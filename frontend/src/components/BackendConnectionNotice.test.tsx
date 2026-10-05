import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BackendConnectionNotice } from "./BackendConnectionNotice";

const mock = vi.hoisted(() => ({ app: { apiBase: "", health: { ok: false }, setApiBase: vi.fn() }, health: vi.fn() }));
vi.mock("@/lib/store", () => ({ useApp: () => mock.app }));
vi.mock("@/lib/api", () => ({ apiJson: mock.health }));
beforeEach(() => {
  vi.stubEnv("VITE_STATIC_HOSTING", "true");
  mock.app.apiBase = window.location.origin;
  mock.app.health = { ok: false };
  mock.app.setApiBase.mockReset();
  mock.health.mockReset().mockResolvedValue({ ok: true });
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

it("explains the public preview's limits without pretending to run recognition", () => {
  render(<BackendConnectionNotice />);
  expect(screen.getByText("Public preview")).toBeVisible();
  expect(screen.getByText(/AI guidance requires a backend; use the full app for accounts and saved results/)).toBeVisible();
  expect(mock.health).not.toHaveBeenCalled();
});

it("checks the chosen backend before applying a normalized connection", async () => {
  render(<BackendConnectionNotice />);
  fireEvent.click(screen.getByRole("button", { name: "Connect backend" }));
  fireEvent.change(screen.getByLabelText("Backend address"), { target: { value: "https://backend.example.com/" } });
  fireEvent.click(screen.getByRole("button", { name: "Connect workspace" }));
  await waitFor(() => expect(mock.app.setApiBase).toHaveBeenCalledWith("https://backend.example.com"));
  expect(mock.health).toHaveBeenCalledWith("https://backend.example.com/api/health");
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("keeps a failed backend connection reviewable and never substitutes simulated analysis", async () => {
  mock.health.mockRejectedValue(new Error("Network unavailable"));
  render(<BackendConnectionNotice />);
  fireEvent.click(screen.getByRole("button", { name: "Connect backend" }));
  fireEvent.change(screen.getByLabelText("Backend address"), { target: { value: "https://backend.example.com" } });
  fireEvent.click(screen.getByRole("button", { name: "Connect workspace" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not connect");
  expect(screen.getByLabelText("Backend address")).toHaveValue("https://backend.example.com");
  expect(mock.app.setApiBase).not.toHaveBeenCalled();
});

it("does not show a public-hosting notice in the local app", () => {
  vi.stubEnv("VITE_STATIC_HOSTING", "false");
  render(<BackendConnectionNotice />);
  expect(screen.queryByLabelText("Backend connection")).toBeNull();
});

it("links prominently to the complete hosted workspace when configured", () => {
  vi.stubEnv("VITE_FULL_APP_URL", "https://universal-ai-proctor.example.com");
  render(<BackendConnectionNotice />);
  expect(screen.getByRole("link", { name: "Open full app" })).toHaveAttribute("href", "https://universal-ai-proctor.example.com/");
});
