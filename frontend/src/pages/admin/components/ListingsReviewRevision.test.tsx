import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { adminService, type ModerationListing } from '@/api-services/admin.service';
import ListingsModerationTab from './ListingsModerationTab';

beforeEach(() => vi.restoreAllMocks());

it('submits the displayed listing revision after a background refresh changes the row', async () => {
  const oldRow = { id: 'listing-1', name: 'Viewed listing', status: 'pending', moderation_revision: 7, created_at: '2026-09-27' } as ModerationListing;
  vi.spyOn(adminService, 'getQueuePage').mockResolvedValueOnce({ data: [oldRow], total: 1, totalPages: 1 })
    .mockResolvedValue({ data: [{ ...oldRow, name: 'Unseen changed listing', moderation_revision: 8 }], total: 1, totalPages: 1 });
  const approve = vi.spyOn(adminService, 'approveListing').mockResolvedValue(false);
  render(<ListingsModerationTab />);
  await screen.findByText('Viewed listing');
  fireEvent.click(screen.getByTitle('Quick Preview'));
  expect(within(screen.getByRole('dialog')).getByText('Viewed listing')).toBeVisible();
  fireEvent.focus(window);
  await screen.findByText('Unseen changed listing');
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Approve Listing' }));
  await waitFor(() => expect(approve).toHaveBeenCalledWith('listing-1', 7));
});

it('keeps selected bulk revisions when a refreshed row has a newer revision', async () => {
  const oldRow = { id: 'listing-1', name: 'Selected listing', status: 'pending', moderation_revision: 7, created_at: '2026-09-27' } as ModerationListing;
  vi.spyOn(adminService, 'getQueuePage').mockResolvedValueOnce({ data: [oldRow], total: 1, totalPages: 1 })
    .mockResolvedValue({ data: [{ ...oldRow, name: 'Changed listing', moderation_revision: 8 }], total: 1, totalPages: 1 });
  const approve = vi.spyOn(adminService, 'batchApproveListings').mockResolvedValue({ successful: [], failed: ['listing-1'] });
  render(<ListingsModerationTab />);
  await screen.findByText('Selected listing');
  fireEvent.click(screen.getByRole('checkbox', { name: /Select.*Selected listing/ }));
  fireEvent.focus(window);
  await screen.findByText('Changed listing');
  fireEvent.click(screen.getByTestId('bulk-approve-btn'));
  await waitFor(() => expect(approve).toHaveBeenCalledWith(['listing-1'], { 'listing-1': 7 }));
});
