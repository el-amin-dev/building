import { expect, test } from '@playwright/test';
import { E2E_APP_TITLE } from './constants.ts';

test.describe('smoke', () => {
  test('renders the 3D scene and toggles the view mode', async ({ page }) => {
    const pageErrors: Error[] = [];
    page.on('pageerror', (error) => pageErrors.push(error));

    await page.goto('/');

    await expect(page).toHaveTitle(E2E_APP_TITLE);
    await expect(page.locator('canvas')).toBeVisible();

    const toggle = page.getByRole('button', { name: 'Interior view' });
    const status = page.getByRole('status');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(status).toHaveText('View: Exterior');

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(status).toHaveText('View: Interior · First person');

    await toggle.press('Enter');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(status).toHaveText('View: Exterior');

    expect(pageErrors).toEqual([]);
  });
});
