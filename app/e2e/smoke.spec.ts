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

const VIEWPORTS = [
  { name: 'mobile-360',   width: 360,  height: 800 },
  { name: 'mobile-414',   width: 414,  height: 896 },
  { name: 'tablet-768',   width: 768,  height: 1024 },
  { name: 'laptop-1366',  width: 1366, height: 768 },
  { name: 'laptop-1707',  width: 1707, height: 1067 },
  { name: 'desktop-1920', width: 1920, height: 1080 },
  { name: 'desktop-2560', width: 2560, height: 1440 },
]

for (const v of VIEWPORTS) {
  test(`R9 responsive — ${v.name} renders Dashboard without horizontal overflow`, async ({ page }) => {
    await page.setViewportSize({ width: v.width, height: v.height })
    await page.goto('/')

    await expect(page.locator('[data-component="profile-card"]')).toBeVisible()
    await expect(page.locator('[data-component="payday-card"]')).toBeVisible()
    await expect(page.locator('[data-component="month-card"]')).toBeVisible()

    const bodyOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth - document.documentElement.clientWidth
    })
    expect(bodyOverflow, `viewport ${v.name} (${v.width}×${v.height}) has horizontal overflow`).toBeLessThanOrEqual(1)
  })
}

test('R11 a11y — tabs have proper ARIA roles + tablist semantics', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('tablist')).toBeVisible()
  await expect(page.getByRole('tab')).toHaveCount(5)
  await expect(page.getByRole('tabpanel')).toBeVisible()

  const activeTab = page.locator('[role="tab"][aria-selected="true"]')
  await expect(activeTab).toHaveCount(1)
  await expect(activeTab).toHaveAttribute('id', 'tab-dashboard')
})

test('R11 a11y — number key 1-5 switches tabs', async ({ page }) => {
  await page.goto('/')
  await page.keyboard.press('3')
  await expect(page.locator('[data-tab-content="watchlist"]')).toBeVisible()
  await page.keyboard.press('2')
  await expect(page.locator('[data-tab-content="records"]')).toBeVisible()
  await page.keyboard.press('1')
  await expect(page.locator('[data-tab-content="dashboard"]')).toBeVisible()
})

test('R11 a11y — number key shortcuts are ignored when typing in inputs', async ({ page }) => {
  await page.goto('/')
  await page.locator('[data-tab="records"]').click()
  const input = page.locator('[data-field="category"]')
  await input.click()
  await input.fill('3')
  // Tab should not switch — we're still on Records
  await expect(page.locator('[data-tab-content="records"]')).toBeVisible()
  await expect(input).toHaveValue('3')
})

test('R11 a11y — Esc in ProfileCard edit mode cancels the edit', async ({ page }) => {
  await page.goto('/')
  await page.locator('[data-action="edit-profile"]').click()
  await page.locator('[data-field="profile-name"]').fill('Throwaway')
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-profile-name]')).toHaveText('Pi-keng')
})

test('R11 a11y — skip link exists and points to #main', async ({ page }) => {
  await page.goto('/')
  const skip = page.locator('.skip-link')
  await expect(skip).toHaveAttribute('href', '#main')
  // Skip link should be present in DOM (hidden via transform) but accessible
  await expect(skip).toHaveText(/Skip/i)
})

test('R10 container query — ProfileCard photo shrinks when its own container is narrow', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 })
  await page.goto('/')

  const photoCol = page.locator('[data-component="profile-card"] .pc-photo-col').first()
  await expect(photoCol).toBeVisible()
  const w = await photoCol.evaluate(el => el.getBoundingClientRect().width)
  expect(w, 'photo col should shrink in narrow container (<420px)').toBeLessThanOrEqual(120)
})

test('R10 modern viewport unit — app-shell uses 100dvh not 100vh', async ({ page }) => {
  await page.goto('/')
  const minHeight = await page.locator('.app-shell').evaluate(el => getComputedStyle(el).minHeight)
  expect(minHeight).toMatch(/^\d+px$/)  // dvh resolves to px at compute time
  const vh = await page.evaluate(() => window.innerHeight)
  const numeric = parseFloat(minHeight)
  expect(Math.abs(numeric - vh)).toBeLessThan(2)
})

test('R9 ultrawide caps shell-inner at --shell-max-w', async ({ page }) => {
  await page.setViewportSize({ width: 3000, height: 1200 })
  await page.goto('/')
  const innerWidth = await page.locator('.app-shell-inner').evaluate(el => el.getBoundingClientRect().width)
  expect(innerWidth).toBeLessThanOrEqual(1800)
})

test('R8 PaydayCard + MonthCard render on Dashboard with sensible values', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('[data-component="payday-card"]')).toBeVisible()
  await expect(page.locator('[data-component="month-card"]')).toBeVisible()

  // Payday: either a number string OR the word "TODAY"
  const paydayText = await page.locator('[data-payday-num]').textContent()
  expect(paydayText).toBeTruthy()
  expect(paydayText!.length).toBeGreaterThan(0)

  // Month: bar fill width is a percentage between 0 and 100
  const barStyle = await page.locator('[data-month-bar-fill]').getAttribute('style')
  expect(barStyle).toMatch(/width:\s*\d{1,3}%/)

  // Month label is uppercase "MONTH YEAR"
  const monthLabel = await page.locator('[data-month-label]').textContent()
  expect(monthLabel).toMatch(/^[A-Z]+ \d{4}$/)
})

test('R7 ProfileCard shows default name + EDIT button on fresh device', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('[data-component="profile-card"]')).toBeVisible()
  await expect(page.locator('[data-profile-name]')).toHaveText('Pi-keng')
  await expect(page.locator('[data-action="edit-profile"]')).toBeVisible()
  await expect(page.locator('[data-action="upload-photo"]')).toBeVisible()
})

test('R7 ProfileCard edit flow — name + notes save and persist across reload', async ({ page }) => {
  await page.goto('/')
  await page.locator('[data-action="edit-profile"]').click()
  await page.locator('[data-field="profile-name"]').fill('Junie')
  await page.locator('[data-field="profile-notes"]').fill('First note · 2026')
  await page.locator('[data-action="save-profile"]').click()

  await expect(page.locator('[data-profile-name]')).toHaveText('Junie')
  await expect(page.locator('[data-profile-notes]')).toContainText('First note · 2026')

  await page.reload()
  await expect(page.locator('[data-profile-name]')).toHaveText('Junie')
  await expect(page.locator('[data-profile-notes]')).toContainText('First note · 2026')
})

test('R7 ProfileCard cancel reverts changes', async ({ page }) => {
  await page.goto('/')
  await page.locator('[data-action="edit-profile"]').click()
  await page.locator('[data-field="profile-name"]').fill('Throwaway')
  await page.locator('[data-action="cancel-profile"]').click()

  await expect(page.locator('[data-profile-name]')).toHaveText('Pi-keng')
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
