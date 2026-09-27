import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/lib/api-client';
import { adminContentService } from './admin-content.service';

describe('adminContentService CRUD contracts', () => {
  const idempotencyKey = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  beforeEach(() => vi.restoreAllMocks());

  it('requires a fresh preview when a tagged save deliberately omits an approvable revision', async () => {
    const pending = { id: 'post-1', content: 'Admin submitted content', status: 'published', moderation_status: 'pending' };
    vi.spyOn(apiClient, 'post').mockResolvedValue(pending);
    vi.spyOn(apiClient, 'put').mockResolvedValue(pending);
    const get = vi.spyOn(apiClient, 'get').mockResolvedValue({ ...pending, content: 'OWNER EDIT NEVER PREVIEWED', moderation_revision: 5 });
    const approve = vi.spyOn(apiClient, 'patch');
    const input = { title: 'Tagged article', content: pending.content, status: 'published' as const };
    await expect(adminContentService.createArticle(input)).rejects.toThrow('fresh preview');
    await expect(adminContentService.updateArticle('post-1', input)).rejects.toThrow('fresh preview');
    expect(get).not.toHaveBeenCalled();
    expect(approve).not.toHaveBeenCalled();
  });

  it('preserves automatic approval of the exact returned revision for a normal no-tag save', async () => {
    vi.spyOn(apiClient, 'put').mockResolvedValue({ id: 'post-1', moderation_status: 'pending', moderation_revision: 3 });
    const approve = vi.spyOn(apiClient, 'patch').mockResolvedValue({ id: 'post-1', moderation_status: 'approved', moderation_revision: 3 });
    await adminContentService.updateArticle('post-1', { title: 'Reviewed article', content: 'Reviewed content', status: 'published' });
    expect(approve).toHaveBeenCalledWith('/admin/public-content/review', { type: 'blog_posts', id: 'post-1', revision: 3, approve: true });
  });

  it('uses the current blog content model for article and guide CRUD', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({ data: [] });
    vi.spyOn(apiClient, 'post').mockResolvedValue({ id: 'post-1' });
    vi.spyOn(apiClient, 'put').mockResolvedValue({ id: 'post-1' });
    vi.spyOn(apiClient, 'delete').mockResolvedValue(undefined);
    const input = { title: 'Guide', content: '<p>Useful guide content</p>' };

    await adminContentService.listArticles('guide');
    await adminContentService.createArticle(input);
    await adminContentService.updateArticle('post-1', input);
    await adminContentService.deleteArticle('post-1');

    expect(apiClient.get).toHaveBeenCalledWith('/blog/posts', { params: { content_type: 'guide' } });
    expect(apiClient.post).toHaveBeenCalledWith('/blog', input);
    expect(apiClient.put).toHaveBeenCalledWith('/blog/post-1', input);
    expect(apiClient.delete).toHaveBeenCalledWith('/blog/post-1');
  });

  it('dispatches complete event, listing, and product CRUD through admin-protected routes', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue([]);
    vi.spyOn(apiClient, 'post').mockResolvedValue({ id: 'created', moderation_status: 'pending', moderation_revision: 1 });
    vi.spyOn(apiClient, 'put').mockResolvedValue({ id: 'updated', moderation_status: 'pending', moderation_revision: 2 });
    vi.spyOn(apiClient, 'patch').mockResolvedValue({});
    vi.spyOn(apiClient, 'delete').mockResolvedValue(undefined);

    await adminContentService.createEvent(
      { title: 'Meetup', event_date: '2026-09-01T18:00:00Z' },
      idempotencyKey,
    );
    await adminContentService.updateEvent('event-1', { title: 'Meetup', event_date: '2026-09-01T18:00:00Z' });
    await adminContentService.deleteEvent('event-1');
    await adminContentService.createListing({ name: 'Cafe', category_id: 'restaurants' });
    await adminContentService.updateListing('listing-1', { name: 'Cafe', category_id: 'restaurants' });
    await adminContentService.deleteListing('listing-1');
    const product = {
      name: 'Lamp',
      description: 'Copper lamp',
      category_id: 7,
      price: 10,
      stock: 2,
      currency: 'EUR',
      status: 'active' as const,
      media: [{ url: 'https://example.com/lamp.jpg', type: 'image' }],
    };
    await adminContentService.createProduct(product);
    await adminContentService.updateProduct('product-1', product);
    await adminContentService.deleteProduct('product-1');

    expect(apiClient.post).toHaveBeenCalledWith(
      '/forum/events',
      expect.any(Object),
      { headers: { 'Idempotency-Key': idempotencyKey } },
    );
    expect(apiClient.put).toHaveBeenCalledWith('/forum/events/event-1', expect.any(Object));
    expect(apiClient.post).toHaveBeenCalledWith('/directory/admin/listings', expect.any(Object));
    expect(apiClient.patch).toHaveBeenCalledWith('/directory/admin/listings/listing-1', expect.any(Object));
    expect(apiClient.post).toHaveBeenCalledWith('/products/admin', product);
    expect(apiClient.put).toHaveBeenCalledWith('/products/admin/product-1', product);
    expect(apiClient.delete).toHaveBeenCalledTimes(3);
  });

  it('requests a counted searchable product page', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      items: [{ id: 21, name: 'Copper Lamp' }],
      page: 2,
      limit: 20,
      total: 21,
    });

    await expect(
      adminContentService.listProducts({ page: 2, limit: 20, search: 'copper' }),
    ).resolves.toMatchObject({ page: 2, total: 21 });
    expect(apiClient.get).toHaveBeenCalledWith('/products/admin', {
      params: { page: 2, limit: 20, search: 'copper' },
    });
  });
});
