import { BadRequestException, ForbiddenException } from '@nestjs/common';
import * as childProcess from 'node:child_process';
import { createHash } from 'node:crypto';
import { access } from 'node:fs/promises';
import { EventMediaPersistenceException } from './event-media.repository';
import { EventMediaService } from './event-media.service';

jest.mock('node:child_process', () => ({ execFile: jest.fn() }));

describe('EventMediaService', () => {
  const ownerId = '11111111-1111-4111-a111-111111111111';
  const mediaId = '22222222-2222-4222-a222-222222222222';
  const mp4Bytes = Uint8Array.from([
    0x00, 0x00, 0x00, 0x10, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
    0x00, 0x00, 0x00, 0x00,
  ]);
  const quickTimeBytes = Uint8Array.from([
    0x00, 0x00, 0x00, 0x10, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20,
    0x00, 0x00, 0x00, 0x00,
  ]);
  const webmBytes = Uint8Array.from([
    0x1a, 0x45, 0xdf, 0xa3, 0x87, 0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d,
  ]);
  const matroskaBytes = Uint8Array.from([
    0x1a, 0x45, 0xdf, 0xa3, 0x8b, 0x42, 0x82, 0x88, 0x6d, 0x61, 0x74, 0x72,
    0x6f, 0x73, 0x6b, 0x61,
  ]);
  const mp4Sha256 = createHash('sha256').update(mp4Bytes).digest('hex');
  let repository: Record<string, jest.Mock>;
  let processing: Record<string, jest.Mock>;
  let applications: { hasApprovedBusinessAccount: jest.Mock };
  let roles: { getRole: jest.Mock };
  let storage: Record<string, jest.Mock>;
  let storageFrom: jest.Mock;
  let service: EventMediaService;
  let fetchMock: jest.SpyInstance;
  const execFileMock = childProcess.execFile as unknown as jest.Mock;

  const mediaRecord = (overrides: Record<string, unknown> = {}) => ({
    id: mediaId,
    owner_id: ownerId,
    event_id: null,
    kind: 'video',
    bucket: 'event-media-staging',
    object_path: `${ownerId}/events/file.mp4`,
    thumbnail_path: null,
    public_url: `https://project.supabase.co/storage/v1/object/public/event-media/${ownerId}/events/file.mp4`,
    thumbnail_url: null,
    mime_type: 'video/mp4',
    size_bytes: mp4Bytes.length,
    content_sha256: null,
    state: 'pending',
    expires_at: new Date().toISOString(),
    ...overrides,
  });

  const probeResult = (formatName: string, codecType = 'video') =>
    JSON.stringify({
      streams: [{ codec_type: codecType }],
      format: { format_name: formatName },
    });

  beforeEach(() => {
    repository = {
      insert: jest.fn(),
      reserveVideoIntent: jest.fn(),
      findOwned: jest.fn(),
      markReady: jest.fn(),
      markPromoting: jest
        .fn()
        .mockImplementation((_id, _ownerId, contentSha256) =>
          Promise.resolve(
            mediaRecord({
              state: 'promoting',
              bucket: 'event-media-staging',
              content_sha256: contentSha256,
            }),
          ),
        ),
      completeVideoPromotion: jest.fn().mockImplementation(() =>
        Promise.resolve(
          mediaRecord({
            state: 'ready',
            bucket: 'event-media',
            content_sha256: mp4Sha256,
          }),
        ),
      ),
      queueCleanup: jest.fn().mockResolvedValue(true),
      queueCleanupPaths: jest.fn().mockResolvedValue(undefined),
    };
    processing = {
      processImageBuffers: jest.fn().mockResolvedValue({
        full: Buffer.from('full'),
        thumbnail: Buffer.from('thumb'),
      }),
    };
    applications = {
      hasApprovedBusinessAccount: jest.fn().mockResolvedValue(true),
    };
    roles = { getRole: jest.fn().mockResolvedValue('user') };
    storage = {
      getPublicUrl: jest.fn((path: string) => ({
        data: {
          publicUrl: `https://project.supabase.co/storage/v1/object/public/event-media/${path}`,
        },
      })),
      createSignedUploadUrl: jest.fn().mockResolvedValue({
        data: { token: 'one-time-token' },
        error: null,
      }),
      createSignedUrl: jest.fn().mockResolvedValue({
        data: { signedUrl: 'https://signed.example/staging-video' },
        error: null,
      }),
      upload: jest.fn().mockResolvedValue({ data: {}, error: null }),
      remove: jest.fn().mockResolvedValue({ data: [], error: null }),
      info: jest.fn(),
      copy: jest.fn().mockResolvedValue({ data: {}, error: null }),
    };
    storageFrom = jest.fn(() => storage);
    const supabase = {
      getClient: jest.fn(() => ({
        storage: { from: storageFrom },
      })),
    };
    service = new EventMediaService(
      repository as never,
      processing as never,
      supabase as never,
      applications as never,
      roles as never,
    );
    fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(mp4Bytes, {
        status: 200,
        headers: { 'Content-Length': String(mp4Bytes.length) },
      }),
    );
    execFileMock
      .mockReset()
      .mockImplementation((_file, _args, _options, callback) => {
        callback(null, probeResult('mov,mp4,m4a,3gp,3g2,mj2'), '');
        return {};
      });
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  it('denies an ordinary authenticated user before issuing an upload intent', async () => {
    applications.hasApprovedBusinessAccount.mockResolvedValueOnce(false);

    await expect(
      service.createVideoIntent(
        { fileName: 'clip.mp4', mimeType: 'video/mp4', sizeBytes: 100 },
        ownerId,
      ),
    ).rejects.toThrow(ForbiddenException);

    expect(repository.insert).not.toHaveBeenCalled();
    expect(storage.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it('reserves owner quota transactionally before issuing a non-upsert signed upload', async () => {
    repository.reserveVideoIntent.mockImplementation((record) =>
      Promise.resolve(record),
    );

    const result = await service.createVideoIntent(
      { fileName: 'clip.mp4', mimeType: 'video/mp4', sizeBytes: 100 },
      ownerId,
    );

    expect(repository.reserveVideoIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        owner_id: ownerId,
        kind: 'video',
        bucket: 'event-media-staging',
        mime_type: 'video/mp4',
        size_bytes: 100,
      }),
    );
    expect(storageFrom).toHaveBeenCalledWith('event-media-staging');
    expect(storageFrom).toHaveBeenCalledWith('event-media');
    expect(storage.createSignedUploadUrl).toHaveBeenCalledWith(result.path, {
      upsert: false,
    });
    expect(
      repository.reserveVideoIntent.mock.invocationCallOrder[0],
    ).toBeLessThan(storage.createSignedUploadUrl.mock.invocationCallOrder[0]);
    expect(result.token).toBe('one-time-token');
  });

  it('returns a stable 429 before signing when the owner quota is exhausted', async () => {
    repository.reserveVideoIntent.mockRejectedValueOnce(
      new EventMediaPersistenceException(
        'EVENT_VIDEO_INTENT_QUOTA_EXCEEDED',
        'P0001',
      ),
    );

    const result = service.createVideoIntent(
      { fileName: 'clip.mp4', mimeType: 'video/mp4', sizeBytes: 100 },
      ownerId,
    );

    await expect(result).rejects.toMatchObject({
      status: 429,
      response: {
        statusCode: 429,
        error: 'Too Many Requests',
        message: 'Event video upload quota exceeded',
      },
    });
    expect(storage.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it('retains a conservative upload lease when signed URL creation fails', async () => {
    repository.reserveVideoIntent.mockImplementation((record) =>
      Promise.resolve(record),
    );
    storage.createSignedUploadUrl.mockResolvedValueOnce({
      data: null,
      error: new Error('storage unavailable'),
    });
    const before = Date.now();

    await expect(
      service.createVideoIntent(
        { fileName: 'clip.mp4', mimeType: 'video/mp4', sizeBytes: 100 },
        ownerId,
      ),
    ).rejects.toThrow('Unable to create event video upload');

    const reservation = repository.reserveVideoIntent.mock.calls[0][0] as {
      expires_at: string;
    };
    expect(new Date(reservation.expires_at).getTime()).toBeGreaterThanOrEqual(
      before + 24 * 60 * 60 * 1000,
    );
    expect(repository.queueCleanup).toHaveBeenCalledWith(
      expect.any(String),
      ownerId,
    );
  });

  it('stores processed covers outside the client-owned forum-media prefix', async () => {
    repository.insert.mockImplementation((record) => Promise.resolve(record));
    repository.markReady.mockResolvedValue({ id: mediaId });

    await service.uploadImage(
      {
        buffer: Buffer.from('image'),
        originalname: 'cover.png',
        mimetype: 'image/png',
        size: 5,
      } as Express.Multer.File,
      ownerId,
    );

    expect(repository.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        owner_id: ownerId,
        bucket: 'forum-media',
        object_path: expect.stringMatching(
          new RegExp(`^events/${ownerId}/.+-full\\.webp$`),
        ),
        thumbnail_path: expect.stringMatching(
          new RegExp(`^events/${ownerId}/.+-thumb\\.webp$`),
        ),
      }),
    );
  });

  it('rejects spoofed video bytes and durably queues the persisted object', async () => {
    repository.findOwned.mockResolvedValue(mediaRecord());
    storage.info.mockResolvedValue({
      data: {
        bucketId: 'event-media-staging',
        size: mp4Bytes.length,
        contentType: 'video/mp4',
      },
      error: null,
    });
    fetchMock.mockResolvedValueOnce(
      new Response(mp4Bytes, {
        status: 200,
        headers: { 'Content-Length': String(mp4Bytes.length) },
      }),
    );
    execFileMock.mockImplementationOnce((_file, _args, _options, callback) => {
      callback(new Error('Invalid data found when processing input'), '', '');
      return {};
    });

    await expect(service.finalizeVideo(mediaId, ownerId)).rejects.toThrow(
      BadRequestException,
    );
    expect(repository.queueCleanup).toHaveBeenCalledWith(mediaId, ownerId);
    expect(repository.markReady).not.toHaveBeenCalled();
    expect(storage.copy).not.toHaveBeenCalled();
  });

  it('finalizes the same ready object idempotently', async () => {
    repository.findOwned.mockResolvedValue(
      mediaRecord({
        state: 'ready',
        bucket: 'event-media',
        content_sha256: mp4Sha256,
      }),
    );
    storage.info.mockResolvedValue({
      data: {
        bucketId: 'event-media-staging',
        size: mp4Bytes.length,
        contentType: 'video/mp4',
      },
      error: null,
    });

    await expect(service.finalizeVideo(mediaId, ownerId)).resolves.toEqual({
      mediaId,
      url: `https://project.supabase.co/storage/v1/object/public/event-media/${ownerId}/events/file.mp4`,
    });
    expect(repository.markReady).not.toHaveBeenCalled();
    expect(storage.info).not.toHaveBeenCalled();
    expect(storage.copy).not.toHaveBeenCalled();
  });

  it('durably queues the one successful image path when its sibling fails and removal fails', async () => {
    repository.insert.mockResolvedValue({});
    repository.markReady.mockResolvedValue(null);
    storage.getPublicUrl.mockImplementation((path: string) => ({
      data: { publicUrl: `https://project.supabase.co/${path}` },
    }));
    storage.upload
      .mockResolvedValueOnce({ data: {}, error: null })
      .mockResolvedValueOnce({ data: null, error: new Error('thumb failed') });
    storage.remove.mockResolvedValueOnce({
      data: null,
      error: new Error('remove failed'),
    });

    await expect(
      service.uploadImage(
        {
          buffer: Buffer.from('image'),
          originalname: 'cover.png',
          mimetype: 'image/png',
          size: 5,
        } as Express.Multer.File,
        ownerId,
      ),
    ).rejects.toThrow('Unable to upload event image');

    expect(repository.queueCleanupPaths).toHaveBeenCalledWith(
      expect.objectContaining({
        bucket: 'forum-media',
        paths: [expect.stringMatching(/-full\.webp$/)],
      }),
    );
    expect(repository.queueCleanup).toHaveBeenCalledWith(
      expect.any(String),
      ownerId,
    );
  });

  it('durably queues a successful image path when the sibling upload throws', async () => {
    repository.insert.mockResolvedValue({});
    storage.upload
      .mockResolvedValueOnce({ data: {}, error: null })
      .mockRejectedValueOnce(new Error('storage unavailable'));

    await expect(
      service.uploadImage(
        {
          buffer: Buffer.from('image'),
          originalname: 'cover.png',
          mimetype: 'image/png',
          size: 5,
        } as Express.Multer.File,
        ownerId,
      ),
    ).rejects.toThrow('Unable to upload event image');

    expect(storage.remove).toHaveBeenCalledWith([
      expect.stringMatching(/-full\.webp$/),
    ]);
    expect(repository.queueCleanup).toHaveBeenCalledWith(
      expect.any(String),
      ownerId,
    );
  });

  it('turns video signature read failures into a validation error and queues cleanup', async () => {
    repository.findOwned.mockResolvedValue(mediaRecord());
    storage.info.mockResolvedValue({
      data: {
        bucketId: 'event-media-staging',
        size: mp4Bytes.length,
        contentType: 'video/mp4',
      },
      error: null,
    });
    fetchMock.mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error('body failed'));
          },
        }),
        { status: 200 },
      ),
    );

    await expect(service.finalizeVideo(mediaId, ownerId)).rejects.toThrow(
      BadRequestException,
    );
    expect(repository.queueCleanup).toHaveBeenCalledWith(mediaId, ownerId);
    expect(repository.markReady).not.toHaveBeenCalled();
  });

  it.each([
    ['audio-only media', probeResult('mov,mp4', 'audio')],
    ['a MIME/container mismatch', probeResult('matroska,webm')],
    ['malformed ffprobe output', '{not-json'],
  ])(
    'rejects %s and removes its temporary directory',
    async (_case, stdout) => {
      repository.findOwned.mockResolvedValue(mediaRecord());
      storage.info.mockResolvedValue({
        data: {
          bucketId: 'event-media-staging',
          size: mp4Bytes.length,
          contentType: 'video/mp4',
        },
        error: null,
      });
      let probedPath = '';
      execFileMock.mockImplementationOnce((_file, args, _options, callback) => {
        probedPath = String(args?.at(-1));
        callback(null, stdout, '');
        return {};
      });

      await expect(service.finalizeVideo(mediaId, ownerId)).rejects.toThrow(
        BadRequestException,
      );

      expect(probedPath).toMatch(/event-video-[^/]+\/upload$/);
      await expect(access(probedPath)).rejects.toThrow();
      expect(repository.queueCleanup).toHaveBeenCalledWith(mediaId, ownerId);
    },
  );

  it('rejects an ffprobe timeout or nonzero exit and removes the temporary file', async () => {
    repository.findOwned.mockResolvedValue(mediaRecord());
    storage.info.mockResolvedValue({
      data: {
        bucketId: 'event-media-staging',
        size: mp4Bytes.length,
        contentType: 'video/mp4',
      },
      error: null,
    });
    let probedPath = '';
    const timeout = Object.assign(new Error('ffprobe timed out'), {
      killed: true,
      signal: 'SIGKILL',
    });
    execFileMock.mockImplementationOnce((_file, args, _options, callback) => {
      probedPath = String(args?.at(-1));
      callback(timeout, '', 'timeout');
      return {};
    });

    await expect(service.finalizeVideo(mediaId, ownerId)).rejects.toThrow(
      BadRequestException,
    );
    await expect(access(probedPath)).rejects.toThrow();
    expect(repository.markReady).not.toHaveBeenCalled();
  });

  it('stops an oversized stream before probing and queues cleanup', async () => {
    const maximum = 50 * 1024 * 1024;
    repository.findOwned.mockResolvedValue(
      mediaRecord({ size_bytes: maximum }),
    );
    storage.info.mockResolvedValue({
      data: {
        bucketId: 'event-media-staging',
        size: maximum,
        contentType: 'video/mp4',
      },
      error: null,
    });
    const chunk = new Uint8Array(1024 * 1024);
    let emitted = 0;
    fetchMock.mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          pull(controller) {
            controller.enqueue(chunk);
            emitted += chunk.length;
            if (emitted > maximum) controller.close();
          },
        }),
        { status: 200 },
      ),
    );

    await expect(service.finalizeVideo(mediaId, ownerId)).rejects.toThrow(
      BadRequestException,
    );

    expect(execFileMock).not.toHaveBeenCalled();
    expect(repository.queueCleanup).toHaveBeenCalledWith(mediaId, ownerId);
  });

  it('aborts a stalled video download before probing and queues cleanup', async () => {
    jest.useFakeTimers();
    repository.findOwned.mockResolvedValue(mediaRecord());
    storage.info.mockResolvedValue({
      data: {
        bucketId: 'event-media-staging',
        size: mp4Bytes.length,
        contentType: 'video/mp4',
      },
      error: null,
    });
    const capturedSignal: { current: AbortSignal | null } = { current: null };
    let markFetchStarted!: () => void;
    const fetchStarted = new Promise<void>((resolve) => {
      markFetchStarted = resolve;
    });
    fetchMock.mockImplementationOnce((_input, init) => {
      capturedSignal.current = init?.signal as AbortSignal;
      markFetchStarted();
      return new Promise<Response>((_resolve, reject) => {
        capturedSignal.current?.addEventListener('abort', () =>
          reject(new Error('aborted')),
        );
      });
    });

    try {
      const finalize = service.finalizeVideo(mediaId, ownerId);
      await fetchStarted;
      await jest.advanceTimersByTimeAsync(30_000);

      await expect(finalize).rejects.toThrow(BadRequestException);
      expect(capturedSignal.current?.aborted).toBe(true);
      expect(execFileMock).not.toHaveBeenCalled();
      expect(repository.queueCleanup).toHaveBeenCalledWith(mediaId, ownerId);
    } finally {
      jest.useRealTimers();
    }
  });

  it.each([
    ['QuickTime MOV', 'video/mp4', quickTimeBytes, 'mov,mp4'],
    ['Matroska', 'video/webm', matroskaBytes, 'matroska,webm'],
  ])(
    'rejects a %s container despite an overlapping ffprobe alias',
    async (_label, mimeType, bytes, formatName) => {
      const extension = mimeType === 'video/webm' ? 'webm' : 'mp4';
      const objectPath = `${ownerId}/events/file.${extension}`;
      repository.findOwned.mockResolvedValue(
        mediaRecord({
          mime_type: mimeType,
          size_bytes: bytes.length,
          object_path: objectPath,
          public_url: `https://project.supabase.co/storage/v1/object/public/event-media/${objectPath}`,
          content_sha256: createHash('sha256').update(bytes).digest('hex'),
        }),
      );
      storage.info.mockResolvedValue({
        data: {
          bucketId: 'event-media-staging',
          size: bytes.length,
          contentType: mimeType,
        },
        error: null,
      });
      fetchMock.mockResolvedValueOnce(
        new Response(bytes, {
          status: 200,
          headers: { 'Content-Length': String(bytes.length) },
        }),
      );
      execFileMock.mockImplementationOnce(
        (_file, _args, _options, callback) => {
          callback(null, probeResult(formatName), '');
          return {};
        },
      );

      await expect(service.finalizeVideo(mediaId, ownerId)).rejects.toThrow(
        BadRequestException,
      );
      expect(repository.markReady).not.toHaveBeenCalled();
      expect(repository.queueCleanup).toHaveBeenCalledWith(mediaId, ownerId);
    },
  );

  it.each([
    ['video/mp4', 'mov,mp4,m4a,3gp,3g2,mj2', mp4Bytes],
    ['video/webm', 'matroska,webm', webmBytes],
  ])(
    'accepts a valid %s container with a video stream',
    async (mimeType, formatName, bytes) => {
      const objectPath = `${ownerId}/events/file.${mimeType === 'video/webm' ? 'webm' : 'mp4'}`;
      repository.findOwned.mockResolvedValue(
        mediaRecord({
          mime_type: mimeType,
          size_bytes: bytes.length,
          object_path: objectPath,
          public_url: `https://project.supabase.co/storage/v1/object/public/event-media/${objectPath}`,
          content_sha256: createHash('sha256').update(bytes).digest('hex'),
        }),
      );
      storage.info.mockResolvedValue({
        data: {
          bucketId: 'event-media-staging',
          size: bytes.length,
          contentType: mimeType,
        },
        error: null,
      });
      fetchMock.mockResolvedValueOnce(
        new Response(bytes, {
          status: 200,
          headers: { 'Content-Length': String(bytes.length) },
        }),
      );
      repository.markReady.mockResolvedValue({ id: mediaId });
      repository.markPromoting.mockResolvedValue(
        mediaRecord({
          state: 'promoting',
          bucket: 'event-media-staging',
          mime_type: mimeType,
          size_bytes: bytes.length,
          object_path: objectPath,
          public_url: `https://project.supabase.co/storage/v1/object/public/event-media/${objectPath}`,
          content_sha256: createHash('sha256').update(bytes).digest('hex'),
        }),
      );
      repository.completeVideoPromotion.mockResolvedValue(
        mediaRecord({
          state: 'ready',
          bucket: 'event-media',
          mime_type: mimeType,
          size_bytes: bytes.length,
          object_path: objectPath,
          public_url: `https://project.supabase.co/storage/v1/object/public/event-media/${objectPath}`,
          content_sha256: createHash('sha256').update(bytes).digest('hex'),
        }),
      );
      execFileMock.mockImplementationOnce(
        (_file, _args, _options, callback) => {
          callback(null, probeResult(formatName), '');
          return {};
        },
      );

      await expect(service.finalizeVideo(mediaId, ownerId)).resolves.toEqual({
        mediaId,
        url: `https://project.supabase.co/storage/v1/object/public/event-media/${objectPath}`,
      });
      expect(execFileMock).toHaveBeenCalledWith(
        'ffprobe',
        expect.arrayContaining([
          '-of',
          'json',
          expect.stringMatching(/\/upload$/),
        ]),
        expect.objectContaining({
          shell: false,
          timeout: expect.any(Number),
          maxBuffer: expect.any(Number),
        }),
        expect.any(Function),
      );
      expect(storage.createSignedUrl).toHaveBeenCalledWith(objectPath, 60);
      expect(repository.markPromoting).toHaveBeenCalledWith(
        mediaId,
        ownerId,
        createHash('sha256').update(bytes).digest('hex'),
      );
      expect(fetchMock).toHaveBeenCalledWith(
        'https://signed.example/staging-video',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      expect(storage.copy).toHaveBeenCalledWith(objectPath, objectPath, {
        destinationBucket: 'event-media',
      });
      expect(repository.markPromoting.mock.invocationCallOrder[0]).toBeLessThan(
        storage.copy.mock.invocationCallOrder[0],
      );
      expect(storage.copy.mock.invocationCallOrder[0]).toBeLessThan(
        repository.completeVideoPromotion.mock.invocationCallOrder[0],
      );
    },
  );

  it('resumes an interrupted promotion without accepting replacement staging bytes', async () => {
    repository.findOwned.mockResolvedValue(
      mediaRecord({
        state: 'promoting',
        bucket: 'event-media-staging',
        content_sha256: mp4Sha256,
      }),
    );

    await expect(service.finalizeVideo(mediaId, ownerId)).resolves.toEqual({
      mediaId,
      url: `https://project.supabase.co/storage/v1/object/public/event-media/${ownerId}/events/file.mp4`,
    });

    expect(storage.info).not.toHaveBeenCalled();
    expect(storage.createSignedUrl).not.toHaveBeenCalled();
    expect(execFileMock).not.toHaveBeenCalled();
    expect(storage.copy).toHaveBeenCalledWith(
      `${ownerId}/events/file.mp4`,
      `${ownerId}/events/file.mp4`,
      { destinationBucket: 'event-media' },
    );
  });

  it('completes an interrupted promotion when the validated public copy already exists', async () => {
    repository.findOwned.mockResolvedValue(
      mediaRecord({
        state: 'promoting',
        bucket: 'event-media-staging',
        content_sha256: mp4Sha256,
      }),
    );
    storage.copy.mockResolvedValueOnce({
      data: null,
      error: new Error('destination already exists'),
    });
    storage.info.mockResolvedValueOnce({
      data: {
        bucketId: 'event-media',
        size: mp4Bytes.length,
        contentType: 'video/mp4',
      },
      error: null,
    });

    await expect(service.finalizeVideo(mediaId, ownerId)).resolves.toEqual({
      mediaId,
      url: `https://project.supabase.co/storage/v1/object/public/event-media/${ownerId}/events/file.mp4`,
    });
    expect(repository.completeVideoPromotion).toHaveBeenCalledWith(
      mediaId,
      ownerId,
    );
  });

  it('refuses and durably cleans an unexpected public object after a copy failure', async () => {
    const differentBytes = Uint8Array.from(mp4Bytes);
    differentBytes[differentBytes.length - 1] = 1;
    repository.findOwned.mockResolvedValue(
      mediaRecord({
        state: 'promoting',
        bucket: 'event-media-staging',
        content_sha256: mp4Sha256,
      }),
    );
    storage.copy.mockResolvedValueOnce({
      data: null,
      error: new Error('copy failed'),
    });
    storage.info.mockResolvedValueOnce({
      data: {
        bucketId: 'event-media',
        size: mp4Bytes.length,
        contentType: 'video/mp4',
      },
      error: null,
    });
    fetchMock.mockResolvedValueOnce(
      new Response(differentBytes, {
        status: 200,
        headers: { 'Content-Length': String(differentBytes.length) },
      }),
    );

    await expect(service.finalizeVideo(mediaId, ownerId)).rejects.toThrow(
      'Unable to promote event video',
    );
    expect(repository.completeVideoPromotion).not.toHaveBeenCalled();
    expect(repository.queueCleanup).toHaveBeenCalledWith(mediaId, ownerId);
  });

  it('does not report ready when abandon wins after the validated copy', async () => {
    repository.findOwned.mockResolvedValue(
      mediaRecord({
        state: 'promoting',
        bucket: 'event-media-staging',
        content_sha256: mp4Sha256,
      }),
    );
    repository.completeVideoPromotion.mockResolvedValueOnce(null);

    await expect(service.finalizeVideo(mediaId, ownerId)).rejects.toThrow(
      'Event media finalization conflicted',
    );
    expect(storage.copy).toHaveBeenCalledTimes(1);
    expect(repository.completeVideoPromotion).toHaveBeenCalledWith(
      mediaId,
      ownerId,
    );
  });
});
