import { Test, TestingModule } from '@nestjs/testing';
import { ProcessedStripeEventsRepository } from './processed-stripe-events.repository';
import { SupabaseService } from '../supabase/supabase.service';

/**
 * Adversarial idempotency tests for Stripe webhook event claiming (audit 2.3):
 * processed events must be persisted in the DB so duplicates are detected
 * across restarts and multiple instances.
 */
describe('ProcessedStripeEventsRepository', () => {
  let repository: ProcessedStripeEventsRepository;
  let mockSupabaseClient: { rpc: jest.Mock };

  beforeEach(async () => {
    mockSupabaseClient = { rpc: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProcessedStripeEventsRepository,
        {
          provide: SupabaseService,
          useValue: { getClient: () => mockSupabaseClient },
        },
      ],
    }).compile();

    repository = module.get<ProcessedStripeEventsRepository>(
      ProcessedStripeEventsRepository,
    );
  });

  it('should claim an unseen event via the claim_stripe_event_delivery RPC and return true', async () => {
    mockSupabaseClient.rpc.mockResolvedValueOnce({
      data: 'claimed',
      error: null,
    });

    const isFirstTime = await repository.tryClaimEvent('evt_123', 'token');

    expect(mockSupabaseClient.rpc).toHaveBeenCalledWith(
      'claim_stripe_event_delivery',
      {
        p_event_id: 'evt_123',
        p_token: 'token',
      },
    );
    expect(isFirstTime).toBe(true);
  });

  it('should return false for an already-claimed (duplicate) event', async () => {
    mockSupabaseClient.rpc.mockResolvedValueOnce({
      data: 'completed',
      error: null,
    });

    const isFirstTime = await repository.tryClaimEvent(
      'evt_duplicate',
      'token',
    );

    expect(isFirstTime).toBe(false);
  });

  it('should throw when the DB claim fails (fail-closed: do not process unverified events)', async () => {
    mockSupabaseClient.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'connection refused' },
    });

    await expect(repository.tryClaimEvent('evt_err', 'token')).rejects.toThrow(
      'connection refused',
    );
  });

  it.each(['busy', null, 'unexpected'])(
    'fails closed for claim result %s',
    async (data) => {
      mockSupabaseClient.rpc.mockResolvedValueOnce({ data, error: null });
      await expect(
        repository.tryClaimEvent('evt_busy', 'token'),
      ).rejects.toThrow();
    },
  );

  it('completes only the owned delivery', async () => {
    mockSupabaseClient.rpc.mockResolvedValueOnce({ data: true, error: null });
    await repository.completeEvent('evt_done', 'token');
    expect(mockSupabaseClient.rpc).toHaveBeenCalledWith(
      'complete_stripe_event_delivery',
      {
        p_event_id: 'evt_done',
        p_token: 'token',
      },
    );
  });

  it.each([false, null])(
    'rejects completion without ownership (%s)',
    async (data) => {
      mockSupabaseClient.rpc.mockResolvedValueOnce({ data, error: null });
      await expect(
        repository.completeEvent('evt_lost', 'token'),
      ).rejects.toThrow('lease was lost');
    },
  );

  it('releases through the token-guarded RPC', async () => {
    mockSupabaseClient.rpc.mockResolvedValueOnce({ error: null });
    await repository.releaseEvent('evt_retry', 'token');
    expect(mockSupabaseClient.rpc).toHaveBeenCalledWith(
      'release_stripe_event_delivery',
      {
        p_event_id: 'evt_retry',
        p_token: 'token',
      },
    );
  });
});
