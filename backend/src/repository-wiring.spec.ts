import { Test } from '@nestjs/testing';
import { PropertiesModule } from './properties/properties.module';
import { ServicesModule } from './services/services.module';
import { ReviewsModule } from './reviews/reviews.module';
import { PROPERTIES_REPOSITORY } from './properties/domain';
import { SERVICES_REPOSITORY } from './services/domain';
import { REVIEWS_REPOSITORY } from './reviews/domain';
import { SupabasePropertiesRepository } from './properties/infrastructure/repositories/supabase-properties.repository';
import { SupabaseServicesRepository } from './services/infrastructure/repositories/supabase-services.repository';
import { SupabaseReviewsRepository } from './reviews/infrastructure/repositories/supabase-reviews.repository';
import { SupabaseService } from './supabase/supabase.service';
import { RedisService } from './common/redis/redis.service';

it('resolves repository tokens to the single implementation in real feature modules', async () => {
  const module = await Test.createTestingModule({
    imports: [PropertiesModule, ServicesModule, ReviewsModule],
  })
    .overrideProvider(SupabaseService)
    .useValue({ getClient: jest.fn() })
    .overrideProvider(RedisService)
    .useValue({})
    .compile();

  try {
    expect(module.get(PROPERTIES_REPOSITORY)).toBe(
      module.get(SupabasePropertiesRepository),
    );
    expect(module.get(SERVICES_REPOSITORY)).toBe(
      module.get(SupabaseServicesRepository),
    );
    expect(module.get(REVIEWS_REPOSITORY)).toBe(
      module.get(SupabaseReviewsRepository),
    );
  } finally {
    await module.close();
  }
});
