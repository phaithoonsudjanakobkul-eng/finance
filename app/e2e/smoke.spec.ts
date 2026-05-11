import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.clear())
})

test('R1 shell renders top nav + default Dashboard', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('navigation')).toBeVisible()
  await expect(page.getByText('PSLink', { exact: true })).toBeVisible()
  await expect(page.locator('[data-tab-content="dashboard"]')).toBeVisible()
})

test('tab pills switch active content', async ({ page }) => {
  await page.goto('/')
  await page.locator('[data-tab="watchlist"]').click()
  await expect(page.locator('[data-tab-content="watchlist"]')).toBeVisible()
  await expect(page.locator('[data-tab-content="dashboard"]')).toHaveCount(0)

  await page.locator('[data-tab="utilities"]').click()
  await expect(page.locator('[data-tab-content="utilities"]')).toBeVisible()
})

test('theme toggle flips html.dark and persists', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('html')).not.toHaveClass(/dark/)

  await page.locator('[data-action="toggle-theme"]').click()
  await expect(page.locator('html')).toHaveClass(/dark/)

  await page.reload()
  await expect(page.locator('html')).toHaveClass(/dark/)
})

test('active tab persists across reload', async ({ page }) => {
  await page.goto('/')
  await page.locator('[data-tab="news"]').click()
  await page.reload()
  await expect(page.locator('[data-tab-content="news"]')).toBeVisible()
})
