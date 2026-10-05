// CI only: real app + Caddy on a private Docker bridge, with a local TLS CA.
// No Oracle resources, external certificate requests, provider keys or paid AI.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const directory = path.dirname(fileURLToPath(import.meta.url));
const temp = await mkdtemp(path.join(os.tmpdir(), 'process-guide-proxy-ci-'));
const network = `process-guide-proxy-ci-${randomUUID().slice(0, 8)}`, app = `${network}-app`, proxy = `${network}-caddy`;
const appVolume = `${network}-data`, tlsVolume = `${network}-tls`;
const base = 'https://localhost:8443', session = randomUUID();
let ca, cookie = '', completed = false;
const owned = { network: false, appVolume: false, tlsVolume: false, app: false, proxy: false };
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function request(route, body, headers = {}, method = body ? 'POST' : 'GET') {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const bytes = body ? Buffer.from(JSON.stringify(body)) : undefined;
    const req = https.request(new URL(route, base), {
      method, ca, family: 4,
      headers: { Origin: base, 'X-Guidance-Session': session, ...(cookie ? { Cookie: cookie } : {}),
        ...(bytes ? { 'Content-Type': 'application/json', 'Content-Length': bytes.length } : {}), ...headers },
    }, response => {
      const chunks = []; let firstChunkMs;
      response.on('data', chunk => { firstChunkMs ??= performance.now() - started; chunks.push(chunk); });
      response.on('error', reject);
      response.on('end', () => {
        for (const value of response.headers['set-cookie'] || []) if (value.startsWith('process-guide-account=')) cookie = value.split(';')[0];
        resolve({ status: response.statusCode, headers: response.headers, bytes: Buffer.concat(chunks), firstChunkMs, totalMs: performance.now() - started });
      });
    });
    req.setTimeout(60_000, () => req.destroy(new Error(`Proxy request timed out: ${route}`)));
    req.on('error', reject);
    req.end(bytes);
  });
}
async function json(route, body, headers, method) {
  const result = await request(route, body, headers, method);
  assert.equal(result.status, 200, `${route}: ${result.status} ${result.bytes.toString().slice(0, 300)}`);
  return JSON.parse(result.bytes.toString());
}

