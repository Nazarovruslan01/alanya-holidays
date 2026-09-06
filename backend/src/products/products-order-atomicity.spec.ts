import { Test, TestingModule } from '@nestjs/testing';
import { ProductsRepository } from './products.repository';
import { SupabaseService } from '../supabase/supabase.service';
import { CreateProductOrderDto } from './dto/create-product-order.dto';

/**
 * Adversarial atomicity tests for createProductOrder persistence (audit 2.2):
 * order header + items must be inserted atomically via a single DB RPC so a
 * failure can never leave an orphaned order_headers row without order_items.
 */
describe('ProductsRepository - atomic order creation', () => {
  let repository: ProductsRepository;
  let mockSupabaseClient: {
    from: jest.Mock;
    rpc: jest.Mock;
  };

  const dto = (items: Array<Record<string, unknown>>): CreateProductOrderDto =>
    ({
      currency: 'EUR',
      subtotal: 100,
      recipient: {
        name: 'John Smith',
        email: 'john@example.com',
        phone: '+905559876543',
        contact_method: 'email',
      },
      items,
    }) as never;

  beforeEach(async () => {
    mockSupabaseClient = {
      from: jest.fn(),
      rpc: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsRepository,
        {
          provide: SupabaseService,
          useValue: { getClient: () => mockSupabaseClient },
        },
      ],
    }).compile();

    repository = module.get<ProductsRepository>(ProductsRepository);
  });

  it('should create the order through the atomic create_product_order RPC', async () => {
    mockSupabaseClient.rpc.mockResolvedValueOnce({
      data: { data: 42 },
      error: null,
    });

    const result = await repository.createProductOrder(
      dto([
        {
          productId: 1,
          productName: 'Handmade Carpet',
          quantity: 1,
          unitPrice: 100,
          finalPrice: 100,
          subtotal: 100,
        },
      ]),
      '12345678-1234-1234-1234-123456789abc',
    );

    expect(mockSupabaseClient.rpc).toHaveBeenCalledWith(
      'create_product_order',
      expect.objectContaining({
        p_currency: 'EUR',
        p_subtotal: 100,
        p_customer_id: '12345678-1234-1234-1234-123456789abc',
        p_request_id: null,
        p_request_payload: null,
      }),
    );
    // Header/items must not be inserted via separate table calls anymore.
    expect(mockSupabaseClient.from).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: true,
      orderId: 42,
      message: 'Order placed successfully',
    });
  });

  it('should propagate RPC failure so no partial order is persisted', async () => {
    mockSupabaseClient.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'items insert failed' },
    });

    await expect(
      repository.createProductOrder(
        dto([
          {
            productId: 1,
            productName: 'Handmade Carpet',
            quantity: 1,
            unitPrice: 100,
            finalPrice: 100,
            subtotal: 100,
          },
        ]),
        undefined,
      ),
    ).rejects.toThrow('items insert failed');
  });

  it('should pass guest orders with null customer_id to the RPC', async () => {
    mockSupabaseClient.rpc.mockResolvedValueOnce({
      data: { data: 7 },
      error: null,
    });

    const result = await repository.createProductOrder(
      dto([
        {
          productId: 1,
          productName: 'Handmade Carpet',
          quantity: 1,
          unitPrice: 100,
          finalPrice: 100,
          subtotal: 100,
        },
      ]),
      'not-a-uuid',
    );

    expect(mockSupabaseClient.rpc).toHaveBeenCalledWith(
      'create_product_order',
      expect.objectContaining({ p_customer_id: null }),
    );
    expect(result.orderId).toBe(7);
  });

  it('should pass keyed request metadata and expose reservation expiry', async () => {
    mockSupabaseClient.rpc.mockResolvedValueOnce({
      data: {
        data: 42,
        status: 'pending_payment',
        expires_at: '2026-09-06T12:00:00.000Z',
      },
      error: null,
    });
    const order = dto([
      {
        productId: 1,
        productName: 'Handmade Carpet',
        quantity: 1,
        unitPrice: 100,
        finalPrice: 100,
        subtotal: 100,
      },
    ]);
    order.requestId = '123e4567-e89b-42d3-a456-426614174000';
    const requestPayload = { original: 'request' };

    await expect(
      repository.createProductOrder(order, undefined, requestPayload),
    ).resolves.toEqual({
      success: true,
      orderId: 42,
      status: 'pending_payment',
      expiresAt: '2026-09-06T12:00:00.000Z',
      message: 'Order placed successfully',
    });
    expect(mockSupabaseClient.rpc).toHaveBeenCalledWith(
      'create_product_order',
      expect.objectContaining({
        p_request_id: order.requestId,
        p_request_payload: requestPayload,
      }),
    );
  });

  it('should query idempotent replay without reading order tables', async () => {
    mockSupabaseClient.rpc.mockResolvedValueOnce({
      data: { data: 42, status: 'pending_payment' },
      error: null,
    });

    await expect(
      repository.getProductOrderReplay(
        '123e4567-e89b-42d3-a456-426614174000',
        { original: 'request' },
        '12345678-1234-1234-1234-123456789abc',
      ),
    ).resolves.toMatchObject({ orderId: 42, status: 'pending_payment' });
    expect(mockSupabaseClient.rpc).toHaveBeenCalledWith(
      'get_product_order_replay',
      {
        p_request_id: '123e4567-e89b-42d3-a456-426614174000',
        p_customer_id: '12345678-1234-1234-1234-123456789abc',
        p_request_payload: { original: 'request' },
        p_guest_access_token_hash: null,
      },
    );
    expect(mockSupabaseClient.from).not.toHaveBeenCalled();
  });

  it('should transition status through the atomic lifecycle RPC', async () => {
    mockSupabaseClient.rpc.mockResolvedValueOnce({
      data: { id: 42, status: 'cancelled' },
      error: null,
    });

    await expect(
      repository.updateOrderStatus(42, 'cancelled', 'pending_payment'),
    ).resolves.toEqual({ id: 42, status: 'cancelled' });
    expect(mockSupabaseClient.rpc).toHaveBeenCalledWith(
      'transition_product_order_status',
      {
        p_order_id: 42,
        p_expected_current_status: 'pending_payment',
        p_new_status: 'cancelled',
      },
    );
    expect(mockSupabaseClient.from).not.toHaveBeenCalled();
  });
});
