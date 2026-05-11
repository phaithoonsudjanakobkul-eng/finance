import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.clear())
})

test('R2 Cinematic shell renders brand + nav + default Dashboard', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText(/^PSLink\.?$/)).toBeVisible()
  await expect(page.getByRole('navigation')).toBeVisible()
  await expect(page.locator('[data-tab-content="dashboard"]')).toBeVisible()
})

test('tab pills switch active content (watchlist label = Market)', async ({ page }) => {
  await page.goto('/')
  await page.locator('[data-tab="watchlist"]').click()
  await expect(page.locator('[data-tab-content="watchlist"]')).toBeVisible()
  await expect(page.locator('[data-tab-content="dashboard"]')).toHaveCount(0)

  await page.locator('[data-tab="utilities"]').click()
  await expect(page.locator('[data-tab-content="utilities"]')).toBeVisible()
})

test('active tab persists across reload', async ({ page }) => {
  await page.goto('/')
  await page.locator('[data-tab="news"]').click()
  await page.reload()
  await expect(page.locator('[data-tab-content="news"]')).toBeVisible()
})

test('app-shell carries cinematic background layers', async ({ page }) => {
  await page.goto('/')
  const shell = page.locator('.app-shell')
  await expect(shell).toBeVisible()
  const bg = await shell.evaluate(el => getComputedStyle(el).backgroundImage)
  expect(bg).toContain('radial-gradient')
  expect(bg).toContain('linear-gradient')
})
