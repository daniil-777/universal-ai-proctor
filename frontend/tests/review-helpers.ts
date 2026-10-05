import { expect, type Page } from "@playwright/test";
import path from "node:path";
export async function setup(page: Page) {
  await page.goto("/");
  await page.getByTestId("intro-document-input").setInputFiles({
    name: "Readiness.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(
      "Step 1: Prepare\nTools: Torque wrench, inspection lamp\nActions: Place the tool on the table.\nCriteria: Tool visibly on table.\nStep 2: Finish\nActions: Put the tool away.\nCriteria: Tool visibly stored.\nPrinciples: Check the work area before beginning.",
    ),
  });
  await expect(
    page.getByText("Readiness.txt · 2 steps extracted"),
  ).toBeVisible();
  await page
    .getByTestId("intro-video-input")
    .setInputFiles(path.resolve("../evaluation/assets/parts-sorting.mp4"));
  await page.getByRole("button", { name: "Open workspace" }).click();
  await expect
    .poll(() =>
      page
        .locator("video")
        .first()
        .evaluate((v) => (v as HTMLVideoElement).readyState),
    )
    .toBeGreaterThanOrEqual(2);
  if (
    await page
      .getByRole("button", { name: "Pause guidance", exact: true })
      .isVisible()
  )
    await page
      .getByRole("button", { name: "Pause guidance", exact: true })
      .click();
  else {
    await page.getByRole("button", { name: "Sources and setup" }).click();
    if (
      await page
        .getByRole("button", { name: "Pause guidance", exact: true })
        .isVisible()
    )
      await page
        .getByRole("button", { name: "Pause guidance", exact: true })
        .click();
    await page
      .getByRole("button", { name: "Close sources", exact: true })
      .click();
  }
  await page
    .locator("video")
    .first()
    .evaluate((v) => (v as HTMLVideoElement).pause());
}
export async function tool(page: Page, name: string) {
  const tab = page.getByRole("tab", { name, exact: true });
  if (await tab.isVisible()) await tab.click();
  else {
    await page.getByRole("button", { name: "More guidance tools" }).click();
    await page.getByRole("menuitem", { name, exact: true }).click();
  }
}
export async function api(page: Page, route: string) {
  return page.evaluate(
    async (route) =>
      (
        await fetch(route, {
          headers: {
            "X-Guidance-Session": sessionStorage.getItem(
              "process-guide-session",
            )!,
          },
        })
      ).json(),
    route,
  );
}
