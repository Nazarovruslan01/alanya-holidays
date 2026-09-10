import {
  IsNumber,
  Min,
  Max,
  IsString,
  IsNotEmpty,
  IsOptional,
  IsIn,
} from 'class-validator';
import {
  REVIEW_VISIT_TYPES,
  ReviewVisitType,
} from '../domain/repositories/reviews.repository.interface';

export class SubmitReviewDto {
  @IsNumber()
  @Min(1)
  @Max(5)
  rating!: number;

  @IsString()
  @IsNotEmpty()
  comment!: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  @IsIn(REVIEW_VISIT_TYPES)
  visit_type?: ReviewVisitType;
}
