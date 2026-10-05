import { afterEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import crypto from "node:crypto";
import { proxyTrust } from "../src/proxyTrust.js";
import { createApp } from "../src/app.js";
import { AccountStore } from "../src/account/store.js";
import { registerAccountRoutes } from "../src/account/routes.js";
import { SessionStore } from "../src/domain/session.js";

const caddy = "172.30.250.3";
const trust = `${caddy}/32`;
const origin = "https://guide.example.com";
const apps: Array<ReturnType<typeof Fastify>> = [];
const stores: AccountStore[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map(app => app.close()));
  for (const store of stores.splice(0)) store.close();
  vi.restoreAllMocks();
});

function clientApp(cidrs = "") {
  const app = Fastify({ trustProxy: proxyTrust(cidrs) });
  apps.push(app);
  app.get("/client", request => ({ ip: request.ip, ips: request.ips, host: request.host, protocol: request.protocol }));
  return app;
}
const forwarded = {
  host: "internal:8101",
  "x-forwarded-for": "203.0.113.9, 198.51.100.21",
  "x-forwarded-host": "guide.example.com",
  "x-forwarded-proto": "https",
};

describe("single-hop reverse proxy trust", () => {
  it("ignores all forwarding metadata when proxy trust is unset", async () => {
    const response = await clientApp().inject({ url: "/client", remoteAddress: caddy, headers: forwarded });
    expect(response.json()).toEqual({ ip: caddy, host: "internal:8101", protocol: "http" });
  });

  it.each(["true", "1", "loopback", "caddy/32", "172.30.250.0/24", "0.0.0.0/0", "::/0", "172.30.250.3/33", "172.30.250.3/32,", "172.30.250.3/32/32"])("rejects unsafe or malformed proxy configuration %s", value => {
    expect(() => proxyTrust(value)).toThrow(/exact IPv4 \/32 or IPv6 \/128/);
  });

  it("accepts the nearest forwarded client only from the pinned Caddy address", async () => {
    const response = await clientApp(trust).inject({ url: "/client", remoteAddress: caddy, headers: forwarded });
    expect(response.json()).toEqual({ ip: "198.51.100.21", ips: [caddy, "198.51.100.21"], host: "guide.example.com", protocol: "https" });
  });

  it("ignores spoofed IP, host and protocol from another container on the same bridge", async () => {
    const response = await clientApp(trust).inject({ url: "/client", remoteAddress: "172.30.250.2", headers: forwarded });
    expect(response.json()).toEqual({ ip: "172.30.250.2", ips: ["172.30.250.2"], host: "internal:8101", protocol: "http" });
  });

  it("does not extend trust to a second hop even when it repeats an allowlisted IP", async () => {
    const response = await clientApp(trust).inject({ url: "/client", remoteAddress: caddy, headers: { ...forwarded, "x-forwarded-for": `198.51.100.21, ${caddy}` } });
    expect(response.json().ip).toBe(caddy);
    expect(response.json().ips).toEqual([caddy, caddy]);
  });

  it("recognizes IPv4-mapped sockets and normalized exact IPv6 proxies", async () => {
    const app = clientApp(` ${trust}, fd00:0:0:0:0:0:0:3/128 `);
    for (const remoteAddress of [`::ffff:${caddy}`, "fd00::3"]) {
      expect((await app.inject({ url: "/client", remoteAddress, headers: forwarded })).json().ip).toBe("198.51.100.21");
    }
    expect((await app.inject({ url: "/client", remoteAddress: "fd00::4", headers: forwarded })).json().ip).toBe("fd00::4");
  });

  it("keeps the socket address when the trusted proxy sends no forwarded client", async () => {
    expect((await clientApp(trust).inject({ url: "/client", remoteAddress: caddy })).json().ip).toBe(caddy);
  });
});

function accountApp() {
  const app = Fastify({ trustProxy: proxyTrust(trust) });
  const accounts = new AccountStore({ file: ":memory:" });
  apps.push(app); stores.push(accounts);
  const sessions = new SessionStore();
  registerAccountRoutes(app, { store: accounts, publicOrigin: origin, limits: { loginIp: 1, loginEmail: 100 }, getGuidanceSession: () => sessions.get(crypto.randomUUID()) });
  app.setErrorHandler((error, _request, reply) => reply.code(error.statusCode || 500).send({ error: error.message }));
  return app;
}
function login(app: ReturnType<typeof Fastify>, client: string, remoteAddress = caddy) {
  return app.inject({ method: "POST", url: "/api/account/login", remoteAddress,
    headers: { host: "guide.example.com", origin, "x-forwarded-for": client },
    payload: { email: "missing@example.com", password: "A sufficiently long test password" } });
}

describe("account rate limits behind Caddy", () => {
  it("blocks repeated attempts from one client without blocking another behind the same proxy", async () => {
    const app = accountApp();
    expect((await login(app, "198.51.100.21")).statusCode).toBe(401);
    expect((await login(app, "198.51.100.21")).statusCode).toBe(429);
    expect((await login(app, "198.51.100.22")).statusCode).toBe(401);
  });

  it("prevents direct callers bypassing an IP limit by rotating spoofed forwarding headers", async () => {
    const app = accountApp();
    expect((await login(app, "198.51.100.21", "203.0.113.40")).statusCode).toBe(401);
    expect((await login(app, "198.51.100.22", "203.0.113.40")).statusCode).toBe(429);
  });

  it("wires the production app to trusted proxy client IPs and retains its untrusted fallback", async () => {
    const accounts = new AccountStore({ file: ":memory:" });
    stores.push(accounts);
    const limit = vi.spyOn(accounts, "consumeLimit").mockReturnValue(false);
    const app = await createApp({ accountStore: accounts, trustedProxyCidrs: trust });
    apps.push(app);
    for (const [remoteAddress, client] of [[caddy, "198.51.100.21"], ["203.0.113.40", "198.51.100.22"]] as const) {
      const response = await app.inject({ method: "POST", url: "/api/account/login", remoteAddress,
        headers: { host: "localhost:8102", origin: "http://localhost:8102", "x-forwarded-for": client },
        payload: { email: "missing@example.com", password: "A sufficiently long test password" } });
      expect(response.statusCode).toBe(429);
    }
    expect(limit.mock.calls.map(call => call[0])).toEqual(["login:ip:198.51.100.21", "login:ip:203.0.113.40"]);
  });
});
