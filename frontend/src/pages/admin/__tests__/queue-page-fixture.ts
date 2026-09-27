import { vi } from 'vitest';
import { adminService } from '@/api-services/admin.service';
import { adminContentService } from '@/api-services/admin-content.service';

// Reuse the existing scenario rows while migrating their transport to page envelopes.
// Pagination itself has dedicated tests with distinct pages and server totals.
export function mockAdminQueuePages() {
  vi.spyOn(adminService, 'getQueuePage').mockImplementation(async <T>(params: Parameters<typeof adminService.getQueuePage>[0]) => {
    let data: unknown[];
    switch (params.type) {
      case 'claims': data = await adminService.getClaimsQueue(params.status === 'all' ? undefined : params.status, { throwOnError: true }); break;
      case 'enquiries': data = await adminService.getEnquiries({ throwOnError: true }); break;
      case 'submissions': data = await adminService.getContentSubmissions({ status: params.status === 'all' ? undefined : params.status, search: params.search?.trim() || undefined, throwOnError: true }); break;
      case 'articles': data = await adminContentService.listArticles(params.category === 'all' ? undefined : params.category as 'blog' | 'guide'); break;
      case 'events': data = await adminContentService.listEvents(); break;
      default: data = params.status === undefined
        ? await adminContentService.listListings()
        : await adminService.getModerationListings({ status: params.status, category: params.category === 'all' ? undefined : params.category, query: params.search?.trim() || undefined, throwOnError: true });
    }
    return { data: data.map((row) => ({ moderation_revision: 1, ...(row as object) })) as T[], total: data.length, totalPages: Math.ceil(data.length / 20) };
  });
}
