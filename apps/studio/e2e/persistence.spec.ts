// Phase A1: saved demos, autosaved drafts, immutable versions, published read-only links,
// restore, fork, primary baselines and edit-conflict protection (zero-cost API, UAT token).
import { test, expect, type Page, type BrowserContext } from '@playwright/test';

let consoleErrors: string[] = [];
// allow404: a revoked public link is expected to answer 404 (the browser logs that as an error).
const watch = (page: Page, allow404 = false) => {
  page.on('pageerror', e => consoleErrors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/409|Conflict/.test(m.text()) && !(allow404 && /status of 404/.test(m.text()))) consoleErrors.push(m.text()); });
};
test.beforeEach(async ({ page }) => { consoleErrors = []; watch(page); });
test.afterEach(() => expect(consoleErrors, 'console/page errors').toEqual([]));

const device = (p: Page) => p.getByTestId('device');
const unique = () => 'Kapiko ' + Math.random().toString(36).slice(2, 7);
async function openSample(page: Page, name: string) {
  await page.goto('/?doc=kapiko');
  await page.evaluate(() => sessionStorage.setItem('db-access', 'e2e-token'));
  await page.reload();
  // Rename the demo so parallel tests never collide in the shared UAT workspace.
  await page.getByTestId('mode-edit').click();
  await device(page).getByRole('heading', { name: 'Banking that moves with you' }).click();
  await page.getByTestId('save-cloud').click();
  await expect(page.getByTestId('versions')).toBeVisible();
  await page.getByTestId('inspector').getByLabel('Text').fill(name);
  await expect(page.getByTestId('save-state')).toHaveText('All changes saved', { timeout: 8000 });
}

test('save, autosave, version, publish a read-only link, revoke', async ({ page, context }) => {
  const name = unique();
  await openSample(page, name);
  await page.getByLabel('Version note').fill('Client review');
  await page.getByRole('button', { name: 'Save version' }).click();
  const v1 = page.locator('[data-version="1"]');
  await expect(v1).toContainText('Client review');
  // Later edits must never change version 1 or its published link.
  await device(page).getByRole('heading', { name }).click();
  await page.getByTestId('inspector').getByLabel('Text').fill(name + ' later');
  await expect(page.getByTestId('save-state')).toHaveText('All changes saved', { timeout: 8000 });
  await v1.getByRole('button', { name: 'Publish' }).click();
  const link = await v1.getByLabel('Published link for version 1').inputValue();
  expect(link).toMatch(/\?p=[A-Za-z0-9_-]{20,}$/);
  const viewer = await context.newPage(); watch(viewer, true);
  await viewer.goto(link);
  await expect(viewer.getByTestId('public-demo')).toBeVisible();
  await expect(viewer.getByRole('heading', { name, exact: true })).toBeVisible();
  await expect(viewer.getByText(name + ' later')).toHaveCount(0);
  await expect(viewer.getByTestId('mode-edit')).toHaveCount(0); // read-only: no editor
  await v1.getByRole('button', { name: 'Revoke' }).click();
  await viewer.reload();
  await expect(viewer.getByText('This demo link is not available')).toBeVisible();
});

