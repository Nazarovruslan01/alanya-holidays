import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BusinessApplicationsService } from '../business-applications/business-applications.service';
import { UserRolesRepository } from '../common/auth/user-roles.repository';
import { SupabaseService } from '../supabase/supabase.service';
import { CreateEventVideoIntentDto } from './dto/event-media.dto';
import {
  EventImageUploadResult,
  EventMediaRecord,
  EventVideoIntentResult,
  FinalizedEventVideoResult,
} from './event-media.types';
import {
  EventMediaPersistenceException,
  EventMediaRepository,
} from './event-media.repository';
import { MediaProcessingService } from './media-processing.service';

const EVENT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const EVENT_VIDEO_MAX_BYTES = 50 * 1024 * 1024;
const EVENT_VIDEO_DOWNLOAD_TIMEOUT_MS = 30_000;
const EVENT_VIDEO_HEADER_MAX_BYTES = 64 * 1024;
const EVENT_VIDEO_STAGING_BUCKET = 'event-media-staging';
const EVENT_VIDEO_PUBLIC_BUCKET = 'event-media';
const EVENT_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const EVENT_VIDEO_TYPES = new Set(['video/mp4', 'video/webm']);

@Injectable()
export class EventMediaService {
  private readonly logger = new Logger(EventMediaService.name);

  constructor(
    private readonly repository: EventMediaRepository,
    private readonly processingService: MediaProcessingService,
    private readonly supabaseService: SupabaseService,
    private readonly businessApplicationsService: BusinessApplicationsService,
    private readonly userRolesRepository: UserRolesRepository,
  ) {}

  async uploadImage(
    file: Express.Multer.File,
    ownerId: string,
  ): Promise<EventImageUploadResult> {
    await this.requireEventManager(ownerId);
    if (!file)
      throw new BadRequestException('File is required for media upload');
    if (file.size <= 0 || file.size > EVENT_IMAGE_MAX_BYTES) {
      throw new BadRequestException('Image must not exceed 5 MB');
    }
    if (!EVENT_IMAGE_TYPES.has(file.mimetype)) {
      throw new BadRequestException(
        'Only JPEG, PNG, and WebP images are allowed',
      );
    }

    let processed;
    try {
      processed = await this.processingService.processImageBuffers({
        buffer: file.buffer,
        originalname: file.originalname,
        mimetype: file.mimetype,
      });
    } catch {
      throw new BadRequestException('Invalid image content');
    }

    const mediaId = randomUUID();
    const objectId = randomUUID();
    // Existing forum-media client policies key ownership off the first path
    // segment. Server-owned event covers use a non-user prefix so the browser
    // cannot overwrite a processed cover after it has been attached.
    const fullPath = `events/${ownerId}/${objectId}-full.webp`;
    const thumbnailPath = `events/${ownerId}/${objectId}-thumb.webp`;
    const storage = this.supabaseService
      .getClient()
      .storage.from('forum-media');
    const url = storage.getPublicUrl(fullPath).data.publicUrl;
    const thumbnailUrl = storage.getPublicUrl(thumbnailPath).data.publicUrl;
    if (!url || !thumbnailUrl) {
      throw new InternalServerErrorException('Unable to prepare event image');
    }

    await this.repository.insert({
      id: mediaId,
      owner_id: ownerId,
      kind: 'image',
      bucket: 'forum-media',
      object_path: fullPath,
      thumbnail_path: thumbnailPath,
      public_url: url,
      thumbnail_url: thumbnailUrl,
      mime_type: 'image/webp',
      size_bytes: processed.full.length,
      expires_at: this.expiry(),
    });

    const [fullUpload, thumbnailUpload] = await Promise.allSettled([
      storage.upload(fullPath, processed.full, {
        contentType: 'image/webp',
        upsert: false,
      }),
      storage.upload(thumbnailPath, processed.thumbnail, {
        contentType: 'image/webp',
        upsert: false,
      }),
    ]);
    const fullSucceeded =
      fullUpload.status === 'fulfilled' && !fullUpload.value.error;
    const thumbnailSucceeded =
      thumbnailUpload.status === 'fulfilled' && !thumbnailUpload.value.error;
    if (!fullSucceeded || !thumbnailSucceeded) {
      const successfulPaths = [
        ...(fullSucceeded ? [fullPath] : []),
        ...(thumbnailSucceeded ? [thumbnailPath] : []),
      ];
      const primaryError =
        fullUpload.status === 'rejected'
          ? String(fullUpload.reason)
          : fullUpload.value.error?.message ||
            (thumbnailUpload.status === 'rejected'
              ? String(thumbnailUpload.reason)
              : thumbnailUpload.value.error?.message);
      await this.cleanupFailedUpload(
        mediaId,
        ownerId,
        'forum-media',
        successfulPaths,
        primaryError,
      );
      throw new InternalServerErrorException('Unable to upload event image');
    }

    const ready = await this.repository.markReady(mediaId, ownerId);
    if (!ready) {
      await this.cleanupFailedUpload(mediaId, ownerId, 'forum-media', [
        fullPath,
        thumbnailPath,
      ]);
      throw new ConflictException('Event image upload expired');
    }
    return { mediaId, url, thumbnailUrl };
  }

