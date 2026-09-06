import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import sharp from 'sharp';
import { randomUUID } from 'crypto';

export interface ProcessedMediaResult {
  originalName: string;
  url: string;
  thumbnailUrl: string;
  format: 'webp';
  sizeBytes: number;
}

export interface ImageProcessingOptions {
  bucket: string;
  folder?: string;
  quality?: number;
  maxFullWidth?: number;
  maxThumbWidth?: number;
}

export interface UploadedFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
}

export interface ProcessedImageBuffers {
  full: Buffer;
  thumbnail: Buffer;
}

@Injectable()
export class MediaProcessingService {
  private static readonly INVALID_IMAGE_MESSAGE = 'Invalid image content';
  private static readonly PROCESSING_FAILED_MESSAGE = 'Unable to process image';
  private readonly logger = new Logger(MediaProcessingService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  async convertToWebp(inputBuffer: Buffer, quality = 80): Promise<Buffer> {
    try {
      return await sharp(inputBuffer).webp({ quality }).toBuffer();
    } catch (error: unknown) {
      this.logger.error('Invalid image content', {
        operation: 'convert',
        sizeBytes: inputBuffer.length,
        error: this.describeError(error),
      });
      throw new BadRequestException(
        MediaProcessingService.INVALID_IMAGE_MESSAGE,
      );
    }
  }

  async processAndUploadImage(
    file: UploadedFile,
    options: ImageProcessingOptions,
  ): Promise<ProcessedMediaResult> {
    let operation = 'validate';

    try {
      const processed = await this.processImageBuffers(file, options);
      operation = 'process';

      // 3. Generate unique filenames
      const fileId = randomUUID();
      const folderPrefix = options.folder ? `${options.folder}/` : '';
      const fullPath = `${folderPrefix}${fileId}-full.webp`;
      const thumbPath = `${folderPrefix}${fileId}-thumb.webp`;

      operation = 'upload';

      // 4. Upload to Supabase Storage
      const storage = this.supabaseService
        .getClient()
        .storage.from(options.bucket);

      const [fullUpload, thumbUpload] = await Promise.all([
        storage.upload(fullPath, processed.full, {
          contentType: 'image/webp',
          upsert: true,
        }),
        storage.upload(thumbPath, processed.thumbnail, {
          contentType: 'image/webp',
          upsert: true,
        }),
      ]);

      if (fullUpload.error || thumbUpload.error) {
        const successfulPaths = [
          ...(fullUpload.error ? [] : [fullPath]),
          ...(thumbUpload.error ? [] : [thumbPath]),
        ];
        if (successfulPaths.length > 0) {
          try {
            const { error: cleanupError } =
              await storage.remove(successfulPaths);
            if (cleanupError) {
              this.logger.error('Partial image upload cleanup failed', {
                bucket: options.bucket,
                paths: successfulPaths,
                error: this.describeError(cleanupError),
              });
            }
          } catch (cleanupError) {
            this.logger.error('Partial image upload cleanup failed', {
              bucket: options.bucket,
              paths: successfulPaths,
              error: this.describeError(cleanupError),
            });
          }
        }
        const uploadError = fullUpload.error || thumbUpload.error;
        throw new Error(uploadError?.message || 'Failed to upload image');
      }

      // 5. Get Public URLs
      const fullPublicUrlData = storage.getPublicUrl(fullPath);
      const thumbPublicUrlData = storage.getPublicUrl(thumbPath);

      return {
        originalName: file.originalname,
        url: fullPublicUrlData.data.publicUrl,
        thumbnailUrl: thumbPublicUrlData.data.publicUrl,
        format: 'webp',
        sizeBytes: processed.full.length,
      };
    } catch (error: unknown) {
      const context = {
        operation,
        originalName: this.sanitizeLogValue(file.originalname),
        mimeType: this.sanitizeLogValue(file.mimetype),
        sizeBytes: file.buffer.length,
        error: this.describeError(error),
      };

      if (this.isMalformedImageError(error)) {
        this.logger.error('Invalid image content', context);
        throw new BadRequestException(
          MediaProcessingService.INVALID_IMAGE_MESSAGE,
        );
      }

      this.logger.error('Image processing failed', context);
      throw new InternalServerErrorException(
        MediaProcessingService.PROCESSING_FAILED_MESSAGE,
      );
    }
  }

  async processImageBuffers(
    file: UploadedFile,
    options: Pick<
      ImageProcessingOptions,
      'quality' | 'maxFullWidth' | 'maxThumbWidth'
    > = {},
  ): Promise<ProcessedImageBuffers> {
    const quality = options.quality ?? 80;
    const full = await sharp(file.buffer)
      .resize({
        width: options.maxFullWidth ?? 1920,
        withoutEnlargement: true,
      })
      .webp({ quality })
      .toBuffer();
    const thumbnail = await sharp(full)
      .resize({
        width: options.maxThumbWidth ?? 300,
        withoutEnlargement: true,
      })
      .webp({ quality })
      .toBuffer();
    return { full, thumbnail };
  }

  private isMalformedImageError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;

    return /unsupported image format|invalid image|corrupt|bad header|premature end|unexpected end|not enough data|vipsforeignload/i.test(
      error.message,
    );
  }

  private describeError(error: unknown): string {
    if (error instanceof Error) {
      return error.stack ?? error.message;
    }
    return String(error);
  }

  private sanitizeLogValue(value: string): string {
    return value.replace(/[\r\n\t]/g, ' ').slice(0, 255);
  }
}