try {
  let config = await readFile(path.join(directory, 'Caddyfile'), 'utf8');
  // Exercise the production proxy directives; only local trust and a CI-only
  // header probe differ. The probe is never present in the published Caddyfile.
  config = config.replace('email {$ACME_EMAIL}', 'email {$ACME_EMAIL}\n\tskip_install_trust')
    .replace('reverse_proxy app:8101', 'reverse_proxy /__ci_proxy_probe app:8110\n\treverse_proxy app:8101');
  const configFile = path.join(temp, 'Caddyfile'), certFile = path.join(temp, 'root.crt');
  await writeFile(configFile, config);
  docker('network', 'create', '--subnet', '172.30.250.0/24', network); owned.network = true;
  docker('volume', 'create', appVolume); owned.appVolume = true;
  docker('volume', 'create', tlsVolume); owned.tlsVolume = true;
  docker('run', '--detach', '--name', app, '--network', network, '--network-alias', 'app', '--ip', '172.30.250.2',
    '--mount', `source=${appVolume},target=/data`, '--env', 'MOCK=1', '--env', `ACCOUNT_PUBLIC_ORIGIN=${base}`,
    '--env', 'ACCOUNT_COOKIE_SECURE=true', '--env', 'TRUST_PROXY_CIDRS=172.30.250.3/32',
    '--env', 'OPENAI_API_KEY=', '--env', 'ANTHROPIC_API_KEY=', '--env', 'GOOGLE_API_KEY=', '--env', 'HF_API_KEY=',
    'process-guide:ci'); owned.app = true;
  docker('exec', '--detach', '--user', 'node', app, 'node', '--input-type=module', '-e',
    "import http from 'node:http'; http.createServer((req,res)=>{if(req.url.includes('events=1')){res.setHeader('Content-Type','text/event-stream');res.write('data: {\"tick\":1}\\n\\n');setTimeout(()=>res.end('data: {\"done\":true}\\n\\n'),250);return;}res.setHeader('Content-Type','application/json');res.end(JSON.stringify({headers:req.headers,peer:req.socket.remoteAddress}));}).listen(8110,'0.0.0.0');");
  docker('run', '--detach', '--name', proxy, '--network', network, '--ip', '172.30.250.3',
    '--publish', '127.0.0.1:8443:443', '--mount', `type=bind,source=${configFile},target=/etc/caddy/Caddyfile,readonly`,
    '--mount', `source=${tlsVolume},target=/data`, '--env', 'APP_DOMAIN=localhost', '--env', 'ACME_EMAIL=owner@example.com',
    'caddy:2.11.7-alpine'); owned.proxy = true;
  let ready = false;
  for (let attempt = 0; attempt < 45; attempt++) {
    try {
      docker('cp', `${proxy}:/data/caddy/pki/authorities/local/root.crt`, certFile);
      ca = await readFile(certFile);
      if ((await request('/api/health')).status === 200) { ready = true; break; }
    } catch { /* local CA/server is still starting */ }
    await delay(1000);
  }
  assert.ok(ready, 'Private app/Caddy HTTPS did not become ready');
  const health = await json('/api/health');
  assert.equal(health.mock, true);
  assert.ok(Object.values(health.providers).every(value => value === false));
  assert.ok((await request('/')).bytes.toString().includes('<html'));
  const probe = await json('/__ci_proxy_probe', undefined, {
    'X-Forwarded-For': '203.0.113.7, 172.30.250.3', 'X-Forwarded-Proto': 'http', 'X-Forwarded-Host': 'attacker.invalid',
  });
  assert.ok(!probe.headers['x-forwarded-for'].includes('203.0.113.7'), 'Client-supplied IP reached the backend');
  assert.equal(probe.headers['x-forwarded-proto'], 'https');
  assert.equal(probe.headers['x-forwarded-host'], 'localhost:8443');
  assert.match(probe.peer, /(?:^|:)172\.30\.250\.3$/);
  const events = await request('/__ci_proxy_probe?events=1');
  assert.equal(events.status, 200);
  assert.ok(events.firstChunkMs < events.totalMs - 100, 'SSE was buffered until the stream finished');
  const samples = await json('/api/samples'), source = randomUUID();
  assert.equal(samples.videos.length, 6);
  await json('/api/source', { source_id: source, kind: 'video', name: 'Proxy smoke' });
  const loaded = await json('/api/video/load-sample', { id: samples.videos.at(-1).id, source_id: source });
  const range = await request(loaded.stream_url, undefined, { Range: 'bytes=0-99' });
  assert.equal(range.status, 206); assert.equal(range.bytes.length, 100);
  assert.equal(range.headers['content-encoding'], undefined);
  const stream = await request('/api/llm/ask/stream', { source_id: source, current_s: 12, question: 'What should I check?' });
  assert.equal(stream.status, 200); assert.match(stream.headers['content-type'], /text\/event-stream/);
  assert.ok(stream.bytes.toString().includes('"done":true') && !stream.bytes.toString().includes('"error":'));
  assert.equal(stream.headers['content-encoding'], undefined);
  const email = `proxy-${randomUUID()}@example.com`, password = `${randomUUID()}-test`;
  const registration = await request('/api/account/register', { name: 'Proxy smoke', email, password });
  assert.equal(registration.status, 200);
  const setCookie = registration.headers['set-cookie'].find(value => value.startsWith('process-guide-account='));
  assert.match(setCookie, /(?:^|;\s*)Secure(?:;|$)/i);
  assert.match(setCookie, /(?:^|;\s*)HttpOnly(?:;|$)/i);
  assert.match(setCookie, /SameSite=Strict/i);
  assert.equal((await json('/api/account/me')).user.email, email);
  const rejected = await request('/api/account/logout', {}, { Origin: 'https://attacker.invalid' });
  assert.equal(rejected.status, 403);
  await json('/api/account/me', { password, confirmation: 'DELETE' }, undefined, 'DELETE');
  completed = true;
  console.log('Private app/Caddy TLS, forwarding-header spoof rejection, video ranges, SSE, secure account cookies and origin protection passed. Paid AI calls: zero. No cloud VM was used.');
} finally {
  if (!completed) for (const name of [app, proxy]) {
    try { process.stderr.write(docker('logs', '--tail', '80', name) + '\n'); } catch { /* container may not exist */ }
  }
  for (const [key, args] of [
    ['proxy', ['rm', '--force', proxy]], ['app', ['rm', '--force', app]],
    ['tlsVolume', ['volume', 'rm', tlsVolume]], ['appVolume', ['volume', 'rm', appVolume]],
    ['network', ['network', 'rm', network]],
  ]) if (owned[key]) { try { docker(...args); } catch { /* preserve original error */ } }
  await rm(temp, { recursive: true, force: true });
}
