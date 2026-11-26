// Phase A2: opening Demo Builder from (simulated) MEYON: one-time launch link, confirmation of the approved story,
// Create (plan review -> generation -> saved demo with story coverage) and Extend (base demo by stable ids).
import { test, expect, type Page, type BrowserContext } from '@playwright/test';

let consoleErrors: string[] = [];
// A used launch link is expected to answer 410; a cancelled launch's confirm 409.
const watch = (page: Page) => {
  page.on('pageerror', e => consoleErrors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/status of (410|409)/.test(m.text())) consoleErrors.push(m.text()); });
};
test.beforeEach(async ({ page }) => { consoleErrors = []; watch(page); });
test.afterEach(() => expect(consoleErrors, 'console/page errors').toEqual([]));

/** The simulator stands in for MEYON's Demo tab; returns the Builder tab it opens. */
async function launchFromMeyon(page: Page, context: BrowserContext, o: { story: string; extend?: string }) {
  await page.goto('/?sim=meyon');
  await page.evaluate(() => sessionStorage.setItem('db-access', 'e2e-token'));
  await page.reload();
  await page.getByTestId('sim').getByText(o.story, { exact: true }).click();
  if (o.extend) { await page.getByLabel('Extend existing demo').check(); await page.getByLabel('Base demo').selectOption(o.extend); } // parallel tests create baselines too
  const opened = context.waitForEvent('page');
  await page.getByTestId('sim-open').click();
  const tab = await opened; watch(tab);
  await tab.waitForLoadState();
  return { tab, link: await page.getByTestId('sim-opened').getByRole('link').getAttribute('href') };
}

test('Create: confirm the approved story, review the plan, generate, save, and see story coverage', async ({ page, context }) => {
  const { tab, link } = await launchFromMeyon(page, context, { story: 'US-101' });
  const confirm = tab.getByTestId('launch-confirm');
  await expect(confirm).toContainText('Create a new demo for this story');
  await expect(confirm).toContainText('Apply for a personal loan in the mobile app');
  await expect(confirm).toContainText('shared MEYON login, not an individual identity');
  await expect(tab.getByTestId('launch-criteria').locator('li')).toHaveCount(5);
  await expect(confirm).toContainText('optional AI suggestions (not approved requirements)');
  expect(tab.url()).not.toContain('launch='); // the one-time code never stays in the address bar
  await tab.getByTestId('launch-go').click();

  // Plan review: nothing is generated before approval; screens show which criteria they demonstrate.
  await expect(tab.getByText(/Demonstrates \d approved acceptance criteri/).first()).toBeVisible({ timeout: 10000 });
  await tab.getByRole('button', { name: /Approve and generate/ }).click();
  await expect(tab.locator('.gen-status')).toHaveAttribute('data-status', /completed/, { timeout: 15000 });
  await tab.getByRole('button', { name: 'Close' }).click();
  await expect(tab.getByTestId('versions')).toBeVisible({ timeout: 8000 }); // saved automatically, in the MEYON project
  await expect(tab.getByTestId('launch-banner')).toContainText('US-101');
  await expect(tab.getByTestId('account')).toContainText('Opened from MEYON');

  // Coverage: every approved criterion is listed; the placeholder screens only plan them (not visibly shown yet).
  const coverage = tab.getByTestId('coverage');
  await expect(coverage.locator('.coverage-list > li')).toHaveCount(5);
  await expect(coverage.locator('.coverage-count')).toHaveText('0/5');
  await coverage.locator('.coverage-list > li').first().getByRole('button', { name: 'This screen' }).click();
  await expect(coverage.locator('.coverage-count')).toHaveText('1/5');
  await expect(tab.getByTestId('save-state')).toHaveText('All changes saved', { timeout: 8000 });
  await tab.getByLabel('Version note').fill('US-101');
  await tab.getByRole('button', { name: 'Save version' }).click();
  await expect(tab.locator('[data-version="1"]')).toBeVisible();

  // Reloading the tab continues the same launch; the one-time link cannot be used again.
  await tab.reload();
  await expect(tab.getByTestId('launch-banner')).toContainText('US-101');
  await expect(tab.getByTestId('coverage').locator('.coverage-count')).toHaveText('1/5', { timeout: 8000 });
  const again = await context.newPage(); watch(again);
  await again.goto(link!);
  await expect(again.getByTestId('launch-error')).toContainText('expired or was already used');
});

