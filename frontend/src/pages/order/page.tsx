import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Navbar from "@/pages/home/components/Navbar";
import Footer from "@/pages/home/components/Footer";
import { ordersService, type OrderDetailsResponse } from "@/api-services/orders.service";
import {
  consumeGuestOrderAccessFragment,
  createGuestOrderStatusLink,
  getGuestOrderAccess,
} from "@/lib/guest-order-access";
import { useTranslation } from "react-i18next";

export default function OrderPage() {
  const { orderId = "" } = useParams<{ orderId: string }>();
  const { t } = useTranslation();
  const [order, setOrder] = useState<OrderDetailsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const accessTokenRef = useRef<string | null>(null);

  const loadOrder = useCallback(async () => {
    setLoading(true);
    setError(null);
    const token = accessTokenRef.current ?? getGuestOrderAccess(orderId);
    const result = await ordersService.getOrder(orderId, token);
    setOrder(result);
    if (!result) setError(t("order.accessError"));
    setLoading(false);
  }, [orderId, t]);

  useEffect(() => {
    accessTokenRef.current = consumeGuestOrderAccessFragment(orderId);
    void loadOrder();
  }, [loadOrder, orderId]);

  const chooseManual = async () => {
    if (acting) return;
    setActing(true);
    try {
      await ordersService.selectManualPayment(orderId, accessTokenRef.current);
      await loadOrder();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("order.actionError"));
    } finally {
      setActing(false);
    }
  };

  const chooseOnline = async () => {
    if (acting) return;
    setActing(true);
    try {
      const { url } = await ordersService.createOnlinePayment(
        orderId,
        accessTokenRef.current,
      );
      window.location.assign(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("order.actionError"));
      setActing(false);
    }
  };

  const copyGuestLink = async () => {
    const token = accessTokenRef.current ?? getGuestOrderAccess(orderId);
    if (token) {
      await navigator.clipboard.writeText(createGuestOrderStatusLink(orderId, token));
    }
  };

  const quoted = Boolean(order?.delivery_quote_confirmed_at);
  const unselected = order?.payment_provider === "unselected";
  const total = Number(order?.total_amount ?? 0);
  const reconciliation = order?.payment_reconciliation_status;

  return (
    <div className="min-h-screen bg-background-50">
      <Navbar />
      <main className="max-w-3xl mx-auto px-4 py-12 space-y-6">
        <Link to="/shop" className="text-sm text-primary-600">← {t("order.backToShop")}</Link>
        <section className="bg-white border border-background-200 rounded-2xl p-6 md:p-8 space-y-5">
          <div className="flex items-center justify-between gap-4">
            <h1 className="font-heading text-2xl">{t("order.title", { id: orderId })}</h1>
            {order && <span className="font-semibold">{t(`checkout.status.${order.status}`, { defaultValue: order.status })}</span>}
          </div>
          {loading && <p>{t("public.loading")}</p>}
          {error && <p role="alert" className="text-red-700">{error}</p>}
          {order && (
            <>
              {reconciliation && reconciliation !== "none" && (
                <div role="alert" className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-amber-900">
                  {t("order.paymentReview")}
                </div>
              )}
              {!quoted && order.status === "pending_payment" && (
                <p>{t("order.awaitingDeliveryQuote")}</p>
              )}
              {quoted && (
                <div className="rounded-xl bg-background-50 p-4 space-y-2">
                  <div className="flex justify-between"><span>{t("checkout.subtotal")}</span><strong>{Number(order.subtotal_items ?? 0).toFixed(2)} {order.currency}</strong></div>
                  <div className="flex justify-between"><span>{t("checkout.shipping")}</span><strong>{Number(order.delivery_fee ?? 0).toFixed(2)} {order.currency}</strong></div>
                  <div className="flex justify-between"><span>{t("checkout.total")}</span><strong>{total.toFixed(2)} {order.currency}</strong></div>
                  <p className="text-sm text-foreground-600">{t("order.deliveryEta", { eta: order.delivery_eta })}</p>
                </div>
              )}
              {quoted && unselected && order.status === "pending_payment" && reconciliation === "none" && (
                <div className="flex flex-wrap gap-3">
                  <button type="button" disabled={acting} onClick={() => void chooseManual()} className="px-5 py-2.5 rounded-full bg-secondary-100 font-semibold disabled:opacity-50">
                    {t("order.chooseManual")}
                  </button>
                  <button type="button" disabled={acting || total <= 0} onClick={() => void chooseOnline()} className="px-5 py-2.5 rounded-full bg-primary-500 text-white font-semibold disabled:opacity-50">
                    {t("order.payOnline")}
                  </button>
                  {total <= 0 && <p className="w-full text-sm text-foreground-500">{t("order.zeroOnlineUnavailable")}</p>}
                </div>
              )}
              {order.payment_provider === "manual" && order.status === "pending_payment" && (
                <p>{t("order.manualSelected")}</p>
              )}
              {order.payment_provider === "stripe" && order.status === "pending_payment" && reconciliation === "none" && (
                <div className="space-y-3">
                  <p>{t("order.onlineVerifying")}</p>
                  <button type="button" disabled={acting} onClick={() => void chooseOnline()} className="px-5 py-2.5 rounded-full bg-primary-500 text-white font-semibold disabled:opacity-50">
                    {t("order.resumeOnline")}
                  </button>
                </div>
              )}
              <div className="flex flex-wrap gap-3">
                <button type="button" onClick={() => void loadOrder()} className="px-4 py-2 rounded-full border border-background-300">
                  {t("order.refresh")}
                </button>
                {getGuestOrderAccess(orderId) && (
                  <button type="button" onClick={() => void copyGuestLink()} className="px-4 py-2 rounded-full border border-background-300">
                    {t("order.copyStatusLink")}
                  </button>
                )}
              </div>
            </>
          )}
        </section>
      </main>
      <Footer />
    </div>
  );
}
