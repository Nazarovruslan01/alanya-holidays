import { useEffect, useRef, useState, type FormEvent } from "react";
import type { User } from "@supabase/supabase-js";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import RegistrationPage from "@/pages/register/RegistrationPage";
import PageHeroImage from "@/components/base/PageHeroImage";
import { useAuth } from "@/context/AuthContext";
import {
  businessApplicationsService,
  type BusinessApplication,
} from "@/api-services/business-applications.service";
import {
  businessRegistrationSchema,
  loginSchema,
} from "@/lib/validation/auth.schemas";

const applicationStatusStyles = {
  pending: "bg-amber-50 text-amber-800 border-amber-200",
  approved: "bg-emerald-50 text-emerald-800 border-emerald-200",
  rejected: "bg-red-50 text-red-800 border-red-200",
  withdrawn: "bg-slate-100 text-slate-700 border-slate-300",
} as const;

function LoadingState() {
  const { t } = useTranslation();

  return (
    <main className="min-h-screen bg-background-50 flex items-center justify-center">
      <p role="status" className="text-sm text-foreground-500">
        {t("common.loading")}
      </p>
    </main>
  );
}

function ExistingApplication({ application }: { application: BusinessApplication }) {
  const { t } = useTranslation();
  const statusClass = applicationStatusStyles[application.status];

  return (
    <main className="min-h-screen bg-background-50 px-4 py-16">
      <section
        aria-label={t("merchant.businessApplication")}
        className={`mx-auto max-w-xl rounded-2xl border p-6 ${statusClass}`}
      >
        <p className="text-xs font-semibold uppercase tracking-wide">
          {t("merchant.businessApplication")}
        </p>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xl font-semibold">{application.businessName}</p>
          <span className="rounded-full border border-current/20 px-3 py-1 text-xs font-bold capitalize">
            {application.status}
          </span>
        </div>
        {application.status === "rejected" && application.rejectionReason && (
          <p className="mt-3 text-sm">{application.rejectionReason}</p>
        )}
        <Link
          to="/business/dashboard"
          className="mt-6 inline-flex rounded-full bg-foreground-900 px-4 py-2 text-sm font-medium text-white hover:bg-foreground-800"
        >
          {t("merchant.dashboard")}
        </Link>
      </section>
    </main>
  );
}

