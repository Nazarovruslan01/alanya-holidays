import { access } from 'node:fs/promises';
import * as childProcess from 'node:child_process';
import {
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SupabaseService } from '../supabase/supabase.service';
import { InlineMediaService } from './inline-media.service';

jest.mock('node:child_process', () => ({ execFile: jest.fn() }));

describe('InlineMediaService', () => {
  const ownerId = '10000000-0000-4000-8000-000000000001';
  const execFileMock = childProcess.execFile as unknown as jest.Mock;
  const upload = jest.fn();
  const remove = jest.fn();
  const getPublicUrl = jest.fn();
  let service: InlineMediaService;

  const mp4Bytes = Buffer.concat([
    Buffer.from([0, 0, 0, 24]),
    Buffer.from('ftypisom'),
    Buffer.alloc(16),
  ]);

  beforeEach(async () => {
    jest.clearAllMocks();
    upload.mockResolvedValue({ data: { path: 'uploaded' }, error: null });
    remove.mockResolvedValue({ data: [], error: null });
    getPublicUrl.mockImplementation((path: string) => ({
      data: {
        publicUrl: `https://project-ref.supabase.co/storage/v1/object/public/inline-media/${path}`,
      },
    }));
    execFileMock.mockImplementation(
      (
        _command,
        _args,
        _options,
        callback: (error: Error | null, stdout: string) => void,
      ) =>
        callback(
          null,
          JSON.stringify({
            format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2' },
            streams: [{ codec_type: 'video', codec_name: 'h264' }],
          }),
        ),
    );

    const module = await Test.createTestingModule({
      providers: [
        InlineMediaService,
        {
          provide: SupabaseService,
          useValue: {
            getClient: () => ({
              storage: {
                from: (bucket: string) => {
                  expect(bucket).toBe('inline-media');
                  return { upload, remove, getPublicUrl };
                },
              },
            }),
          },
        },
      ],
    }).compile();

    service = module.get(InlineMediaService);
  });

  it('validates before uploading to an immutable server-owned path', async () => {
    const result = await service.uploadVideo(
      {
        buffer: mp4Bytes,
        originalname: '../../clip.mp4',
        mimetype: 'video/mp4',
        size: mp4Bytes.length,
      } as Express.Multer.File,
      ownerId,
    );

    const [path, body, options] = upload.mock.calls[0] as [
      string,
      Buffer,
      { contentType: string; upsert: boolean; cacheControl: string },
    ];
    expect(path).toMatch(
      /^10000000-0000-4000-8000-000000000001\/videos\/[0-9a-f-]{36}\.mp4$/,
    );
    expect(body).toEqual(mp4Bytes);
    expect(options).toEqual({
      contentType: 'video/mp4',
      upsert: false,
      cacheControl: '31536000',
    });
    expect(result).toEqual({
      url: expect.stringContaining(`/inline-media/${path}`),
      mimeType: 'video/mp4',
      sizeBytes: mp4Bytes.length,
    });
    expect(execFileMock.mock.calls[0][1]).toEqual(
      expect.arrayContaining(['-protocol_whitelist', 'file', '-f', 'mov']),
    );
  });

  it.each([
    ['empty files', Buffer.alloc(0), 'video/mp4'],
    ['oversized files', Buffer.alloc(50 * 1024 * 1024 + 1), 'video/mp4'],
    ['unsupported MIME types', Buffer.from('video'), 'video/quicktime'],
  ])(
    'rejects %s before probing or uploading',
    async (_label, buffer, mimetype) => {
      await expect(
        service.uploadVideo(
          {
            buffer,
            originalname: 'clip',
            mimetype,
            size: buffer.length,
          } as Express.Multer.File,
          ownerId,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(execFileMock).not.toHaveBeenCalled();
      expect(upload).not.toHaveBeenCalled();
    },
  );

  it('rejects an HLS playlist labeled as MP4 before probing or touching storage', async () => {
    const playlist = Buffer.from(
      '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1280000\nfile:///etc/passwd\n',
    );

    await expect(
      service.uploadVideo(
        {
          buffer: playlist,
          originalname: 'playlist.mp4',
          mimetype: 'video/mp4',
          size: playlist.length,
        } as Express.Multer.File,
        ownerId,
      ),
    ).rejects.toEqual(new BadRequestException('Invalid video content'));
    expect(execFileMock).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(getPublicUrl).not.toHaveBeenCalled();
  });

  it('rejects a spoofed container and removes the temporary file', async () => {
    let probedPath = '';
    execFileMock.mockImplementationOnce(
      (
        _command,
        args: string[],
        _options,
        callback: (error: Error | null, stdout: string) => void,
      ) => {
        probedPath = String(args.at(-1));
        callback(
          null,
          JSON.stringify({
            format: { format_name: 'matroska,webm' },
            streams: [{ codec_type: 'video', codec_name: 'vp9' }],
          }),
        );
      },
    );

    await expect(
      service.uploadVideo(
        {
          buffer: mp4Bytes,
          originalname: 'spoof.mp4',
          mimetype: 'video/mp4',
          size: mp4Bytes.length,
        } as Express.Multer.File,
        ownerId,
      ),
    ).rejects.toEqual(new BadRequestException('Invalid video content'));
    expect(upload).not.toHaveBeenCalled();
    await expect(access(probedPath)).rejects.toThrow();
  });

  it('rejects a container with an unsupported video codec', async () => {
    execFileMock.mockImplementationOnce(
      (
        _command,
        _args,
        _options,
        callback: (error: Error | null, stdout: string) => void,
      ) =>
        callback(
          null,
          JSON.stringify({
            format: { format_name: 'mov,mp4' },
            streams: [{ codec_type: 'video', codec_name: 'mpeg2video' }],
          }),
        ),
    );

    await expect(
      service.uploadVideo(
        {
          buffer: mp4Bytes,
          originalname: 'old.mp4',
          mimetype: 'video/mp4',
          size: mp4Bytes.length,
        } as Express.Multer.File,
        ownerId,
      ),
    ).rejects.toEqual(new BadRequestException('Invalid video content'));
    expect(upload).not.toHaveBeenCalled();
  });

  it('attempts object cleanup and returns a stable failure when storage rejects upload', async () => {
    upload.mockResolvedValueOnce({
      data: null,
      error: new Error('internal storage detail'),
    });

    await expect(
      service.uploadVideo(
        {
          buffer: mp4Bytes,
          originalname: 'clip.mp4',
          mimetype: 'video/mp4',
          size: mp4Bytes.length,
        } as Express.Multer.File,
        ownerId,
      ),
    ).rejects.toEqual(
      new InternalServerErrorException('Unable to upload video'),
    );
    expect(remove).toHaveBeenCalledWith([
      expect.stringMatching(new RegExp(`^${ownerId}/videos/`)),
    ]);
  });
});
