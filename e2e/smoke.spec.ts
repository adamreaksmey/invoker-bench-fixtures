import { test, expect } from "@playwright/test";

test("auth session smoke (baseline harness)", async ({ page }) => {
  const username = `u_${Date.now()}`;
  const password = "password123";

  await page.goto("/");
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page.getByText("Good to see you")).toBeVisible({ timeout: 15_000 });

  await page.reload();
  await expect(page.getByText("Good to see you")).toBeVisible({ timeout: 15_000 });
});

test("ledger account smoke (W1 acceptance)", async ({ page }) => {
  test.fixme(true, "Enable after W1 persisted ledger; baseline in-memory UI timing is flaky in CI");
});
