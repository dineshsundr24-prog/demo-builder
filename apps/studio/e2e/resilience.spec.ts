// Regression: the deployed API reported a storage failure as budget: {error}, which crashed
// the generation panel and blanked the page. Both API response shapes must render a message.
import { test, expect } from '@playwright/test';

for (const [name, status] of [
  ['deployed (old) API shape', { ready: true, model: 'gpt-4.1-mini', store: 'supabase', budget: { error: 'Supabase GET usage_events failed (401): Invalid API key' }, maxScreensPerJob: 40 }],
  ['current API shape', { ready: false, model: 'gpt-4.1-mini', store: 'supabase', storage: 'unavailable', budget: null, maxScreensPerJob: 40 }],
] as const) {
  test('storage failure (' + name + ') shows a clear message instead of a blank page', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/api/v2/status', route => route.fulfill({ json: status }));
    await page.goto('/');
    await page.getByTestId('new-mobile').click();
    const panel = page.getByRole('dialog', { name: 'Generate with AI' });
    await expect(panel.getByTestId('api-status')).toContainText('storage is not connected');
    await expect(panel.getByLabel('Business requirements')).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('an unexpected rendering error shows the recovery message, not a blank page', async ({ page }) => {
  await page.route('**/api/v2/status', route => route.fulfill({ json: { model: 'x', store: 'supabase', budget: { spentUsd: 'not-a-number' } } }));
  await page.goto('/');
  await page.getByTestId('new-portal').click();
  await expect(page.locator('body')).not.toHaveText('');
  await expect(page.getByRole('dialog', { name: 'Generate with AI' }).or(page.getByRole('alert'))).toBeVisible();
});
