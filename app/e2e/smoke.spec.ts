import { test, expect } from '@playwright/test'

test('R0 scaffold renders heading and counter', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'PSLink v2' })).toBeVisible()
  const btn = page.getByRole('button', { name: /count = 0/ })
  await btn.click()
  await expect(page.getByRole('button', { name: /count = 1/ })).toBeVisible()
})
