import { test, expect } from '@playwright/test';
import { mockSupabaseRest, seedAuthSession, setupAuthMocks } from './utils/mock-utils';

test('administrator previews, rejects a stale revision, then approves the current revision', async ({ page }) => {
  await page.route('https://**/*', (route) => route.abort());
  await setupAuthMocks(page);
  await seedAuthSession(page, { role: 'admin' });
  await mockSupabaseRest(page, { role: 'admin' });
  let revision = 7;
  let status = 'pending';
  const submitted: number[] = [];
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/admin/public-content/review')) {
      const body = route.request().postDataJSON();
      submitted.push(body.revision);
      if (body.revision !== revision) return route.fulfill({ status: 409, json: { message: 'Content changed; reload the review' } });
      status = body.approve ? 'approved' : 'rejected';
      return route.fulfill({ json: { id: 'post-1', moderation_status: status, moderation_revision: revision } });
    }
    if (url.pathname.endsWith('/admin/public-content')) {
      const data = url.searchParams.get('status') === status ? [{ id: 'post-1', title: 'Reviewable discussion', body: 'The exact submitted public text', moderation_revision: revision }] : [];
      return route.fulfill({ json: { data, total: data.length, totalPages: data.length } });
    }
    if (url.pathname.endsWith('/admin/queue-counts')) return route.fulfill({ json: { pendingListings: 0, pendingClaims: 0, pendingContent: 0, pendingReports: 0, newEnquiries: 0, pendingBookings: 0, pendingReviews: 0 } });
    return route.fulfill({ json: { data: [], total: 0, totalPages: 0 } });
  });
  await page.goto('/admin?tab=public-review');
  await page.getByRole('button', { name: 'Reviewable discussion' }).click();
  await expect(page.getByText('The exact submitted public text', { exact: true })).toBeVisible();
  revision = 8;
  await page.getByRole('button', { name: 'Approve and publish' }).click();
  await expect(page.getByRole('alert')).toContainText('Content changed');
  expect(status).toBe('pending');
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.getByRole('button', { name: 'Reviewable discussion' }).click();
  await expect(page.getByText('Review revision 8')).toBeVisible();
  await page.getByRole('button', { name: 'Approve and publish' }).click();
  await expect(page.getByText('0 records', { exact: true })).toBeVisible();
  expect(submitted).toEqual([7, 8]);
  await page.getByRole('combobox', { name: 'Status', exact: true }).selectOption('approved');
  await expect(page.getByRole('button', { name: 'Reviewable discussion' })).toBeVisible();
});

test('owner settings show a pending public revision without replacing the approved profile', async ({ page }) => {
  await page.route('https://**/*', (route) => route.abort());
  await setupAuthMocks(page);
  await seedAuthSession(page, { role: 'guest' });
  await mockSupabaseRest(page, { role: 'guest' });
  await page.route('**/api/**', async (route) => {
    if (new URL(route.request().url()).pathname.endsWith('/users/me/public-revision')) {
      return route.fulfill({ json: { changes: { full_name: 'Requested public name', bio: 'Requested biography' }, moderation_status: 'pending', moderation_revision: 2, moderation_reason: null } });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto('/settings');
  await expect(page.getByLabel(/Full name/i)).toHaveValue('Requested public name');
  await expect(page.getByText(/last approved profile remains public/i)).toBeVisible();
  await expect(page.getByText('Test User', { exact: true }).first()).toBeVisible();
});
