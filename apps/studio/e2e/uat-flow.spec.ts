// The UAT path: product-neutral start screen and a free-form, non-Kapiko requirement.
import { test, expect } from '@playwright/test';

test('start screen -> new staff portal from a free-form brief -> add a screen -> generate -> reopen from recent', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Create a new demo' })).toBeVisible();
  await expect(page.getByTestId('device')).toHaveCount(0); // nothing preloaded
  await page.getByTestId('new-portal').click();
  const panel = page.getByRole('dialog', { name: 'Generate with AI' });
  await expect(panel.getByTestId('api-status')).toContainText('Connected');
  await expect(panel.getByLabel('Channel')).toHaveValue('portal');
  await panel.getByPlaceholder('Demo Builder access token').fill('e2e-token');
  await panel.getByLabel('Project name').fill('HR Leave Portal');
  await panel.getByLabel('Business requirements').fill('A staff portal where HR officers review employee leave requests, approve or reject them, and see a dashboard of pending requests.');
  await panel.getByRole('button', { name: 'Draft plan' }).click();
  await expect(panel.locator('.gen-plan li')).toHaveCount(2, { timeout: 10000 });
  await panel.getByRole('button', { name: 'Add screen' }).click();
  await panel.getByLabel('Title of screen 3').fill('Leave Calendar');
  await panel.getByRole('button', { name: 'Approve and generate 3 screens' }).click();
  await expect(panel.locator('.gen-status')).toContainText(/Done/, { timeout: 20000 });
  await expect(panel.locator('.gen-status')).toContainText('USD');
  await panel.getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('.studio-screens li')).toHaveCount(3);
  await expect(page.locator('.studio-screens')).toContainText('Leave Calendar');
  await expect(page.locator('.studio-current')).toContainText('HR Leave Portal');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download JSON' }).click();
  expect((await download).suggestedFilename()).toMatch(/\.json$/);
  // Back to the start screen and reopen the generation from the recent list.
  await page.getByRole('button', { name: 'New demo' }).click();
  await page.getByRole('button', { name: 'Open a previous generation' }).click();
  await expect(panel.locator('.gen-recent li').first()).toContainText('HR Leave Portal');
  await panel.locator('.gen-recent li').first().getByRole('button', { name: 'Open' }).click();
  await expect(panel.locator('.gen-status')).toContainText(/Done/, { timeout: 10000 });
  await panel.getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('.studio-screens li')).toHaveCount(3);
  expect(errors).toEqual([]);
});
