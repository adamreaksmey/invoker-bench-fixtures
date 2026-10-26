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
  const username = `ledger_${Date.now()}`;
  const password = "password123";

  await page.goto("/");
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Good to see you")).toBeVisible({ timeout: 15_000 });

  await page.getByLabel("Account name").fill("Everyday checking");
  await page.getByRole("button", { name: "Add account" }).click();
  await expect(page.locator(".balance-note")).toHaveText("Everyday checking");

  await page.getByLabel("Description").fill("Paycheck");
  await page.getByLabel("Amount").fill("125.50");
  await page.getByRole("button", { name: "Save transaction" }).click();
  await expect(page.locator(".balance-amount")).toHaveText("$125.50");

  await page.reload();
  await expect(page.locator(".balance-amount")).toHaveText("$125.50");

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Good to see you")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".balance-amount")).toHaveText("$125.50");
});
