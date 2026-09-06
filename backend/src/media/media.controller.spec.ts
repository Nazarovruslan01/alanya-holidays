import { Test, TestingModule } from '@nestjs/testing';
import { MediaController } from './media.controller';
import { MediaProcessingService } from './media-processing.service';
import { BadRequestException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AuthGuard } from '../auth/auth.guard';
import { EventMediaService } from './event-media.service';

describe('MediaController', () => {
  let controller: MediaController;
  let serviceMock: {
    processAndUploadImage: jest.Mock;
  };
  let eventMediaServiceMock: {
    uploadImage: jest.Mock;
    createVideoIntent: jest.Mock;
    finalizeVideo: jest.Mock;
    abandon: jest.Mock;
  };

  beforeEach(async () => {
    serviceMock = {
      processAndUploadImage: jest.fn().mockResolvedValue({
        originalName: 'test.png',
        url: 'https://example.com/test-full.webp',
        thumbnailUrl: 'https://example.com/test-thumb.webp',
        format: 'webp',
        sizeBytes: 1234,
      }),
    };
    eventMediaServiceMock = {
      uploadImage: jest.fn().mockResolvedValue({
        mediaId: 'media-1',
        url: 'https://project/image.webp',
        thumbnailUrl: 'https://project/thumb.webp',
      }),
      createVideoIntent: jest.fn().mockResolvedValue({
        mediaId: 'media-2',
        path: 'owner/events/video.mp4',
        token: 'signed-token',
      }),
      finalizeVideo: jest.fn().mockResolvedValue({
        mediaId: 'media-2',
        url: 'https://project/video.mp4',
      }),
      abandon: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MediaController],
      providers: [
        {
          provide: MediaProcessingService,
          useValue: serviceMock,
        },
        {
          provide: EventMediaService,
          useValue: eventMediaServiceMock,
        },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<MediaController>(MediaController);
  });

  it('should upload and process an image file successfully', async () => {
    const mockFile = {
      buffer: Buffer.from('fake-image-bytes'),
      originalname: 'house.png',
      mimetype: 'image/png',
      size: 1024,
    } as Express.Multer.File;

    const result = await controller.uploadMedia(
      mockFile,
      {
        bucket: 'blog-media',
        folder: 'house-12',
      },
      { id: 'user-1' },
    );

    expect(serviceMock.processAndUploadImage).toHaveBeenCalledWith(
      {
        buffer: mockFile.buffer,
        originalname: 'house.png',
        mimetype: 'image/png',
      },
      {
        bucket: 'blog-media',
        folder: 'user-1/house-12',
      },
    );

    expect(result).toEqual({
      originalName: 'test.png',
      url: 'https://example.com/test-full.webp',
      thumbnailUrl: 'https://example.com/test-thumb.webp',
      format: 'webp',
      sizeBytes: 1234,
    });
  });

  it('should throw BadRequestException if no file is provided', async () => {
    await expect(
      controller.uploadMedia(
        undefined as unknown as Express.Multer.File,
        { bucket: 'blog-media' },
        { id: 'user-1' },
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('should require authentication for uploads', () => {
    const handler = Object.getOwnPropertyDescriptor(
      MediaController.prototype,
      'uploadMedia',
    )?.value as object;
    const guards = Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[];

    expect(guards).toContain(AuthGuard);
  });

  it('should reject unsupported image types before processing', async () => {
    const file = {
      buffer: Buffer.from('not-an-image'),
      originalname: 'payload.svg',
      mimetype: 'image/svg+xml',
      size: 128,
    } as Express.Multer.File;

    await expect(
      controller.uploadMedia(file, { bucket: 'blog-media' }, { id: 'user-1' }),
    ).rejects.toThrow(BadRequestException);
    expect(serviceMock.processAndUploadImage).not.toHaveBeenCalled();
  });

  it('keeps the event image upload in the authenticated owner events folder', async () => {
    const file = {
      buffer: Buffer.from('event-cover'),
      originalname: 'cover.webp',
      mimetype: 'image/webp',
      size: 2048,
    } as Express.Multer.File;

    await controller.uploadMedia(
      file,
      { bucket: 'forum-media', folder: 'events' },
      { id: 'owner-1' },
    );

    expect(serviceMock.processAndUploadImage).toHaveBeenCalledWith(
      expect.objectContaining({ originalname: 'cover.webp' }),
      { bucket: 'forum-media', folder: 'owner-1/events' },
    );
  });

  it('rejects a video even when the caller targets forum-media', async () => {
    const file = {
      buffer: Buffer.from('video'),
      originalname: 'clip.mp4',
      mimetype: 'video/mp4',
      size: 2048,
    } as Express.Multer.File;

    await expect(
      controller.uploadMedia(
        file,
        { bucket: 'forum-media', folder: 'events' },
        { id: 'owner-1' },
      ),
    ).rejects.toThrow('Only JPEG, PNG, and WebP images are allowed');
    expect(serviceMock.processAndUploadImage).not.toHaveBeenCalled();
  });

  it('uses dedicated authenticated endpoints for event media lifecycle', async () => {
    const file = {
      buffer: Buffer.from('cover'),
      originalname: 'cover.png',
      mimetype: 'image/png',
      size: 5,
    } as Express.Multer.File;

    await controller.uploadEventImage(file, { id: 'owner-1' });
    await controller.createEventVideoIntent(
      { fileName: 'clip.mp4', mimeType: 'video/mp4', sizeBytes: 100 },
      { id: 'owner-1' },
    );
    await controller.finalizeEventVideo('media-2', { id: 'owner-1' });
    await controller.abandonEventMedia('media-2', { id: 'owner-1' });

    expect(eventMediaServiceMock.uploadImage).toHaveBeenCalledWith(
      file,
      'owner-1',
    );
    expect(eventMediaServiceMock.createVideoIntent).toHaveBeenCalledWith(
      expect.objectContaining({ mimeType: 'video/mp4', sizeBytes: 100 }),
      'owner-1',
    );
    expect(eventMediaServiceMock.finalizeVideo).toHaveBeenCalledWith(
      'media-2',
      'owner-1',
    );
    expect(eventMediaServiceMock.abandon).toHaveBeenCalledWith(
      'media-2',
      'owner-1',
    );
  });
});
