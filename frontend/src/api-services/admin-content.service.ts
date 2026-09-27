import { apiClient } from '@/lib/api-client';
import type { BackendBlogPostItem } from './blog.service';
import type { BackendForumEvent, CreateEventPayload } from './events.service';
import type { DirectoryListingRecord } from '@alanya-holidays/shared';

export interface AdminProduct {
  id: number;
  name: string;
  description: string | null;
  price: number;
  stock: number;
  currency: string;
  status: 'active' | 'inactive' | 'draft';
  media: Array<{ url: string; type: string }> | null;
  category_id: number | null;
  seller_id?: string | null;
  product_categories?: { id: number; name: string } | null;
}

export type AdminProductInput = Pick<
  AdminProduct,
  'name' | 'description' | 'price' | 'stock' | 'currency' | 'status' | 'media' | 'category_id'
>;

export interface AdminProductPage {
  items: AdminProduct[];
  page: number;
  limit: number;
  total: number;
}

export interface AdminArticleInput {
  title: string;
  content: string;
  excerpt?: string;
  category?: string | null;
  cover_image_url?: string | null;
  status?: 'draft' | 'published' | 'archived';
  is_featured?: boolean;
  content_type?: 'blog' | 'guide';
}

export interface AdminListingInput {
  name: string;
  description?: string;
  short_description?: string;
  category_id: string;
  location?: string;
  phone?: string;
  email?: string;
  website?: string;
  gallery?: string[];
  tier?: 'explorer' | 'voyager' | 'signature' | 'partner';
  status?: 'draft' | 'pending' | 'approved' | 'rejected';
  creation_source?: 'admin' | 'merchant' | 'import';
}

async function publishReviewed<T>(request: Promise<T>, type: string, publish: boolean): Promise<T> {
  const item = await request;
  const row = item as { id?: string | number; moderation_status?: string; moderation_revision?: number };
  if (publish && row.moderation_status !== 'approved') {
    if (row.moderation_status !== 'pending' || row.id === undefined || row.moderation_revision === undefined) {
      throw new Error('Saved, but publication needs a fresh preview in the public content review queue.');
    }
    return await apiClient.patch<T>('/admin/public-content/review', { type, id: String(row.id), revision: row.moderation_revision, approve: true });
  }
  return item;
}

class AdminContentService {
  async listArticles(contentType?: 'blog' | 'guide'): Promise<BackendBlogPostItem[]> {
    return apiClient.get<BackendBlogPostItem[]>('/blog/posts', { params: contentType ? { content_type: contentType } : {} });
  }

  createArticle(input: AdminArticleInput): Promise<BackendBlogPostItem> {
    return publishReviewed(apiClient.post('/blog', input), 'blog_posts', input.status === 'published');
  }

  updateArticle(id: string, input: AdminArticleInput): Promise<BackendBlogPostItem> {
    return publishReviewed(apiClient.put(`/blog/${id}`, input), 'blog_posts', input.status === 'published');
  }

  async deleteArticle(id: string): Promise<void> {
    await apiClient.delete(`/blog/${id}`);
  }

  listEvents(): Promise<BackendForumEvent[]> {
    return apiClient.get('/forum/events', {
      params: { includeUnpublished: true, limit: 100 },
    });
  }

  createEvent(
    input: CreateEventPayload,
    idempotencyKey: string,
  ): Promise<BackendForumEvent> {
    return publishReviewed(apiClient.post('/forum/events', input, {
      headers: { 'Idempotency-Key': idempotencyKey },
    }), 'forum_events', input.is_published !== false);
  }

  updateEvent(
    id: string,
    input: Partial<CreateEventPayload>,
  ): Promise<BackendForumEvent> {
    return publishReviewed(apiClient.put(`/forum/events/${id}`, input), 'forum_events', input.is_published === true);
  }

  async deleteEvent(id: string): Promise<void> {
    await apiClient.delete(`/forum/events/${id}`);
  }

  async listListings(): Promise<DirectoryListingRecord[]> {
    return apiClient.get<DirectoryListingRecord[]>('/directory/admin/listings', { params: { status: 'all' } });
  }

  createListing(input: AdminListingInput): Promise<DirectoryListingRecord> {
    return publishReviewed(apiClient.post('/directory/admin/listings', input), 'directory_listings', input.status === 'approved');
  }

  updateListing(
    id: string,
    input: AdminListingInput,
  ): Promise<DirectoryListingRecord> {
    return publishReviewed(apiClient.patch(`/directory/admin/listings/${id}`, input), 'directory_listings', input.status === 'approved');
  }

  async deleteListing(id: string): Promise<void> {
    await apiClient.delete(`/directory/admin/listings/${id}`);
  }

  listProducts(options: {
    page?: number;
    limit?: number;
    search?: string;
  } = {}): Promise<AdminProductPage> {
    return apiClient.get('/products/admin', { params: options });
  }

  createProduct(input: AdminProductInput): Promise<AdminProduct> {
    return publishReviewed(apiClient.post('/products/admin', input), 'product_items', input.status === 'active');
  }

  updateProduct(
    id: string,
    input: AdminProductInput,
  ): Promise<AdminProduct> {
    return publishReviewed(apiClient.put(`/products/admin/${id}`, input), 'product_items', input.status === 'active');
  }

  async deleteProduct(id: string): Promise<void> {
    await apiClient.delete(`/products/admin/${id}`);
  }
}

export const adminContentService = new AdminContentService();
