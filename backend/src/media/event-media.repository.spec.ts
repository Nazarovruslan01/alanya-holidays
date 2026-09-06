import {
  EventMediaPersistenceException,
  EventMediaRepository,
} from './event-media.repository';

describe('EventMediaRepository', () => {
  let rpc: jest.Mock;
  let repository: EventMediaRepository;

  beforeEach(() => {
    rpc = jest.fn().mockResolvedValue({ data: true, error: null });
    repository = new EventMediaRepository({
      getClient: () => ({ rpc }),
    } as never);
  });

  it('queues cleanup only through the owner-scoped durable RPC', async () => {
    await expect(repository.queueCleanup('media-1', 'owner-1')).resolves.toBe(
      true,
    );

    expect(rpc).toHaveBeenCalledWith('queue_owned_event_media_cleanup', {
      p_media_id: 'media-1',
      p_owner_id: 'owner-1',
    });
  });

  it('reserves a video intent through the transactionally serialized quota RPC', async () => {
    rpc.mockResolvedValueOnce({
      data: { id: 'media-1', state: 'pending' },
      error: null,
    });

    await repository.reserveVideoIntent({
      id: 'media-1',
      owner_id: 'owner-1',
      kind: 'video',
      bucket: 'event-media-staging',
      object_path: 'owner-1/events/video.mp4',
      thumbnail_path: null,
      public_url: 'https://project.test/video.mp4',
      thumbnail_url: null,
      mime_type: 'video/mp4',
      size_bytes: 1024,
      expires_at: '2026-09-06T12:00:00.000Z',
    });

    expect(rpc).toHaveBeenCalledWith('reserve_event_video_intent', {
      p_id: 'media-1',
      p_owner_id: 'owner-1',
      p_object_path: 'owner-1/events/video.mp4',
      p_public_url: 'https://project.test/video.mp4',
      p_mime_type: 'video/mp4',
      p_size_bytes: 1024,
      p_expires_at: '2026-09-06T12:00:00.000Z',
    });
  });

  it('completes video promotion through the atomic owner-scoped RPC', async () => {
    rpc.mockResolvedValueOnce({
      data: { id: 'media-1', bucket: 'event-media', state: 'ready' },
      error: null,
    });

    await expect(
      repository.completeVideoPromotion('media-1', 'owner-1'),
    ).resolves.toMatchObject({
      id: 'media-1',
      bucket: 'event-media',
      state: 'ready',
    });

    expect(rpc).toHaveBeenCalledWith('complete_event_video_promotion', {
      p_media_id: 'media-1',
      p_owner_id: 'owner-1',
    });
  });

  it('claims only an owner pending staging row for promotion', async () => {
    const maybeSingle = jest.fn().mockResolvedValue({
      data: { id: 'media-1', state: 'promoting' },
      error: null,
    });
    const builder: Record<string, jest.Mock> = {};
    builder.update = jest.fn(() => builder);
    builder.eq = jest.fn(() => builder);
    builder.select = jest.fn(() => builder);
    builder.maybeSingle = maybeSingle;
    const from = jest.fn(() => builder);
    repository = new EventMediaRepository({
      getClient: () => ({ from, rpc }),
    } as never);

    await expect(
      repository.markPromoting('media-1', 'owner-1', 'a'.repeat(64)),
    ).resolves.toMatchObject({ id: 'media-1', state: 'promoting' });

    expect(from).toHaveBeenCalledWith('event_media');
    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        state: 'promoting',
        content_sha256: 'a'.repeat(64),
      }),
    );
    expect(builder.eq.mock.calls).toEqual([
      ['id', 'media-1'],
      ['owner_id', 'owner-1'],
      ['bucket', 'event-media-staging'],
      ['state', 'pending'],
    ]);
  });

  it('passes only persisted-operation paths to the durable partial cleanup RPC', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null });

    await repository.queueCleanupPaths({
      mediaId: 'media-1',
      bucket: 'forum-media',
      paths: ['owner/events/full.webp'],
      error: 'thumbnail failed',
    });

    expect(rpc).toHaveBeenCalledWith('queue_event_media_cleanup_paths', {
      p_media_id: 'media-1',
      p_bucket: 'forum-media',
      p_object_paths: ['owner/events/full.webp'],
      p_last_error: 'thumbnail failed',
    });
  });

  it('preserves cleanup RPC failures for the primary service error path', async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'XX000', message: 'outbox unavailable' },
    });

    await expect(repository.queueCleanup('media-1', 'owner-1')).rejects.toEqual(
      new EventMediaPersistenceException('outbox unavailable', 'XX000'),
    );
  });
});
