// Phase 3 exit gate: visual editing on the real runtime render.
import { test, expect, type Page } from '@playwright/test';

let consoleErrors: string[] = [];
test.beforeEach(async ({ page }) => {
  consoleErrors = [];
  page.on('pageerror', e => consoleErrors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  await page.goto('/?doc=kapiko');
  await page.getByTestId('mode-edit').click();
});
test.afterEach(() => expect(consoleErrors, 'console/page errors').toEqual([]));

const device = (p: Page) => p.getByTestId('device');
const inspector = (p: Page) => p.getByTestId('inspector');
const screenId = (p: Page) => device(p).locator('[data-screen-id]').getAttribute('data-screen-id');

test('click selects a component; editing updates the canvas; undo and redo', async ({ page }) => {
  await device(page).getByRole('heading', { name: 'Banking that moves with you' }).click();
  await expect(inspector(page)).toContainText('Heading');
  const text = inspector(page).getByLabel('Text');
  await text.fill('Banking made simple');
  await expect(device(page).getByRole('heading', { name: 'Banking made simple' })).toBeVisible();
  await page.locator('body').click({ position: { x: 5, y: 5 } }); // leave the field so shortcuts apply
  await page.keyboard.press('Control+z');
  await expect(device(page).getByRole('heading', { name: 'Banking that moves with you' })).toBeVisible();
  await page.keyboard.press('Control+Shift+z');
  await expect(device(page).getByRole('heading', { name: 'Banking made simple' })).toBeVisible();
  await expect(page.getByTestId('validation')).toContainText('No errors');
});

test('edit mode never runs actions: clicking a button selects it and stays on the screen', async ({ page }) => {
  await device(page).getByRole('button', { name: 'Create account' }).click();
  expect(await screenId(page)).toBe('welcome');
  await expect(inspector(page)).toContainText('Button');
  await expect(inspector(page).getByLabel('Label')).toHaveValue('Create account');
});

test('change where a button leads, then the preview follows the new link', async ({ page }) => {
  await device(page).getByRole('button', { name: 'Create account' }).click();
  await inspector(page).getByLabel('Screen').selectOption({ label: 'Dashboard' });
  await page.getByRole('button', { name: 'Preview' }).click();
  await device(page).getByRole('button', { name: 'Create account' }).click();
  await expect(device(page).locator('[data-screen-id]')).toHaveAttribute('data-screen-id', 'dashboard');
});

test('add from the palette, duplicate and delete with the keyboard', async ({ page }) => {
  await device(page).getByRole('heading', { name: 'Banking that moves with you' }).click();
  await page.getByRole('tab', { name: 'Add' }).click();
  await page.getByTestId('palette').getByRole('button', { name: 'Notice', exact: true }).click();
  await expect(inspector(page)).toContainText('Notice');
  const notices = device(page).locator('[data-node-type="Notice"]');
  await expect(notices).toHaveCount(1);
  await page.keyboard.press('Control+d');
  await expect(notices).toHaveCount(2);
  await page.keyboard.press('Delete');
  await expect(notices).toHaveCount(1);
  await expect(page.getByTestId('validation')).toContainText('No errors');
});

test('reorder with drag and drop in Layers', async ({ page }) => {
  await page.getByRole('tab', { name: 'Layers' }).click();
  const layers = page.getByTestId('layers');
  const order = () => device(page).locator('[data-screen-id] [data-node-id]').evaluateAll(els => els.map(e => e.getAttribute('data-node-id')).filter(id => ['logo', 'headline', 'intro', 'sign-in', 'create'].includes(id!)));
  expect((await order())[0]).toBe('logo');
  await layers.locator('[data-layer="create"]').dragTo(layers.locator('[data-layer="logo"]'), { targetPosition: { x: 20, y: 2 } });
  await expect.poll(order).toEqual(['create', 'logo', 'headline', 'intro', 'sign-in']);
});

test('lists inside a component are editable: add a detail row', async ({ page }) => {
  await page.locator('.studio-screens button', { hasText: 'Customer Profile' }).click();
  const fields = device(page).locator('[data-node-type="RecordFields"]').first();
  const before = await fields.locator('dt').count();
  await fields.click();
  await expect(inspector(page)).toContainText('Detail fields');
  await inspector(page).getByRole('button', { name: 'Add item' }).click();
  await expect(fields.locator('dt')).toHaveCount(before + 1);
});

test('screens: rename, add and delete', async ({ page }) => {
  await page.getByLabel('Title', { exact: true }).fill('Get started');
  await expect(page.locator('.studio-screens')).toContainText('Get started');
  page.once('dialog', d => d.accept('Card services'));
  await page.getByRole('button', { name: 'Add screen' }).click();
  await expect(page.locator('.studio-screens')).toContainText('Card services');
  page.once('dialog', d => d.accept());
  await page.getByTitle('Delete screen').click();
  await expect(page.locator('.studio-screens')).not.toContainText('Card services');
  await expect(page.getByTestId('validation')).toContainText('No errors');
});

test('open in a new window shows the full demo and follows edits live', async ({ page, context }) => {
  const [popup] = await Promise.all([context.waitForEvent('page'), page.getByTestId('open-window').click()]);
  await expect(popup.getByTestId('present')).toBeVisible();
  await expect(popup.getByRole('heading', { name: 'Banking that moves with you' })).toBeVisible();
  await device(page).getByRole('heading', { name: 'Banking that moves with you' }).click();
  await inspector(page).getByLabel('Text').fill('Edited live');
  await expect(popup.getByRole('heading', { name: 'Edited live' })).toBeVisible();
});

test('edits survive a reload as a local draft', async ({ page }) => {
  await device(page).getByRole('heading', { name: 'Banking that moves with you' }).click();
  await inspector(page).getByLabel('Text').fill('Saved draft');
  await page.waitForTimeout(500);
  await page.goto('/');
  await page.getByTestId('continue-draft').click();
  await expect(device(page).getByRole('heading', { name: 'Saved draft' })).toBeVisible();
});
