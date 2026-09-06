import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { X, Sparkles, Rocket, MessageCircle, CheckCircle2, Loader2 } from "lucide-react";
import {
  billingService,
  type SubscriptionPlan,
} from "@/api-services/billing.service";
import { WHATSAPP_NUMBER } from "@/config/whatsapp";

export interface UpgradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  businessName?: string;
  currentTier?: string;
}

interface PlanCard {
  id: "voyager" | "custom";
  name: string;
  monthlyPrice: string;
  annualPrice: string;
  badge?: string;
  badgeColor?: string;
  description: string;
  icon: React.ReactNode;
  features: string[];
  highlighted?: boolean;
}

const getPlans = (t: import("i18next").TFunction): PlanCard[] => [
  {
    id: "voyager",
    name: "Voyager",
    monthlyPrice: "€19",
    annualPrice: "€190",
    badge: t("plans.growth"),
    badgeColor:
      "bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-950/60 dark:text-sky-300 dark:border-sky-800",
    description:
      t("plans.voyagerDescription"),
    icon: <Rocket className="w-5 h-5 text-sky-500" />,
    highlighted: true,
    features: [
      t("plans.priorityPlacement"),
      t("plans.directButtons"),
      t("plans.socialIntegration"),
      t("plans.video"),
      t("plans.bookingButton"),
      t("plans.fiftyPhotos"),
      t("plans.analytics"),
    ],
  },
  {
    id: "custom",
    name: "Custom",
    monthlyPrice: "~$100",
    annualPrice: "~$100",
    badge: t("plans.enterprise"),
    badgeColor:
      "bg-purple-100 text-purple-900 border-purple-300 dark:bg-purple-950/60 dark:text-purple-300 dark:border-purple-800",
    description:
      t("plans.customDescription"),
    icon: <MessageCircle className="w-5 h-5 text-purple-500" />,
    features: [
      t("plans.partnerBadge"),
      t("plans.aiLanguages"),
      t("plans.campaigns"),
      t("plans.manager"),
      t("plans.unlimitedPhotos"),
      t("plans.spotlight"),
    ],
  },
];

export const UpgradeModal: React.FC<UpgradeModalProps> = ({
  isOpen,
  onClose,
  businessName,
  currentTier = "explorer",
}) => {
  const { t } = useTranslation();
  const PLANS = getPlans(t);
  const [billingPeriod, setBillingPeriod] =
    useState<SubscriptionPlan>("monthly");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubscribeVoyager = async () => {
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const { url } = await billingService.createSubscriptionCheckout(
        billingPeriod
      );
      window.location.href = url;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Something went wrong";
      setErrorMessage(
        message.includes("already has an active subscription")
          ? t("plans.activeSubscription")
          : t("plans.checkoutFailed")
      );
      setIsSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="upgrade-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm overflow-y-auto"
    >
      <div className="relative w-full max-w-3xl rounded-2xl bg-white dark:bg-slate-900 border border-secondary-200 dark:border-slate-800 shadow-2xl overflow-hidden my-8">
        {/* Header */}
        <div className="relative px-6 pt-6 pb-5 border-b border-secondary-100 dark:border-slate-800 flex items-start justify-between">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 mb-2">
              <Sparkles className="w-3.5 h-3.5" />
              {t("plans.membership")}
            </div>
            <h2
              id="upgrade-modal-title"
              className="text-xl sm:text-2xl font-bold font-display text-secondary-900 dark:text-white"
            >
              {t("plans.chooseFor", { name: businessName || t("merchant.businessFallback") })}
            </h2>
            <p className="text-sm text-secondary-500 dark:text-slate-400">
              {t("plans.help")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="p-2 rounded-xl text-secondary-400 hover:text-secondary-700 dark:hover:text-white hover:bg-secondary-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5">
          {errorMessage && (
            <div
              role="alert"
              className="p-4 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm"
            >
              {errorMessage}
            </div>
          )}

          {/* Billing period toggle (applies to self-serve plan) */}
          <div className="flex items-center justify-center gap-2">
            {(["monthly", "annual"] as SubscriptionPlan[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setBillingPeriod(p)}
                className={`px-4 py-1.5 rounded-full text-xs font-semibold capitalize transition-colors cursor-pointer border ${
                  billingPeriod === p
                    ? "bg-primary-500 text-white border-primary-500"
                    : "bg-white dark:bg-slate-900 text-secondary-600 dark:text-slate-300 border-secondary-200 dark:border-slate-700 hover:border-primary-300"
                }`}
              >
                {t(`plans.${p}`)}
                {p === "annual" && (
                  <span className="ml-1.5 text-[10px] opacity-80">{t("plans.freeMonths")}</span>
                )}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {PLANS.map((plan) => {
              const isCurrent =
                currentTier?.toLowerCase() === plan.id.toLowerCase();
              const isSelfServe = plan.id === "voyager";
              const price = isSelfServe
                ? billingPeriod === "annual"
                  ? plan.annualPrice
                  : plan.monthlyPrice
                : plan.monthlyPrice;

              return (
                <div
                  key={plan.id}
                  className={`rounded-2xl border p-5 flex flex-col gap-4 ${
                    plan.highlighted
                      ? "border-primary-400 dark:border-primary-500/60 shadow-md"
                      : "border-secondary-200 dark:border-slate-700"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">{plan.icon}</div>
                    {plan.badge && (
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${plan.badgeColor}`}
                      >
                        {plan.badge}
                      </span>
                    )}
                  </div>

                  <div>
                    <h3 className="text-lg font-bold font-display text-secondary-900 dark:text-white">
                      {plan.name}
                      {isCurrent && (
                        <span className="ml-2 text-xs font-medium text-emerald-600 dark:text-emerald-400 align-middle">
                          {t("plans.current")}
                        </span>
                      )}
                    </h3>
                    <p className="text-sm text-secondary-500 dark:text-slate-400 mt-1">
                      {plan.description}
                    </p>
                  </div>

                  <div className="flex items-baseline gap-1.5">
                    <span className="text-3xl font-bold text-secondary-900 dark:text-white">
                      {price}
                    </span>
                    <span className="text-sm text-secondary-500">
                      / {t(isSelfServe && billingPeriod === "annual" ? "plans.annual" : "plans.monthly")}
                    </span>
                  </div>

                  <ul className="text-sm text-secondary-700 dark:text-slate-300 space-y-2 flex-1">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-start gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>

                  {isSelfServe ? (
                    <button
                      type="button"
                      disabled={isSubmitting || isCurrent}
                      onClick={handleSubscribeVoyager}
                      className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-primary-500 hover:bg-primary-600 disabled:opacity-60 text-white transition-all cursor-pointer"
                    >
                      {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                      {t("plans.subscribe")}{billingPeriod === "annual" ? t("plans.annualSuffix") : ""}
                    </button>
                  ) : (
                    <a
                      href={`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(t("plans.customInquiry"))}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-purple-600 hover:bg-purple-500 text-white transition-all cursor-pointer"
                    >
                      <MessageCircle className="w-4 h-4" />
                      {t("plans.whatsapp")}
                    </a>
                  )}
                </div>
              );
            })}
          </div>

          <p className="text-xs text-secondary-400 dark:text-slate-500 text-center">
            {t("plans.cancelHelp")}
          </p>
        </div>
      </div>
    </div>
  );
};
