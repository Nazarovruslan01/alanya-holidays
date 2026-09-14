import { validate } from 'class-validator';
import { SubmitReviewDto } from './submit-review.dto';

describe('SubmitReviewDto', () => {
  it('accepts legacy payloads without optional metadata', async () => {
    const dto = Object.assign(new SubmitReviewDto(), {
      rating: 5,
      comment: 'A useful review',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it.each(['Couple', 'Family', 'Solo', 'Friends', 'Business'])(
    'accepts the supported %s visit type',
    async (visit_type) => {
      const dto = Object.assign(new SubmitReviewDto(), {
        rating: 5,
        comment: 'A useful review',
        title: 'A memorable visit',
        visit_type,
      });

      await expect(validate(dto)).resolves.toHaveLength(0);
    },
  );

  it('rejects an unsupported visit type', async () => {
    const dto = Object.assign(new SubmitReviewDto(), {
      rating: 5,
      comment: 'A useful review',
      visit_type: 'Conference',
    });

    const errors = await validate(dto);
    expect(errors).toEqual([
      expect.objectContaining({
        property: 'visit_type',
        constraints: expect.objectContaining({ isIn: expect.any(String) }),
      }),
    ]);
  });
});
