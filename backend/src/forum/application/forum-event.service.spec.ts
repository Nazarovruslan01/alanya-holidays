import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { ForumEventService } from './forum-event.service';
import {
  ForumEventPersistenceException,
  ForumRepository,
} from '../forum.repository';
import { UserRolesRepository } from '../../common/auth/user-roles.repository';
import { BusinessApplicationsService } from '../../business-applications/business-applications.service';

describe('ForumEventService', () => {
  let service: ForumEventService;
  let mockRepository: Record<string, jest.Mock>;
  let mockUserRoles: Record<string, jest.Mock>;
  let mockBusinessApplications: { hasApprovedBusinessAccount: jest.Mock };

  const userId = '11111111-1111-4111-a111-111111111111';
  const eventId = '22222222-2222-4222-a222-222222222222';
  const idempotencyKey = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const videoUrl =
    'https://project.supabase.co/storage/v1/object/public/event-media/11111111-1111-4111-a111-111111111111/events/33333333-3333-4333-a333-333333333333.mp4';

  beforeEach(async () => {
    mockRepository = {
      getEvents: jest.fn().mockResolvedValue([]),
      getEventBySlug: jest.fn(),
      getEventSlugs: jest.fn().mockResolvedValue([]),
      getEventOwnership: jest.fn(),
      insertEvent: jest.fn(),
      createEventWithMedia: jest.fn(),
      updateEvent: jest.fn(),
      updateEventWithMedia: jest.fn(),
      deleteEvent: jest.fn().mockResolvedValue(true),
      deleteEventWithMedia: jest.fn().mockResolvedValue(true),
      getEventRsvpAttendees: jest.fn().mockResolvedValue([]),
      getProfilesByIds: jest.fn().mockResolvedValue([]),
      toggleRow: jest.fn().mockResolvedValue({ active: true }),
      annotateRsvp: jest
        .fn()
        .mockImplementation((rows) => Promise.resolve(rows)),
    };

    mockUserRoles = {
      getRole: jest.fn(),
    };
    mockBusinessApplications = {
      hasApprovedBusinessAccount: jest.fn().mockResolvedValue(true),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ForumEventService,
        {
          provide: ForumRepository,
          useValue: mockRepository,
        },
        {
          provide: UserRolesRepository,
          useValue: mockUserRoles,
        },
        {
          provide: BusinessApplicationsService,
          useValue: mockBusinessApplications,
        },
      ],
    }).compile();

    service = module.get<ForumEventService>(ForumEventService);
  });

  describe('Events management', () => {
    it('denies event list, create, update, and delete to an ordinary authenticated user', async () => {
      mockUserRoles.getRole.mockResolvedValue('user');
      mockBusinessApplications.hasApprovedBusinessAccount.mockResolvedValue(
        false,
      );

      await expect(service.getMyForumEvents(userId)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(
        service.createForumEvent(
          { title: 'Unauthorized Event', event_date: '2026-09-01' },
          userId,
          idempotencyKey,
        ),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.updateForumEvent(eventId, { title: 'Unauthorized' }, userId),
      ).rejects.toThrow(ForbiddenException);
      await expect(service.deleteForumEvent(eventId, userId)).rejects.toThrow(
        ForbiddenException,
      );

      expect(mockRepository.getEvents).not.toHaveBeenCalled();
      expect(mockRepository.insertEvent).not.toHaveBeenCalled();
      expect(mockRepository.getEventOwnership).not.toHaveBeenCalled();
      expect(mockRepository.updateEvent).not.toHaveBeenCalled();
      expect(mockRepository.deleteEvent).not.toHaveBeenCalled();
    });

    it('fetches events and annotates RSVP for current user', async () => {
      mockRepository.getEvents.mockResolvedValueOnce([
        { id: eventId, title: 'Beach Meet' },
      ]);
      const res = await service.getForumEvents({ upcomingOnly: true }, userId);
      expect(res).toEqual([{ id: eventId, title: 'Beach Meet' }]);
      expect(mockRepository.annotateRsvp).toHaveBeenCalled();
    });

    it('requires admin to include unpublished events', async () => {
      mockUserRoles.getRole.mockResolvedValueOnce('user');
      await expect(
        service.getForumEvents({ includeUnpublished: true }, userId),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('creates event with resolved unique slug when user is admin', async () => {
      mockUserRoles.getRole.mockResolvedValueOnce('admin');
      mockRepository.getEventSlugs.mockResolvedValueOnce([]);
      mockRepository.createEventWithMedia.mockResolvedValueOnce({
        id: eventId,
        title: 'Sunset BBQ',
        slug: 'sunset-bbq',
      });

      const res = await service.createForumEvent(
        {
          title: 'Sunset BBQ',
          event_date: '2026-09-01',
          video_media_id: '33333333-3333-4333-a333-333333333333',
        },
        userId,
        idempotencyKey,
      );
      expect(res.id).toBe(eventId);
      expect(mockRepository.createEventWithMedia).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Sunset BBQ',
          slug: 'sunset-bbq',
          created_by: userId,
          is_published: true,
        }),
        userId,
        {
          imageMediaId: null,
          videoMediaId: '33333333-3333-4333-a333-333333333333',
        },
        {
          idempotencyKey,
          requestFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
        },
      );
    });

    it.each([
      undefined,
      '',
      'not-a-uuid',
      'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaaaa',
    ])(
      'rejects a missing or malformed idempotency key before persistence',
      async (invalidKey) => {
        mockUserRoles.getRole.mockResolvedValue('admin');

        await expect(
          service.createForumEvent(
            { title: 'Invalid key', event_date: '2026-09-01' },
            userId,
            invalidKey as string,
          ),
        ).rejects.toThrow(BadRequestException);

        expect(mockRepository.createEventWithMedia).not.toHaveBeenCalled();
      },
    );

    it('rejects a malformed event date as a bad request before persistence', async () => {
      await expect(
        service.createForumEvent(
          { title: 'Invalid date', event_date: 'not-a-date' },
          userId,
          idempotencyKey,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(mockRepository.createEventWithMedia).not.toHaveBeenCalled();
      expect(mockRepository.getEventSlugs).not.toHaveBeenCalled();
    });

    it('fingerprints normalized event semantics and opaque media identifiers', async () => {
      mockUserRoles.getRole.mockResolvedValue('admin');
      mockRepository.createEventWithMedia.mockResolvedValue({ id: eventId });

      await service.createForumEvent(
        {
          title: '  Canonical event  ',
          description: '  Same description ',
          location: '  Alanya  ',
          event_date: '2026-09-01T18:00:00+00:00',
          image_media_id: '88888888-8888-4888-a888-888888888888',
        },
        userId,
        idempotencyKey,
      );
      await service.createForumEvent(
        {
          title: 'Canonical event',
          description: 'Same description',
          location: 'Alanya',
          event_date: '2026-09-01T18:00:00.000Z',
          image_media_id: '88888888-8888-4888-a888-888888888888',
        },
        userId,
        idempotencyKey,
      );

      const first = mockRepository.createEventWithMedia.mock.calls[0][3];
      const second = mockRepository.createEventWithMedia.mock.calls[1][3];
      expect(first.requestFingerprint).toBe(second.requestFingerprint);
      expect(first.requestFingerprint).toMatch(/^[0-9a-f]{64}$/);
    });

    it('maps a reused key with a changed fingerprint to conflict without fallback persistence', async () => {
      mockUserRoles.getRole.mockResolvedValue('admin');
      mockRepository.createEventWithMedia.mockRejectedValueOnce(
        new ForumEventPersistenceException(
          'Idempotency key was already used for another event request',
          '23505',
        ),
      );

      await expect(
        service.createForumEvent(
          { title: 'Changed request', event_date: '2026-09-01' },
          userId,
          idempotencyKey,
        ),
      ).rejects.toThrow(ConflictException);

      expect(mockRepository.insertEvent).not.toHaveBeenCalled();
    });

    it('atomically creates an event by attaching opaque ready media IDs', async () => {
      const imageMediaId = '88888888-8888-4888-a888-888888888888';
      const videoMediaId = '99999999-9999-4999-a999-999999999999';
      mockUserRoles.getRole.mockResolvedValueOnce('admin');
      mockRepository.getEventSlugs.mockResolvedValueOnce([]);
      mockRepository.createEventWithMedia.mockResolvedValueOnce({
        id: eventId,
        title: 'Opaque media event',
      });

      const result = await service.createForumEvent(
        {
          title: 'Opaque media event',
          event_date: '2026-09-01',
          image_media_id: imageMediaId,
          video_media_id: videoMediaId,
        },
        userId,
        idempotencyKey,
      );

      expect(result.id).toBe(eventId);
      expect(mockRepository.createEventWithMedia).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Opaque media event',
          slug: 'opaque-media-event',
        }),
        userId,
        { imageMediaId, videoMediaId },
        {
          idempotencyKey,
          requestFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
        },
      );
      expect(mockRepository.insertEvent).not.toHaveBeenCalled();
    });

    it.each([
      'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
      'bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb',
    ])(
      'rejects a missing or cross-owner event video on create',
      async (videoMediaId) => {
        mockUserRoles.getRole.mockResolvedValue('admin');
        mockRepository.createEventWithMedia.mockRejectedValueOnce(
          new ForumEventPersistenceException(
            'Event media is unavailable for this owner',
            '42501',
          ),
        );

        await expect(
          service.createForumEvent(
            {
              title: 'Untrusted video',
              event_date: '2026-09-01',
              video_media_id: videoMediaId,
            },
            userId,
            idempotencyKey,
          ),
        ).rejects.toThrow(ForbiddenException);

        expect(mockRepository.insertEvent).not.toHaveBeenCalled();
      },
    );

    it('rejects a cross-owner event video on update before persistence', async () => {
      mockUserRoles.getRole.mockResolvedValue('admin');
      mockRepository.getEventOwnership.mockResolvedValue({
        host_id: userId,
        created_by: userId,
        is_published: false,
        image_url: null,
        video_url: null,
      });
      mockRepository.updateEventWithMedia.mockRejectedValueOnce(
        new ForumEventPersistenceException(
          'Event media is unavailable for this owner',
          '42501',
        ),
      );

      await expect(
        service.updateForumEvent(
          eventId,
          { video_media_id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa' },
          userId,
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(mockRepository.updateEvent).not.toHaveBeenCalled();
    });

    it('rejects replacement media that belongs to the hosted event owner instead of the actor', async () => {
      const eventOwnerId = '77777777-7777-4777-a777-777777777777';
      const eventOwnerMediaId = '66666666-6666-4666-a666-666666666666';
      mockUserRoles.getRole.mockResolvedValue('admin');
      mockRepository.getEventOwnership.mockResolvedValue({
        host_id: eventOwnerId,
        created_by: eventOwnerId,
        is_published: true,
        image_url: null,
        video_url: null,
      });
      mockRepository.updateEventWithMedia.mockRejectedValueOnce(
        new ForumEventPersistenceException(
          'Event media is unavailable for this owner',
          '42501',
        ),
      );

      await expect(
        service.updateForumEvent(
          eventId,
          { video_media_id: eventOwnerMediaId },
          userId,
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(mockRepository.updateEvent).not.toHaveBeenCalled();
    });

    it('allows an admin to replace hosted-on-behalf media with admin-owned media', async () => {
      const hostedOwnerId = '77777777-7777-4777-a777-777777777777';
      const adminOwnedMediaId = '33333333-3333-4333-a333-333333333333';
      mockUserRoles.getRole.mockResolvedValue('admin');
      mockRepository.getEventOwnership.mockResolvedValue({
        host_id: hostedOwnerId,
        created_by: hostedOwnerId,
        is_published: true,
        image_url: null,
        video_url: null,
      });
      mockRepository.updateEventWithMedia.mockResolvedValueOnce({
        id: eventId,
      });

      await expect(
        service.updateForumEvent(
          eventId,
          { video_media_id: adminOwnedMediaId },
          userId,
        ),
      ).resolves.toEqual({ id: eventId });

      expect(mockRepository.updateEventWithMedia).toHaveBeenCalledWith(
        eventId,
        {},
        userId,
        {
          replaceImage: false,
          imageMediaId: null,
          replaceVideo: true,
          videoMediaId: adminOwnedMediaId,
        },
      );
    });

    it('rejects unfinalized media while leaving persisted cleanup to the durable expiry queue', async () => {
      mockUserRoles.getRole.mockResolvedValue('admin');
      mockRepository.createEventWithMedia.mockRejectedValueOnce(
        new ForumEventPersistenceException(
          'Event media must be ready before attachment',
          '22023',
        ),
      );

      await expect(
        service.createForumEvent(
          {
            title: 'Spoofed video',
            event_date: '2026-09-01',
            video_media_id: '33333333-3333-4333-a333-333333333333',
          },
          userId,
          idempotencyKey,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(mockRepository.insertEvent).not.toHaveBeenCalled();
    });

    it('forces merchant ownership when an authenticated user creates an event', async () => {
      mockUserRoles.getRole.mockResolvedValueOnce('user');
      mockRepository.createEventWithMedia.mockResolvedValueOnce({
        id: eventId,
      });

      await service.createForumEvent(
        {
          title: 'Merchant Meetup',
          event_date: '2026-09-02',
          host_id: 'forged-owner',
          is_published: true,
        },
        userId,
        idempotencyKey,
      );

      expect(mockRepository.createEventWithMedia).toHaveBeenCalledWith(
        expect.objectContaining({
          host_id: userId,
          created_by: userId,
          is_published: false,
        }),
        userId,
        { imageMediaId: null, videoMediaId: null },
        {
          idempotencyKey,
          requestFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
        },
      );
    });

    it('allows the event owner to edit but rejects a forged event id', async () => {
      mockUserRoles.getRole.mockResolvedValue('user');
      mockRepository.getEventOwnership
        .mockResolvedValueOnce({
          host_id: userId,
          created_by: userId,
          is_published: false,
          image_url: null,
          video_url: null,
        })
        .mockResolvedValueOnce({
          host_id: 'another-user',
          created_by: 'another-user',
          is_published: false,
          image_url: null,
          video_url: null,
        });
      mockRepository.updateEventWithMedia.mockResolvedValueOnce({
        id: eventId,
        title: 'Updated',
      });

      await expect(
        service.updateForumEvent(
          eventId,
          { title: 'Updated', video_media_id: null },
          userId,
        ),
      ).resolves.toEqual({ id: eventId, title: 'Updated' });
      expect(mockRepository.updateEventWithMedia).toHaveBeenCalledWith(
        eventId,
        { title: 'Updated' },
        userId,
        {
          replaceImage: false,
          imageMediaId: null,
          replaceVideo: true,
          videoMediaId: null,
        },
      );
      await expect(
        service.updateForumEvent(eventId, { title: 'Forged' }, userId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('uses one atomic RPC for replacement and durable old-media enqueue', async () => {
      const newImage = '55555555-5555-4555-a555-555555555555';
      const newVideo = '66666666-6666-4666-a666-666666666666';
      mockUserRoles.getRole.mockResolvedValue('admin');
      mockRepository.getEventOwnership.mockResolvedValue({
        host_id: userId,
        created_by: userId,
        is_published: true,
        image_url: 'https://project.supabase.co/old-image.webp',
        video_url: 'https://project.supabase.co/old-video.mp4',
      });
      mockRepository.updateEventWithMedia.mockResolvedValue({ id: eventId });

      await service.updateForumEvent(
        eventId,
        { image_media_id: newImage, video_media_id: newVideo },
        userId,
      );

      // Repository coverage verifies this is exactly one RPC; SQL coverage
      // verifies that event update + old-media enqueue commit or roll back together.
      expect(mockRepository.updateEventWithMedia).toHaveBeenCalledWith(
        eventId,
        {},
        userId,
        {
          replaceImage: true,
          imageMediaId: newImage,
          replaceVideo: true,
          videoMediaId: newVideo,
        },
      );
      expect(mockRepository.updateEvent).not.toHaveBeenCalled();
    });

    it('uses one atomic RPC for delete and durable attached-media enqueue', async () => {
      mockUserRoles.getRole.mockResolvedValue('admin');
      mockRepository.getEventOwnership.mockResolvedValue({
        host_id: userId,
        created_by: userId,
        is_published: true,
        image_url: null,
        video_url: videoUrl,
      });
      mockRepository.deleteEventWithMedia.mockResolvedValue(true);

      await expect(service.deleteForumEvent(eventId, userId)).resolves.toEqual({
        success: true,
      });

      expect(mockRepository.deleteEventWithMedia).toHaveBeenCalledWith(
        eventId,
        userId,
      );
      expect(mockRepository.deleteEvent).not.toHaveBeenCalled();
    });

    it('does not run cleanup outside the transaction when a media mutation fails', async () => {
      mockUserRoles.getRole.mockResolvedValue('admin');
      mockRepository.getEventOwnership.mockResolvedValue({
        host_id: userId,
        created_by: userId,
        is_published: true,
        image_url: null,
        video_url: videoUrl,
      });
      mockRepository.updateEventWithMedia.mockRejectedValue(
        new ForumEventPersistenceException('transaction rolled back', '40001'),
      );

      await expect(
        service.updateForumEvent(eventId, { video_media_id: null }, userId),
      ).rejects.toThrow('transaction rolled back');
      expect(mockRepository.updateEventWithMedia).toHaveBeenCalledTimes(1);
    });

    it('rejects merchant publication and mutations of a published event', async () => {
      mockUserRoles.getRole.mockResolvedValue('user');
      mockRepository.getEventOwnership
        .mockResolvedValueOnce({
          host_id: userId,
          created_by: userId,
          is_published: false,
          image_url: null,
          video_url: null,
        })
        .mockResolvedValueOnce({
          host_id: userId,
          created_by: userId,
          is_published: true,
          image_url: null,
          video_url: null,
        })
        .mockResolvedValueOnce({
          host_id: userId,
          created_by: userId,
          is_published: true,
          image_url: null,
          video_url: null,
        });

      await expect(
        service.updateForumEvent(eventId, { is_published: true }, userId),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.updateForumEvent(eventId, { title: 'Published edit' }, userId),
      ).rejects.toThrow(ForbiddenException);
      await expect(service.deleteForumEvent(eventId, userId)).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockRepository.updateEvent).not.toHaveBeenCalled();
      expect(mockRepository.deleteEvent).not.toHaveBeenCalled();
    });

    it('loads draft and published events scoped to the authenticated owner', async () => {
      mockRepository.getEvents.mockResolvedValueOnce([
        { id: eventId, host_id: userId, is_published: false },
        {
          id: 'published-event',
          created_by: userId,
          is_published: true,
        },
      ]);

      await expect(service.getMyForumEvents(userId)).resolves.toEqual([
        { id: eventId, host_id: userId, is_published: false },
        {
          id: 'published-event',
          created_by: userId,
          is_published: true,
        },
      ]);
      expect(mockRepository.getEvents).toHaveBeenCalledWith(
        { ownerId: userId, includeUnpublished: true, limit: 100 },
        expect.any(String),
      );
    });

    it('never returns an unpublished event to another user', async () => {
      mockRepository.getEventBySlug.mockResolvedValueOnce({
        id: eventId,
        slug: 'private-event',
        is_published: false,
        host_id: 'another-user',
        created_by: 'another-user',
      });
      mockUserRoles.getRole.mockResolvedValueOnce('user');

      await expect(
        service.getForumEvent('private-event', userId),
      ).resolves.toBeNull();
      expect(mockRepository.annotateRsvp).not.toHaveBeenCalled();
    });

    it('hides an owned unpublished event from an ordinary account', async () => {
      mockRepository.getEventBySlug.mockResolvedValueOnce({
        id: eventId,
        slug: 'private-event',
        is_published: false,
        host_id: userId,
        created_by: userId,
      });
      mockUserRoles.getRole.mockResolvedValueOnce('user');
      mockBusinessApplications.hasApprovedBusinessAccount.mockResolvedValueOnce(
        false,
      );

      await expect(
        service.getForumEvent('private-event', userId),
      ).resolves.toBeNull();
      expect(mockRepository.annotateRsvp).not.toHaveBeenCalled();
    });

    it('toggles RSVP delegating to repository toggleRow', async () => {
      mockRepository.toggleRow.mockResolvedValueOnce({ active: true });
      const res = await service.toggleEventRsvp(
        eventId,
        '+905551234567',
        userId,
      );
      expect(res).toEqual({ going: true });
      expect(mockRepository.toggleRow).toHaveBeenCalledWith(
        'forum_event_rsvps',
        'event_id',
        eventId,
        userId,
        { contact_phone: '+905551234567' },
      );
    });
  });
});
