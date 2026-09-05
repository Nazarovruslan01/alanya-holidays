import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsString, Max, Min } from 'class-validator';

export class CreateEventVideoIntentDto {
  @IsString()
  @IsNotEmpty()
  fileName!: string;

  @IsIn(['video/mp4', 'video/webm'])
  mimeType!: 'video/mp4' | 'video/webm';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50 * 1024 * 1024)
  sizeBytes!: number;
}
