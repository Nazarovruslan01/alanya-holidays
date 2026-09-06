import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateProductOrderDto } from './create-product-order.dto';

describe('CreateProductOrderDto', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true });
  const validPayload = {
    currency: 'EUR',
    subtotal: 25,
    recipient: {
      name: 'Jane Doe',
      email: 'jane@example.com',
      phone: '+905551234567',
      address: '10 Harbour Road',
      contact_method: 'email',
    },
    items: [
      {
        productId: 1,
        productName: 'Olive Oil',
        quantity: 1,
        unitPrice: 25,
        finalPrice: 25,
        subtotal: 25,
      },
    ],
  };

  const validate = (payload: Record<string, unknown>) =>
    pipe.transform(payload, {
      type: 'body',
      metatype: CreateProductOrderDto,
    });

  it('accepts an optional UUID request id with positive integer quantities', async () => {
    await expect(
      validate({
        ...validPayload,
        requestId: '123e4567-e89b-42d3-a456-426614174000',
      }),
    ).resolves.toMatchObject({
      requestId: '123e4567-e89b-42d3-a456-426614174000',
      items: [{ quantity: 1 }],
    });
  });

  it.each([0, -1, 1.5])(
    'rejects a non-positive integer quantity: %s',
    async (quantity) => {
      await expect(
        validate({
          ...validPayload,
          items: [{ ...validPayload.items[0], quantity }],
        }),
      ).rejects.toThrow(BadRequestException);
    },
  );

  it('rejects a malformed request id', async () => {
    await expect(
      validate({ ...validPayload, requestId: 'not-a-uuid' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a malformed guest access capability and missing address', async () => {
    await expect(
      validate({ ...validPayload, guestAccessToken: 'sequential-77' }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      validate({
        ...validPayload,
        recipient: { ...validPayload.recipient, address: undefined },
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
