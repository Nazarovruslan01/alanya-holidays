import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class ProductOrderPaymentsRepository {
  constructor(private readonly supabaseService: SupabaseService) {}

  async confirmStripePayment(params: {
    orderId: number;
    sessionId: string;
    amount: number;
    currency: string;
    quoteConfirmedAt: string;
    paymentIntentId: string | null;
  }): Promise<'paid' | 'late_payment' | 'mismatch'> {
    const { data, error } = (await this.supabaseService
      .getClient()
      .rpc('confirm_product_order_stripe_payment', {
        p_order_id: params.orderId,
        p_session_id: params.sessionId,
        p_amount: params.amount,
        p_currency: params.currency,
        p_quote_confirmed_at: params.quoteConfirmedAt,
        p_payment_intent_id: params.paymentIntentId,
      })) as {
      data: 'paid' | 'late_payment' | 'mismatch' | null;
      error: { message: string } | null;
    };
    if (error || !data) {
      throw new Error(
        error?.message || 'Product order payment was not recorded',
      );
    }
    return data;
  }
}
