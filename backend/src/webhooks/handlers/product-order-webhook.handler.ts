import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { ProductOrderPaymentsRepository } from '../product-order-payments.repository';

@Injectable()
export class ProductOrderWebhookHandler {
  private readonly logger = new Logger(ProductOrderWebhookHandler.name);

  constructor(
    private readonly paymentsRepository: ProductOrderPaymentsRepository,
  ) {}

  async handleCheckoutSession(session: Stripe.Checkout.Session): Promise<void> {
    if (session.payment_status !== 'paid') return;

    const orderId = Number(session.metadata?.orderId);
    const quoteConfirmedAt = session.metadata?.quoteConfirmedAt;
    if (
      !Number.isSafeInteger(orderId) ||
      orderId <= 0 ||
      !quoteConfirmedAt ||
      session.amount_total == null ||
      !session.currency
    ) {
      throw new Error('Product order checkout metadata is incomplete');
    }
    const paymentIntentId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : (session.payment_intent?.id ?? null);
    const outcome = await this.paymentsRepository.confirmStripePayment({
      orderId,
      sessionId: session.id,
      amount: session.amount_total / 100,
      currency: session.currency.toUpperCase(),
      quoteConfirmedAt,
      paymentIntentId,
    });
    if (outcome !== 'paid') {
      this.logger.warn(
        `Product order ${orderId} payment requires reconciliation: ${outcome}`,
      );
    }
  }
}
