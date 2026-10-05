import { expect, test } from "@playwright/test";

const expected = ["real-house-construction", "real-manufacturing", "real-surgery", "real-dancing", "real-sport"];
type Sample = { id: string; name: string; guidance: string; license: string; author: string; source_url: string; duration_s: number };

for (const width of [1440, 320]) {
  test.describe(`real footage at ${width}px`, () => {
    test.use({ viewport: { width, height: 1000 }, hasTouch: width === 320 });
    test("selects all five video/reference pairs with honest attribution and preserves the original option", async ({ page }) => {
      await page.goto("/");
      const catalog = await (await page.request.get("/api/samples")).json();
      const samples: Sample[] = catalog.videos.filter((sample: Sample) => expected.includes(sample.id));
      expect(samples.map(sample => sample.id)).toEqual(expected);
      const session = await page.evaluate(() => sessionStorage.getItem("process-guide-session")!);
      const headers = { "x-guidance-session": session };
      const select = page.getByRole("combobox", { name: "Choose a sample video", exact: true });
      let lastReference: { workflow: { steps: { name: string }[] } } | undefined;
      for (const sample of samples) {
        await expect(select).toBeEnabled();
        await select.click();
        const option = page.getByRole("option").filter({ hasText: sample.name });
        await expect(option).toContainText(sample.license);
        const box = await option.boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
        expect(await option.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
        await option.click();
        await expect(page.getByText(new RegExp(`${sample.guidance.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} · \\d+ steps extracted`))).toBeVisible();
        await expect(page.getByRole("link", { name: "Original source", exact: true })).toHaveAttribute("href", sample.source_url);
        await expect(page.getByText(`Video by ${sample.author}. ${sample.license}`)).toBeVisible();
        const reference = await (await page.request.get("/api/reference", { headers })).json();
        expect(reference.filename).toBe(sample.guidance);
        expect(reference.workflow.steps.every((step: { complete: boolean; criteria: { status: string }[] }) => !step.complete && step.criteria.every(criterion => criterion.status === "unknown"))).toBe(true);
        lastReference = reference;
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
      await page.reload();
      await expect(page.getByRole("link", { name: "Original source", exact: true })).toHaveAttribute("href", samples.at(-1)!.source_url);
      await select.click();
      await expect(page.getByRole("option", { name: /Uncomplicated cholecystectomy/ })).toContainText("Original default");
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Open workspace" }).click();
      const pause = page.getByRole("button", { name: "Pause guidance", exact: true });
      if (await pause.isVisible()) await pause.click();
      await expect(page.getByTestId("step-S1")).toContainText(lastReference!.workflow.steps[0].name);
      await page.getByRole("tab", { name: "Principles", exact: true }).click();
      const principles = page.getByRole("tabpanel", { name: "Principles", exact: true });
      await expect(principles.getByText("Process principles", { exact: true })).toBeVisible();
      await expect(principles.getByText(samples.at(-1)!.source_url, { exact: false })).toBeVisible();
      expect(await principles.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const video = page.locator("video").first();
      await expect.poll(() => video.evaluate(el => (el as HTMLVideoElement).duration)).toBeGreaterThanOrEqual(120);
      await expect.poll(() => video.evaluate(el => (el as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(1);
      expect(await video.evaluate(el => (el as HTMLVideoElement).duration)).toBeLessThanOrEqual(180.1);
    });
  });
}
