import { expect, test } from "@playwright/test";

/**
 * Camera + Face Detection API can't be granted in headless tests without
 * additional setup. We verify UI plumbing and feature-detection messaging.
 */
test("arm screen advertises Face Detection availability or fallback", async ({ page, baseURL }) => {
  await page.goto(baseURL ?? "");
  await expect(page.getByRole("button", { name: /arm front camera/i })).toBeVisible();
  // Either the API is available message or the manual-mode fallback message renders.
  const apiText = page.getByText(/Face Detection API/);
  const fallbackText = page.getByText(/manual mode/i);
  await expect(apiText.or(fallbackText)).toBeVisible();
});

test("empty meet list is shown until a 5-second mutual hold lands", async ({ page, baseURL }) => {
  await page.goto(baseURL ?? "");
  await expect(page.getByText(/no mutual 5-second holds yet/i)).toBeVisible();
});
