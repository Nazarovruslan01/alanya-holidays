import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import Stripe from 'stripe';
import { createHash } from 'crypto';

process.env.STRIPE_SECRET_KEY ||= 'sk_test_product_order_e2e';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_product_order_e2e';

import { GlobalHttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { ProductsController } from '../src/products/products.controller';
import { ProductsService } from '../src/products/products.service';
import { ProductsRepository } from '../src/products/products.repository';
import { ProductDraftsService } from '../src/products/product-drafts.service';
import { BillingService } from '../src/billing/billing.service';
import { AuthGuard } from '../src/auth/auth.guard';
import { OptionalAuthGuard } from '../src/auth/optional-auth.guard';
import { AuthTokenService } from '../src/auth/auth-token.service';
import { UserRolesRepository } from '../src/common/auth/user-roles.repository';
import { SupabaseService } from '../src/supabase/supabase.service';
import { RedisService } from '../src/common/redis/redis.service';
import { StripeWebhookController } from '../src/webhooks/stripe-webhook.controller';
import { StripeWebhookService } from '../src/webhooks/stripe-webhook.service';
import { StripePaymentAdapter } from '../src/webhooks/adapters/stripe-payment.adapter';
import { PAYMENT_GATEWAY } from '../src/webhooks/domain/payment-gateway.interface';
import { AddonWebhookHandler } from '../src/webhooks/handlers/addon-webhook.handler';
import { SubscriptionWebhookHandler } from '../src/webhooks/handlers/subscription-webhook.handler';
import { BookingWebhookHandler } from '../src/webhooks/handlers/booking-webhook.handler';
import { ProductOrderWebhookHandler } from '../src/webhooks/handlers/product-order-webhook.handler';
import { ProductOrderPaymentsRepository } from '../src/webhooks/product-order-payments.repository';
import { ProcessedStripeEventsRepository } from '../src/webhooks/processed-stripe-events.repository';

type HttpApp = Parameters<typeof request>[0];

interface TestOrder {
  id: number;
  customer_id?: string;
  currency: string;
  status: string;
  subtotal_items: number;
  total_amount: number;
  recipient: Record<string, unknown>;
  items: Array<{ product_id: number; quantity: number }>;
  delivery_fee?: number;
  delivery_eta?: string;
  delivery_quote_confirmed_at?: string;
  checkout_expires_at?: string;
  stripe_session_id?: string;
}

const BUYER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_BUYER_ID = '22222222-2222-4222-8222-222222222222';
const SELLER_ID = '33333333-3333-4333-8333-333333333333';
const GUEST_ACCESS_TOKEN = 'g'.repeat(43);
const WRONG_GUEST_ACCESS_TOKEN = 'w'.repeat(43);
const GUEST_ORDER_ID = 101;
const BUYER_ORDER_ID = 102;

describe('Product order HTTP flow (e2e)', () => {
  jest.setTimeout(30000);

  let app: INestApplication;
  let httpApp: HttpApp;

  const stripe = new Stripe(
    process.env.STRIPE_SECRET_KEY ?? 'sk_test_product_order_e2e',
    { apiVersion: '2026-06-24.dahlia' },
  );
  const orders = new Map<number, TestOrder>();
  const guestAccessHashes = new Map<number, string>();
  const claimedEvents = new Set<string>();

  const authGetUserMock = jest.fn();
  const userRolesRepositoryFake = {
    getRole: jest.fn().mockResolvedValue('user'),
  };
  const billingServiceFake = {
    hasActivePremiumAccess: jest.fn().mockResolvedValue(true),
    createProductOrderCheckout: jest.fn().mockResolvedValue({
      url: 'https://checkout.stripe.test/session',
      sessionId: 'cs_product_order_e2e',
      expiresAt: '2026-09-06T10:30:00.000Z',
    }),
  };
  const productOrderPaymentsFake = {
    confirmStripePayment: jest.fn().mockResolvedValue('paid'),
  };
  const processedEventsFake = {
    tryClaimEvent: jest.fn((eventId: string) => {
      if (claimedEvents.has(eventId)) return Promise.resolve(false);
      claimedEvents.add(eventId);
      return Promise.resolve(true);
    }),
    releaseEvent: jest.fn((eventId: string) => {
      claimedEvents.delete(eventId);
      return Promise.resolve();
    }),
  };

  const productsRepositoryFake = {
    getOrderById: jest.fn((orderId: string | number) =>
      Promise.resolve(orders.get(Number(orderId)) ?? null),
    ),
    getOrderByGuestAccess: jest.fn(
      (orderId: string | number, guestAccessTokenHash: string) => {
        const id = Number(orderId);
        return Promise.resolve(
          guestAccessHashes.get(id) === guestAccessTokenHash
            ? (orders.get(id) ?? null)
            : null,
        );
      },
    ),
    sellerOwnsAllCatalogItems: jest.fn((itemIds: string[], userId: string) =>
      Promise.resolve(
        userId === SELLER_ID && itemIds.every((id) => id === '1'),
      ),
    ),
    confirmDeliveryQuote: jest.fn(
      (orderId: string | number, deliveryFee: number, deliveryEta: string) => {
        const order = orders.get(Number(orderId));
        if (!order) throw new Error('Delivery quote order not found');
        order.delivery_fee = deliveryFee;
        order.delivery_eta = deliveryEta;
        order.delivery_quote_confirmed_at = '2026-09-06T10:00:00.000Z';
        order.total_amount = order.subtotal_items + deliveryFee;
        return Promise.resolve({
          delivery_fee: deliveryFee,
          delivery_eta: deliveryEta,
          delivery_quote_confirmed_at: order.delivery_quote_confirmed_at,
          total_amount: order.total_amount,
        });
      },
    ),
    beginOnlinePayment: jest.fn((orderId: string | number) => {
      const order = orders.get(Number(orderId));
      if (!order?.delivery_quote_confirmed_at) {
        throw new Error('Payment requires a confirmed delivery quote');
      }
      order.checkout_expires_at = '2026-09-06T10:30:00.000Z';
      return Promise.resolve({
        id: order.id,
        currency: order.currency,
        total_amount: order.total_amount,
        recipient: order.recipient,
        delivery_quote_confirmed_at: order.delivery_quote_confirmed_at,
        checkout_expires_at: order.checkout_expires_at,
      });
    }),
    attachOnlinePaymentSession: jest.fn(
      (orderId: string | number, sessionId: string) => {
        const order = orders.get(Number(orderId));
        if (order) order.stripe_session_id = sessionId;
        return Promise.resolve(order ?? null);
      },
    ),
  };

  function makeOrder(id: number, customerId?: string): TestOrder {
    return {
      id,
      ...(customerId ? { customer_id: customerId } : {}),
      currency: 'EUR',
      status: 'pending_payment',
      subtotal_items: 25,
      total_amount: 25,
      recipient: {
        name: 'Guest Buyer',
        email: 'guest@example.com',
        phone: '+905551234567',
        address: '10 Harbour Road',
        contact_method: 'email',
      },
      items: [{ product_id: 1, quantity: 1 }],
    };
  }

  async function sendSignedProductWebhook(
    order: TestOrder,
    eventId = 'evt_product_order_e2e',
  ) {
    const event = {
      id: eventId,
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: order.stripe_session_id,
          object: 'checkout.session',
          payment_status: 'paid',
          amount_total: order.total_amount * 100,
          currency: order.currency.toLowerCase(),
          payment_intent: 'pi_product_order_e2e',
          metadata: {
            type: 'product_order',
            orderId: String(order.id),
            quoteConfirmedAt: order.delivery_quote_confirmed_at,
          },
        },
      },
    } as unknown as Stripe.Event;
    const payload = Buffer.from(JSON.stringify(event));
    const signature = await Promise.resolve(
      stripe.webhooks.generateTestHeaderString({
        payload: payload.toString(),
        secret: process.env.STRIPE_WEBHOOK_SECRET ?? 'whsec_product_order_e2e',
      }),
    );
    return request(httpApp)
      .post('/api/webhooks/stripe')
      .set('stripe-signature', signature)
      .set('Content-Type', 'application/json')
      .send(payload.toString());
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [ProductsController, StripeWebhookController],
      providers: [
        ProductsService,
        AuthGuard,
        OptionalAuthGuard,
        AuthTokenService,
        StripeWebhookService,
        ProductOrderWebhookHandler,
        { provide: ProductsRepository, useValue: productsRepositoryFake },
        { provide: ProductDraftsService, useValue: {} },
        { provide: BillingService, useValue: billingServiceFake },
        { provide: UserRolesRepository, useValue: userRolesRepositoryFake },
        {
          provide: ProductOrderPaymentsRepository,
          useValue: productOrderPaymentsFake,
        },
        {
          provide: ProcessedStripeEventsRepository,
          useValue: processedEventsFake,
        },
        { provide: PAYMENT_GATEWAY, useClass: StripePaymentAdapter },
        {
          provide: AddonWebhookHandler,
          useValue: { handleCheckoutSession: jest.fn() },
        },
        {
          provide: SubscriptionWebhookHandler,
          useValue: {
            handleCreated: jest.fn(),
            handleUpdated: jest.fn(),
            handleDeleted: jest.fn(),
            handleInvoicePaymentFailed: jest.fn(),
          },
        },
        {
          provide: BookingWebhookHandler,
          useValue: {
            handleCheckoutSession: jest.fn(),
            handlePaymentIntentFailed: jest.fn(),
            handleDisputeCreated: jest.fn(),
            handleChargeRefunded: jest.fn(),
          },
        },
        {
          provide: SupabaseService,
          useValue: {
            getClient: () => ({ auth: { getUser: authGetUserMock } }),
          },
        },
        {
          provide: RedisService,
          useValue: {
            getJson: jest.fn().mockResolvedValue(null),
            setJson: jest.fn().mockResolvedValue(undefined),
            del: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new GlobalHttpExceptionFilter());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    httpApp = app.getHttpAdapter().getInstance() as HttpApp;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    orders.clear();
    guestAccessHashes.clear();
    claimedEvents.clear();
    orders.set(GUEST_ORDER_ID, makeOrder(GUEST_ORDER_ID));
    orders.set(BUYER_ORDER_ID, makeOrder(BUYER_ORDER_ID, BUYER_ID));
    guestAccessHashes.set(
      GUEST_ORDER_ID,
      createHash('sha256').update(GUEST_ACCESS_TOKEN).digest('hex'),
    );
    authGetUserMock.mockImplementation((token: string) => {
      const users: Record<string, { id: string; email: string }> = {
        'buyer-token': { id: BUYER_ID, email: 'buyer@example.com' },
        'other-buyer-token': {
          id: OTHER_BUYER_ID,
          email: 'other@example.com',
        },
        'seller-token': { id: SELLER_ID, email: 'seller@example.com' },
      };
      return Promise.resolve({
        data: { user: users[token] ?? null },
        error: users[token] ? null : new Error('Invalid token'),
      });
    });
    productOrderPaymentsFake.confirmStripePayment.mockResolvedValue('paid');
  });

  afterAll(async () => {
    await app.close();
  });

  it('allows only the matching guest capability to read a guest order', async () => {
    await request(httpApp)
      .get(`/api/products/orders/${GUEST_ORDER_ID}`)
      .expect(404);
    await request(httpApp)
      .get(`/api/products/orders/${GUEST_ORDER_ID}`)
      .set('x-order-access-token', WRONG_GUEST_ACCESS_TOKEN)
      .expect(404);

    const visible = await request(httpApp)
      .get(`/api/products/orders/${GUEST_ORDER_ID}`)
      .set('x-order-access-token', GUEST_ACCESS_TOKEN)
      .expect(200);
    expect(visible.body).toMatchObject({
      id: GUEST_ORDER_ID,
      subtotal_items: 25,
    });
    expect(visible.body).not.toHaveProperty('customer_id');
  });

  it('isolates authenticated buyer order access', async () => {
    await request(httpApp)
      .get(`/api/products/orders/${BUYER_ORDER_ID}`)
      .set('Authorization', 'Bearer other-buyer-token')
      .expect(404);
    const visible = await request(httpApp)
      .get(`/api/products/orders/${BUYER_ORDER_ID}`)
      .set('Authorization', 'Bearer buyer-token')
      .expect(200);
    expect(visible.body.id).toBe(BUYER_ORDER_ID);
    expect(visible.body).not.toHaveProperty('customer_id');
  });

  it('enforces seller quote ownership before guest online payment and signed webhook settlement', async () => {
    await request(httpApp)
      .post(`/api/products/orders/${GUEST_ORDER_ID}/delivery-quote`)
      .set('Authorization', 'Bearer other-buyer-token')
      .send({ deliveryFee: 5.5, deliveryEta: 'Tomorrow 10-12' })
      .expect(401);
    await request(httpApp)
      .post(`/api/products/orders/${GUEST_ORDER_ID}/delivery-quote`)
      .set('Authorization', 'Bearer seller-token')
      .send({ deliveryFee: 5.5, deliveryEta: 'Tomorrow 10-12' })
      .expect(201);

    const checkout = await request(httpApp)
      .post(`/api/products/orders/${GUEST_ORDER_ID}/payment/online`)
      .set('x-order-access-token', GUEST_ACCESS_TOKEN)
      .expect(201);
    expect(checkout.body).toEqual({
      url: 'https://checkout.stripe.test/session',
    });
    expect(billingServiceFake.createProductOrderCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: GUEST_ORDER_ID,
        amount: 30.5,
        currency: 'EUR',
      }),
    );

    const order = orders.get(GUEST_ORDER_ID);
    expect(order).toBeDefined();
    await sendSignedProductWebhook(order as TestOrder).then((result) =>
      expect(result.status).toBe(200),
    );
    await sendSignedProductWebhook(order as TestOrder).then((result) =>
      expect(result.status).toBe(200),
    );

    expect(productOrderPaymentsFake.confirmStripePayment).toHaveBeenCalledTimes(
      1,
    );
    expect(productOrderPaymentsFake.confirmStripePayment).toHaveBeenCalledWith({
      orderId: GUEST_ORDER_ID,
      sessionId: 'cs_product_order_e2e',
      amount: 30.5,
      currency: 'EUR',
      quoteConfirmedAt: '2026-09-06T10:00:00.000Z',
      paymentIntentId: 'pi_product_order_e2e',
    });
  });
});
