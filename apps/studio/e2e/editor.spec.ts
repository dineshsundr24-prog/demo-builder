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
  await expect(device(page).locator('[data-screen-id]')).toHaveAttribute('data-screen-id', 'customer-profile');
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
  await page.getByTestId('add-screen').click();
  await page.getByRole('button', { name: 'Create a blank screen instead' }).click();
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

test('a journey template can be customised: rename "Verify" to "Validate"', async ({ page }) => {
  await page.locator('.studio-screens button', { hasText: 'OTP' }).click();
  await device(page).getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByTestId('template-note')).toBeVisible();
  await page.getByTestId('customise-template').click();
  await device(page).getByRole('button', { name: 'Verify' }).click();
  await expect(inspector(page)).toContainText('Button');
  await inspector(page).getByLabel('Label').first().fill('Validate');
  await expect(device(page).getByRole('button', { name: 'Validate' })).toBeVisible();
  await page.getByRole('button', { name: 'Preview' }).click();
  await device(page).getByLabel('Verification code').fill('123456');
  await device(page).getByRole('button', { name: 'Validate' }).click();
  await expect(device(page).locator('[data-screen-id]')).not.toHaveAttribute('data-screen-id', /otp/, { timeout: 8000 });
  await expect(page.getByTestId('validation')).toContainText('No errors');
});

test.describe('AI assistant chat', () => {
  test.beforeEach(async ({ page }) => { await page.evaluate(() => sessionStorage.setItem('db-access', 'e2e-token')); });
  const chat = (p: Page) => p.getByTestId('assist');
  const say = async (p: Page, text: string) => { await p.getByLabel('Message the AI assistant').fill(text); await p.keyboard.press('Enter'); };

  test('docked chat: change the current screen, follow up, undo the last change', async ({ page }) => {
    await page.locator('.studio-screens button', { hasText: 'OTP' }).click();
    await page.getByRole('button', { name: 'Preview' }).click();
    await page.getByTestId('open-assist').click();
    await expect(chat(page)).toBeVisible();
    await expect(device(page)).toBeVisible(); // the demo stays visible next to the chat
    await say(page, 'Rename the Verify button to Validate');
    await expect(chat(page).locator('.msg-user')).toContainText('Rename the Verify button');
    await expect(chat(page).locator('.msg-ai').last()).toContainText('"Verify" → "Validate"');
    await expect(device(page).getByRole('button', { name: 'Validate' })).toBeVisible();
    await say(page, 'Rename Validate to Confirm code');
    await expect(chat(page).locator('.msg-ai').last()).toContainText('Confirm code');
    await expect(device(page).getByRole('button', { name: 'Confirm code' })).toBeVisible();
    await chat(page).getByTestId('assist-undo').click();
    await expect(device(page).getByRole('button', { name: 'Validate' })).toBeVisible();
    await expect(chat(page).locator('.msg-ai.msg-undone')).toHaveCount(1);
    await device(page).getByLabel('Verification code').fill('123456');
    await device(page).getByRole('button', { name: 'Validate' }).click();
    await expect(device(page).locator('[data-screen-id]')).not.toHaveAttribute('data-screen-id', /otp/, { timeout: 8000 });
  });

  test('new screen from the chat, linked from the chosen screen', async ({ page }) => {
    await page.getByTestId('add-screen').click();
    await expect(chat(page).getByRole('radio', { name: 'New screen' })).toHaveAttribute('aria-checked', 'true');
    await chat(page).getByLabel('New screen options').click();
    await chat(page).getByLabel('Opens from').selectOption({ label: 'Dashboard' });
    await say(page, 'Card management: freeze card and change PIN');
    await expect(chat(page).locator('.msg-ai').last()).toContainText('I added the screen "Card Management"');
    await expect(chat(page).locator('.msg-ai').last()).toContainText('Link:');
    await expect(page.locator('.studio-screens')).toContainText('Card Management');
    await expect(device(page)).toContainText('Freeze card');
    await page.locator('.studio-screens button', { hasText: 'Dashboard' }).click();
    await page.getByRole('button', { name: 'Preview' }).click();
    await device(page).getByRole('button', { name: 'Cards' }).click();
    await expect(device(page).locator('[data-screen-id]')).toHaveAttribute('data-screen-id', 'card-management');
  });

  test('clicking a component in edit mode switches from the chat to its properties', async ({ page }) => {
    await page.getByTestId('open-assist').click();
    await expect(chat(page)).toBeVisible();
    await device(page).getByRole('heading', { name: 'Banking that moves with you' }).click();
    await expect(inspector(page)).toContainText('Heading');
    await page.getByRole('tab', { name: 'AI' }).click();
    await expect(chat(page)).toBeVisible();
  });

  test('app structure by chat: rename a tab, delete a screen, undo', async ({ page }) => {
    await page.locator('.studio-screens button', { hasText: 'Dashboard' }).click();
    await page.getByRole('button', { name: 'Preview' }).click();
    await page.getByTestId('open-assist').click();
    const tabs = device(page).locator('.db-tabs');
    await expect(tabs).toContainText('Home');
    await say(page, 'Rename the Home tab to Overview');
    await expect(chat(page).locator('.msg-ai').last()).toContainText('renamed to "Overview"');
    await expect(tabs).toContainText('Overview');
    await chat(page).getByTestId('assist-undo').click();
    await expect(tabs).toContainText('Home');
    await say(page, 'Delete the Income Update screen');
    await expect(chat(page).locator('.msg-ai').last()).toContainText('Deleted screen "Income Update"');
    await expect(page.locator('.studio-screens .studio-title', { hasText: /^Income Update$/ })).toHaveCount(0);
    await expect(page.getByTestId('validation')).toContainText('No errors');
  });

  test('palette search understands everyday words', async ({ page }) => {
    await page.getByRole('tab', { name: 'Add' }).click();
    await page.getByLabel('Search components').fill('back button');
    await expect(page.getByTestId('palette')).toContainText('back arrow appears automatically');
    await expect(page.getByTestId('palette').getByRole('button', { name: 'Button', exact: true })).toBeVisible();
  });
});

test('portal tables: switch on product and date-range filters in the editor, then filter in preview', async ({ page }) => {
  await page.goto('/?doc=portal&mode=edit');
  await page.locator('.studio-screens button', { hasText: 'Customer Applications' }).click();
  await device(page).locator('[data-node-type="Table"] th').first().click();
  await expect(inspector(page)).toContainText('Table');
  await inspector(page).getByLabel('Date filter field').selectOption({ label: 'Submitted' });
  await inspector(page).getByRole('checkbox', { name: 'Product' }).check();
  await page.getByRole('button', { name: 'Preview' }).click();
  const table = device(page).locator('[data-node-type="Table"]');
  const rows = table.locator('tbody tr');
  const total = await rows.count();
  await table.getByLabel('Filter by Product').selectOption('Home Finance');
  const homeOnly = await rows.count();
  expect(homeOnly).toBeLessThan(total);
  await table.getByLabel('Filter by Product').selectOption('');
  await table.getByLabel('Submitted from').fill('2026-11-21');
  await table.getByLabel('Submitted to').fill('2026-11-21');
  await expect(rows).toHaveCount(2); // two applications were submitted on 21 Nov
  await expect(table).toContainText('APP-20482');
  await expect(table).not.toContainText('APP-20470');
  await expect(table).toContainText('2 of ');
  await table.getByRole('button', { name: 'Clear' }).click();
  await expect(rows).toHaveCount(total);
});