function BusinessApplicationForm({ user }: { user: User }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [businessName, setBusinessName] = useState("");
  const [accountType, setAccountType] = useState("seller");
  const [contactEmail, setContactEmail] = useState(user.email ?? "");
  const [contactPhone, setContactPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const mountedRef = useRef(true);
  const currentUserIdRef = useRef(user.id);

  useEffect(() => {
    mountedRef.current = true;
    currentUserIdRef.current = user.id;
    return () => {
      mountedRef.current = false;
    };
  }, [user.id]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;
    setError("");

    const businessValidation = businessRegistrationSchema.safeParse({
      businessName,
      accountType,
      contactPhone,
      website,
    });
    const emailValidation = loginSchema.shape.email.safeParse(contactEmail);

    if (!businessValidation.success) {
      setError(businessValidation.error.issues[0]?.message || t("common.tryAgain"));
      return;
    }
    if (!emailValidation.success) {
      setError(emailValidation.error.issues[0]?.message || t("common.tryAgain"));
      return;
    }

    setIsSubmitting(true);
    const submittingUserId = user.id;
    try {
      const details = businessValidation.data;
      await businessApplicationsService.create({
        businessName: details.businessName,
        accountType: details.accountType,
        contactEmail: emailValidation.data,
        ...(details.contactPhone ? { contactPhone: details.contactPhone } : {}),
        ...(details.website ? { website: details.website } : {}),
      });
      if (!mountedRef.current || currentUserIdRef.current !== submittingUserId) return;
      navigate("/business/dashboard", { replace: true });
    } catch (submissionError: unknown) {
      if (!mountedRef.current || currentUserIdRef.current !== submittingUserId) return;
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "Failed to submit business application. Please try again.",
      );
    } finally {
      if (mountedRef.current && currentUserIdRef.current === submittingUserId) {
        setIsSubmitting(false);
      }
    }
  };

  return (
    <main className="min-h-screen bg-background-50">
      <section className="relative h-[220px] w-full overflow-hidden md:h-[280px]">
        <PageHeroImage page="register" alt="Alanya Morning" />
        <div className="absolute inset-0 bg-gradient-to-b from-foreground-950/50 via-foreground-950/25 to-foreground-950/70" />
        <div className="absolute bottom-0 left-0 right-0 px-4 pb-8 md:px-8 lg:px-12">
          <div className="mb-3 flex items-center gap-2">
            <Link to="/" className="text-sm text-white/60 underline-offset-2 hover:text-white/90 hover:underline">
              {t("nav.home", "Home")}
            </Link>
            <i className="ri-arrow-right-s-line text-sm text-white/40" />
            <span className="text-sm text-white/90">{t("auth.businessRegistration")}</span>
          </div>
          <h1 className="font-heading text-3xl text-white md:text-4xl">
            {t("auth.createBusinessAccount")}
          </h1>
          <p className="mt-1 max-w-md text-sm text-white/65 md:text-base">
            {t("auth.businessSubtitle")}
          </p>
        </div>
      </section>

      <section className="relative z-10 mx-auto -mt-8 w-full max-w-md px-4 pb-20">
        <div className="rounded-2xl border border-background-200/70 bg-background-50 p-6 md:p-8">
          {error && (
            <div role="alert" className="mb-5 flex items-center gap-2 rounded-lg border border-accent-300/50 bg-accent-100/70 px-4 py-3">
              <i className="ri-error-warning-line text-sm text-accent-600" />
              <p className="text-sm text-accent-800">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="business-application-name" className="mb-1.5 block text-sm font-medium text-foreground-700">
                {t("auth.businessName")}
              </label>
              <input
                id="business-application-name"
                required
                value={businessName}
                onChange={(event) => setBusinessName(event.target.value)}
                placeholder={t("auth.businessNamePlaceholder")}
                className="h-11 w-full rounded-lg border border-background-200 bg-background-50 px-4 text-sm text-foreground-900 placeholder:text-foreground-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100"
              />
            </div>

            <div>
              <label htmlFor="business-application-type" className="mb-1.5 block text-sm font-medium text-foreground-700">
                {t("auth.accountType")}
              </label>
              <select
                id="business-application-type"
                required
                value={accountType}
                onChange={(event) => setAccountType(event.target.value)}
                className="h-11 w-full rounded-lg border border-background-200 bg-background-50 px-4 text-sm text-foreground-900 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100"
              >
                <option value="seller">{t("auth.seller")}</option>
                <option value="service_provider">{t("auth.serviceProvider")}</option>
                <option value="property_host">{t("auth.propertyHost")}</option>
                <option value="directory_owner">{t("auth.directoryOwner")}</option>
              </select>
            </div>

            <div>
              <label htmlFor="business-application-email" className="mb-1.5 block text-sm font-medium text-foreground-700">
                {t("auth.email")}
              </label>
              <input
                id="business-application-email"
                type="email"
                required
                value={contactEmail}
                onChange={(event) => setContactEmail(event.target.value)}
                className="h-11 w-full rounded-lg border border-background-200 bg-background-50 px-4 text-sm text-foreground-900 placeholder:text-foreground-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100"
              />
            </div>

            <div>
              <label htmlFor="business-application-phone" className="mb-1.5 block text-sm font-medium text-foreground-700">
                {t("auth.contactPhone")} <span className="text-foreground-400">{t("auth.optional")}</span>
              </label>
              <input
                id="business-application-phone"
                type="tel"
                value={contactPhone}
                onChange={(event) => setContactPhone(event.target.value)}
                placeholder={t("auth.phonePlaceholder")}
                className="h-11 w-full rounded-lg border border-background-200 bg-background-50 px-4 text-sm text-foreground-900 placeholder:text-foreground-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100"
              />
            </div>

            <div>
              <label htmlFor="business-application-website" className="mb-1.5 block text-sm font-medium text-foreground-700">
                {t("auth.website")} <span className="text-foreground-400">{t("auth.optional")}</span>
              </label>
              <input
                id="business-application-website"
                type="url"
                value={website}
                onChange={(event) => setWebsite(event.target.value)}
                placeholder={t("auth.websitePlaceholder")}
                className="h-11 w-full rounded-lg border border-background-200 bg-background-50 px-4 text-sm text-foreground-900 placeholder:text-foreground-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100"
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="h-11 w-full rounded-full bg-primary-500 text-sm font-medium text-background-50 transition-colors hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? t("common.loading") : t("common.submit")}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}

function AuthenticatedBusinessRegister({ user }: { user: User }) {
  const { t } = useTranslation();
  const [application, setApplication] = useState<BusinessApplication | null>(null);
  const [applicationUserId, setApplicationUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryToken, setRetryToken] = useState(0);
  const requestIdRef = useRef(0);
  const currentUserIdRef = useRef<string | null>(null);

  currentUserIdRef.current = user.id;

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    let active = true;
    setApplication(null);
    setApplicationUserId(user.id);
    setLoading(true);
    setError("");

    void businessApplicationsService
      .getMine()
      .then((result) => {
        if (!active || requestIdRef.current !== requestId || currentUserIdRef.current !== user.id) {
          return;
        }
        setApplication(result);
        setLoading(false);
      })
      .catch((requestError: unknown) => {
        if (!active || requestIdRef.current !== requestId || currentUserIdRef.current !== user.id) {
          return;
        }
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Failed to load your business application. Please try again.",
        );
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [user.id, retryToken]);

  if (loading || applicationUserId !== user.id) {
    return <LoadingState />;
  }

  if (error) {
    return (
      <main className="min-h-screen bg-background-50 flex items-center justify-center px-4">
        <section role="alert" className="max-w-md rounded-2xl border border-accent-200 bg-accent-50 p-6 text-center">
          <p className="text-sm text-accent-800">{error}</p>
          <button
            type="button"
            onClick={() => setRetryToken((value) => value + 1)}
            className="mt-4 rounded-full bg-primary-500 px-4 py-2 text-sm font-medium text-white"
          >
            {t("common.tryAgain")}
          </button>
        </section>
      </main>
    );
  }

  if (application && application.userId === user.id) {
    return <ExistingApplication application={application} />;
  }

  return <BusinessApplicationForm user={user} />;
}

export default function BusinessRegisterPage() {
  const { user, loading: authLoading } = useAuth();

  if (authLoading) return <LoadingState />;
  if (!user) return <RegistrationPage variant="business" />;
  return <AuthenticatedBusinessRegister user={user} />;
}
