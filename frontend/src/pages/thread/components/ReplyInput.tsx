import { useRef, useState } from "react";
import RichTextEditor from "@/components/base/RichTextEditor";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/context/AuthContext";
import "@/i18n";

interface ReplyInputProps {
  replyTo: string | null;
  replyToAuthor?: string;
  onSubmit: (content: string, parentId: string | null) => Promise<void>;
  onCancel: () => void;
}

const replyModules = {
  toolbar: [
    ['bold', 'italic', 'strike'],
    ['link', 'image', 'video'],
    ['clean'],
  ],
};

export default function ReplyInput({ replyTo, replyToAuthor, onSubmit, onCancel }: ReplyInputProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [content, setContent] = useState("");
  const [mediaUploadPending, setMediaUploadPending] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const isSubmittingRef = useRef(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const submittedDraft = content;
    const submittedContent = submittedDraft.trim();
    if (!submittedContent || mediaUploadPending || isSubmittingRef.current) return;

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await onSubmit(submittedContent, replyTo);
      setContent((current) => (current === submittedDraft ? "" : current));
    } catch {
      setSubmitError(t("public.replySubmitError"));
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-background-50 rounded-xl border border-background-200/70 p-4 md:p-5">
      {replyTo ? (
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-foreground-500 flex items-center gap-1">
            <i className="ri-reply-line"></i>
            {t("public.replyingTo")} {" "}
            <span className="font-medium text-foreground-700">{replyToAuthor}</span>
          </p>
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className="text-xs text-foreground-400 hover:text-foreground-600 transition-colors"
          >
            <i className="ri-close-line"></i>
          </button>
        </div>
      ) : (
        <p className="text-sm font-heading text-foreground-700 font-medium mb-3">
          {t("public.joinDiscussion")}
        </p>
      )}

      <RichTextEditor
        value={content}
        onChange={setContent}
        placeholder={replyTo ? t("public.replyTo", { name: replyToAuthor }) : t("public.shareThoughts")}
        modules={replyModules}
        userId={user?.id}
        onUploadStateChange={setMediaUploadPending}
      />

      {submitError && (
        <p role="alert" className="mt-3 text-xs text-red-600">
          {submitError}
        </p>
      )}

      <div className="flex items-center justify-end mt-3">
        <div className="flex items-center gap-2">
          {replyTo && (
            <button
              type="button"
              onClick={onCancel}
              disabled={isSubmitting}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-foreground-500 hover:bg-background-100 transition-colors"
            >
              {t("common.cancel")}
            </button>
          )}
          <button
            type="submit"
            disabled={!content.trim() || mediaUploadPending || isSubmitting}
            className="px-4 py-1.5 rounded-lg text-xs font-medium bg-primary-500 text-background-50 hover:bg-primary-600 disabled:opacity-40 disabled:cursor-not-allowed transition-all whitespace-nowrap"
          >
            {isSubmitting
              ? t("comments.posting")
              : replyTo
                ? t("public.postReply")
                : t("public.postComment")}
          </button>
        </div>
      </div>
    </form>
  );
}
