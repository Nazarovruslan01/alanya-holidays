import React, { useCallback, useEffect, useState } from "react";
import { CreditCard, ExternalLink, Loader2 } from "lucide-react";
import {
  billingService,
  type MySubscription,
} from "@/api-services/billing.service";
import {
  UpgradeModal,
} from "@/pages/business/dashboard/components/UpgradeModal";
import { logger } from "@/lib/logger";
import { useTranslation } from "react-i18next";

const formatDate = (iso: string, locale: string): string =>
  new Date(iso).toLocaleDateString(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

export const BillingTab: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [subscription, setSubscription] = useState<MySubscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionInProgress, setActionInProgress] = useState<
    "cancel" | "portal" | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [plansOpen, setPlansOpen] = useState(false);

  const loadSubscription = useCallback(async () => {
    setLoading(true);
    try {
      setSubscription(await billingService.getMySubscription());
    } catch (err) {
      logger.warn("Failed to load subscription:", err);
      setError(t("settings.billingLoadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadSubscription();
  }, [loadSubscription]);

  const handleCancel = async () => {
    if (
      !window.confirm(
        t("settings.confirmCancelSubscription")
      )
    ) {
      return;
    }
    setActionInProgress("cancel");
    setError(null);
    try {
      await billingService.cancelSubscription();
      await loadSubscription();
    } catch (err) {
      logger.warn("Failed to cancel subscription:", err);
      setError(t("settings.billingCancelFailed"));
    } finally {
      setActionInProgress(null);
    }
  };

  const handlePortal = async () => {
    setActionInProgress("portal");
    setError(null);
    try {
      const { url } = await billingService.createPortalSession();
      window.location.href = url;
    } catch (err) {
      logger.warn("Failed to open billing portal:", err);
      setError(t("settings.billingPortalFailed"));
      setActionInProgress(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-secondary-400">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  const isActive =
    subscription &&
    ["active", "trialing"].includes(subscription.status);

  return (
    <div className="space-y-6" data-testid="billing-tab">
      <div className="rounded-2xl border border-secondary-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 space-y-4">
        <div className="flex items-center gap-2">
          <CreditCard className="w-5 h-5 text-primary-500" />
          <h3 className="text-lg font-bold font-display text-secondary-900 dark:text-white">
            {t("settings.subscription")}
          </h3>
        </div>

        {error && (
          <div
            role="alert"
            className="p-3 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm"
          >
            {error}
          </div>
        )}

        {isActive && subscription ? (
          <div className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl bg-background-50 dark:bg-slate-800/60 p-3">
                <p className="text-xs uppercase tracking-wider text-secondary-400">
                  {t("settings.plan")}
                </p>
                <p className="font-semibold text-secondary-900 dark:text-white capitalize">
                  {subscription.tier || subscription.plan} ·{" "}
                  {subscription.plan}
                </p>
              </div>
              <div className="rounded-xl bg-background-50 dark:bg-slate-800/60 p-3">
                <p className="text-xs uppercase tracking-wider text-secondary-400">
                  {subscription.cancel_at_period_end
                    ? t("settings.accessUntil")
                    : t("settings.renewsOn")}
                </p>
                <p className="font-semibold text-secondary-900 dark:text-white">
                  {formatDate(subscription.current_period_end, i18n.language)}
                </p>
              </div>
            </div>

            {subscription.cancel_at_period_end && (
              <p className="text-sm text-amber-700 dark:text-amber-300">
                {t("settings.cancelledUntil", { date: formatDate(subscription.current_period_end, i18n.language) })}
              </p>
            )}

            <div className="flex flex-wrap gap-3">
              {!subscription.cancel_at_period_end && (
                <button
                  type="button"
                  onClick={handleCancel}
                  disabled={actionInProgress !== null}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-60 transition-all cursor-pointer"
                >
                  {actionInProgress === "cancel" && (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  )}
                  {t("settings.cancelSubscription")}
                </button>
              )}
              <button
                type="button"
                onClick={handlePortal}
                disabled={actionInProgress !== null}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border border-secondary-200 dark:border-slate-700 text-secondary-700 dark:text-slate-300 hover:border-primary-300 disabled:opacity-60 transition-all cursor-pointer"
              >
                {actionInProgress === "portal" ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <ExternalLink className="w-4 h-4" />
                )}
                {t("settings.manageBilling")}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-secondary-500 dark:text-slate-400">
              {t("settings.noSubscription")}
            </p>
            <button
              type="button"
              onClick={() => setPlansOpen(true)}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-primary-500 hover:bg-primary-600 text-white transition-all cursor-pointer"
            >
              {t("settings.viewPlans")}
            </button>
          </div>
        )}
      </div>

      <UpgradeModal
        isOpen={plansOpen}
        onClose={() => {
          setPlansOpen(false);
          void loadSubscription();
        }}
      />
    </div>
  );
};
