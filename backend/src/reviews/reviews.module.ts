import { Module } from '@nestjs/common';
import { ReviewsService } from './reviews.service';
import { ReviewsController } from './reviews.controller';
import { SupabaseReviewsRepository } from './infrastructure/repositories/supabase-reviews.repository';
import { REVIEWS_REPOSITORY } from './domain/repositories/reviews.repository.interface';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  providers: [
    ReviewsService,
    SupabaseReviewsRepository,
    {
      provide: REVIEWS_REPOSITORY,
      useExisting: SupabaseReviewsRepository,
    },
  ],
  controllers: [ReviewsController],
  exports: [ReviewsService, SupabaseReviewsRepository, REVIEWS_REPOSITORY],
})
export class ReviewsModule {}
