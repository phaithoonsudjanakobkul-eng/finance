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

test('R3 HeroPhoto + FrameStrip render on Dashboard', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('[data-component="hero-photo"]')).toBeVisible()
  await expect(page.locator('[data-component="frame-strip"]')).toBeVisible()
  await expect(page.locator('[data-component="frame-strip"] [data-frame]')).toHaveCount(6)
})

test('FrameStrip switches active frame and updates hero caption + hue', async ({ page }) => {
  await page.goto('/')
  const heroBefore = await page.locator('[data-hero-caption]').textContent()
  const hueBefore = await page.locator('.app-shell').getAttribute('data-hero-hue')

  await page.locator('[data-frame="3"]').click()

  const heroAfter = await page.locator('[data-hero-caption]').textContent()
  const hueAfter = await page.locator('.app-shell').getAttribute('data-hero-hue')
  expect(heroAfter).not.toBe(heroBefore)
  expect(hueAfter).not.toBe(hueBefore)
  await expect(page.locator('[data-frame="3"]')).toHaveAttribute('aria-current', 'true')
})

test('active frame persists across reload', async ({ page }) => {
  await page.goto('/')
  await page.locator('[data-frame="4"]').click()
  await page.reload()
  await expect(page.locator('[data-frame="4"]')).toHaveAttribute('aria-current', 'true')
})
