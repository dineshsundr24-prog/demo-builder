// Banking building blocks, end to end in the real runtime (deterministic fixture, no AI).
import { test, expect, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

let consoleErrors: string[] = [];
test.beforeEach(async ({ page }) => {
  consoleErrors = [];
  page.on('pageerror', e => consoleErrors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  await page.goto('/');
  await page.locator('.studio-import input').first().setInputFiles(fileURLToPath(new URL('./fixtures/falcon-banking.json', import.meta.url)));
  await expect(page.getByTestId('validation')).toContainText('No errors');
});
test.afterEach(() => expect(consoleErrors, 'console/page errors').toEqual([]));
const device = (p: Page) => p.getByTestId('device');
const open = async (p: Page, title: string) => { await p.locator('.studio-screens button', { hasText: title }).first().click(); };

test('transfer: pick a beneficiary, limits are enforced, the review repeats the entry', async ({ page }) => {
  await open(page, 'Transfer Money');
  const d = device(page);
  await d.getByRole('radio', { name: /Omar Haddad/ }).click();
  await expect(d.getByRole('radio', { name: /Omar Haddad/ })).toHaveAttribute('aria-checked', 'true');
  await d.locator('[data-node-type="AmountInput"] input').fill('60000');
  await d.getByLabel('From account').selectOption({ index: 1 });
  await d.getByLabel('Purpose of payment').selectOption({ index: 1 });
  await d.getByRole('button', { name: 'Review transfer' }).click();
  await expect(d).toContainText(/more than your available balance|Daily limit/);
  await d.getByRole('button', { name: '5,000' }).click();
  await d.getByRole('button', { name: 'Review transfer' }).click();
  await expect(d.locator('[data-screen-id]')).toHaveAttribute('data-screen-id', 'review-transfer');
  await expect(d).toContainText('Omar Haddad');
  await expect(d).toContainText('AED 5,000.00');
});

test('statement: months switch and totals follow', async ({ page }) => {
  await open(page, 'Current Account');
  const st = device(page).locator('[data-node-type="Statement"]');
  await expect(st.getByRole('tab')).toHaveCount(2);
  await expect(st).toContainText('Salary');
  const first = await st.locator('.db-statement-totals').innerText();
  await st.getByRole('tab').nth(1).click();
  await expect(st).toContainText('Etisalat');
  expect(await st.locator('.db-statement-totals').innerText()).not.toBe(first);
  await st.getByRole('button', { name: 'Download PDF' }).click();
  await expect(device(page)).toContainText('downloaded (simulated)');
});

test('card freeze and loan calculator react immediately', async ({ page }) => {
  await open(page, 'My Cards');
  await device(page).getByRole('switch', { name: 'Freeze card' }).check();
  await expect(device(page).getByText('Card frozen')).toBeVisible();
  await open(page, 'Personal Finance');
  const monthly = device(page).getByTestId('emi-monthly');
  const before = await monthly.innerText();
  await device(page).getByRole('button', { name: '12 months' }).click();
  await expect(monthly).not.toHaveText(before);
});
