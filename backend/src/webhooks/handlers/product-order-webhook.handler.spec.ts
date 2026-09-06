import Stripe from 'stripe';
import { ProductOrderWebhookHandler } from './product-order-webhook.handler';
import { ProductOrderPaymentsRepository } from '../product-order-payments.repository';

describe('ProductOrderWebhookHandler', () => {
  const repository = {
    confirmStripePayment: jest.fn(),
  };
  const handler = new ProductOrderWebhookHandler(
    repository as unknown as ProductOrderPaymentsRepository,
  );

  beforeEach(() => jest.clearAllMocks());

  it('settles only a paid session using trusted Stripe amounts and stored-session identifiers', async () => {
    repository.confirmStripePayment.mockResolvedValueOnce('paid');
    const session = {
      id: 'cs_order_77',
      payment_status: 'paid',
      amount_total: 5850,
      currency: 'eur',
      payment_intent: 'pi_77',
      metadata: {
        type: 'product_order',
        orderId: '77',
        quoteConfirmedAt: '2026-09-06T10:00:00.000Z',
      },
    } as unknown as Stripe.Checkout.Session;

    await handler.handleCheckoutSession(session);

    expect(repository.confirmStripePayment).toHaveBeenCalledWith({
      orderId: 77,
      sessionId: 'cs_order_77',
      amount: 58.5,
      currency: 'EUR',
      quoteConfirmedAt: '2026-09-06T10:00:00.000Z',
      paymentIntentId: 'pi_77',
    });
  });

  it('does not trust an unpaid checkout completion', async () => {
    await handler.handleCheckoutSession({
      id: 'cs_unpaid',
      payment_status: 'unpaid',
      metadata: { type: 'product_order', orderId: '77' },
    } as unknown as Stripe.Checkout.Session);

    expect(repository.confirmStripePayment).not.toHaveBeenCalled();
  });
});
