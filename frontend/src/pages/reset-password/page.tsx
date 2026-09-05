import { FormEvent, useId, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import PageHeroImage from "@/components/base/PageHeroImage";
import { useAuth } from "@/context/AuthContext";
import { resetPasswordSchema } from "@/lib/validation/auth.schemas";

export default function ResetPasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { passwordRecoveryStatus, completePasswordRecovery } = useAuth();
  const passwordId = useId();
  const confirmationId = useId();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    const validation = resetPasswordSchema.safeParse({
      password,
      confirmPassword,
    });
    if (!validation.success) {
      setError(validation.error.issues[0]?.message ?? "Invalid password.");
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await completePasswordRecovery(validation.data.password);
      if (result.error) {
        setError(result.error.message);
        return;
      }

      navigate("/login", { replace: true });
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : t("auth.passwordResetFailed", "Failed to reset password. Please try again.")
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderContent = () => {
    if (passwordRecoveryStatus === "checking") {
      return (
        <div className="py-8 text-center" role="status" aria-live="polite">
          <i className="ri-loader-4-line mb-3 block animate-spin text-2xl text-primary-500" />
          <h2 className="font-heading text-xl text-foreground-900">
            {t("auth.checkingResetLink", "Checking reset link…")}
          </h2>
          <p className="mt-2 text-sm text-foreground-500">
            {t("auth.checkingResetLinkHelp", "Please wait while we verify your secure link.")}
          </p>
        </div>
      );
    }

    if (passwordRecoveryStatus === "invalid") {
      return (
        <div className="py-4 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-accent-100">
            <i className="ri-link-unlink-m text-xl text-accent-600" />
          </div>
          <h2 className="font-heading text-xl text-foreground-900">
            {t("auth.resetLinkUnavailable", "Reset link unavailable")}
          </h2>
          <p className="mt-2 text-sm text-foreground-500">
            {t(
              "auth.resetLinkInvalid",
              "This password reset link is invalid or has expired."
            )}
          </p>
          <Link
            to="/forgot-password"
            className="mt-6 inline-flex h-11 items-center justify-center rounded-full bg-primary-500 px-6 text-sm font-medium text-background-50 transition-colors hover:bg-primary-600"
          >
            {t("auth.requestAnotherResetLink", "Request another reset link")}
          </Link>
        </div>
      );
    }

    return (
      <>
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-accent-100">
            <i className="ri-lock-password-line text-xl text-accent-600" />
          </div>
          <h2 className="font-heading text-xl text-foreground-900">
            {t("auth.chooseNewPassword", "Choose a new password")}
          </h2>
          <p className="mt-1 text-sm text-foreground-500">
            {t("auth.newPasswordHelp", "Use at least 8 characters for your new password.")}
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="mb-5 flex items-center gap-2 rounded-lg border border-accent-300/50 bg-accent-100/70 px-4 py-3"
          >
            <i className="ri-error-warning-line text-sm text-accent-600" />
            <p className="text-sm text-accent-800">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor={passwordId} className="mb-1.5 block text-sm font-medium text-foreground-700">
              {t("auth.newPassword", "New password")}
            </label>
            <input
              id={passwordId}
              type="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="h-11 w-full rounded-lg border border-background-200 bg-background-50 px-4 text-sm text-foreground-900 transition-all focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100"
            />
          </div>

          <div>
            <label htmlFor={confirmationId} className="mb-1.5 block text-sm font-medium text-foreground-700">
              {t("auth.confirmPassword", "Confirm password")}
            </label>
            <input
              id={confirmationId}
              type="password"
              autoComplete="new-password"
              required
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className="h-11 w-full rounded-lg border border-background-200 bg-background-50 px-4 text-sm text-foreground-900 transition-all focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100"
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-full bg-primary-500 text-sm font-medium text-background-50 transition-colors hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting
              ? t("auth.updatingPassword", "Updating password…")
              : t("auth.setNewPassword", "Set new password")}
          </button>
        </form>
      </>
    );
  };

  return (
    <main className="min-h-screen bg-background-50">
      <section className="relative h-[220px] w-full overflow-hidden md:h-[280px]">
        <PageHeroImage page="forgotPassword" alt="Alanya landscape" />
        <div className="absolute inset-0 bg-gradient-to-b from-foreground-950/50 via-foreground-950/25 to-foreground-950/70" />
        <div className="absolute bottom-0 left-0 right-0 w-full px-4 pb-8 md:px-8 lg:px-12">
          <div className="mb-3 flex items-center gap-2">
            <Link to="/" className="text-sm text-white/60 underline underline-offset-2 transition-colors hover:text-white/90">
              {t("nav.home", "Home")}
            </Link>
            <i className="ri-arrow-right-s-line text-sm text-white/40" />
            <span className="text-sm text-white/90">
              {t("auth.resetPassword", "Reset Password")}
            </span>
          </div>
          <h1 className="font-heading text-3xl text-white md:text-4xl">
            {t("auth.resetYourPassword", "Reset your password")}
          </h1>
        </div>
      </section>

      <section className="relative z-10 mx-auto -mt-8 w-full max-w-md px-4 pb-20">
        <div className="rounded-2xl border border-background-200/70 bg-background-50 p-6 md:p-8">
          {renderContent()}
        </div>
      </section>
    </main>
  );
}