test('Cancel leaves nothing behind', async ({ page, context }) => {
  const { tab } = await launchFromMeyon(page, context, { story: 'US-103' });
  await tab.getByTestId('launch-cancel').click();
  await expect(tab.getByTestId('launch-cancelled')).toContainText('Nothing was created');
  await tab.reload();
  await expect(tab.getByRole('heading', { name: 'Create a new demo' })).toBeVisible(); // a plain Studio, no MEYON session
});

test('Extend opens the chosen base demo with the new story\'s coverage', async ({ page, context }) => {
  // A baseline of the simulated tenant: create, save a version.
  const first = await launchFromMeyon(page, context, { story: 'US-103' });
  await first.tab.getByTestId('launch-go').click();
  await first.tab.getByRole('button', { name: /Approve and generate/ }).click({ timeout: 10000 });
  await expect(first.tab.locator('.gen-status')).toHaveAttribute('data-status', /completed/, { timeout: 15000 });
  await first.tab.getByRole('button', { name: 'Close' }).click();
  await expect(first.tab.getByTestId('versions')).toBeVisible({ timeout: 8000 });
  await first.tab.getByRole('button', { name: 'Save version' }).click();
  await expect(first.tab.locator('[data-version="1"]')).toBeVisible();
  const baseId = (await first.tab.getByTestId('versions').getAttribute('data-demo-id'))!;

  const { tab } = await launchFromMeyon(page, context, { story: 'US-101', extend: baseId });
  await expect(tab.getByTestId('launch-confirm')).toContainText('Extend an existing demo with this story');
  await expect(tab.getByTestId('launch-base')).toContainText('version');
  await tab.getByTestId('launch-go').click();
  await expect(tab.getByTestId('versions')).toBeVisible({ timeout: 8000 });
  const coverage = tab.getByTestId('coverage').filter({ hasText: 'US-101' });
  await expect(coverage.locator('.coverage-count')).toHaveText('0/5'); // the new story is not demonstrated yet
  await expect(coverage).toContainText('Not demonstrated');
});

test('the MEYON prompt is composed from approved data, and AI adds a labelled screen suggestion that becomes the screen plan', async ({ page, context }) => {
  await page.goto('/?sim=meyon');
  await page.evaluate(() => sessionStorage.setItem('db-access', 'e2e-token'));
  await page.reload();
  await page.getByTestId('sim').getByText('US-101', { exact: true }).click();
  const prompt = page.getByTestId('sim-prompt');
  await expect(prompt).toHaveValue(/Acceptance criteria \(approved; each must be demonstrated\)/);
  await expect(prompt).toHaveValue(/Maximum debt burden ratio is 50% of monthly salary/);
  await expect(prompt).toHaveValue(/Demo expectations/);
  await page.getByTestId('sim-suggest').click();
  await expect(page.getByTestId('sim-suggest-note')).toContainText('5 screens suggested');
  await expect(prompt).toHaveValue(/Screens to build \(AI suggestion/);
  await page.getByTestId('sim-suggest').click(); // suggesting again replaces the section, never duplicates it
  await expect(page.getByTestId('sim-suggest-note')).toContainText('5 screens suggested');
  expect(((await prompt.inputValue()).match(/Screens to build/g) ?? []).length).toBe(1);
  const opened = context.waitForEvent('page');
  await page.getByTestId('sim-open').click();
  const tab = await opened; watch(tab);
  await expect(tab.getByTestId('launch-confirm')).toContainText('Screens to build (AI suggestion');
  await tab.getByTestId('launch-go').click();
  // The suggested screens are kept exactly in the plan.
  await expect(tab.locator('.gen-plan li')).toHaveCount(5, { timeout: 10000 });
  await expect(tab.getByLabel('Title of screen 3')).toHaveValue('Upload Documents');
});
