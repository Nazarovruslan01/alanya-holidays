import React, { useState, useEffect, useId, useRef } from "react";
import {
  User,
  Image as ImageIcon,
  Phone,
  Building,
  Globe,
  Instagram,
  Send,
  MessageSquare,
  Twitter,
  Save,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { useAuth, type UserProfile } from "@/context/AuthContext";
import { useTranslation } from "react-i18next";
import { uploadAvatarImage } from "@/api-services/storage.service";

export interface ProfileTabProps {
  profile: UserProfile | null;
  onProfileUpdated?: (updatedProfile: UserProfile) => void;
}

interface SocialLinksState {
  instagram: string;
  telegram: string;
  whatsapp: string;
  website: string;
  twitter: string;
}

const PRESET_AVATARS = [
  "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=300&q=80",
  "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=300&q=80",
  "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=300&q=80",
  "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=300&q=80",
  "https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=300&q=80",
];

export const ProfileTab: React.FC<ProfileTabProps> = ({ profile, onProfileUpdated }) => {
  const { t } = useTranslation();
  const { updateProfile, user } = useAuth();
  const profileIdentity = `${user?.id ?? ""}:${profile?.id ?? ""}`;
  const profileIsReady = Boolean(user?.id && profile?.id === user.id);

  const fullNameId = useId();
  const avatarUrlId = useId();
  const bioId = useId();
  const phoneId = useId();
  const companyId = useId();
  const instagramId = useId();
  const telegramId = useId();
  const whatsappId = useId();
  const websiteId = useId();
  const twitterId = useId();

  const [fullName, setFullName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null);
  const [isAvatarUploading, setIsAvatarUploading] = useState(false);
  const [bio, setBio] = useState("");
  const [phone, setPhone] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [socials, setSocials] = useState<SocialLinksState>({
    instagram: "",
    telegram: "",
    whatsapp: "",
    website: "",
    twitter: "",
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const avatarUploadTokenRef = useRef(0);
  const avatarObjectUrlRef = useRef<string | null>(null);
  const profileIdentityRef = useRef(profileIdentity);
  const profileReadyRef = useRef(profileIsReady);
  if (profileIdentityRef.current !== profileIdentity) {
    profileIdentityRef.current = profileIdentity;
    avatarUploadTokenRef.current += 1;
  }
  profileReadyRef.current = profileIsReady;

  const revokeAvatarPreview = React.useCallback(() => {
    if (avatarObjectUrlRef.current) {
      URL.revokeObjectURL(avatarObjectUrlRef.current);
      avatarObjectUrlRef.current = null;
    }
    setAvatarPreviewUrl(null);
  }, []);

  const invalidateAvatarUpload = React.useCallback(() => {
    avatarUploadTokenRef.current += 1;
    revokeAvatarPreview();
    setIsAvatarUploading(false);
  }, [revokeAvatarPreview]);

  const populateFromProfile = React.useCallback((p: UserProfile | null) => {
    if (!p) return;
    setFullName(p.full_name || "");
    setAvatarUrl(p.avatar_url || "");
    setBio(p.bio || "");
    setPhone(p.phone || "");
    setCompanyName(p.company_name || "");

    const pSocials = (p.social_links as Record<string, string> | null) || {};
    setSocials({
      instagram: pSocials.instagram || "",
      telegram: pSocials.telegram || "",
      whatsapp: pSocials.whatsapp || "",
      website: pSocials.website || "",
      twitter: pSocials.twitter || "",
    });
    setErrors({});
    setErrorMessage(null);
    setSuccessMessage(null);
  }, []);

  useEffect(() => {
    invalidateAvatarUpload();
    if (!profileIsReady) {
      setFullName("");
      setAvatarUrl("");
      setBio("");
      setPhone("");
      setCompanyName("");
      setSocials({
        instagram: "",
        telegram: "",
        whatsapp: "",
        website: "",
        twitter: "",
      });
      setErrors({});
      setErrorMessage(null);
      setSuccessMessage(null);
      return;
    }
    populateFromProfile(profile);
  }, [profile, populateFromProfile, invalidateAvatarUpload, profileIsReady]);

  useEffect(() => () => {
    avatarUploadTokenRef.current += 1;
    if (avatarObjectUrlRef.current) {
      URL.revokeObjectURL(avatarObjectUrlRef.current);
      avatarObjectUrlRef.current = null;
    }
  }, []);

  const handleSocialChange = (key: keyof SocialLinksState, value: string) => {
    setSocials((prev) => ({ ...prev, [key]: value }));
  };

  const handleAvatarUrlChange = (value: string) => {
    invalidateAvatarUpload();
    setAvatarUrl(value);
  };

  const handleAvatarFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !profileIsReady) return;

    invalidateAvatarUpload();
    const token = avatarUploadTokenRef.current;
    const uploadIdentity = profileIdentity;
    const objectUrl = URL.createObjectURL(file);
    avatarObjectUrlRef.current = objectUrl;
    setAvatarPreviewUrl(objectUrl);
    setErrorMessage(null);
    setIsAvatarUploading(true);

    uploadAvatarImage(file)
      .then((uploaded) => {
        if (
          token !== avatarUploadTokenRef.current ||
          profileIdentityRef.current !== uploadIdentity ||
          !profileReadyRef.current
        ) return;
        setAvatarUrl(uploaded.url);
        revokeAvatarPreview();
      })
      .catch((error: unknown) => {
        if (
          token !== avatarUploadTokenRef.current ||
          profileIdentityRef.current !== uploadIdentity ||
          !profileReadyRef.current
        ) return;
        revokeAvatarPreview();
        const validationKeys: Record<string, string> = {
          "Only JPEG, PNG, and WebP images are allowed": "events.imageTypeError",
          "Image must not exceed 5 MB": "events.imageSizeError",
          "Image file must not be empty": "settings.avatarEmptyError",
        };
        setErrorMessage(t(
          (error instanceof Error && validationKeys[error.message]) || "settings.avatarUploadError"
        ));
      })
      .finally(() => {
        if (
          token === avatarUploadTokenRef.current &&
          profileIdentityRef.current === uploadIdentity &&
          profileReadyRef.current
        ) {
          setIsAvatarUploading(false);
        }
      });
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!fullName.trim()) {
      newErrors.fullName = t("settings.nameRequired");
    }

    if (bio.length > 500) {
      newErrors.bio = t("settings.bioTooLong");
    }

    if (socials.website.trim() && !/^https?:\/\//i.test(socials.website.trim())) {
      newErrors.website = t("settings.websiteProtocol");
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isAvatarUploading || !profileIsReady) return;
    setSuccessMessage(null);
    setErrorMessage(null);

    if (!validateForm()) {
      return;
    }

    setIsSubmitting(true);

    try {
      // Filter empty social links
      const cleanSocials: Record<string, string> = {};
      Object.entries(socials).forEach(([key, val]) => {
        if (val.trim()) {
          cleanSocials[key] = val.trim();
        }
      });

      const updates: Partial<UserProfile> = {
        full_name: fullName.trim(),
        avatar_url: avatarUrl.trim() || null,
        bio: bio.trim() || null,
        phone: phone.trim() || null,
        company_name: companyName.trim() || null,
        social_links: Object.keys(cleanSocials).length > 0 ? cleanSocials : null,
      };

      const result = await updateProfile(updates);

      if (result.error) {
        setErrorMessage(t("settings.profileSaveFailed"));
        return;
      }

      setSuccessMessage(t("settings.profileSaved"));
      if (result.profile && onProfileUpdated) {
        onProfileUpdated(result.profile);
      }
    } catch {
      const msg = t("public.loadErrorMessage");
      setErrorMessage(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = () => {
    if (!profileIsReady) return;
    populateFromProfile(profile);
  };

  return (
    <div
      role="tabpanel"
      id="tabpanel-profile"
      aria-labelledby="tab-profile"
      className="space-y-8"
    >
      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Status Alerts */}
        {successMessage && (
          <div
            role="status"
            className="flex items-center gap-3 p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 shadow-sm transition-all animate-fadeIn"
          >
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <p className="text-sm font-medium">{successMessage}</p>
          </div>
        )}

        {errorMessage && (
          <div
            role="alert"
            className="flex items-center gap-3 p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 shadow-sm transition-all animate-fadeIn"
          >
            <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
            <p className="text-sm font-medium">{errorMessage}</p>
          </div>
        )}

        {/* Section 1: Basic Identity & Avatar */}
        <div className="bg-white rounded-2xl p-6 sm:p-8 shadow-sm border border-slate-200/80 space-y-6">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-lg bg-amber-500/10 text-amber-600">
                <User className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-900">{t("settings.personalInfo")}</h2>
                <p className="text-xs sm:text-sm text-slate-500">
                  {t("settings.profileHelp")}
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Full Name */}
            <div className="space-y-2">
              <label
                htmlFor={fullNameId}
                className="block text-sm font-medium text-slate-700"
              >
                {t("settings.fullName")} <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <input
                  id={fullNameId}
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder={t("settings.nameExample")}
                  className={`w-full px-4 py-2.5 rounded-xl border bg-slate-50/50 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 transition-all ${
                    errors.fullName
                      ? "border-rose-300 focus:ring-rose-200 focus:border-rose-400"
                      : "border-slate-200 focus:ring-amber-500/20 focus:border-amber-500"
                  }`}
                />
              </div>
              {errors.fullName && (
                <p className="text-xs text-rose-600 font-medium">{errors.fullName}</p>
              )}
            </div>

            {/* Phone Number */}
            <div className="space-y-2">
              <label
                htmlFor={phoneId}
                className="block text-sm font-medium text-slate-700"
              >
                {t("settings.phoneNumber")}
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Phone className="w-4 h-4" />
                </div>
                <input
                  id={phoneId}
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+90 532 000 0000"
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50/50 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-all"
                />
              </div>
            </div>

            {/* Company / Brand Name */}
            <div className="space-y-2 md:col-span-2">
              <label
                htmlFor={companyId}
                className="block text-sm font-medium text-slate-700"
              >
                {t("settings.companyLabel")}
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Building className="w-4 h-4" />
                </div>
                <input
                  id={companyId}
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder={t("settings.companyExample")}
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50/50 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-all"
                />
              </div>
              <p className="text-xs text-slate-500">
                {t("settings.companyHelp")}
              </p>
            </div>
          </div>

          {/* Avatar URL & Previews */}
          <div className="space-y-4 pt-4 border-t border-slate-100">
            <label
              htmlFor={avatarUrlId}
              className="block text-sm font-medium text-slate-700"
            >
              {t("settings.avatarLabel")}
            </label>

            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <div className="w-16 h-16 rounded-full overflow-hidden bg-slate-100 border-2 border-amber-400/40 shrink-0 shadow-inner flex items-center justify-center">
                {avatarPreviewUrl || avatarUrl ? (
                  <img
                    src={avatarPreviewUrl || avatarUrl}
                    alt={t("settings.avatarPreview")}
                    className="w-full h-full object-cover"
                    onError={() => {
                      // Fallback if URL fails to load
                    }}
                  />
                ) : (
                  <ImageIcon className="w-7 h-7 text-slate-400" />
                )}
              </div>

              <div className="flex-1 w-full space-y-2">
                <div className="relative">
                  <input
                    id={avatarUrlId}
                    type="url"
                    value={avatarUrl}
                    onChange={(e) => handleAvatarUrlChange(e.target.value)}
                    disabled={!profileIsReady}
                    placeholder="https://images.unsplash.com/..."
                    className="w-full px-4 py-2 text-sm rounded-xl border border-slate-200 bg-slate-50/50 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-all"
                  />
                </div>
                <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 cursor-pointer transition-colors">
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={handleAvatarFileChange}
                    disabled={!profileIsReady}
                    className="sr-only"
                    aria-label={t("settings.avatarUpload")}
                  />
                  {isAvatarUploading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {t("settings.avatarUploading")}
                    </>
                  ) : (
                    t("settings.avatarUpload")
                  )}
                </label>
                <p className="text-xs text-slate-500">{t("settings.avatarUploadRequirements")}</p>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">{t("settings.choosePreset")}</span>
                  <div className="flex items-center gap-1.5">
                    {PRESET_AVATARS.map((url, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => {
                          invalidateAvatarUpload();
                          setAvatarUrl(url);
                        }}
                        disabled={!profileIsReady}
                        className={`w-7 h-7 rounded-full overflow-hidden border-2 transition-all cursor-pointer ${
                          avatarUrl === url
                            ? "border-amber-500 scale-110 shadow-sm"
                            : "border-transparent opacity-70 hover:opacity-100"
                        }`}
                      >
                        <img
                          src={url}
                          alt={t("settings.presetAvatar", { number: idx + 1 })}
                          className="w-full h-full object-cover"
                        />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Bio Description */}
          <div className="space-y-2 pt-4 border-t border-slate-100">
            <div className="flex items-center justify-between">
              <label
                htmlFor={bioId}
                className="block text-sm font-medium text-slate-700"
              >
                {t("settings.bioLabel")}
              </label>
              <span
                className={`text-xs ${
                  bio.length > 500 ? "text-rose-600 font-semibold" : "text-slate-400"
                }`}
              >
                {bio.length}/500
              </span>
            </div>
            <div className="relative">
              <textarea
                id={bioId}
                rows={3}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                maxLength={500}
                placeholder={t("settings.bioPlaceholder")}
                className={`w-full px-4 py-2.5 rounded-xl border bg-slate-50/50 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 transition-all ${
                  errors.bio
                    ? "border-rose-300 focus:ring-rose-200"
                    : "border-slate-200 focus:ring-amber-500/20 focus:border-amber-500"
                }`}
              />
            </div>
            {errors.bio && <p className="text-xs text-rose-600 font-medium">{errors.bio}</p>}
          </div>
        </div>

        {/* Section 2: Social & Contact Links */}
        <div className="bg-white rounded-2xl p-6 sm:p-8 shadow-sm border border-slate-200/80 space-y-6">
          <div className="flex items-center gap-2.5 border-b border-slate-100 pb-4">
            <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-600">
              <Globe className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-900">{t("settings.socialPresence")}</h2>
              <p className="text-xs sm:text-sm text-slate-500">
                {t("settings.socialHelp")}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Instagram */}
            <div className="space-y-2">
              <label
                htmlFor={instagramId}
                className="block text-sm font-medium text-slate-700"
              >
                Instagram
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Instagram className="w-4 h-4" />
                </div>
                <input
                  id={instagramId}
                  type="text"
                  value={socials.instagram}
                  onChange={(e) => handleSocialChange("instagram", e.target.value)}
                  placeholder={t("settings.socialPlaceholder")}
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50/50 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-all"
                />
              </div>
            </div>

            {/* Telegram */}
            <div className="space-y-2">
              <label
                htmlFor={telegramId}
                className="block text-sm font-medium text-slate-700"
              >
                Telegram
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Send className="w-4 h-4" />
                </div>
                <input
                  id={telegramId}
                  type="text"
                  value={socials.telegram}
                  onChange={(e) => handleSocialChange("telegram", e.target.value)}
                  placeholder={t("settings.telegramPlaceholder")}
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50/50 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-all"
                />
              </div>
            </div>

            {/* WhatsApp */}
            <div className="space-y-2">
              <label
                htmlFor={whatsappId}
                className="block text-sm font-medium text-slate-700"
              >
                WhatsApp
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <MessageSquare className="w-4 h-4" />
                </div>
                <input
                  id={whatsappId}
                  type="text"
                  value={socials.whatsapp}
                  onChange={(e) => handleSocialChange("whatsapp", e.target.value)}
                  placeholder={t("settings.whatsappPlaceholder")}
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50/50 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-all"
                />
              </div>
            </div>

            {/* Twitter / X */}
            <div className="space-y-2">
              <label
                htmlFor={twitterId}
                className="block text-sm font-medium text-slate-700"
              >
                Twitter / X
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Twitter className="w-4 h-4" />
                </div>
                <input
                  id={twitterId}
                  type="text"
                  value={socials.twitter}
                  onChange={(e) => handleSocialChange("twitter", e.target.value)}
                  placeholder="@handle"
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50/50 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-all"
                />
              </div>
            </div>

            {/* Personal or Business Website */}
            <div className="space-y-2 md:col-span-2">
              <label
                htmlFor={websiteId}
                className="block text-sm font-medium text-slate-700"
              >
                {t("settings.websiteLabel")}
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Globe className="w-4 h-4" />
                </div>
                <input
                  id={websiteId}
                  type="url"
                  value={socials.website}
                  onChange={(e) => handleSocialChange("website", e.target.value)}
                  placeholder="https://yourwebsite.com"
                  className={`w-full pl-10 pr-4 py-2.5 rounded-xl border bg-slate-50/50 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 transition-all ${
                    errors.website
                      ? "border-rose-300 focus:ring-rose-200"
                      : "border-slate-200 focus:ring-amber-500/20 focus:border-amber-500"
                  }`}
                />
              </div>
              {errors.website && (
                <p className="text-xs text-rose-600 font-medium">{errors.website}</p>
              )}
            </div>
          </div>
        </div>

        {/* Action Bar */}
        <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={handleReset}
            disabled={!profileIsReady || isSubmitting || isAvatarUploading}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl border border-slate-300 hover:bg-slate-100 text-slate-700 text-sm font-medium transition-colors cursor-pointer disabled:opacity-50"
          >
            <RotateCcw className="w-4 h-4 text-slate-500" />
            <span>{t("settings.reset")}</span>
          </button>

          <button
            type="submit"
            disabled={!profileIsReady || isSubmitting || isAvatarUploading}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white text-sm font-semibold shadow-md shadow-amber-500/20 hover:shadow-lg transition-all cursor-pointer disabled:opacity-60"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-white" />
                <span>{t("settings.saving")}</span>
              </>
            ) : (
              <>
                <Save className="w-4 h-4 text-white" />
                <span>{t("settings.saveChanges")}</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
};
