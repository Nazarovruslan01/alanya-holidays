import { test, expect } from '@playwright/test';

test('mobile controls fit, remain accessible, and dismiss with keyboard', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('alanya-language', 'ru'));
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: { message: 'Unavailable' } }));
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Написать в WhatsApp' })).toBeVisible();
  // Sample several animation frames: the old ping ring expanded page scroll width.
  const widths = await page.evaluate(async () => {
    const samples: number[] = [];
    const end = performance.now() + 1200;
    while (performance.now() < end) {
      samples.push(document.documentElement.scrollWidth - innerWidth);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    return samples;
  });
  expect(Math.max(...widths)).toBeLessThanOrEqual(0);
  const language = page.getByRole('button', { name: 'Выбор языка: RU (Русский)' });
  await language.click();
  const option = page.getByRole('button', { name: /Türkçe/ });
  await option.focus();
  await option.press('Escape');
  await expect(language).toHaveAttribute('aria-expanded', 'false');
  await expect(language).toBeFocused();
  await expect(page.locator('footer').getByRole('textbox', { name: 'Электронная почта' })).toHaveCount(1);
  await page.goto('/events');
  const heading = page.getByRole('heading', { level: 1 });
  await expect(heading).toBeVisible();
  const navBottom = await page.locator('nav').evaluate(el => el.getBoundingClientRect().bottom);
  expect(await heading.evaluate(el => el.getBoundingClientRect().top)).toBeGreaterThanOrEqual(navBottom);
  const categories = page.getByRole('combobox', { name: 'Категории мероприятий' });
  await categories.selectOption('Beach Gatherings');
  await expect(categories).toHaveValue('Beach Gatherings');
  await categories.selectOption('');
  await expect(categories).toHaveValue('');
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});
