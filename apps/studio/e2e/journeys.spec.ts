// Phase 1 exit gate: the acceptance journeys run in a real browser through the
// single runtime renderer. No page errors or console errors are tolerated.
import { test, expect, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

let consoleErrors: string[] = [];
test.beforeEach(async ({ page }) => {
  consoleErrors = [];
  page.on('pageerror', e => consoleErrors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
});
test.afterEach(() => expect(consoleErrors, 'console/page errors').toEqual([]));

const device = (page: Page) => page.getByTestId('device');
const title = (page: Page) => device(page).locator('[data-screen-id]');
async function expectScreen(page: Page, id: string) { await expect(title(page)).toHaveAttribute('data-screen-id', id, { timeout: 8000 }); }

test.describe('Kapiko mobile', () => {
  test.beforeEach(async ({ page }) => { await page.goto('/?doc=kapiko'); await expect(page.getByTestId('validation')).toContainText('No errors'); });

  test('journey A: welcome -> sign up -> OTP -> eKYC -> face -> dashboard', async ({ page }) => {
    const d = device(page);
    await expect(d.locator('.db-tabs')).toHaveCount(0); // shell hidden on welcome
    await d.getByRole('button', { name: 'Create account' }).click();
    await expectScreen(page, 'sign-up');
    await d.getByRole('button', { name: 'Continue' }).click();
    await expect(d.getByRole('alert')).toHaveCount(5);
    await d.getByLabel('Full name').fill('Ahmed Al Hammadi');
    await d.getByLabel('UAE mobile').fill('+971 50 123 4567');
    await d.getByLabel('Email').fill('ahmed@example.com');
    await d.getByLabel('Password').fill('Secret#123');
    await d.getByText('I accept the terms and conditions').click();
    await d.getByRole('button', { name: 'Continue' }).click();
    await expectScreen(page, 'mobile-otp-verification');
    await expect(d).toContainText('+971 50 123 4567 (simulated, no SMS is sent)');
    await d.getByLabel('Verification code').fill('123456');
    await d.getByRole('button', { name: 'Verify' }).click();
    await expect(d.getByRole('status')).toContainText('simulated');
    await expectScreen(page, 'ekyc-using-uae-pass');
    await d.getByText('I consent to sharing my identity details').click();
    await d.getByRole('button', { name: 'Confirm identity' }).click();
    await expectScreen(page, 'face-verification');
    await expect(d).toContainText('No camera or biometric data is captured');
    await d.getByRole('button', { name: 'Start face scan' }).click();
    await expectScreen(page, 'dashboard');
    await expect(d).toContainText('AED 48,750.00');
    await expect(d.locator('.db-tabs')).toBeVisible();
  });

  test('journey B: welcome -> sign in -> dashboard, then back returns', async ({ page }) => {
    const d = device(page);
    await d.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expectScreen(page, 'sign-in');
    await d.getByLabel('Mobile or email').fill('ahmed@example.com');
    await d.getByLabel('Password').fill('x');
    await d.getByRole('button', { name: 'Show' }).click();
    await expect(d.getByLabel('Password')).toHaveAttribute('type', 'text');
    await d.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expectScreen(page, 'dashboard');
    await d.getByRole('button', { name: 'Back' }).click();
    await expectScreen(page, 'sign-in');
  });

  test('UAE PASS sign-in is simulated and lands on dashboard', async ({ page }) => {
    const d = device(page);
    await d.getByRole('button', { name: 'Sign in', exact: true }).click();
    await d.getByRole('button', { name: 'Sign in with UAE PASS' }).click();
    await expect(d.getByRole('status')).toContainText('Authenticating with UAE PASS (simulated)');
    await expectScreen(page, 'dashboard');
  });

  test('income journey carries entered values to review and confirmation', async ({ page }) => {
    await page.goto('/?doc=kapiko&screen=dashboard');
    const d = device(page);
    await d.getByRole('button', { name: 'Update income' }).click();
    await expectScreen(page, 'income-update');
    await d.getByRole('button', { name: 'Continue' }).click();
    await expect(d.getByText('New monthly salary (AED) is required')).toBeVisible();
    await d.getByLabel('New monthly salary (AED)').fill('21500');
    await d.getByLabel('Employment status').selectOption('Employed');
    await d.getByLabel('Effective date').fill('2026-12-01');
    await d.locator('input[type=file]').setInputFiles({ name: 'salary-certificate.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 fictional') });
    await expect(d).toContainText('salary-certificate.pdf');
    await d.getByRole('button', { name: 'Continue' }).click();
    await expectScreen(page, 'income-verification-review');
    await expect(d).toContainText('AED 21500');
    await expect(d).toContainText('Employed');
    await d.getByText('I confirm these details are accurate').click();
    await d.getByRole('button', { name: 'Confirm and submit' }).click();
    await expectScreen(page, 'income-update-confirmation');
    await d.getByRole('button', { name: 'View request' }).click();
    await expectScreen(page, 'my-service-requests');
    await expect(d).toContainText('KPK-INC-2026-00125');
  });

  test('bottom tabs navigate between dashboard, requests and profile', async ({ page }) => {
    await page.goto('/?doc=kapiko&screen=dashboard');
    const tabs = device(page).locator('.db-tabs');
    await tabs.getByRole('button', { name: 'Profile' }).click();
    await expectScreen(page, 'customer-profile');
    await expect(tabs.getByRole('button', { name: 'Profile' })).toHaveAttribute('aria-current', 'page');
    await tabs.getByRole('button', { name: 'Requests' }).click();
    await expectScreen(page, 'my-service-requests');
  });
});

test.describe('Staff portal', () => {
  test.beforeEach(async ({ page }) => { await page.goto('/?doc=portal&screen=applications'); await expect(page.getByTestId('validation')).toContainText('No errors'); });

  test('two different rows open the same details page with their own data', async ({ page }) => {
    const d = device(page);
    await d.getByRole('row', { name: /Ahmed Al Hammadi/ }).getByRole('button', { name: 'View' }).click();
    await expectScreen(page, 'application-details');
    await expect(d.locator('.db-page-head')).toContainText('APP-20481 · Ahmed Al Hammadi');
    await expect(d).toContainText('AED 750,000.00');
    await d.getByRole('button', { name: 'Back' }).click();
    await d.getByRole('row', { name: /Mariam Al Suwaidi/ }).getByRole('button', { name: 'View' }).click();
    await expect(d.locator('.db-page-head')).toContainText('APP-20482 · Mariam Al Suwaidi');
    await expect(d).toContainText('AED 85,000.00');
    await expect(d).not.toContainText('Ahmed Al Hammadi');
  });

  test('maker -> checker updates the selected application through to Completed', async ({ page }) => {
    const d = device(page);
    await d.getByRole('row', { name: /Mariam Al Suwaidi/ }).getByRole('button', { name: 'View' }).click();
    await d.getByRole('button', { name: 'Start maker review' }).click();
    await expectScreen(page, 'maker-review');
    await d.getByRole('button', { name: 'Submit to checker' }).click();
    await expect(d.getByText('Recommendation is required')).toBeVisible();
    await d.getByLabel('Recommendation').selectOption('Recommend approval');
    await d.getByLabel('Comments').fill('Salary certificate verified');
    await d.getByRole('button', { name: 'Submit to checker' }).click();
    await expectScreen(page, 'applications');
    await expect(d.getByRole('row', { name: /Mariam Al Suwaidi/ })).toContainText('Pending checker');
    await d.getByRole('row', { name: /Mariam Al Suwaidi/ }).getByRole('button', { name: 'View' }).click();
    await d.getByRole('button', { name: 'Checker decision' }).click();
    await expectScreen(page, 'checker-approval');
    await expect(d).toContainText('Recommend approval');
    await expect(d).toContainText('Salary certificate verified');
    await d.getByRole('button', { name: 'Approve' }).click();
    await expectScreen(page, 'completed');
    await expect(d.getByRole('row', { name: /Mariam Al Suwaidi/ })).toContainText('Approved');
    await expect(d.getByRole('row', { name: /Ahmed Al Hammadi/ })).toContainText('Pending maker');
  });

  test('search, status filter and sidebar sub-navigation', async ({ page }) => {
    const d = device(page);
    await d.getByRole('searchbox', { name: 'Search' }).fill('omar');
    await expect(d.locator('tbody tr')).toHaveCount(1);
    await d.getByRole('searchbox', { name: 'Search' }).fill('');
    await d.getByLabel('Filter').selectOption('Pending maker');
    await expect(d.locator('tbody tr')).toHaveCount(2);
    await d.locator('.db-sidebar').getByRole('button', { name: 'Completed' }).click();
    await expectScreen(page, 'completed');
    await d.locator('.db-sidebar').getByRole('button', { name: 'Reports' }).click();
    await expectScreen(page, 'reports');
  });
});

test('importing a v1 export migrates it and it runs with no validation errors', async ({ page }) => {
  await page.goto('/');
  await page.locator('.studio-import input').setInputFiles(fileURLToPath(new URL('./fixtures/v1-portal-starter.json', import.meta.url)));
  await expect(page.getByTestId('validation')).toContainText('No errors');
  const d = device(page);
  await expect(d.locator('.db-sidebar')).toContainText('Banking Operations');
  await d.getByRole('row', { name: /Sarah Ahmed/ }).getByRole('button', { name: 'View' }).click();
  await expectScreen(page, 'application');
  await d.getByLabel('Customer name').fill('Sarah Ahmed');
  await d.getByLabel('Email address').fill('sarah@example.com');
  await d.getByLabel('Requested amount (AED)').fill('750000');
  await d.getByLabel('Review decision').selectOption('Approved');
  await d.getByRole('button', { name: 'Submit review' }).click();
  await expectScreen(page, 'complete');
});
