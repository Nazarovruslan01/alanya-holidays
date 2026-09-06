import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, it, expect, vi } from 'vitest';
import { directoryService } from '@/api-services/directory.service';
import { businesses } from '@/domain/directory-businesses';
import i18n from '@/i18n';
import RecentlyClaimedSection from './RecentlyClaimedSection';

afterEach(() => vi.restoreAllMocks());

it('shows only the ownership badge for a claimed but unverified business', async () => {
  await i18n.changeLanguage('en');
  vi.spyOn(directoryService, 'getRecentlyClaimedListings').mockResolvedValue([{ ...businesses[0], claimed_at: '2026-08-20T12:00:00Z', is_verified: false }]);
  render(<MemoryRouter><RecentlyClaimedSection /></MemoryRouter>);
  expect(await screen.findByText('Owner confirmed')).toBeInTheDocument();
  expect(screen.queryByText('Verified Owner')).not.toBeInTheDocument();
  expect(screen.getAllByTestId('trust-badge')).toHaveLength(1);
});

it('uses a translated public error instead of the backend message', async () => {
  await i18n.changeLanguage('en');
  vi.spyOn(directoryService, 'getRecentlyClaimedListings').mockRejectedValue(new Error('relation private_table does not exist'));
  render(<MemoryRouter><RecentlyClaimedSection /></MemoryRouter>);
  expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load content');
  expect(screen.queryByText('relation private_table does not exist')).not.toBeInTheDocument();
});
