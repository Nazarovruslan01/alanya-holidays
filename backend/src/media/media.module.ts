import { Module } from '@nestjs/common';
import { MediaController } from './media.controller';
import { MediaProcessingService } from './media-processing.service';
import { SupabaseModule } from '../supabase/supabase.module';
import { BusinessApplicationsModule } from '../business-applications/business-applications.module';
import { EventMediaRepository } from './event-media.repository';
import { EventMediaService } from './event-media.service';

@Module({
  imports: [SupabaseModule, BusinessApplicationsModule],
  controllers: [MediaController],
  providers: [MediaProcessingService, EventMediaRepository, EventMediaService],
  exports: [MediaProcessingService, EventMediaService],
})
export class MediaModule {}
