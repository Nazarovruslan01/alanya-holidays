import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

/**
 * Persistent store of processed Stripe event ids (audit 2.3).
 * Replaces the in-memory Map in StripeWebhookService so duplicate
 * deliveries are detected across restarts and multiple instances.
 */
@Injectable()
export class ProcessedStripeEventsRepository {
  constructor(private readonly supabaseService: SupabaseService) {}

  get client() {
    return this.supabaseService.getClient();
  }

  /**
   * Claims a new or expired delivery. Only completed events are duplicates;
   * active deliveries must fail so the provider retries after a worker crash.
   */
  async tryClaimEvent(eventId: string, token: string): Promise<boolean> {
    const { data, error } = (await this.client.rpc(
      'claim_stripe_event_delivery',
      {
        p_event_id: eventId,
        p_token: token,
      },
    )) as { data: string | null; error: { message: string } | null };

    if (error) throw new Error(error.message);
    if (data === 'claimed') return true;
    if (data === 'completed') return false;
    throw new Error('Stripe event is not available for processing');
  }

  async completeEvent(eventId: string, token: string): Promise<void> {
    const { data, error } = (await this.client.rpc(
      'complete_stripe_event_delivery',
      {
        p_event_id: eventId,
        p_token: token,
      },
    )) as { data: boolean | null; error: { message: string } | null };
    if (error) throw new Error(error.message);
    if (data !== true)
      throw new Error('Stripe event processing lease was lost');
  }

  /**
   * Releases a previously claimed event so Stripe retries are processed
   * instead of being skipped as duplicates after a handler failure.
   */
  async releaseEvent(eventId: string, token: string): Promise<void> {
    const { error } = await this.client.rpc('release_stripe_event_delivery', {
      p_event_id: eventId,
      p_token: token,
    });

    if (error) throw new Error(error.message);
  }
}
