import {
  IsString,
  IsOptional,
  IsObject,
  IsIn,
  MinLength,
} from 'class-validator';

export class UpdateUserProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  full_name?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  avatar_url?: string;

  @IsOptional()
  @IsString()
  bio?: string;

  @IsOptional()
  @IsString()
  company_name?: string;

  @IsOptional()
  @IsObject()
  social_links?: Record<string, string>;

  @IsOptional()
  @IsString()
  @IsIn(['guest', 'user', 'host', 'artisan', 'admin'])
  role?: string;
}
