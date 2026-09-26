import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { adminService } from '@/api-services/admin.service';
import ListingsModerationTab from './ListingsModerationTab';

beforeEach(() => vi.restoreAllMocks());
it('requests a later server page and preserves the server total', async () => {
  const fetch = vi.spyOn(adminService, 'getQueuePage').mockImplementation(async <T,>(params: Parameters<typeof adminService.getQueuePage>[0]) => ({
    data: [{ id: `listing-${params.page}`, name: `Page ${params.page} listing`, status: 'pending', moderation_revision: params.page, created_at: '2026-09-27' }] as T[], total: 45, totalPages: 3,
  }));
  render(<ListingsModerationTab />);
  expect(await screen.findByText('Page 1 listing')).toBeVisible();
  expect(screen.getByText(/45 records/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(await screen.findByText('Page 2 listing')).toBeVisible();
  await waitFor(() => expect(fetch).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, type: 'listings', status: 'all' })));
  expect(screen.queryByText('Page 1 listing')).not.toBeInTheDocument();
});
