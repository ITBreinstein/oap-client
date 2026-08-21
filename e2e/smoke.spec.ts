import { expect, test } from "@playwright/test";

test("the app boots", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("core-version")).toContainText("core ");
});
