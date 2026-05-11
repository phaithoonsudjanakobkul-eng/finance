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

test('R4 Records tab shows zero totals and empty state on fresh device', async ({ page }) => {
  await page.goto('/')
  await page.locator('[data-tab="records"]').click()
  await expect(page.locator('[data-component="record-form"]')).toBeVisible()
  await expect(page.locator('[data-empty]')).toBeVisible()
  const balanceCard = page.locator('[data-component="stat-glass"][data-label="Balance"] [data-value]')
  await expect(balanceCard).toContainText('฿0')
})

test('R4 Add expense record — appears in list, updates totals + balance', async ({ page }) => {
  await page.goto('/')
  await page.locator('[data-tab="records"]').click()

  await page.locator('[data-field="category"]').fill('Coffee')
  await page.locator('[data-field="amount"]').fill('150')
  await page.locator('[data-action="save-record"]').click()

  await expect(page.locator('[data-records-list] [data-record-id]')).toHaveCount(1)
  await expect(page.locator('[data-component="stat-glass"][data-label="Expense"]')).toContainText('150')
  await expect(page.locator('[data-component="stat-glass"][data-label="Balance"]')).toContainText('150')
})

test('R4 Income type toggle + delete row', async ({ page }) => {
  await page.goto('/')
  await page.locator('[data-tab="records"]').click()

  await page.locator('[data-type-toggle="income"]').click()
  await page.locator('[data-field="category"]').fill('Salary')
  await page.locator('[data-field="amount"]').fill('50000')
  await page.locator('[data-action="save-record"]').click()

  await expect(page.locator('[data-record-type="income"]')).toHaveCount(1)
  await expect(page.locator('[data-component="stat-glass"][data-label="Income"]')).toContainText('50,000')

  await page.locator('[data-action="delete-record"]').first().click()
  await expect(page.locator('[data-records-list] [data-record-id]')).toHaveCount(0)
})

test('R6 Watchlist tab renders mock symbols with correct semantic colors', async ({ page }) => {
  await page.goto('/')
  await page.locator('[data-tab="watchlist"]').click()
  await expect(page.locator('[data-watchlist-row]')).toHaveCount(8)

  const tsla = page.locator('[data-watchlist-row][data-symbol="TSLA"] [data-pct]')
  await expect(tsla).toContainText('▲')
  await expect(tsla).toContainText('+2.61%')
  const tslaColor = await tsla.evaluate(el => getComputedStyle(el).color)
  expect(tslaColor).toMatch(/rgb\(124,\s*197,\s*124\)/) // --positive #7CC57C

  const googl = page.locator('[data-watchlist-row][data-symbol="GOOGL"] [data-pct]')
  await expect(googl).toContainText('▼')
})

test('R5 Dashboard reflects Records data after add', async ({ page }) => {
  await page.goto('/')

  await page.locator('[data-tab="records"]').click()
  await page.locator('[data-type-toggle="income"]').click()
  await page.locator('[data-field="category"]').fill('Salary')
  await page.locator('[data-field="amount"]').fill('75000')
  await page.locator('[data-action="save-record"]').click()

  await page.locator('[data-type-toggle="expense"]').click()
  await page.locator('[data-field="category"]').fill('Rent')
  await page.locator('[data-field="amount"]').fill('15000')
  await page.locator('[data-action="save-record"]').click()

  await page.locator('[data-tab="dashboard"]').click()
  await expect(page.locator('[data-component="profile-card"]')).toBeVisible()
  await expect(page.locator('[data-tab-content="dashboard"] [data-component="stat-glass"][data-label="Income"]')).toContainText('75,000')
  await expect(page.locator('[data-tab-content="dashboard"] [data-component="stat-glass"][data-label="Expense"]')).toContainText('15,000')
  await expect(page.locator('[data-tab-content="dashboard"] [data-component="stat-glass"][data-label="Balance"]')).toContainText('60,000')
})

test('R4 records persist across reload', async ({ page }) => {
  await page.goto('/')
  await page.locator('[data-tab="records"]').click()
  await page.locator('[data-field="category"]').fill('Rent')
  await page.locator('[data-field="amount"]').fill('12000')
  await page.locator('[data-action="save-record"]').click()

  await page.reload()
  await page.locator('[data-tab="records"]').click()
  await expect(page.locator('[data-records-list] [data-record-id]')).toHaveCount(1)
  await expect(page.locator('[data-component="stat-glass"][data-label="Expense"]')).toContainText('12,000')
})
