import { test, expect } from '@playwright/test';

const locales = [
  { code: 'en', loadingError: 'Upcoming events are unavailable', retry: 'Try Again', empty: 'No events scheduled this week', category: 'Category' },
  { code: 'ru', loadingError: 'Предстоящие мероприятия недоступны', retry: 'Попробовать снова', empty: 'На этой неделе мероприятий нет', category: 'Категория' },
  { code: 'tr', loadingError: 'Yaklaşan etkinlikler kullanılamıyor', retry: 'Tekrar dene', empty: 'Bu hafta planlanmış etkinlik yok', category: 'Kategori' },
];

for (const locale of locales) {
  test(`live data failures and narrow catalogue in ${locale.code}`, async ({ page }) => {
    await page.addInitScript((code) => localStorage.setItem('alanya-language', code), locale.code);
    let recoverEvents = false;
    await page.route('**/api/**', async (route) => {
      if (recoverEvents && new URL(route.request().url()).pathname === '/api/forum/events') {
        return route.fulfill({ json: [] });
      }
      return route.fulfill({ status: 503, json: { message: 'internal SQL failure' } });
    });
    await page.goto('/');
    const hero = page.getByRole('heading', { level: 1 }).locator('..');
    await expect(hero.getByRole('alert')).toContainText(locale.loadingError);
    await expect(page.getByText('internal SQL failure')).toHaveCount(0);
    await expect(hero.locator('img[alt^="Traveler"]')).toHaveCount(0);
    recoverEvents = true;
    await hero.getByRole('button', { name: locale.retry, exact: true }).click();
    await expect(hero.getByText(locale.empty, { exact: true })).toBeVisible();
    await page.goto('/explore');
    for (const width of [320, 360, 390, 430, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      if (width < 640) {
        const categories = page.getByRole('combobox', { name: locale.category, exact: true });
        await expect(categories).toBeVisible();
        await categories.selectOption({ index: 1 });
        await expect(categories).not.toHaveValue('all');
      }
    }
  });
}

for (const locale of [
  { code: 'ru', personal: 'Личный аккаунт', business: 'Бизнес-аккаунт', emptyMembers: 'Участники не найдены' },
  { code: 'tr', personal: 'Kişisel hesap', business: 'İşletme hesabı', emptyMembers: 'Üye bulunamadı' },
]) {
  test(`registration and member directory translate in ${locale.code}`, async ({ page }) => {
    await page.addInitScript((code) => localStorage.setItem('alanya-language', code), locale.code);
    await page.route('**/api/**', (route) => route.fulfill({ json: [] }));
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto('/register');
    await expect(page.getByRole('link', { name: locale.personal, exact: true })).toHaveAttribute('aria-current', 'page');
    await page.getByRole('link', { name: locale.business, exact: true }).click();
    await expect(page).toHaveURL(/\/business\/register$/);
    await expect(page.getByRole('link', { name: locale.business, exact: true })).toHaveAttribute('aria-current', 'page');
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.goto('/members');
    await expect(page.getByRole('heading', { name: locale.emptyMembers, exact: true })).toBeVisible();
    await expect(page.getByText('No members found', { exact: true })).toHaveCount(0);
  });
}