test('reopen a saved demo, restore an old version, fork it', async ({ page }) => {
  const name = unique();
  await openSample(page, name);
  const demoId = await page.getByTestId('versions').getAttribute('data-demo-id');
  await page.getByRole('button', { name: 'Save version' }).click();
  await expect(page.locator('[data-version="1"]')).toBeVisible();
  await device(page).getByRole('heading', { name }).click();
  await page.getByTestId('inspector').getByLabel('Text').fill(name + ' v2');
  await expect(page.getByTestId('save-state')).toHaveText('All changes saved', { timeout: 8000 });
  // Reopen from the start page: the draft is restored from the server.
  await page.getByRole('button', { name: 'New demo' }).click();
  await page.getByTestId('saved-demos').getByRole('button', { name: new RegExp('Kapiko Bank') }).first().waitFor();
  await page.goto('/');
  await page.getByTestId('saved-demos').locator('button').filter({ hasText: 'Kapiko' }).first().waitFor();
  const entry = page.getByTestId('saved-demos').locator('li').filter({ has: page.locator('text=v1') }).first();
  await expect(entry).toBeVisible();
  // Open our own demo (parallel tests save demos with the same name).
  await page.getByTestId('saved-demos').locator('button[data-demo-id="' + demoId + '"]').click();
  await expect(device(page).getByRole('heading', { name: name + ' v2' })).toBeVisible();
  await page.locator('[data-version="1"]').getByRole('button', { name: 'Restore' }).click();
  await expect(device(page).getByRole('heading', { name, exact: true })).toBeVisible();
  await page.locator('[data-version="1"]').getByRole('button', { name: 'Fork' }).click();
  await expect(page.locator('.studio-current')).toContainText('Kapiko');
  await expect(page.getByTestId('versions')).toContainText('No versions yet');
  await expect(page.getByTestId('versions')).toContainText('Make primary', { timeout: 8000 });
});

test('two windows editing the same demo: the second save is refused, not lost silently', async ({ page, context }) => {
  const name = unique();
  await openSample(page, name);
  const demoId = await page.getByTestId('versions').getAttribute('data-demo-id');
  const other = await context.newPage(); watch(other);
  await other.goto('/');
  await other.evaluate(() => sessionStorage.setItem('db-access', 'e2e-token'));
  await other.reload();
  await other.getByTestId('saved-demos').locator('button[data-demo-id="' + demoId + '"]').click(); // parallel tests save demos too
  await other.getByTestId('mode-edit').click();
  await other.getByTestId('device').getByRole('heading', { name }).click();
  await other.getByTestId('inspector').getByLabel('Text').fill(name + ' from window 2');
  await expect(other.getByTestId('save-state')).toHaveText('All changes saved', { timeout: 8000 });
  // Window 1 still has the old revision: its next edit conflicts.
  await device(page).getByRole('heading', { name }).click();
  await page.getByTestId('inspector').getByLabel('Text').fill(name + ' from window 1');
  await expect(page.getByTestId('save-state')).toHaveText('Changed elsewhere', { timeout: 8000 });
  await page.getByRole('button', { name: 'Load the latest version of the draft' }).click();
  await expect(device(page).getByRole('heading', { name: name + ' from window 2' })).toBeVisible();
  await expect(page.getByTestId('save-state')).toHaveText('All changes saved');
});

test('generated demos are saved automatically, and regenerating a screen updates the same saved demo', async ({ page }) => {
  await page.goto('/?generate=1');
  const panel = page.getByRole('dialog', { name: 'Generate with AI' });
  await panel.getByPlaceholder('Demo Builder access token').fill('e2e-token');
  await panel.getByLabel('Project name').fill('Auto saved ' + Math.random().toString(36).slice(2, 6));
  await panel.getByLabel('Business requirements').fill('A mobile banking app with a home dashboard and a details screen.');
  await panel.getByRole('button', { name: 'Draft plan' }).click();
  await panel.getByRole('button', { name: /Approve and generate/ }).click();
  await expect(panel.getByText('Done: all screens generated and validated.')).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('versions')).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId('save-state')).toHaveText('All changes saved');
  const before = await page.request.get('http://localhost:8788/api/v2/demos', { headers: { 'x-builder-access': 'e2e-token' } }).then(r => r.json());
  await panel.getByRole('button', { name: /Regenerate / }).first().click();
  await expect(panel.getByText('Done: all screens generated and validated.')).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('save-state')).toHaveText('All changes saved', { timeout: 8000 });
  const after = await page.request.get('http://localhost:8788/api/v2/demos', { headers: { 'x-builder-access': 'e2e-token' } }).then(r => r.json());
  expect(after.demos.length).toBe(before.demos.length);
});
