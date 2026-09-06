import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEmpty,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MaxLength,
} from 'class-validator';

export class GetForumEventsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  upcomingOnly?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  includeUnpublished?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
}

export class CreateForumEventDto {
  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsString()
  location?: string | null;

  @IsString()
  @IsNotEmpty()
  @IsDateString()
  event_date!: string;

  @IsOptional()
  @IsUUID()
  image_media_id?: string | null;

  @IsOptional()
  @IsUUID()
  video_media_id?: string | null;

  @IsOptional()
  @IsEmpty({ message: 'Direct event image URLs are not accepted' })
  image_url?: unknown;

  @IsOptional()
  @IsEmpty({ message: 'Direct event video URLs are not accepted' })
  video_url?: unknown;

  @IsOptional()
  @IsString()
  host_id?: string | null;

  @IsOptional()
  @IsUUID()
  category_id?: string | null;

  @IsOptional()
  @IsBoolean()
  is_published?: boolean;
}

export class UpdateForumEventDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsString()
  location?: string | null;

  @IsOptional()
  @IsString()
  @IsDateString()
  event_date?: string;

  @IsOptional()
  @IsUUID()
  image_media_id?: string | null;

  @IsOptional()
  @IsUUID()
  video_media_id?: string | null;

  @IsOptional()
  @IsEmpty({ message: 'Direct event image URLs are not accepted' })
  image_url?: unknown;

  @IsOptional()
  @IsEmpty({ message: 'Direct event video URLs are not accepted' })
  video_url?: unknown;

  @IsOptional()
  @IsString()
  host_id?: string | null;

  @IsOptional()
  @IsUUID()
  category_id?: string | null;

  @IsOptional()
  @IsBoolean()
  is_published?: boolean;
}

export class ToggleEventRsvpDto {
  @IsOptional()
  @IsString()
  contactPhone?: string | null;
}
