import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminContentLibraryTab from '../components/AdminContentLibraryTab';
import { adminContentService } from '@/api-services/admin-content.service';
import { storageService } from '@/api-services/storage.service';
import { forumService, type Category } from '@/api-services/forum.service';

vi.mock('@/api-services/forum.service', () => ({
  forumService: {
    getCategories: vi.fn(),
  },
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'admin-1' } }),
}));

vi.mock('@/api-services/storage.service', () => ({
  storageService: {
    uploadEventImage: vi.fn(),
    uploadEventVideo: vi.fn(),
    abandonEventMedia: vi.fn(),
  },
}));

vi.mock('@/components/base/RichTextEditor', () => ({
  default: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <textarea aria-label="Article body" value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}));

describe('AdminContentLibraryTab', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.spyOn(adminContentService, 'listArticles').mockResolvedValue([
      { id: 'post-1', title: 'Alanya Guide', slug: 'alanya-guide', content: '<p>Guide body</p>' },
    ]);
    vi.spyOn(adminContentService, 'createArticle').mockResolvedValue({
      id: 'post-2', title: 'New Guide', slug: 'new-guide', content: '<p>Long enough guide</p>',
    });
    vi.spyOn(adminContentService, 'deleteArticle').mockResolvedValue(undefined);
    vi.spyOn(adminContentService, 'updateArticle').mockResolvedValue({
      id: 'post-1', title: 'Updated Guide', slug: 'alanya-guide', content: '<p>Guide body</p>',
    });
    vi.spyOn(adminContentService, 'listEvents').mockResolvedValue([
      {
        id: 'event-1',
        title: 'Harbour Meetup',
        event_date: '2026-09-01T18:00:00Z',
        description: 'Meet the community beside the harbour in Alanya.',
        location: 'Alanya Harbour',
        category_id: 'category-1',
        category: { id: 'category-1', name: 'Community', slug: 'community' },
        image_url: 'https://legacy.example/cover.jpg',
        video_url: 'https://legacy.example/clip.mp4',
      },
    ]);
    vi.spyOn(adminContentService, 'listListings').mockResolvedValue([
      {
        id: 'listing-1',
        name: 'Castle Cafe',
        description: null,
        short_description: 'A welcoming cafe by the castle.',
        category_id: 'restaurants',
        creation_source: 'import',
        gallery: ['https://example.com/castle-1.jpg', 'https://example.com/castle-2.jpg'],
      },
    ]);
    vi.spyOn(adminContentService, 'listProducts').mockResolvedValue({
      items: [{ id: 1, name: 'Copper Lamp', description: 'Handmade', category_id: 7, product_categories: { id: 7, name: 'Decor' }, price: 10, stock: 2, currency: 'EUR', status: 'active', media: [] }],
      page: 1,
      limit: 20,
      total: 21,
    });
    vi.spyOn(adminContentService, 'createEvent').mockResolvedValue({ id: 'event-2', title: 'New Event', event_date: '2026-09-02T18:00:00Z' });
    vi.spyOn(adminContentService, 'updateEvent').mockResolvedValue({ id: 'event-1', title: 'Harbour Meetup', event_date: '2026-09-01T18:00:00Z' });
    vi.spyOn(adminContentService, 'createListing').mockResolvedValue({ id: 'listing-2', name: 'New Cafe', category_id: 'restaurants' });
    vi.spyOn(adminContentService, 'updateListing').mockResolvedValue({ id: 'listing-1', name: 'Castle Cafe', category_id: 'restaurants', creation_source: 'admin' });
    vi.spyOn(adminContentService, 'createProduct').mockResolvedValue({ id: 2, name: 'New Lamp', description: 'Handmade', category_id: 7, price: 12, stock: 3, currency: 'EUR', status: 'active', media: [] });
    vi.mocked(storageService.uploadEventImage).mockResolvedValue({
      mediaId: 'image-media-1',
      url: 'https://project.example/new-cover.webp',
      thumbnailUrl: 'https://project.example/new-cover-thumb.webp',
    });
    vi.mocked(storageService.uploadEventVideo).mockResolvedValue({
      mediaId: 'video-media-1',
      url: 'https://project.example/new-video.mp4',
    });
    vi.mocked(storageService.abandonEventMedia).mockResolvedValue(undefined);
    vi.mocked(forumService.getCategories).mockResolvedValue([
      { id: 'category-1', name: 'Community', slug: 'community' } as Category,
    ]);
  });

  it('creates and deletes an article with explicit confirmation', async () => {
    render(<AdminContentLibraryTab />);
    expect(await screen.findByText('Alanya Guide')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /create articles & guides/i }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'New Guide' } });
    fireEvent.change(screen.getByLabelText('Article body'), { target: { value: '<p>Long enough guide</p>' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(adminContentService.createArticle).toHaveBeenCalledWith(expect.objectContaining({ title: 'New Guide' })));

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(adminContentService.deleteArticle).toHaveBeenCalledWith('post-1'));
  });

  it('opens existing content in edit mode and persists the update', async () => {
    render(<AdminContentLibraryTab />);
    expect(await screen.findByText('Alanya Guide')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Updated Guide' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(adminContentService.updateArticle).toHaveBeenCalledWith('post-1', expect.objectContaining({ title: 'Updated Guide' })));
  });

  it('exposes working create forms for events, listings, and products', async () => {
    render(<AdminContentLibraryTab />);
    await screen.findByText('Alanya Guide');

    fireEvent.click(screen.getByRole('tab', { name: 'Events' }));
    expect(await screen.findByText('Harbour Meetup')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /create events/i }));
    fireEvent.change(screen.getByLabelText('Event title'), { target: { value: 'New Event' } });
    fireEvent.change(await screen.findByLabelText('Category'), { target: { value: 'category-1' } });
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-09-02' } });
    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '18:00' } });
    fireEvent.change(screen.getByLabelText('Location'), { target: { value: 'Alanya Harbour' } });
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: 'Meet the community beside the harbour in Alanya.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save event' }));
    await waitFor(() =>
      expect(adminContentService.createEvent).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'New Event' }),
        expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        ),
      ),
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Directory Listings' }));
    expect(await screen.findByText('Castle Cafe')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /create directory listings/i }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New Cafe' } });
    fireEvent.change(screen.getByLabelText('Category ID'), { target: { value: 'restaurants' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(adminContentService.createListing).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('tab', { name: 'Products' }));
    expect(await screen.findByText('Copper Lamp')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /create products/i }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New Lamp' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Handmade lamp' } });
    fireEvent.change(screen.getByLabelText('Category ID'), { target: { value: '7' } });
    fireEvent.change(screen.getByLabelText('Price'), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText('Stock'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(adminContentService.createProduct).toHaveBeenCalledWith({
      name: 'New Lamp',
      description: 'Handmade lamp',
      category_id: 7,
      price: 12,
      stock: 3,
      currency: 'EUR',
      status: 'draft',
      media: [],
    }));
  });

  it('omits legacy event URLs on metadata-only edit and preserves opaque replacement/removal', async () => {
    render(<AdminContentLibraryTab />);
    await screen.findByText('Alanya Guide');
    fireEvent.click(screen.getByRole('tab', { name: 'Events' }));
    await screen.findByText('Harbour Meetup');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await screen.findByRole('option', { name: 'Community' });
    fireEvent.change(screen.getByLabelText('Event title'), {
      target: { value: 'Updated harbour meetup' },
    });
    const saveMetadataButton = screen.getByRole('button', { name: 'Save event' });
    await waitFor(() => expect(saveMetadataButton).toBeEnabled());
    fireEvent.click(saveMetadataButton);

    await waitFor(() => expect(adminContentService.updateEvent).toHaveBeenCalled());
    const metadataPayload = vi.mocked(adminContentService.updateEvent).mock
      .calls[0][1];
    expect(metadataPayload).not.toHaveProperty('image_url');
    expect(metadataPayload).not.toHaveProperty('video_url');
    expect(metadataPayload).not.toHaveProperty('image_media_id');
    expect(metadataPayload).not.toHaveProperty('video_media_id');
    expect(metadataPayload.event_date).toBe('2026-09-01T18:00:00Z');

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const replacement = new File(['cover'], 'cover.png', {
      type: 'image/png',
    });
    fireEvent.change(screen.getByLabelText('Event cover image'), {
      target: { files: [replacement] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Remove event video' }));
    const saveMediaButton = screen.getByRole('button', { name: 'Save event' });
    await waitFor(() => expect(saveMediaButton).toBeEnabled());
    fireEvent.click(saveMediaButton);

    await waitFor(() =>
      expect(adminContentService.updateEvent).toHaveBeenLastCalledWith(
        'event-1',
        expect.objectContaining({
          image_media_id: 'image-media-1',
          video_media_id: null,
        }),
      ),
    );
    const mediaPayload = vi.mocked(adminContentService.updateEvent).mock
      .calls.at(-1)?.[1];
    expect(mediaPayload).not.toHaveProperty('image_url');
    expect(mediaPayload).not.toHaveProperty('video_url');
  });

  it('keeps one event-create key and media draft while an uncertain save is pending', async () => {
    let rejectCreation: ((reason?: unknown) => void) | undefined;
    vi.mocked(adminContentService.createEvent)
      .mockReturnValueOnce(
        new Promise<
          Awaited<ReturnType<typeof adminContentService.createEvent>>
        >((_resolve, reject) => {
          rejectCreation = reject;
        }),
      )
      .mockResolvedValueOnce({
        id: 'event-2',
        title: 'New Event',
        event_date: '2026-09-02T18:00:00Z',
      });
    render(<AdminContentLibraryTab />);
    await screen.findByText('Alanya Guide');
    fireEvent.click(screen.getByRole('tab', { name: 'Events' }));
    await screen.findByText('Harbour Meetup');
    fireEvent.click(screen.getByRole('button', { name: /create events/i }));
    const title = screen.getByLabelText('Event title');
    const image = screen.getByLabelText('Event cover image');
    fireEvent.change(title, { target: { value: 'New Event' } });
    fireEvent.change(await screen.findByLabelText('Category'), {
      target: { value: 'category-1' },
    });
    fireEvent.change(screen.getByLabelText('Date'), {
      target: { value: '2026-09-02' },
    });
    fireEvent.change(screen.getByLabelText('Time'), {
      target: { value: '18:00' },
    });
    fireEvent.change(screen.getByLabelText('Location'), {
      target: { value: 'Alanya Harbour' },
    });
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: 'Meet the community beside the harbour in Alanya.' },
    });
    fireEvent.change(image, {
      target: {
        files: [new File(['cover'], 'cover.png', { type: 'image/png' })],
      },
    });
    const form = screen.getByRole('button', { name: 'Save event' }).closest(
      'form',
    ) as HTMLFormElement;

    fireEvent.submit(form);
    await waitFor(() =>
      expect(adminContentService.createEvent).toHaveBeenCalledTimes(1),
    );
    const firstCall = vi.mocked(adminContentService.createEvent).mock.calls[0];
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.change(title, { target: { value: 'Changed while pending' } });
    fireEvent.change(image, {
      target: {
        files: [new File(['other'], 'other.webp', { type: 'image/webp' })],
      },
    });
    fireEvent.submit(form);

    expect(adminContentService.createEvent).toHaveBeenCalledTimes(1);
    expect(storageService.abandonEventMedia).not.toHaveBeenCalled();
    rejectCreation?.(new Error('network response lost'));
    await screen.findByText('Could not save this event right now. Please try again.');
    fireEvent.submit(form);

    await waitFor(() =>
      expect(adminContentService.createEvent).toHaveBeenCalledTimes(2),
    );
    expect(storageService.uploadEventImage).toHaveBeenCalledTimes(1);
    expect(vi.mocked(adminContentService.createEvent).mock.calls[1]).toEqual(
      firstCall,
    );
  });

  it('searches and pages products beyond the first 20 records', async () => {
    render(<AdminContentLibraryTab />);
    await screen.findByText('Alanya Guide');

    fireEvent.click(screen.getByRole('tab', { name: 'Products' }));
    expect(await screen.findByText('Copper Lamp')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search products' }), {
      target: { value: 'copper' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() =>
      expect(adminContentService.listProducts).toHaveBeenLastCalledWith({
        page: 1,
        limit: 20,
        search: 'copper',
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() =>
      expect(adminContentService.listProducts).toHaveBeenLastCalledWith({
        page: 2,
        limit: 20,
        search: 'copper',
      }),
    );
  });

  it('lets an admin explicitly mark a verified imported listing as admin-curated', async () => {
    render(<AdminContentLibraryTab />);
    await screen.findByText('Alanya Guide');

    fireEvent.click(screen.getByRole('tab', { name: 'Directory Listings' }));
    expect(await screen.findByText('Castle Cafe')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Claim source'), {
      target: { value: 'admin' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(adminContentService.updateListing).toHaveBeenCalledWith(
        'listing-1',
        expect.objectContaining({
          creation_source: 'admin',
          gallery: [
            'https://example.com/castle-1.jpg',
            'https://example.com/castle-2.jpg',
          ],
        }),
      ),
    );
  });

  it('uses a listing short description when the full description is absent', async () => {
    render(<AdminContentLibraryTab />);
    await screen.findByText('Alanya Guide');

    fireEvent.click(screen.getByRole('tab', { name: 'Directory Listings' }));
    await screen.findByText('Castle Cafe');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    expect(screen.getByLabelText('Description')).toHaveValue('A welcoming cafe by the castle.');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(adminContentService.updateListing).toHaveBeenCalledWith(
        'listing-1',
        expect.objectContaining({
          description: 'A welcoming cafe by the castle.',
          short_description: 'A welcoming cafe by the castle.',
        }),
      ),
    );
  });

  it('preserves an explicit empty listing description instead of falling back', async () => {
    vi.mocked(adminContentService.listListings).mockResolvedValueOnce([
      {
        id: 'listing-empty-description',
        name: 'Empty Description Cafe',
        description: '',
        short_description: 'Fallback should not be used',
        category_id: 'restaurants',
        creation_source: 'import',
        gallery: [],
      },
    ]);

    render(<AdminContentLibraryTab />);
    await screen.findByText('Alanya Guide');
    fireEvent.click(screen.getByRole('tab', { name: 'Directory Listings' }));
    await screen.findByText('Empty Description Cafe');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    expect(screen.getByLabelText('Description')).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(adminContentService.updateListing).toHaveBeenCalledWith(
        'listing-empty-description',
        expect.objectContaining({ description: '', short_description: '' }),
      ),
    );
  });
});
