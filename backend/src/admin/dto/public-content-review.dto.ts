import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const REVIEW_TABLES = [
  'directory_listings',
  'services',
  'service_edits',
  'properties',
  'products',
  'product_items',
  'forum_events',
  'listing_reviews',
  'reviews',
  'blog_posts',
  'forum_posts',
  'forum_comments',
  'blog_comments',
  'saved_itineraries',
  'profile_public_revisions',
] as const;

export class PublicContentQueueDto {
  @IsIn(REVIEW_TABLES)
  type: (typeof REVIEW_TABLES)[number] = 'forum_posts';

  @IsIn(['pending', 'approved', 'rejected'])
  status: string = 'pending';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 20;
}

export class ReviewPublicContentDto {
  @IsIn(REVIEW_TABLES)
  type!: (typeof REVIEW_TABLES)[number];

  @IsString()
  @MaxLength(100)
  id!: string;

  @IsInt()
  @Min(1)
  revision!: number;

  @IsBoolean()
  approve!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}

export class AdminQueuePageDto {
  @IsIn([
    'listings',
    'claims',
    'enquiries',
    'submissions',
    'articles',
    'events',
  ])
  type!:
    'listings' | 'claims' | 'enquiries' | 'submissions' | 'articles' | 'events';
  @IsOptional()
  @IsString()
  @MaxLength(30)
  status?: string;
  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;
}
