import { useEffect, useMemo, useRef, useState } from "react";
import {
  eventsService,
  type BackendForumEvent,
  type CreateEventPayload,
  type ForumEvent,
} from "@/api-services/events.service";
import { forumService, type Category } from "@/api-services/forum.service";
import {
  storageService,
  type UploadedEventImage,
  type UploadedEventVideo,
} from "@/api-services/storage.service";
import { logger } from "@/lib/logger";
import { useAuth } from "@/context/AuthContext";
import { useTranslation } from "react-i18next";
import "@/i18n";

interface HostEventModalProps {
  isOpen: boolean;
  onClose: () => void;
  onEventCreated?: (newEvent: ForumEvent) => void;
  initialEvent?: BackendForumEvent | null;
  isAdmin?: boolean;
  onSave?: (
    payload: CreateEventPayload,
    idempotencyKey: string,
  ) => Promise<unknown>;
  onSaved?: () => void | Promise<void>;
}

const MAX_EVENT_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_EVENT_VIDEO_SIZE_BYTES = 50 * 1024 * 1024;
const ALLOWED_EVENT_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const ALLOWED_EVENT_VIDEO_TYPES = new Set(["video/mp4", "video/webm"]);

function localEventDateTime(eventDate?: string | null) {
  if (!eventDate) return { date: "", time: "" };
  const parsed = new Date(eventDate);
  if (Number.isNaN(parsed.getTime())) return { date: "", time: "" };
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  const hours = String(parsed.getHours()).padStart(2, "0");
  const minutes = String(parsed.getMinutes()).padStart(2, "0");
  return { date: `${year}-${month}-${day}`, time: `${hours}:${minutes}` };
}

