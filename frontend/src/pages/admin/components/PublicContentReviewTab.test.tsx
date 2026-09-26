import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/lib/api-client';
import PublicContentReviewTab from './PublicContentReviewTab';

describe('Public content review', () => {
  beforeEach(() => vi.restoreAllMocks());
  it('previews content and submits exactly the reviewed revision', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({ data: [{ id: 'post-1', title: 'Pending discussion', body: 'Text awaiting review', moderation_revision: 7 }], total: 1, totalPages: 1 });
    const patch = vi.spyOn(apiClient, 'patch').mockResolvedValue({ moderation_status: 'approved' });
    render(<PublicContentReviewTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Pending discussion' }));
    expect(screen.getByText('Text awaiting review')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Approve and publish' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/admin/public-content/review', { type: 'forum_posts', id: 'post-1', revision: 7, approve: true, reason: '' }));
  });
  it('does not display a late response under a different content type', async () => {
    let resolveOld!: (value: unknown) => void;
    vi.spyOn(apiClient, 'get').mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
      .mockResolvedValue({ data: [{ id: 'new', body: 'Article comment', moderation_revision: 2 }], total: 1, totalPages: 1 });
    render(<PublicContentReviewTab />);
    fireEvent.change(screen.getByLabelText('Content type'), { target: { value: 'blog_comments' } });
    expect(await screen.findByRole('button', { name: 'Article comment' })).toBeVisible();
    resolveOld({ data: [{ id: 'old', title: 'Stale forum post', moderation_revision: 1 }], total: 1, totalPages: 1 });
    await waitFor(() => expect(screen.queryByText('Stale forum post')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Article comment' })).toBeVisible();
  });
  it('does not reload the old queue after approval finishes in a different type', async () => {
    let finishReview!: (value: unknown) => void;
    const get = vi.spyOn(apiClient, 'get').mockResolvedValueOnce({ data: [{ id: 'old', title: 'Old discussion', gallery: ['https://cdn.example.test/media/123'], moderation_revision: 1 }], total: 1, totalPages: 1 })
      .mockResolvedValue({ data: [{ id: 'new', body: 'New comment', moderation_revision: 2 }], total: 1, totalPages: 1 });
    vi.spyOn(apiClient, 'patch').mockImplementationOnce(() => new Promise((resolve) => { finishReview = resolve; }));
    render(<PublicContentReviewTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Old discussion' }));
    expect(screen.getByRole('img', { name: 'Submitted image' })).toHaveAttribute('src', 'https://cdn.example.test/media/123');
    fireEvent.click(screen.getByRole('button', { name: 'Approve and publish' }));
    fireEvent.change(screen.getByLabelText('Content type'), { target: { value: 'blog_comments' } });
    await screen.findByRole('button', { name: 'New comment' });
    finishReview({});
    await waitFor(() => expect(screen.getByRole('button', { name: 'New comment' })).toBeVisible());
    expect(get).toHaveBeenCalledTimes(2);
  });
  it('keeps a stale review visible with an actionable conflict instead of reporting success', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({ data: [{ id: 'post-1', title: 'Changed discussion', moderation_revision: 7 }], total: 1, totalPages: 1 });
    vi.spyOn(apiClient, 'patch').mockRejectedValue(new Error('Content changed; reload the review'));
    render(<PublicContentReviewTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Changed discussion' }));
    fireEvent.click(screen.getByRole('button', { name: 'Approve and publish' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Content changed; reload the review');
  });
});
