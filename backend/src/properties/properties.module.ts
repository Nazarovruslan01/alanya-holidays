import { Module } from '@nestjs/common';
import { PropertiesService } from './properties.service';
import { PropertiesController } from './properties.controller';
import { PropertiesAdminController } from './properties-admin.controller';
import { SupabasePropertiesRepository } from './infrastructure/repositories/supabase-properties.repository';
import { PROPERTIES_REPOSITORY } from './domain';
import { AuthModule } from '../auth/auth.module';
import { EmailOutboxRepository } from '../bookings/email-outbox.repository';

@Module({
  imports: [AuthModule],
  controllers: [PropertiesController, PropertiesAdminController],
  providers: [
    PropertiesService,
    EmailOutboxRepository,
    SupabasePropertiesRepository,
    {
      provide: PROPERTIES_REPOSITORY,
      useExisting: SupabasePropertiesRepository,
    },
  ],
  exports: [
    PropertiesService,
    SupabasePropertiesRepository,
    PROPERTIES_REPOSITORY,
  ],
})
export class PropertiesModule {}