export default function HostEventModal({
  isOpen,
  onClose,
  onEventCreated,
  initialEvent = null,
  isAdmin = false,
  onSave,
  onSaved,
}: HostEventModalProps) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [eventTime, setEventTime] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [isPublished, setIsPublished] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingCategories, setIsLoadingCategories] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);
  const [availableCategories, setAvailableCategories] = useState<Category[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const [removeExistingCover, setRemoveExistingCover] = useState(false);
  const [removeExistingVideo, setRemoveExistingVideo] = useState(false);
  const [mediaErrors, setMediaErrors] = useState<Record<string, string>>({});
  const [isUploadingMedia, setIsUploadingMedia] = useState(false);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const submittingRef = useRef(false);
  const idempotencyKeyRef = useRef<string | null>(null);
  const uploadedImageRef = useRef<UploadedEventImage | null>(null);
  const uploadedVideoRef = useRef<UploadedEventVideo | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const initialCategoryId = initialEvent?.category_id ?? initialEvent?.category?.id ?? "";
  const isLegacyCategorylessEdit = Boolean(initialEvent && !initialCategoryId);

  useEffect(() => {
    if (!isOpen) return;
    const localDateTime = localEventDateTime(initialEvent?.event_date);
    setTitle(initialEvent?.title ?? "");
    setCategory(initialCategoryId);
    setEventDate(localDateTime.date);
    setEventTime(localDateTime.time);
    setLocation(initialEvent?.location ?? "");
    setDescription(initialEvent?.description ?? "");
    setIsPublished(initialEvent?.is_published ?? true);
    setSubmitted(false);
    setSubmitError(null);
    setErrors({});
    setCoverFile(null);
    setCoverPreview(null);
    setVideoFile(null);
    setVideoPreview(null);
    setRemoveExistingCover(false);
    setRemoveExistingVideo(false);
    setMediaErrors({});
  }, [initialCategoryId, initialEvent, isOpen]);

  useEffect(() => {
    return () => {
      if (coverPreview) URL.revokeObjectURL(coverPreview);
    };
  }, [coverPreview]);

  useEffect(() => {
    return () => {
      if (videoPreview) URL.revokeObjectURL(videoPreview);
    };
  }, [videoPreview]);


  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;

    const loadCategories = async () => {
      setIsLoadingCategories(true);
      setCategoriesError(null);
      try {
        const categories = await forumService.getCategories();
        if (cancelled) return;

        const normalized = categories
          .map((category) => ({
            ...category,
            slug: category.slug || category.id,
          }))
          .filter((category) => category.id)
          .sort((a, b) => a.name.localeCompare(b.name));

        setAvailableCategories(normalized);
      } catch (err) {
        logger.warn("Failed to load forum categories for events:", err);
        if (!cancelled) {
          setCategoriesError(t("events.categoriesLoadError"));
          setAvailableCategories([]);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingCategories(false);
        }
      }
    };

    void loadCategories();

    return () => {
      cancelled = true;
    };
  }, [isOpen, t]);

  useEffect(() => {
    if (!isOpen || !dialogRef.current) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const parent = dialogRef.current.parentElement;
    const background = parent
      ? Array.from(parent.children).filter(
          (element) => element !== dialogRef.current,
        )
      : [];
    const previousState = background.map((element) => ({
      element: element as HTMLElement,
      ariaHidden: element.getAttribute("aria-hidden"),
      inert: (element as HTMLElement & { inert?: boolean }).inert,
    }));
    previousState.forEach(({ element }) => {
      element.setAttribute("aria-hidden", "true");
      (element as HTMLElement & { inert?: boolean }).inert = true;
    });
    closeButtonRef.current?.focus();

    return () => {
      previousState.forEach(({ element, ariaHidden, inert }) => {
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
        (element as HTMLElement & { inert?: boolean }).inert = inert ?? false;
      });
      previouslyFocused?.focus();
    };
  }, [isOpen]);

  const trapDialogFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      handleClose();
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) return;
    const focusable = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => !element.hasAttribute("hidden"));
    if (focusable.length === 0) {
      event.preventDefault();
      dialogRef.current.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const selectedCategoryLabel = useMemo(() => {
    return availableCategories.find((item) => item.id === category)?.name || category;
  }, [availableCategories, category]);
  const displayedCover =
    coverPreview || (!removeExistingCover ? initialEvent?.image_url : null);
  const displayedVideo =
    videoPreview || (!removeExistingVideo ? initialEvent?.video_url : null);

  if (!isOpen) return null;

  const resetForm = (cleanupRetainedUploads = false) => {
    resetSubmissionAttempt(cleanupRetainedUploads);
    setTitle("");
    setCategory("");
    setEventDate("");
    setEventTime("");
    setLocation("");
    setDescription("");
    setIsPublished(true);
    setSubmitted(false);
    setSubmitError(null);
    setErrors({});
    setCoverFile(null);
    setCoverPreview(null);
    setVideoFile(null);
    setVideoPreview(null);
    setRemoveExistingCover(false);
    setRemoveExistingVideo(false);
    setMediaErrors({});
    setIsUploadingMedia(false);
    if (coverInputRef.current) coverInputRef.current.value = "";
    if (videoInputRef.current) videoInputRef.current.value = "";
  };

  const selectCoverFile = (file?: File) => {
    if (submittingRef.current) return;
    if (!file) return;
    let error: string | null = null;
    if (!ALLOWED_EVENT_IMAGE_TYPES.has(file.type)) {
      error = t("events.imageTypeError");
    } else if (file.size > MAX_EVENT_IMAGE_SIZE_BYTES) {
      error = t("events.imageSizeError");
    }
    if (error) {
      setMediaErrors((current) => ({ ...current, cover: error }));
      if (coverInputRef.current) coverInputRef.current.value = "";
      return;
    }

    resetSubmissionAttempt(true);
    setSubmitError(null);
    setMediaErrors((current) => {
      const next = { ...current };
      delete next.cover;
      return next;
    });
    setCoverFile(file);
    setCoverPreview(URL.createObjectURL(file));
    setRemoveExistingCover(false);
  };

  const selectVideoFile = (file?: File) => {
    if (submittingRef.current) return;
    if (!file) return;
    let error: string | null = null;
    if (!ALLOWED_EVENT_VIDEO_TYPES.has(file.type)) {
      error = t("events.videoTypeError");
    } else if (file.size > MAX_EVENT_VIDEO_SIZE_BYTES) {
      error = t("events.videoSizeError");
    }
    if (error) {
      setMediaErrors((current) => ({ ...current, video: error }));
      if (videoInputRef.current) videoInputRef.current.value = "";
      return;
    }

    resetSubmissionAttempt(true);
    setSubmitError(null);
    setMediaErrors((current) => {
      const next = { ...current };
      delete next.video;
      return next;
    });
    setVideoFile(file);
    setVideoPreview(URL.createObjectURL(file));
    setRemoveExistingVideo(false);
  };

  const removeCover = () => {
    if (submittingRef.current) return;
    resetSubmissionAttempt(true);
    setCoverFile(null);
    setCoverPreview(null);
    setRemoveExistingCover(Boolean(initialEvent?.image_url));
    setMediaErrors((current) => {
      const next = { ...current };
      delete next.cover;
      return next;
    });
    if (coverInputRef.current) coverInputRef.current.value = "";
  };

  const removeVideo = () => {
    if (submittingRef.current) return;
    resetSubmissionAttempt(true);
    setVideoFile(null);
    setVideoPreview(null);
    setRemoveExistingVideo(Boolean(initialEvent?.video_url));
    setMediaErrors((current) => {
      const next = { ...current };
      delete next.video;
      return next;
    });
    if (videoInputRef.current) videoInputRef.current.value = "";
  };

  const cleanupUploads = async (
    image: UploadedEventImage | null,
    video: UploadedEventVideo | null,
  ) => {
    const cleanupOperations = [image?.mediaId, video?.mediaId]
      .filter((mediaId): mediaId is string => Boolean(mediaId))
      .map((mediaId) => storageService.abandonEventMedia(mediaId));
    const results = await Promise.allSettled(cleanupOperations);
    results.forEach((result) => {
      if (result.status === "rejected") {
        logger.warn(
          "Failed to clean up newly uploaded event media:",
          result.reason,
        );
      }
    });
  };

  const resetSubmissionAttempt = (cleanupRetainedUploads: boolean) => {
    const image = uploadedImageRef.current;
    const video = uploadedVideoRef.current;
    uploadedImageRef.current = null;
    uploadedVideoRef.current = null;
    idempotencyKeyRef.current = null;
    if (cleanupRetainedUploads && (image || video)) {
      void cleanupUploads(image, video);
    }
  };

  const markFormChanged = (): boolean => {
    if (submittingRef.current) return false;
    if (
      idempotencyKeyRef.current ||
      uploadedImageRef.current ||
      uploadedVideoRef.current
    ) {
      resetSubmissionAttempt(true);
    }
    return true;
  };

  const validate = () => {
    const errs: Record<string, string> = {};
    const unchangedLegacyTitle = Boolean(initialEvent && title === initialEvent.title);
    const unchangedLegacyLocation = Boolean(
      initialEvent && location === (initialEvent.location ?? ""),
    );
    const unchangedLegacyDescription = Boolean(
      initialEvent && description === (initialEvent.description ?? ""),
    );
    if (!title.trim() && !unchangedLegacyTitle) {
      errs.title = t("events.titleRequired");
    } else if (title.trim().length < 5 && !unchangedLegacyTitle) {
      errs.title = t("events.titleTooShort");
    }
    if (!category && !isLegacyCategorylessEdit) {
      errs.category = t("events.categoryRequired");
    }
    if (!eventDate) errs.eventDate = t("events.dateRequired");
    if (!eventTime) errs.eventTime = t("events.timeRequired");
    if (!location.trim() && !unchangedLegacyLocation) {
      errs.location = t("events.locationRequired");
    }
    if (!description.trim() && !unchangedLegacyDescription) {
      errs.description = t("events.descriptionRequired");
    } else if (
      description.trim().length < 20 &&
      !unchangedLegacyDescription
    ) {
      errs.description = t("events.descriptionTooShort");
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingRef.current) return;
    setSubmitError(null);
    if (!validate()) return;
    if (Object.keys(mediaErrors).length > 0) return;

    if ((coverFile || videoFile) && !user?.id) {
      setSubmitError(t("events.mediaAuthenticationError"));
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    setIsUploadingMedia(
      Boolean(
        (coverFile && !uploadedImageRef.current) ||
          (videoFile && !uploadedVideoRef.current),
      ),
    );
    try {
      if (coverFile && !uploadedImageRef.current) {
        uploadedImageRef.current =
          await storageService.uploadEventImage(coverFile);
      }
      if (videoFile && user?.id && !uploadedVideoRef.current) {
        uploadedVideoRef.current = await storageService.uploadEventVideo(
          videoFile,
          user.id,
        );
      }
      setIsUploadingMedia(false);
      idempotencyKeyRef.current ??= globalThis.crypto.randomUUID();
      const initialLocalDateTime = localEventDateTime(initialEvent?.event_date);
      const eventDateIsUnchanged = Boolean(
        initialEvent?.event_date &&
          eventDate === initialLocalDateTime.date &&
          eventTime === initialLocalDateTime.time,
      );
      const payload: CreateEventPayload = {
        title: title.trim(),
        event_date: eventDateIsUnchanged
          ? initialEvent!.event_date
          : new Date(`${eventDate}T${eventTime}:00`).toISOString(),
        location: location.trim(),
        description: description.trim(),
        is_published: isAdmin ? isPublished : true,
        ...(category ? { category_id: category } : {}),
        ...(uploadedImageRef.current
          ? { image_media_id: uploadedImageRef.current.mediaId }
          : removeExistingCover
            ? { image_media_id: null }
            : {}),
        ...(uploadedVideoRef.current
          ? { video_media_id: uploadedVideoRef.current.mediaId }
          : removeExistingVideo
            ? { video_media_id: null }
            : {}),
      };
      if (onSave) {
        await onSave(payload, idempotencyKeyRef.current);
      } else {
        const newEvent = await eventsService.createEvent(
          payload,
          idempotencyKeyRef.current,
        );
        onEventCreated?.(newEvent);
      }
      resetSubmissionAttempt(false);
      if (onSaved) await onSaved();
      else setSubmitted(true);
    } catch (err) {
      logger.warn("Failed to create event:", err);
      setSubmitError(t(isAdmin ? "events.saveError" : "events.publishError"));
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
      setIsUploadingMedia(false);
    }
  };

  const handleClose = () => {
    if (submittingRef.current) return;
    resetForm(true);
    onClose();
  };

  const handleCreateAnother = () => {
    resetForm(false);
  };

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="host-event-modal-title"
      tabIndex={-1}
      onKeyDown={trapDialogFocus}
      className="fixed inset-0 z-50 flex items-start justify-center pt-16 md:pt-24 px-4"
    >
      <div
        className="absolute inset-0 bg-foreground-950/50 backdrop-blur-sm"
        onClick={handleClose}
      ></div>

      <div className="relative w-full max-w-lg bg-background-50 rounded-2xl shadow-2xl max-h-[85vh] overflow-y-auto">
        <div className="sticky top-0 z-10 bg-background-50 rounded-t-2xl border-b border-background-200/70 px-6 py-4 flex items-center justify-between">
          <div>
            <h2
              id="host-event-modal-title"
              className="font-heading text-lg text-foreground-900"
            >
              {submitted
                ? t("events.publishedTitle")
                : t(isAdmin
                    ? initialEvent
                      ? "events.editTitle"
                      : "events.adminCreateTitle"
                    : "events.hostModalTitle")}
            </h2>
            {!submitted && (
              <p className="text-xs text-foreground-500 mt-0.5">
                {t(isAdmin ? "events.adminModalDescription" : "events.hostModalDescription")}
              </p>
            )}
          </div>
          <button
            ref={closeButtonRef}
            onClick={handleClose}
            disabled={isSubmitting}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-background-100 text-foreground-500 hover:text-foreground-800 transition-colors cursor-pointer"
            aria-label={t("events.closeModal")}
          >
            <i className="ri-close-line text-lg"></i>
          </button>
        </div>

        <div className="px-6 py-5">
          {submitted ? (
            <div className="text-center py-6">
              <div className="w-16 h-16 mx-auto mb-4 flex items-center justify-center bg-primary-100 rounded-full">
                <i className="ri-check-line text-3xl text-primary-500"></i>
              </div>
              <h3 className="font-heading text-lg text-foreground-900 mb-2">
                {t("events.eventIsLive")}
              </h3>
              <p className="text-sm text-foreground-600 mb-1">
                <span className="font-semibold text-foreground-900">{title}</span>
              </p>
              <p className="text-sm text-foreground-600 mb-6">
                {selectedCategoryLabel && (
                  <span className="inline-flex items-center gap-1 text-foreground-500">
                    <i className="ri-price-tag-3-line"></i>
                    {selectedCategoryLabel}
                  </span>
                )}
                {eventDate && (
                  <span className="inline-flex items-center gap-1 text-foreground-500 ml-3">
                    <i className="ri-calendar-line"></i>
                    {new Date(eventDate + "T00:00:00").toLocaleDateString(i18n.language, {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                )}
              </p>
              <p className="text-xs text-foreground-400 mb-8">
                {t("events.createdSuccess")}
              </p>
              <div className="flex items-center justify-center gap-3 flex-wrap">
                <button
                  onClick={handleClose}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-primary-500 text-background-50 text-sm font-medium hover:bg-primary-600 transition-colors cursor-pointer whitespace-nowrap"
                >
                  <i className="ri-calendar-check-line"></i>
                  {t("events.backToEvents")}
                </button>
                <button
                  onClick={handleCreateAnother}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full border border-foreground-200 text-foreground-700 text-sm font-medium hover:bg-background-100 transition-colors cursor-pointer whitespace-nowrap"
                >
                  <i className="ri-add-line"></i>
                  {t("events.publishAnother")}
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <fieldset
                disabled={isSubmitting}
                className="m-0 min-w-0 space-y-4 border-0 p-0"
              >
              {submitError && (
                <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-700" role="alert">
                  {submitError}
                </div>
              )}

              <div>
                <label htmlFor="event-title" className="block text-sm font-medium text-foreground-800 mb-1">
                  {t("events.eventTitleLabel")} <span className="text-primary-500">*</span>
                </label>
                <input
                  type="text"
                  id="event-title"
                  aria-label={t("events.eventTitleLabel")}
                  name="title"
                  value={title}
                  onChange={(e) => {
                    if (!markFormChanged()) return;
                    setTitle(e.target.value);
                    if (errors.title) setErrors((prev) => { const n = { ...prev }; delete n.title; return n; });
                  }}
                  placeholder={t("events.hostTitlePlaceholder")}
                  maxLength={100}
                  className={`w-full bg-background-50 border ${
                    errors.title ? "border-primary-500" : "border-background-200"
                  } rounded-lg px-4 py-2.5 text-sm text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:border-primary-500 transition-colors`}
                />
                <div className="flex items-center justify-between mt-1">
                  {errors.title ? (
                    <p className="text-xs text-primary-500">{errors.title}</p>
                  ) : (
                    <span />
                  )}
                  <span className="text-xs text-foreground-400">{title.length}/100</span>
                </div>
              </div>

              <div>
                <label htmlFor="event-category" className="block text-sm font-medium text-foreground-800 mb-1">
                  {t("events.categoryLabel")} {!isLegacyCategorylessEdit && <span className="text-primary-500">*</span>}
                </label>
                <div className="relative">
                  <select
                    name="category"
                    id="event-category"
                    aria-label={t("events.categoryLabel")}
                    value={category}
                    onChange={(e) => {
                      if (!markFormChanged()) return;
                      setCategory(e.target.value);
                      if (errors.category) setErrors((prev) => { const n = { ...prev }; delete n.category; return n; });
                    }}
                    disabled={isLoadingCategories || availableCategories.length === 0}
                    className={`w-full appearance-none bg-background-50 border ${
                      errors.category ? "border-primary-500" : "border-background-200"
                    } rounded-lg px-4 py-2.5 pr-10 text-sm text-foreground-900 focus:outline-none focus:border-primary-500 transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-60`}
                  >
                    <option value="">
                      {isLoadingCategories
                        ? t("events.loadingCategories")
                        : availableCategories.length > 0
                          ? t(isLegacyCategorylessEdit
                              ? "events.legacyNoCategory"
                              : "events.selectCategory")
                          : t("events.noCategories")}
                    </option>
                    {availableCategories.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.name}
                      </option>
                    ))}
                  </select>
                  <i className="ri-arrow-down-s-line absolute right-3 top-1/2 -translate-y-1/2 text-foreground-400 pointer-events-none"></i>
                </div>
                {errors.category ? (
                  <p className="text-xs text-primary-500 mt-1">{errors.category}</p>
                ) : categoriesError ? (
                  <p className="text-xs text-primary-500 mt-1">{categoriesError}</p>
                ) : (
                  <p className="text-xs text-foreground-400 mt-1">{t("events.categoriesBackendNote")}</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="event-date" className="block text-sm font-medium text-foreground-800 mb-1">
                    {t("events.dateLabel")} <span className="text-primary-500">*</span>
                  </label>
                  <input
                    type="date"
                    id="event-date"
                    aria-label={t("events.dateLabel")}
                    name="eventDate"
                    value={eventDate}
                    onChange={(e) => {
                      if (!markFormChanged()) return;
                      setEventDate(e.target.value);
                      if (errors.eventDate) setErrors((prev) => { const n = { ...prev }; delete n.eventDate; return n; });
                    }}
                    className={`w-full bg-background-50 border ${
                      errors.eventDate ? "border-primary-500" : "border-background-200"
                    } rounded-lg px-4 py-2.5 text-sm text-foreground-900 focus:outline-none focus:border-primary-500 transition-colors cursor-pointer`}
                  />
                  {errors.eventDate && (
                    <p className="text-xs text-primary-500 mt-1">{errors.eventDate}</p>
                  )}
                </div>
                <div>
                  <label htmlFor="event-time" className="block text-sm font-medium text-foreground-800 mb-1">
                    {t("events.timeLabel")} <span className="text-primary-500">*</span>
                  </label>
                  <input
                    type="time"
                    id="event-time"
                    aria-label={t("events.timeLabel")}
                    name="eventTime"
                    value={eventTime}
                    onChange={(e) => {
                      if (!markFormChanged()) return;
                      setEventTime(e.target.value);
                      if (errors.eventTime) setErrors((prev) => { const n = { ...prev }; delete n.eventTime; return n; });
                    }}
                    className={`w-full bg-background-50 border ${
                      errors.eventTime ? "border-primary-500" : "border-background-200"
                    } rounded-lg px-4 py-2.5 text-sm text-foreground-900 focus:outline-none focus:border-primary-500 transition-colors cursor-pointer`}
                  />
                  {errors.eventTime && (
                    <p className="text-xs text-primary-500 mt-1">{errors.eventTime}</p>
                  )}
                </div>
              </div>

              <div>
                <label htmlFor="event-location" className="block text-sm font-medium text-foreground-800 mb-1">
                  {t("events.locationLabel")} <span className="text-primary-500">*</span>
                </label>
                <input
                  type="text"
                  id="event-location"
                  aria-label={t("events.locationLabel")}
                  name="location"
                  value={location}
                  onChange={(e) => {
                    if (!markFormChanged()) return;
                    setLocation(e.target.value);
                    if (errors.location) setErrors((prev) => { const n = { ...prev }; delete n.location; return n; });
                  }}
                  placeholder={t("events.locationPlaceholder")}
                  maxLength={150}
                  className={`w-full bg-background-50 border ${
                    errors.location ? "border-primary-500" : "border-background-200"
                  } rounded-lg px-4 py-2.5 text-sm text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:border-primary-500 transition-colors`}
                />
                {errors.location && (
                  <p className="text-xs text-primary-500 mt-1">{errors.location}</p>
                )}
              </div>

              <div>
                <label htmlFor="event-description" className="block text-sm font-medium text-foreground-800 mb-1">
                  {t("events.descriptionLabel")} <span className="text-primary-500">*</span>
                </label>
                <textarea
                  name="description"
                  id="event-description"
                  aria-label={t("events.descriptionLabel")}
                  value={description}
                  onChange={(e) => {
                    if (!markFormChanged()) return;
                    setDescription(e.target.value);
                    if (errors.description) setErrors((prev) => { const n = { ...prev }; delete n.description; return n; });
                  }}
                  placeholder={t("events.descriptionPlaceholder")}
                  rows={4}
                  maxLength={500}
                  className={`w-full bg-background-50 border ${
                    errors.description ? "border-primary-500" : "border-background-200"
                  } rounded-lg px-4 py-2.5 text-sm text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:border-primary-500 transition-colors resize-y`}
                />
                <div className="flex items-center justify-between mt-1">
                  {errors.description ? (
                    <p className="text-xs text-primary-500">{errors.description}</p>
                  ) : (
                    <span />
                  )}
                  <span className="text-xs text-foreground-400">{description.length}/500</span>
                </div>
              </div>

              <div
                role="group"
                aria-labelledby="event-media-title"
                className="space-y-3"
              >
                <div
                  id="event-media-title"
                  className="text-sm font-medium text-foreground-800"
                >
                  {t("events.mediaTitle")}
                  <span className="ml-1 font-normal text-foreground-400">
                    {t("events.optional")}
                  </span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div
                    className="rounded-xl border border-dashed border-background-300 bg-background-100/50 p-3"
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      selectCoverFile(event.dataTransfer.files[0]);
                    }}
                  >
                    <label
                      htmlFor="event-cover-image"
                      className="flex cursor-pointer items-center gap-2 text-sm font-medium text-foreground-700"
                    >
                      <i
                        className="ri-image-add-line text-lg text-primary-500"
                        aria-hidden="true"
                      ></i>
                      {t("events.coverImage")}
                    </label>
                    <input
                      id="event-cover-image"
                      ref={coverInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="sr-only"
                      onChange={(event) =>
                        selectCoverFile(event.target.files?.[0])
                      }
                    />
                    {displayedCover ? (
                      <div className="mt-3 space-y-2">
                        <img
                          src={displayedCover}
                          alt={t("events.coverPreview")}
                          className="h-28 w-full rounded-lg object-cover"
                        />
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-xs text-foreground-500">
                            {coverFile?.name ?? t("events.currentCover")}
                          </span>
                          <button
                            type="button"
                            onClick={removeCover}
                            className="text-xs font-medium text-primary-600 hover:text-primary-700 cursor-pointer"
                            aria-label={t("events.removeCover")}
                          >
                            {t("events.remove")}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-foreground-400">
                        {t("events.coverHelp")}
                      </p>
                    )}
                    {mediaErrors.cover && (
                      <p className="mt-2 text-xs text-primary-600">
                        {mediaErrors.cover}
                      </p>
                    )}
                  </div>

                  <div
                    className="rounded-xl border border-dashed border-background-300 bg-background-100/50 p-3"
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      selectVideoFile(event.dataTransfer.files[0]);
                    }}
                  >
                    <label
                      htmlFor="event-video"
                      className="flex cursor-pointer items-center gap-2 text-sm font-medium text-foreground-700"
                    >
                      <i
                        className="ri-video-add-line text-lg text-primary-500"
                        aria-hidden="true"
                      ></i>
                      {t("events.video")}
                    </label>
                    <input
                      id="event-video"
                      ref={videoInputRef}
                      type="file"
                      accept="video/mp4,video/webm"
                      className="sr-only"
                      onChange={(event) =>
                        selectVideoFile(event.target.files?.[0])
                      }
                    />
                    {displayedVideo ? (
                      <div className="mt-3 space-y-2">
                        <video
                          src={displayedVideo}
                          controls
                          preload="metadata"
                          className="h-28 w-full rounded-lg bg-black object-contain"
                        >
                          {t("events.videoUnsupported")}
                        </video>
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-xs text-foreground-500">
                            {videoFile?.name ?? t("events.currentVideo")}
                          </span>
                          <button
                            type="button"
                            onClick={removeVideo}
                            className="text-xs font-medium text-primary-600 hover:text-primary-700 cursor-pointer"
                            aria-label={t("events.removeVideo")}
                          >
                            {t("events.remove")}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-foreground-400">
                        {t("events.videoHelp")}
                      </p>
                    )}
                    {mediaErrors.video && (
                      <p className="mt-2 text-xs text-primary-600">
                        {mediaErrors.video}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {isAdmin && (
                <label className="flex items-center gap-2 text-sm font-medium text-foreground-800">
                  <input
                    type="checkbox"
                    checked={isPublished}
                    onChange={(event) => {
                      if (!markFormChanged()) return;
                      setIsPublished(event.target.checked);
                    }}
                  />
                  {t("events.publishedLabel")}
                </label>
              )}

              <div className="flex items-center gap-2 text-xs text-foreground-500 bg-background-100/70 rounded-lg px-4 py-2.5">
                <i className="ri-information-line"></i>
                <span>{t(isAdmin ? "events.adminFormNote" : "events.hostFormNote")}</span>
              </div>

              <button
                type="submit"
                disabled={
                  isSubmitting ||
                  isLoadingCategories ||
                  (availableCategories.length === 0 && !isLegacyCategorylessEdit)
                }
                className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-full bg-primary-500 text-background-50 text-sm font-medium hover:bg-primary-600 transition-colors cursor-pointer whitespace-nowrap disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isSubmitting ? (
                  <>
                    <i className="ri-loader-4-line animate-spin"></i>
                    {isUploadingMedia
                      ? t("events.uploadingMedia")
                      : t(isAdmin ? "events.saving" : "events.publishing")}
                  </>
                ) : (
                  <>
                    <i className="ri-send-plane-line"></i>
                    {t(isAdmin ? "events.saveEvent" : "events.publishEvent")}
                  </>
                )}
              </button>
              </fieldset>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
