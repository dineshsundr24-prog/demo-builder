// Optional brand assets: logo, palette and font at generation time, and live re-styling afterwards.
import { test, expect } from '@playwright/test';

const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><rect width="120" height="40" fill="#7A1F3D"/><text x="10" y="27" fill="#fff" font-size="20">ACME</text></svg>');

test('brand assets apply to the generated app and can be changed afterwards', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await page.getByTestId('new-mobile').click();
  const panel = page.getByRole('dialog', { name: 'Generate with AI' });
  await panel.getByPlaceholder('Demo Builder access token').fill('e2e-token');
  await panel.getByLabel('Project name').fill('Acme Wallet');
  await panel.getByLabel('Business requirements').fill('A mobile wallet with screens:\n1) Start screen\n2) Wallet home with balance and recent payments');
  await panel.getByText('Brand (optional)').click();
  await panel.getByLabel('Upload logo').setInputFiles({ name: 'logo.svg', mimeType: 'image/svg+xml', buffer: svg });
  await expect(panel.getByAltText('Uploaded logo')).toBeVisible();
  await panel.getByRole('radio', { name: 'Burgundy' }).click();
  await panel.getByLabel('Font').selectOption('rounded');
  await panel.getByRole('button', { name: 'Draft plan' }).click();
  await panel.getByRole('button', { name: /Approve and generate/ }).click();
  await expect(panel.locator('.gen-status')).toContainText(/Done/, { timeout: 20000 });
  await panel.getByRole('button', { name: 'Close' }).click();
  const app = page.locator('.db-app');
  await expect(app).toHaveAttribute('style', /--db-primary: #7A1F3D/);
  // The uploaded logo replaces the initials wherever the brand mark is shown.
  await expect(page.getByTestId('device').locator('img.db-brandmark-img').first()).toBeVisible();
  // Re-style the finished demo instantly from the sidebar (no AI call).
  await page.getByText('Brand', { exact: true }).click();
  await page.getByTestId('brand-fields').getByRole('radio', { name: 'Emerald' }).click();
  await expect(app).toHaveAttribute('style', /--db-primary: #0B6E4F/);
  await page.getByRole('button', { name: 'Remove logo' }).click();
  await expect(page.getByTestId('device').locator('img.db-brandmark-img')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('an oversized or non-image logo is refused with a clear message', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('new-portal').click();
  const panel = page.getByRole('dialog', { name: 'Generate with AI' });
  await panel.getByText('Brand (optional)').click();
  await panel.getByLabel('Upload logo').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await expect(panel.getByRole('alert')).toContainText('PNG, JPEG, SVG or WebP');
  await panel.getByLabel('Upload logo').setInputFiles({ name: 'big.png', mimeType: 'image/png', buffer: Buffer.alloc(400 * 1024) });
  await expect(panel.getByRole('alert')).toContainText('under 300 KB');
});
