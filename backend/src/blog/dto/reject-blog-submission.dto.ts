import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';
import { ReviewBlogSubmissionDto } from './review-blog-submission.dto';

export class RejectBlogSubmissionDto extends ReviewBlogSubmissionDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(10, { message: 'Reason must be at least 10 chars' })
  @MaxLength(1000)
  reason!: string;
}
