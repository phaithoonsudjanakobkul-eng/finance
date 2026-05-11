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

    test('Utilities → PSI module renders Stage 4 measurement buttons', async ({ page }) => {
        await page.locator('button[data-tab="utilities"]').click();
        await page.locator('button[data-util="psi"]').click();
        // Stage 4 starts collapsed — click the header to expand the body before
        // asserting the buttons (this matches the actual user flow).
        await page.locator('.stage[data-stage="4"] .stage-hdr').click();
        // The 4 Stage-4 measurement tools must all render so the family stays
        // verifiable end-to-end as the module evolves.
        await expect(page.locator('#psi-measure-line')).toBeVisible({ timeout: 5_000 });
        await expect(page.locator('#psi-measure-angle')).toBeVisible();
        await expect(page.locator('#psi-measure-area')).toBeVisible();
        await expect(page.locator('#psi-measure-freehand')).toBeVisible();
        await expect(page.locator('#psi-measure-clear')).toBeVisible();
    });

    test('Utilities → PSI calibration profile modal opens + closes', async ({ page }) => {
        await page.locator('button[data-tab="utilities"]').click();
        await page.locator('button[data-util="psi"]').click();
        // Profile modal should not exist yet
        await expect(page.locator('.psi-prof-modal')).toHaveCount(0);
        // Click "+ Add profile" — modal mounts
        await page.locator('#psi-calib-add').click();
        await expect(page.locator('.psi-prof-modal')).toBeVisible({ timeout: 2_000 });
        await expect(page.locator('#psi-prof-name')).toBeVisible();
        // Close via × button
        await page.locator('#psi-prof-close').click();
        // Modal animates out (160ms) — wait for it to disappear
        await expect(page.locator('.psi-prof-modal')).toHaveCount(0, { timeout: 1_000 });
    });

    test('Settings tab masks sensitive keys with type=password by default', async ({ page }) => {
        // Seed a sensitive key so there's something to mask
        await page.evaluate(() => localStorage.setItem('ps_finnhub_key', 'test-finnhub-key-123456'));
        await page.reload({ waitUntil: 'load' });
        await page.locator('button[data-tab="settings"]').click();
        const finnhubInput = page.locator('input[data-input="ps_finnhub_key"]');
        await expect(finnhubInput).toBeVisible({ timeout: 5_000 });
        // Sensitive keys mount as password type so the value isn't readable
        await expect(finnhubInput).toHaveAttribute('type', 'password');
    });

    test('Watchlist clicking column header changes sort + persists to localStorage', async ({ page }) => {
        await page.locator('button[data-tab="watchlist"]').click();
        // Click "Last" header — should switch sort to c:desc (numeric default)
        await page.locator('th[data-sort="c"]').click();
        await expect.poll(async () => page.evaluate(() => localStorage.getItem('ps_v2_wl_sort')))
            .toBe('c:desc');
        // Click again — flips to asc
        await page.locator('th[data-sort="c"]').click();
        await expect.poll(async () => page.evaluate(() => localStorage.getItem('ps_v2_wl_sort')))
            .toBe('c:asc');
    });

    test('Watchlist rejects invalid symbol on Add (regex guard)', async ({ page }) => {
        await page.locator('button[data-tab="watchlist"]').click();
        // Lower-case + special chars → rejected by /^[A-Z0-9.\-=^]{1,12}$/
        await page.locator('#wl-add').fill('not_valid!');
        await page.locator('#wl-add').press('Enter');
        // Watchlist localStorage should remain empty (no symbol added)
        const ls = await page.evaluate(() => localStorage.getItem('ps_watchlist'));
        // Either null (never set) or empty array — both mean "rejected"
        if (ls !== null) {
            expect(JSON.parse(ls)).toEqual([]);
        }
        // Empty-state message should still be visible
        await expect(page.locator('tbody#wl-tbody')).toContainText('No symbols');
    });

    test('Watchlist empty state shows the v2-Add hint (not the stale monolith message)', async ({ page }) => {
        await page.locator('button[data-tab="watchlist"]').click();
        await expect(page.locator('tbody#wl-tbody')).toContainText('add one via the input above');
        // The monolith-era hint must not survive
        await expect(page.locator('tbody#wl-tbody')).not.toContainText('Add via the monolith');
    });

    test('Nav chrome — V2 SYNC + SAVE + avatar + settings cog all mount', async ({ page }) => {
        // Each widget mounts into its dedicated host. If any host is missing
        // or the widget fails to attach, the page is broken.
        await expect(page.locator('#nav-avatar')).toBeVisible();
        await expect(page.locator('#nav-sync')).toBeVisible();
        await expect(page.locator('#nav-save')).toBeVisible();
        await expect(page.locator('#nav-theme')).toBeVisible();
        await expect(page.locator('#privacy-toggle')).toBeVisible();
        await expect(page.locator('#nav-settings-btn')).toBeVisible();
        // Brand subtitle should now say PSLINK DATABASE (was "v2" pre-V2)
        await expect(page.locator('.ps-brand-sub')).toHaveText('PSLINK DATABASE');
    });

    test('Nav settings cog activates Settings tab', async ({ page }) => {
        // Start on Dashboard so cog click is the action under test
        await page.locator('button[data-tab="dashboard"]').click();
        await expect(page.locator('#dash-profile-name')).toBeVisible({ timeout: 5_000 });
        await page.locator('#nav-settings-btn').click();
        await expect(page.locator('#gist-pull-btn')).toBeVisible({ timeout: 5_000 });
        await expect(page.locator('button[data-tab="settings"]')).toHaveClass(/is-active/);
    });

    test('Dashboard V3 hero row — 3 cards visible (profile / payday / month)', async ({ page }) => {
        await page.locator('button[data-tab="dashboard"]').click();
        await expect(page.locator('#dash-profile')).toBeVisible({ timeout: 5_000 });
        await expect(page.locator('#cine-payday-card')).toBeVisible();
        await expect(page.locator('#cine-month-card')).toBeVisible();
        // No leftover Balance / MoM cards from pre-V3 layout
        await expect(page.locator('#dash-balance')).toHaveCount(0);
        await expect(page.locator('#dash-mom')).toHaveCount(0);
    });

    test('Dashboard V3 — profile name + role + contact render from ps_profile JSON', async ({ page }) => {
        await page.evaluate(() => {
            localStorage.setItem('ps_profile', JSON.stringify({
                displayName: 'Phaithoon S.',
                role: 'Sales Executive',
                company: 'Evident Olympus',
                email: 'pi@example.com',
                phone: '081-234-5678',
                payday: 25,
            }));
        });
        await page.reload({ waitUntil: 'load' });
        await page.locator('button[data-tab="dashboard"]').click();
        await expect(page.locator('#dash-profile-name')).toHaveText('Phaithoon S.', { timeout: 5_000 });
        await expect(page.locator('#dash-profile-role')).toHaveText('Sales Executive');
        await expect(page.locator('#dash-profile-company')).toHaveText('Evident Olympus');
        await expect(page.locator('#dash-profile-contact')).toContainText('081-234-5678');
        await expect(page.locator('#dash-profile-contact')).toContainText('pi@example.com');
    });

    test('Dashboard V3 — month card renders today day-of-month and "OF N"', async ({ page }) => {
        await page.locator('button[data-tab="dashboard"]').click();
        const dayEl = page.locator('#dash-month-day');
        await expect(dayEl).toBeVisible({ timeout: 5_000 });
        // Day should be 1-31 — assert it's a number, not the placeholder dash
        const v = await dayEl.textContent();
        expect(Number(v)).toBeGreaterThanOrEqual(1);
        expect(Number(v)).toBeLessThanOrEqual(31);
        await expect(page.locator('#dash-month-of')).toContainText(/OF \d+/);
    });

    test('Muse V6 — Dashboard renders Muse panel with preset bar + slot grid', async ({ page }) => {
        await page.locator('button[data-tab="dashboard"]').click();
        await expect(page.locator('#muse-root')).toBeVisible({ timeout: 5_000 });
        await expect(page.locator('#muse-preset-bar')).toBeVisible();
        // 6 preset pills A..F
        for (const L of ['A','B','C','D','E','F']) {
            await expect(page.locator(`button[data-muse-preset]:has-text("${L}")`)).toBeVisible();
        }
        // Slot grid has the default 7 visible
        const slots = page.locator('#muse-slot-grid .muse-slot');
        await expect(slots).toHaveCount(7);
    });

    test('Muse V6 — preset switch updates active highlight + persists', async ({ page }) => {
        await page.locator('button[data-tab="dashboard"]').click();
        await page.locator('button[data-muse-preset="2"]').click();
        await expect.poll(async () => page.evaluate(() => localStorage.getItem('ps_muse_preset_idx'))).toBe('2');
    });

    test('Muse V6 — Edit toggle shows edit controls', async ({ page }) => {
        await page.locator('button[data-tab="dashboard"]').click();
        await expect(page.locator('#muse-edit-controls')).toBeHidden();
        await page.locator('#muse-edit-btn').click();
        await expect(page.locator('#muse-edit-controls')).toBeVisible();
        await expect(page.locator('#muse-pw-set')).toBeVisible();
        await expect(page.locator('#muse-add-image')).toBeVisible();
        // toggle back off
        await page.locator('#muse-edit-btn').click();
        await expect(page.locator('#muse-edit-controls')).toBeHidden();
    });

    test('Muse V7 — seeded image slot renders in active hero', async ({ page }) => {
        await page.evaluate(() => {
            const slot = { type: 'image', src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVQYV2NgYAAAAAMAAWgmWQ0AAAAASUVORK5CYII=', thumb: '', panFracX: 0, panFracY: 0, zoom: 1 };
            localStorage.setItem('ps_muse_clips_a', JSON.stringify([slot]));
            localStorage.setItem('ps_muse_active_slot', JSON.stringify([0,0,0,0,0,0]));
        });
        await page.reload({ waitUntil: 'load' });
        await page.locator('button[data-tab="dashboard"]').click();
        await expect(page.locator('#muse-hero-img')).toBeVisible({ timeout: 5_000 });
    });

    test('Profile edit modal — clicking nav avatar opens, Esc closes', async ({ page }) => {
        await page.locator('#nav-avatar').click();
        await expect(page.locator('#profile-edit-panel')).toBeVisible({ timeout: 2_000 });
        await expect(page.locator('#profile-edit-pick')).toBeVisible();
        await expect(page.locator('#profile-edit-save')).toBeDisabled();
        // Press Escape to close
        await page.keyboard.press('Escape');
        await expect(page.locator('#profile-edit-panel')).toHaveCount(0);
    });

    test('SAVE button flips to pending after a records edit', async ({ page }) => {
        await page.locator('button[data-tab="records"]').click();
        await expect(page.locator('#rec-payday')).toBeVisible({ timeout: 5_000 });
        // Edit the payday → records:saved emits → SAVE turns pending (accent fill)
        await page.locator('#rec-payday').fill('12345');
        await page.locator('#rec-payday').press('Tab'); // commit
        // Poll the title attribute — flips to "Pending edits — click to push now"
        await expect.poll(async () => page.locator('#nav-save').getAttribute('title'))
            .toMatch(/Pending edits/);
    });
});
