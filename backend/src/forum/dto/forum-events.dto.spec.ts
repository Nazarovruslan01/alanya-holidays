import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateForumEventDto, UpdateForumEventDto } from './forum-events.dto';

describe('CreateForumEventDto validation', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true });
  const meta = { type: 'body' as const, metatype: CreateForumEventDto };
  const valid = {
    title: 'Sunset Sports Meetup',
    event_date: '2026-09-01T18:00:00Z',
    category_id: '11111111-2222-4333-8444-555555555555',
  };

  it('accepts a UUID category_id', async () => {
    await expect(pipe.transform(valid, meta)).resolves.toMatchObject(valid);
  });

  it('accepts opaque media IDs and nullable removal on update', async () => {
    const videoMediaId = '22222222-2222-4222-a222-222222222222';

    await expect(
      pipe.transform({ ...valid, video_media_id: videoMediaId }, meta),
    ).resolves.toMatchObject({ video_media_id: videoMediaId });
    await expect(
      pipe.transform(
        { video_media_id: null },
        { type: 'body', metatype: UpdateForumEventDto },
      ),
    ).resolves.toMatchObject({ video_media_id: null });
  });

  it.each([
    ['video_url', 'https://cdn.example/event.mp4'],
    ['image_url', 'https://cdn.example/cover.webp'],
  ])('rejects direct or external media URL field %s', async (field, url) => {
    await expect(
      pipe.transform({ ...valid, [field]: url }, meta),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a category slug before the event service is called', async () => {
    await expect(
      pipe.transform({ ...valid, category_id: 'events-sports' }, meta),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a malformed event date before the event service is called', async () => {
    await expect(
      pipe.transform({ ...valid, event_date: 'not-a-date' }, meta),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
