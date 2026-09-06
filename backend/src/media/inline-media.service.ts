import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SupabaseService } from '../supabase/supabase.service';

const INLINE_VIDEO_BUCKET = 'inline-media';
const INLINE_VIDEO_MAX_BYTES = 50 * 1024 * 1024;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const videoTypes = new Map([
  ['video/mp4', 'mp4'],
  ['video/webm', 'webm'],
]);
const videoCodecs = {
  'video/mp4': new Set(['h264', 'hevc', 'av1', 'vp9']),
  'video/webm': new Set(['vp8', 'vp9', 'av1']),
} as const;

interface ProbeResult {
  format?: { format_name?: string };
  streams?: Array<{ codec_type?: string; codec_name?: string }>;
}

export interface UploadedInlineVideo {
  url: string;
  mimeType: 'video/mp4' | 'video/webm';
  sizeBytes: number;
}

@Injectable()
export class InlineMediaService {
  private readonly logger = new Logger(InlineMediaService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  async uploadVideo(
    file: Express.Multer.File,
    ownerId: string,
  ): Promise<UploadedInlineVideo> {
    const extension = videoTypes.get(file?.mimetype);
    if (
      !file ||
      !extension ||
      file.size <= 0 ||
      file.size > INLINE_VIDEO_MAX_BYTES ||
      file.size !== file.buffer.length
    ) {
      throw new BadRequestException(
        'Video must be an MP4 or WebM file no larger than 50 MB',
      );
    }
    if (!UUID.test(ownerId)) {
      throw new BadRequestException('Invalid media owner');
    }

    let directory: string | null = null;
    try {
      this.assertVideoSignature(file.buffer, file.mimetype);
      directory = await mkdtemp(join(tmpdir(), 'inline-video-'));
      const localPath = join(directory, `upload.${extension}`);
      await writeFile(localPath, file.buffer, { flag: 'wx', mode: 0o600 });
      const probe = await this.runProbe(localPath, file.mimetype);
      this.assertVideoContent(file.buffer, file.mimetype, probe);
    } catch (error) {
      this.logger.warn('Inline video validation failed', {
        mimeType: file.mimetype,
        sizeBytes: file.size,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new BadRequestException('Invalid video content');
    } finally {
      if (directory) await rm(directory, { recursive: true, force: true });
    }

    const mimeType = file.mimetype as 'video/mp4' | 'video/webm';
    const objectPath = `${ownerId}/videos/${randomUUID()}.${extension}`;
    const storage = this.supabaseService
      .getClient()
      .storage.from(INLINE_VIDEO_BUCKET);
    const { error } = await storage.upload(objectPath, file.buffer, {
      contentType: mimeType,
      upsert: false,
      cacheControl: '31536000',
    });
    if (error) {
      try {
        await storage.remove([objectPath]);
      } catch (cleanupError) {
        this.logger.error('Inline video upload cleanup failed', {
          objectPath,
          error:
            cleanupError instanceof Error
              ? cleanupError.message
              : String(cleanupError),
        });
      }
      this.logger.error('Inline video upload failed', {
        objectPath,
        error: error.message,
      });
      throw new InternalServerErrorException('Unable to upload video');
    }

    const url = storage.getPublicUrl(objectPath).data.publicUrl;
    if (!url) {
      await storage.remove([objectPath]);
      throw new InternalServerErrorException('Unable to upload video');
    }
    return { url, mimeType, sizeBytes: file.size };
  }

  private runProbe(path: string, mimeType: string): Promise<ProbeResult> {
    const demuxer = mimeType === 'video/mp4' ? 'mov' : 'matroska,webm';
    return new Promise((resolve, reject) => {
      execFile(
        'ffprobe',
        [
          '-v',
          'error',
          '-protocol_whitelist',
          'file',
          '-f',
          demuxer,
          '-show_entries',
          'format=format_name:stream=codec_type,codec_name',
          '-of',
          'json',
          path,
        ],
        { timeout: 10_000, maxBuffer: 128 * 1024, killSignal: 'SIGKILL' },
        (error, stdout) => {
          if (error) {
            reject(
              error instanceof Error
                ? error
                : new Error('ffprobe failed', { cause: error }),
            );
            return;
          }
          try {
            resolve(JSON.parse(String(stdout)) as ProbeResult);
          } catch (parseError) {
            reject(
              parseError instanceof Error
                ? parseError
                : new Error('Invalid probe output'),
            );
          }
        },
      );
    });
  }

  private assertVideoContent(
    buffer: Buffer,
    mimeType: string,
    probe: ProbeResult,
  ): void {
    const formats = new Set(
      (probe.format?.format_name ?? '').split(',').map((value) => value.trim()),
    );
    const videoStreams = (probe.streams ?? []).filter(
      (stream) => stream.codec_type === 'video',
    );
    const hasSupportedCodec = videoStreams.some((stream) =>
      videoCodecs[mimeType as keyof typeof videoCodecs]?.has(
        stream.codec_name ?? '',
      ),
    );
    const containerMatches =
      mimeType === 'video/mp4'
        ? formats.has('mp4') && this.hasMp4Signature(buffer)
        : mimeType === 'video/webm' &&
          formats.has('webm') &&
          this.hasWebmSignature(buffer);

    if (!containerMatches || !hasSupportedCodec) {
      throw new Error('Video container or codec mismatch');
    }
  }

  private assertVideoSignature(buffer: Buffer, mimeType: string): void {
    const matches =
      mimeType === 'video/mp4'
        ? this.hasMp4Signature(buffer)
        : mimeType === 'video/webm' && this.hasWebmSignature(buffer);
    if (!matches) throw new Error('Video container signature mismatch');
  }

  private hasMp4Signature(buffer: Buffer): boolean {
    return buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp';
  }

  private hasWebmSignature(buffer: Buffer): boolean {
    return (
      buffer.length >= 16 &&
      buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) &&
      buffer
        .subarray(0, Math.min(buffer.length, 64))
        .includes(Buffer.from('webm'))
    );
  }
}