  async createVideoIntent(
    dto: CreateEventVideoIntentDto,
    ownerId: string,
  ): Promise<EventVideoIntentResult> {
    await this.requireEventManager(ownerId);
    if (
      !EVENT_VIDEO_TYPES.has(dto.mimeType) ||
      !Number.isInteger(dto.sizeBytes) ||
      dto.sizeBytes <= 0 ||
      dto.sizeBytes > EVENT_VIDEO_MAX_BYTES
    ) {
      throw new BadRequestException('Invalid event video metadata');
    }

    const extension = dto.mimeType === 'video/webm' ? 'webm' : 'mp4';
    const mediaId = randomUUID();
    const objectPath = `${ownerId}/events/${randomUUID()}.${extension}`;
    const client = this.supabaseService.getClient();
    const stagingStorage = client.storage.from(EVENT_VIDEO_STAGING_BUCKET);
    const publicUrl = client.storage
      .from(EVENT_VIDEO_PUBLIC_BUCKET)
      .getPublicUrl(objectPath).data.publicUrl;
    if (!publicUrl) {
      throw new InternalServerErrorException('Unable to prepare event video');
    }

    try {
      await this.repository.reserveVideoIntent({
        id: mediaId,
        owner_id: ownerId,
        kind: 'video',
        bucket: EVENT_VIDEO_STAGING_BUCKET,
        object_path: objectPath,
        thumbnail_path: null,
        public_url: publicUrl,
        thumbnail_url: null,
        mime_type: dto.mimeType,
        size_bytes: dto.sizeBytes,
        expires_at: this.expiry(),
      });
    } catch (error) {
      if (
        error instanceof EventMediaPersistenceException &&
        error.code === 'P0001' &&
        error.message === 'EVENT_VIDEO_INTENT_QUOTA_EXCEEDED'
      ) {
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            error: 'Too Many Requests',
            message: 'Event video upload quota exceeded',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      throw error;
    }

    const { data, error } = await stagingStorage.createSignedUploadUrl(
      objectPath,
      { upsert: false },
    );
    if (error || !data?.token) {
      await this.repository.queueCleanup(mediaId, ownerId);
      throw new InternalServerErrorException(
        'Unable to create event video upload',
      );
    }
    return { mediaId, path: objectPath, token: data.token };
  }

  async finalizeVideo(
    mediaId: string,
    ownerId: string,
  ): Promise<FinalizedEventVideoResult> {
    await this.requireEventManager(ownerId);
    let media = await this.repository.findOwned(mediaId, ownerId);
    if (!media) throw new NotFoundException('Event media not found');
    if (media.kind !== 'video') {
      throw new BadRequestException('Event media is not a video');
    }
    if (
      media.state === 'ready' &&
      media.bucket === EVENT_VIDEO_PUBLIC_BUCKET &&
      media.content_sha256
    ) {
      return { mediaId: media.id, url: media.public_url };
    }
    if (
      (media.state !== 'pending' && media.state !== 'promoting') ||
      media.bucket !== EVENT_VIDEO_STAGING_BUCKET
    ) {
      throw new ConflictException('Event media cannot be finalized');
    }

    if (media.state === 'pending') {
      try {
        const contentSha256 = await this.assertStoredVideo(media);
        const promoting = await this.repository.markPromoting(
          media.id,
          ownerId,
          contentSha256,
        );
        if (promoting) {
          media = promoting;
        } else {
          const concurrent = await this.repository.findOwned(media.id, ownerId);
          if (
            concurrent?.state === 'ready' &&
            concurrent.bucket === EVENT_VIDEO_PUBLIC_BUCKET
          ) {
            return { mediaId: concurrent.id, url: concurrent.public_url };
          }
          if (
            concurrent?.state !== 'promoting' ||
            concurrent.bucket !== EVENT_VIDEO_STAGING_BUCKET
          ) {
            throw new ConflictException('Event media finalization conflicted');
          }
          media = concurrent;
        }
      } catch (error) {
        if (media.state === 'pending') {
          await this.repository.queueCleanup(media.id, ownerId);
        }
        throw error;
      }
    }

    try {
      await this.copyValidatedVideoToPublic(media);
    } catch (error) {
      await this.repository.queueCleanup(media.id, ownerId);
      throw error;
    }
    const ready = await this.repository.completeVideoPromotion(
      media.id,
      ownerId,
    );
    if (
      !ready ||
      ready.state !== 'ready' ||
      ready.bucket !== EVENT_VIDEO_PUBLIC_BUCKET
    ) {
      throw new ConflictException('Event media finalization conflicted');
    }
    return { mediaId: ready.id, url: ready.public_url };
  }

  async abandon(mediaId: string, ownerId: string): Promise<void> {
    await this.requireEventManager(ownerId);
    const queued = await this.repository.queueCleanup(mediaId, ownerId);
    if (!queued) throw new NotFoundException('Event media not found');
  }

  private async requireEventManager(ownerId: string): Promise<void> {
    if ((await this.userRolesRepository.getRole(ownerId)) === 'admin') return;
    if (
      !(await this.businessApplicationsService.hasApprovedBusinessAccount(
        ownerId,
      ))
    ) {
      throw new ForbiddenException(
        'An approved business account is required to manage event media',
      );
    }
  }

  private async assertStoredVideo(media: EventMediaRecord): Promise<string> {
    const client = this.supabaseService.getClient();
    const storage = client.storage.from(EVENT_VIDEO_STAGING_BUCKET);
    const { data, error } = await storage.info(media.object_path);
    if (
      error ||
      !data ||
      data.bucketId !== EVENT_VIDEO_STAGING_BUCKET ||
      data.size !== media.size_bytes ||
      data.size <= 0 ||
      data.size > EVENT_VIDEO_MAX_BYTES ||
      data.contentType !== media.mime_type
    ) {
      throw new BadRequestException('Event media object failed validation');
    }

    const publicUrl = client.storage
      .from(EVENT_VIDEO_PUBLIC_BUCKET)
      .getPublicUrl(media.object_path).data.publicUrl;
    if (!publicUrl || publicUrl !== media.public_url) {
      throw new BadRequestException('Event media object failed validation');
    }
    const { data: signedRead, error: signedReadError } =
      await storage.createSignedUrl(media.object_path, 60);
    if (signedReadError || !signedRead?.signedUrl) {
      throw new BadRequestException('Event media object failed validation');
    }

    let temporaryDirectory: string | null = null;
    let validationError: BadRequestException | null = null;
    let contentSha256: string | null = null;
    try {
      temporaryDirectory = await mkdtemp(join(tmpdir(), 'event-video-'));
      const localPath = join(temporaryDirectory, 'upload');
      const downloaded = await this.downloadStoredVideo(
        signedRead.signedUrl,
        localPath,
        media.size_bytes,
      );
      const probe = await this.runFfprobe(localPath);
      this.assertProbeMatchesMedia(probe, media.mime_type, downloaded.header);
      contentSha256 = downloaded.contentSha256;
    } catch {
      validationError = new BadRequestException(
        'Event video content failed validation',
      );
    } finally {
      if (temporaryDirectory) {
        try {
          await rm(temporaryDirectory, { recursive: true, force: true });
        } catch {
          validationError ??= new BadRequestException(
            'Event video content failed validation',
          );
        }
      }
    }
    if (validationError || !contentSha256) {
      throw (
        validationError ??
        new BadRequestException('Event video content failed validation')
      );
    }
    return contentSha256;
  }

  private async copyValidatedVideoToPublic(
    media: EventMediaRecord,
  ): Promise<void> {
    if (!media.content_sha256) {
      throw new InternalServerErrorException('Unable to promote event video');
    }
    const client = this.supabaseService.getClient();
    const stagingStorage = client.storage.from(EVENT_VIDEO_STAGING_BUCKET);
    const publicStorage = client.storage.from(EVENT_VIDEO_PUBLIC_BUCKET);
    const { error } = await stagingStorage.copy(
      media.object_path,
      media.object_path,
      { destinationBucket: EVENT_VIDEO_PUBLIC_BUCKET },
    );
    if (!error) return;

    const { data, error: infoError } = await publicStorage.info(
      media.object_path,
    );
    if (
      infoError ||
      !data ||
      data.bucketId !== EVENT_VIDEO_PUBLIC_BUCKET ||
      data.size !== media.size_bytes ||
      data.contentType !== media.mime_type
    ) {
      throw new InternalServerErrorException('Unable to promote event video');
    }
    const publicUrl = publicStorage.getPublicUrl(media.object_path).data
      .publicUrl;
    if (!publicUrl || publicUrl !== media.public_url) {
      throw new InternalServerErrorException('Unable to promote event video');
    }
    const publicSha256 = await this.validateVideoDownload(publicUrl, media);
    if (publicSha256 !== media.content_sha256) {
      throw new InternalServerErrorException('Unable to promote event video');
    }
  }

  private async validateVideoDownload(
    sourceUrl: string,
    media: EventMediaRecord,
  ): Promise<string> {
    let temporaryDirectory: string | null = null;
    let contentSha256: string | null = null;
    let validationError: InternalServerErrorException | null = null;
    try {
      temporaryDirectory = await mkdtemp(join(tmpdir(), 'event-video-'));
      const localPath = join(temporaryDirectory, 'upload');
      const downloaded = await this.downloadStoredVideo(
        sourceUrl,
        localPath,
        media.size_bytes,
      );
      const probe = await this.runFfprobe(localPath);
      this.assertProbeMatchesMedia(probe, media.mime_type, downloaded.header);
      contentSha256 = downloaded.contentSha256;
    } catch {
      validationError = new InternalServerErrorException(
        'Unable to promote event video',
      );
    } finally {
      if (temporaryDirectory) {
        try {
          await rm(temporaryDirectory, { recursive: true, force: true });
        } catch {
          validationError ??= new InternalServerErrorException(
            'Unable to promote event video',
          );
        }
      }
    }
    if (validationError || !contentSha256) {
      throw (
        validationError ??
        new InternalServerErrorException('Unable to promote event video')
      );
    }
    return contentSha256;
  }

  private async downloadStoredVideo(
    publicUrl: string,
    localPath: string,
    expectedBytes: number,
  ): Promise<{ header: Uint8Array; contentSha256: string }> {
    const abortController = new AbortController();
    const timeout = setTimeout(
      () => abortController.abort(),
      EVENT_VIDEO_DOWNLOAD_TIMEOUT_MS,
    );
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    let file: Awaited<ReturnType<typeof open>> | null = null;
    try {
      if (
        !Number.isSafeInteger(expectedBytes) ||
        expectedBytes <= 0 ||
        expectedBytes > EVENT_VIDEO_MAX_BYTES
      ) {
        throw new Error('Invalid persisted event video size');
      }

      const response = await fetch(publicUrl, {
        signal: abortController.signal,
      });
      if (!response.ok || !response.body) {
        throw new Error('Unable to download event video');
      }
      const contentLength = response.headers.get('content-length');
      if (contentLength !== null) {
        if (!/^\d+$/.test(contentLength)) {
          throw new Error('Invalid event video content length');
        }
        const declaredBytes = Number(contentLength);
        if (
          !Number.isSafeInteger(declaredBytes) ||
          declaredBytes !== expectedBytes ||
          declaredBytes <= 0 ||
          declaredBytes > EVENT_VIDEO_MAX_BYTES
        ) {
          throw new Error('Invalid event video content length');
        }
      }

      reader = response.body.getReader();
      file = await open(localPath, 'wx', 0o600);
      const header = new Uint8Array(
        Math.min(expectedBytes, EVENT_VIDEO_HEADER_MAX_BYTES),
      );
      const contentHash = createHash('sha256');
      let headerBytes = 0;
      let receivedBytes = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value || value.byteLength === 0) continue;
        receivedBytes += value.byteLength;
        contentHash.update(value);
        if (
          receivedBytes > expectedBytes ||
          receivedBytes > EVENT_VIDEO_MAX_BYTES
        ) {
          abortController.abort();
          throw new Error('Event video exceeded its persisted size');
        }
        if (headerBytes < header.byteLength) {
          const bytesToCopy = Math.min(
            value.byteLength,
            header.byteLength - headerBytes,
          );
          header.set(value.subarray(0, bytesToCopy), headerBytes);
          headerBytes += bytesToCopy;
        }
        let offset = 0;
        while (offset < value.byteLength) {
          const { bytesWritten } = await file.write(
            value,
            offset,
            value.byteLength - offset,
          );
          if (bytesWritten <= 0) {
            throw new Error('Unable to persist event video for validation');
          }
          offset += bytesWritten;
        }
      }

      if (receivedBytes !== expectedBytes) {
        throw new Error('Event video size changed during download');
      }
      return {
        header: header.subarray(0, headerBytes),
        contentSha256: contentHash.digest('hex'),
      };
    } finally {
      clearTimeout(timeout);
      abortController.abort();
      if (reader) {
        try {
          await reader.cancel();
        } catch {
          // The stream may already have failed or closed.
        }
        reader.releaseLock();
      }
      if (file) await file.close();
    }
  }

  private runFfprobe(localPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(
        'ffprobe',
        [
          '-v',
          'error',
          '-show_entries',
          'format=format_name:stream=codec_type',
          '-of',
          'json',
          localPath,
        ],
        {
          encoding: 'utf8',
          killSignal: 'SIGKILL',
          maxBuffer: 64 * 1024,
          shell: false,
          timeout: 10_000,
          windowsHide: true,
        },
        (error, stdout) => {
          if (error) {
            reject(
              error instanceof Error ? error : new Error('ffprobe failed'),
            );
          } else {
            resolve(stdout);
          }
        },
      );
    });
  }

  private assertProbeMatchesMedia(
    stdout: string,
    mimeType: string,
    header: Uint8Array,
  ): void {
    const parsed = JSON.parse(stdout) as {
      streams?: Array<{ codec_type?: unknown }>;
      format?: { format_name?: unknown };
    };
    const hasVideoStream =
      Array.isArray(parsed.streams) &&
      parsed.streams.some((stream) => stream?.codec_type === 'video');
    const formatName = parsed.format?.format_name;
    if (!hasVideoStream || typeof formatName !== 'string') {
      throw new Error('Event video has no supported video stream');
    }
    const formats = new Set(
      formatName
        .toLowerCase()
        .split(',')
        .map((format) => format.trim()),
    );
    const containerMatches =
      mimeType === 'video/mp4'
        ? formats.has('mp4') && this.hasStandardMp4FileType(header)
        : mimeType === 'video/webm' && formats.has('webm');
    if (
      !containerMatches ||
      (mimeType === 'video/webm' && !this.hasWebmDocumentType(header))
    ) {
      throw new Error('Event video container does not match its MIME type');
    }
  }

  private hasStandardMp4FileType(header: Uint8Array): boolean {
    if (
      header.byteLength < 12 ||
      String.fromCharCode(...header.subarray(4, 8)) !== 'ftyp'
    ) {
      return false;
    }
    const boxSize =
      header[0] * 2 ** 24 +
      header[1] * 2 ** 16 +
      header[2] * 2 ** 8 +
      header[3];
    if (boxSize < 12 || boxSize > header.byteLength) return false;
    const majorBrand = String.fromCharCode(...header.subarray(8, 12));
    return majorBrand !== 'qt  ';
  }

  private hasWebmDocumentType(header: Uint8Array): boolean {
    if (
      header.byteLength < 5 ||
      ![0x1a, 0x45, 0xdf, 0xa3].every((byte, index) => header[index] === byte)
    ) {
      return false;
    }
    const rootSize = this.readEbmlSize(header, 4);
    if (!rootSize) return false;
    let offset = 4 + rootSize.length;
    const rootEnd = offset + rootSize.value;
    if (rootEnd > header.byteLength) return false;
    while (offset < rootEnd) {
      const idLength = this.ebmlElementLength(header[offset]);
      if (!idLength || offset + idLength > rootEnd) return false;
      const id = header.subarray(offset, offset + idLength);
      offset += idLength;
      const size = this.readEbmlSize(header, offset);
      if (!size) return false;
      offset += size.length;
      const valueEnd = offset + size.value;
      if (valueEnd > rootEnd) return false;
      if (idLength === 2 && id[0] === 0x42 && id[1] === 0x82) {
        return (
          new TextDecoder().decode(header.subarray(offset, valueEnd)) === 'webm'
        );
      }
      offset = valueEnd;
    }
    return false;
  }

  private readEbmlSize(
    bytes: Uint8Array,
    offset: number,
  ): { length: number; value: number } | null {
    const length = this.ebmlElementLength(bytes[offset]);
    if (!length || length > 6 || offset + length > bytes.byteLength) {
      return null;
    }
    let value = bytes[offset] & (0xff >> length);
    for (let index = 1; index < length; index += 1) {
      value = value * 256 + bytes[offset + index];
    }
    return Number.isSafeInteger(value) ? { length, value } : null;
  }

  private ebmlElementLength(firstByte: number | undefined): number {
    if (!firstByte) return 0;
    for (let length = 1; length <= 8; length += 1) {
      if ((firstByte & (0x80 >> (length - 1))) !== 0) return length;
    }
    return 0;
  }

  private async cleanupFailedUpload(
    mediaId: string,
    ownerId: string,
    bucket: 'forum-media' | 'event-media',
    successfulPaths: string[],
    primaryError?: string,
  ): Promise<void> {
    if (successfulPaths.length > 0) {
      try {
        const { error } = await this.supabaseService
          .getClient()
          .storage.from(bucket)
          .remove(successfulPaths);
        if (error) {
          await this.repository.queueCleanupPaths({
            mediaId,
            bucket,
            paths: successfulPaths,
            error: error.message,
          });
        }
      } catch (error) {
        await this.repository.queueCleanupPaths({
          mediaId,
          bucket,
          paths: successfulPaths,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    try {
      await this.repository.queueCleanup(mediaId, ownerId);
    } catch (cleanupError) {
      this.logger.error('Failed to queue event media cleanup', {
        mediaId,
        primaryError,
        cleanupError:
          cleanupError instanceof Error
            ? cleanupError.message
            : String(cleanupError),
      });
    }
  }

  private expiry(): string {
    return new Date(Date.now() + 86400000).toISOString();
  }
}
