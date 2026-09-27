import { IsInt, Min } from 'class-validator';

export class ReviewBlogSubmissionDto {
  @IsInt()
  @Min(1)
  revision!: number;
}
