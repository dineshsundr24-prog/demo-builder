// The AI generation flow in the studio against the real API server (fake AI provider, no cost).
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const brief = readFileSync(new URL('../../../packages/generator/fixtures/kapiko-brief.md', import.meta.url), 'utf8');

test('brief -> editable plan -> approve -> 12 generated screens load and run; one screen regenerates', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/?generate=1');
  const panel = page.getByRole('dialog', { name: 'Generate with AI' });
  await panel.getByPlaceholder('Demo Builder access token').fill('e2e-token');
  await panel.getByLabel('Project name').fill('Kapiko Bank Mobile');
  await panel.getByLabel('Business requirements').fill(brief);
  await panel.getByRole('button', { name: 'Draft plan' }).click();
  await expect(panel.locator('.gen-plan li')).toHaveCount(12, { timeout: 10000 });
  await panel.getByLabel('Title of screen 12').fill('My Profile');
  await panel.getByRole('button', { name: 'Approve and generate 12 screens' }).click();
  await expect(panel.getByText('Done: all screens generated and validated.')).toBeVisible({ timeout: 20000 });
  await expect(panel.locator('.gen-progress li[data-status="valid"]')).toHaveCount(12);
  await expect(panel.locator('.gen-status')).toContainText('USD');
  // The generated document is loaded into the preview, valid, with the edited title.
  await expect(page.getByTestId('validation')).toContainText('No errors');
  await expect(page.locator('.studio-screens li')).toHaveCount(12);
  await expect(page.locator('.studio-screens')).toContainText('My Profile');
  // Regenerate a single screen: only that row runs again.
  await panel.getByRole('button', { name: 'Regenerate Dashboard' }).click();
  await expect(panel.getByText('Done: all screens generated and validated.')).toBeVisible({ timeout: 20000 });
  await panel.getByRole('button', { name: 'Close' }).click();
  // And it runs: Welcome -> Sign in -> Dashboard.
  const d = page.getByTestId('device');
  await d.getByRole('button', { name: 'Sign in', exact: true }).click();
  await d.getByLabel('Mobile or email').fill('ahmed@example.com');
  await d.getByLabel('Password').fill('x');
  await d.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(d.locator('[data-screen-id]')).toHaveAttribute('data-screen-id', 'dashboard');
  expect(errors).toEqual([]);
});

test('a wrong access token is reported clearly and nothing starts', async ({ page }) => {
  await page.goto('/?generate=1');
  const panel = page.getByRole('dialog', { name: 'Generate with AI' });
  await panel.getByPlaceholder('Demo Builder access token').fill('wrong');
  await panel.getByLabel('Business requirements').fill(brief);
  await panel.getByRole('button', { name: 'Draft plan' }).click();
  await expect(panel.getByRole('alert')).toContainText('Missing or invalid Demo Builder access token');
});
