// E2E smoke — boots the v2 shell, walks every tab, asserts that each
// tab's distinguishing element renders. Catches regressions in the tab
// router, dynamic-import wiring, splash flow, and the chrome that holds
// it all together.
//
// Each tab assertion is a single visible-element selector that's stable
// across preset/theme switches. If a tab module's first render fails,
// the assert times out instead of false-passing on a blank page.

import { test, expect } from '@playwright/test';

test.describe('v2 shell smoke', () => {
    test.beforeEach(async ({ page }) => {
        // Clear localStorage between tests so each one boots with a known empty
        // state (no Gist token → no auto-pull → empty tabs render fast)
        await page.goto('/src/', { waitUntil: 'load' });
        await page.evaluate(() => { try { localStorage.clear(); } catch (_e) {} });
        await page.reload({ waitUntil: 'load' });
    });

    test('boots and shows the tab nav', async ({ page }) => {
        await expect(page.locator('button[data-tab="dashboard"]')).toBeVisible();
        await expect(page.locator('button[data-tab="watchlist"]')).toBeVisible();
        await expect(page.locator('button[data-tab="settings"]')).toBeVisible();
    });

    test('Dashboard tab renders profile placeholder', async ({ page }) => {
        await page.locator('button[data-tab="dashboard"]').click();
        await expect(page.locator('#dash-profile-name')).toBeVisible({ timeout: 5_000 });
    });

    test('Records tab renders financial bar grid', async ({ page }) => {
        await page.locator('button[data-tab="records"]').click();
        await expect(page.locator('#financial-bar-grid')).toBeVisible({ timeout: 5_000 });
    });

    test('Watchlist tab renders the table + Add input', async ({ page }) => {
        await page.locator('button[data-tab="watchlist"]').click();
        await expect(page.locator('#watchlist-table')).toBeVisible({ timeout: 5_000 });
        await expect(page.locator('#wl-add')).toBeVisible();
    });

    test('Watchlist scanner panel opens + tabs visible', async ({ page }) => {
        await page.locator('button[data-tab="watchlist"]').click();
        await page.locator('#wl-scanner-toggle').click();
        await expect(page.locator('button[data-scan="day_gainers"]')).toBeVisible();
        await expect(page.locator('button[data-scan="day_losers"]')).toBeVisible();
    });

    test('News tab renders refresh button', async ({ page }) => {
        await page.locator('button[data-tab="news"]').click();
        await expect(page.locator('#news-refresh')).toBeVisible({ timeout: 5_000 });
    });

    test('Utilities tab renders module sidebar', async ({ page }) => {
        await page.locator('button[data-tab="utilities"]').click();
        // Utilities tab has a left sidebar — at least one module button should be there
        await expect(page.locator('button[data-util-tool], #util-sidebar, [data-util]').first()).toBeVisible({ timeout: 5_000 });
    });

    test('Settings tab renders Pull + Push Gist buttons', async ({ page }) => {
        await page.locator('button[data-tab="settings"]').click();
        await expect(page.locator('#gist-pull-btn')).toBeVisible({ timeout: 5_000 });
        await expect(page.locator('#gist-push-btn')).toBeVisible();
    });

    test('hash routing — direct URL with #tab=watchlist activates that tab', async ({ page }) => {
        await page.goto('/src/#tab=watchlist', { waitUntil: 'load' });
        await expect(page.locator('#watchlist-table')).toBeVisible({ timeout: 5_000 });
    });

    test('Watchlist add symbol writes to ps_watchlist + renders new row', async ({ page }) => {
        await page.locator('button[data-tab="watchlist"]').click();
        await page.locator('#wl-add').fill('AAPL');
        await page.locator('#wl-add').press('Enter');
        // Row should appear within a frame of repaint
        await expect(page.locator('tr.wl-row[data-sym="AAPL"]')).toBeVisible({ timeout: 5_000 });
        // localStorage should reflect the add
        const ls = await page.evaluate(() => localStorage.getItem('ps_watchlist'));
        expect(ls).toContain('AAPL');
    });
});
