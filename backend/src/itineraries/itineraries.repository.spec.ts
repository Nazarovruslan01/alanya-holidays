import { Test, TestingModule } from '@nestjs/testing';
import { SupabaseService } from '../supabase/supabase.service';
import { ItinerariesRepository } from './itineraries.repository';

describe('ItinerariesRepository privacy', () => {
  let repository: ItinerariesRepository;
  let client: { from: jest.Mock };

  beforeEach(async () => {
    client = { from: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ItinerariesRepository,
        {
          provide: SupabaseService,
          useValue: { getClient: jest.fn().mockReturnValue(client) },
        },
      ],
    }).compile();

    repository = module.get(ItinerariesRepository);
  });

  it('creates itineraries as private regardless of params.shared', async () => {
    const single = jest.fn().mockResolvedValue({ data: {}, error: null });
    const select = jest.fn().mockReturnValue({ single });
    const insert = jest.fn().mockReturnValue({ select });
    client.from.mockReturnValue({ insert });

    await repository.createItinerary('user-1', {
      title: 'Private plan',
      params: { shared: true },
      itinerary: [],
    });

    expect(insert).toHaveBeenCalledWith({
      user_id: 'user-1',
      title: 'Private plan',
      params: { shared: true },
      itinerary: [],
      is_public: false,
    });
  });

  it('inserts a caller-provided stable itinerary ID', async () => {
    const single = jest.fn().mockResolvedValue({ data: {}, error: null });
    const select = jest.fn().mockReturnValue({ single });
    const insert = jest.fn().mockReturnValue({ select });
    client.from.mockReturnValue({ insert });

    await repository.createItinerary('user-1', {
      id: 'd74d2730-bfe5-4e22-854c-b5b8c4c46a25',
      title: 'Stable plan',
      itinerary: [],
    });

    expect(insert).toHaveBeenCalledWith({
      id: 'd74d2730-bfe5-4e22-854c-b5b8c4c46a25',
      user_id: 'user-1',
      title: 'Stable plan',
      params: {},
      itinerary: [],
      is_public: false,
    });
  });

  it('returns the same owner row when a stable-ID retry hits the primary key', async () => {
    const existing = {
      id: 'd74d2730-bfe5-4e22-854c-b5b8c4c46a25',
      user_id: 'user-1',
    };
    const insertSingle = jest.fn().mockResolvedValue({
      data: null,
      error: { code: '23505', message: 'duplicate key' },
    });
    const insertSelect = jest.fn().mockReturnValue({ single: insertSingle });
    const insert = jest.fn().mockReturnValue({ select: insertSelect });
    const maybeSingle = jest
      .fn()
      .mockResolvedValue({ data: existing, error: null });
    const ownerEq = jest.fn().mockReturnValue({ maybeSingle });
    const idEq = jest.fn().mockReturnValue({ eq: ownerEq });
    const select = jest.fn().mockReturnValue({ eq: idEq });
    client.from.mockReturnValueOnce({ insert }).mockReturnValueOnce({ select });

    await expect(
      repository.createItinerary('user-1', {
        id: existing.id,
        title: 'Retry',
        itinerary: [],
      }),
    ).resolves.toBe(existing);
    expect(idEq).toHaveBeenCalledWith('id', existing.id);
    expect(ownerEq).toHaveBeenCalledWith('user_id', 'user-1');
  });

  it('never returns another owner row for a stable-ID conflict', async () => {
    const insertSingle = jest.fn().mockResolvedValue({
      data: null,
      error: { code: '23505', message: 'duplicate key' },
    });
    const insertSelect = jest.fn().mockReturnValue({ single: insertSingle });
    const insert = jest.fn().mockReturnValue({ select: insertSelect });
    const maybeSingle = jest
      .fn()
      .mockResolvedValue({ data: null, error: null });
    const ownerEq = jest.fn().mockReturnValue({ maybeSingle });
    const idEq = jest.fn().mockReturnValue({ eq: ownerEq });
    const select = jest.fn().mockReturnValue({ eq: idEq });
    client.from.mockReturnValueOnce({ insert }).mockReturnValueOnce({ select });

    await expect(
      repository.createItinerary('attacker', {
        id: 'd74d2730-bfe5-4e22-854c-b5b8c4c46a25',
        title: 'Foreign conflict',
        itinerary: [],
      }),
    ).rejects.toThrow('duplicate key');
    expect(ownerEq).toHaveBeenCalledWith('user_id', 'attacker');
  });

  it('filters the community feed to explicitly public itineraries', async () => {
    const limit = jest.fn().mockResolvedValue({ data: [], error: null });
    const order = jest.fn().mockReturnValue({ limit });
    const eq = jest.fn().mockReturnValue({ order });
    const select = jest.fn().mockReturnValue({ eq });
    client.from.mockReturnValue({ select });

    await repository.findCommunity(12);

    expect(eq).toHaveBeenCalledWith('is_public', true);
    expect(limit).toHaveBeenCalledWith(12);
  });

  it('scopes publication updates to the authenticated owner', async () => {
    const single = jest.fn().mockResolvedValue({ data: {}, error: null });
    const select = jest.fn().mockReturnValue({ single });
    const ownerEq = jest.fn().mockReturnValue({ select });
    const idEq = jest.fn().mockReturnValue({ eq: ownerEq });
    const update = jest.fn().mockReturnValue({ eq: idEq });
    client.from.mockReturnValue({ update });

    await repository.updateItinerary('itin-123', { is_public: true }, 'user-1');

    expect(update).toHaveBeenCalledWith({ is_public: true });
    expect(idEq).toHaveBeenCalledWith('id', 'itin-123');
    expect(ownerEq).toHaveBeenCalledWith('user_id', 'user-1');
  });
});
