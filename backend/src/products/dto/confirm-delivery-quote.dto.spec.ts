import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { ConfirmDeliveryQuoteDto } from './confirm-delivery-quote.dto';

describe('ConfirmDeliveryQuoteDto', () => {
  const pipe = new ValidationPipe({ transform: true });
  const validate = (payload: Record<string, unknown>) =>
    pipe.transform(payload, {
      type: 'body',
      metatype: ConfirmDeliveryQuoteDto,
    });

  it('accepts an explicit zero fee and rejects excess precision or non-finite money', async () => {
    await expect(
      validate({ deliveryFee: 0, deliveryEta: 'Tomorrow' }),
    ).resolves.toMatchObject({ deliveryFee: 0 });
    await expect(
      validate({ deliveryFee: 1.001, deliveryEta: 'Tomorrow' }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      validate({
        deliveryFee: Number.POSITIVE_INFINITY,
        deliveryEta: 'Tomorrow',
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
