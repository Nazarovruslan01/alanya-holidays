import { supabase } from "@/lib/supabase";
import { logger } from "@/lib/logger";
import { apiClient } from "@/lib/api-client";

/**
 * Service to handle media and asset storage operations via Supabase Storage.
 * UI components must consume this service rather than importing the Supabase client directly.
 */

const MAX_EVENT_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_EVENT_VIDEO_SIZE_BYTES = 50 * 1024 * 1024;
const EVENT_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const EVENT_VIDEO_EXTENSIONS: Record<string, "mp4" | "webm"> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
};
const AVATAR_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export interface UploadedEventImage {
  mediaId: string;
  url: string;
  thumbnailUrl: string;
}

export interface UploadedEventVideo {
  mediaId: string;
  url: string;
}

export interface UploadedAvatarImage {
  originalName: string;
  url: string;
  thumbnailUrl: string;
  format: "webp";
  sizeBytes: number;
}

function validateEventImage(file: File): void {
  if (!EVENT_IMAGE_TYPES.has(file.type)) {
    throw new Error("Only JPEG, PNG, and WebP images are allowed");
  }
  if (file.size <= 0) {
    throw new Error("Image file must not be empty");
  }
  if (file.size > MAX_EVENT_IMAGE_SIZE_BYTES) {
    throw new Error("Image must not exceed 5 MB");
  }
}

function validateEventVideo(file: File): "mp4" | "webm" {
  const extension = EVENT_VIDEO_EXTENSIONS[file.type];
  if (!extension) {
    throw new Error("Only MP4 and WebM videos are allowed");
  }
  if (file.size <= 0) {
    throw new Error("Video file must not be empty");
  }
  if (file.size > MAX_EVENT_VIDEO_SIZE_BYTES) {
    throw new Error("Video must not exceed 50 MB");
  }
  return extension;
}

function validateAvatarImage(file: File): void {
  if (!AVATAR_IMAGE_TYPES.has(file.type)) {
    throw new Error("Only JPEG, PNG, and WebP images are allowed");
  }
  if (file.size <= 0) {
    throw new Error("Image file must not be empty");
  }
  if (file.size > MAX_EVENT_IMAGE_SIZE_BYTES) {
    throw new Error("Image must not exceed 5 MB");
  }
}

export async function uploadEventImage(
  file: File,
): Promise<UploadedEventImage> {
  validateEventImage(file);
  const body = new FormData();
  body.append("file", file);
  return apiClient.post<UploadedEventImage>("/media/events/image", body);
}

export async function uploadEventVideo(
  file: File,
  _userId?: string,
): Promise<UploadedEventVideo> {
  validateEventVideo(file);
  const intent = await apiClient.post<{
    mediaId: string;
    path: string;
    token: string;
  }>("/media/events/video-intent", {
    fileName: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
  });
  const storage = supabase.storage.from("event-media-staging");
  const { error } = await storage.uploadToSignedUrl(
    intent.path,
    intent.token,
    file,
    {
      cacheControl: "3600",
      contentType: file.type,
      upsert: false,
    },
  );
  if (error) {
    try {
      await apiClient.delete(`/media/events/${intent.mediaId}`);
    } catch (cleanupError) {
      logger.warn(
        "Failed to queue unsuccessful event video cleanup:",
        cleanupError,
      );
    }
    throw error;
  }
  try {
    return await apiClient.post<UploadedEventVideo>(
      `/media/events/${intent.mediaId}/finalize`,
      {},
    );
  } catch (error) {
    try {
      await apiClient.delete(`/media/events/${intent.mediaId}`);
    } catch (cleanupError) {
      logger.warn(
        "Failed to queue rejected event video cleanup:",
        cleanupError,
      );
    }
    throw error;
  }
}

export async function uploadAvatarImage(
  file: File,
): Promise<UploadedAvatarImage> {
  validateAvatarImage(file);
  const body = new FormData();
  body.append("file", file);
  body.append("bucket", "forum-media");
  body.append("folder", "avatars");
  return apiClient.post<UploadedAvatarImage>("/media/upload", body);
}

export async function abandonEventMedia(mediaId: string): Promise<void> {
  await apiClient.delete(`/media/events/${mediaId}`);
}

/**
 * Uploads an image for forum threads, replies, or rich text content to the 'forum-media' bucket.
 * 
 * @param file The image File to upload
 * @param userId The ID of the authenticated owner
 * @returns The public CDN URL of the uploaded image
 */
export async function uploadForumImage(file: File, userId: string): Promise<string> {
  const sanitizedUserId = userId.trim();
  if (!sanitizedUserId) {
    throw new Error("A user ID is required to upload a forum image");
  }
  
  // Extract and sanitize extension
  const parts = file.name.split(".");
  const rawExt = parts.length > 1 ? parts.pop()?.toLowerCase() || "png" : "png";
  const sanitizedExt = rawExt.replace(/[^a-z0-9]/g, "") || "png";
  
  // Generate random unique identifier
  const uniqueId = typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  
  const filePath = `${sanitizedUserId}/${uniqueId}.${sanitizedExt}`;

  try {
    const { error: uploadError } = await supabase.storage
      .from("forum-media")
      .upload(filePath, file, {
        cacheControl: "3600",
        upsert: false,
      });

    if (uploadError) {
      logger.error("Failed to upload forum image to Supabase storage:", uploadError);
      throw uploadError;
    }

    const { data: publicUrlData } = supabase.storage
      .from("forum-media")
      .getPublicUrl(filePath);

    if (!publicUrlData || !publicUrlData.publicUrl) {
      throw new Error("Failed to generate public URL for uploaded forum image");
    }

    return publicUrlData.publicUrl;
  } catch (err) {
    logger.error("Error in uploadForumImage:", err);
    throw err;
  }
}

export async function uploadBlogImage(file: File, userId: string): Promise<string> {
  const ownerId = userId.trim();
  if (!ownerId) throw new Error("A user ID is required to upload a blog image");

  const parts = file.name.split(".");
  const rawExt = parts.length > 1 ? parts.pop()?.toLowerCase() || "png" : "png";
  const sanitizedExt = rawExt.replace(/[^a-z0-9]/g, "") || "png";
  const uniqueId = typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  const filePath = `${ownerId}/${uniqueId}.${sanitizedExt}`;

  const { error: uploadError } = await supabase.storage
    .from("blog-media")
    .upload(filePath, file, {
      cacheControl: "3600",
      upsert: false,
    });

  if (uploadError) {
    logger.error("Failed to upload blog image to Supabase storage:", uploadError);
    throw uploadError;
  }

  const { data } = supabase.storage.from("blog-media").getPublicUrl(filePath);
  if (!data?.publicUrl) {
    throw new Error("Failed to generate public URL for uploaded blog image");
  }

  return data.publicUrl;
}

const FORUM_MEDIA_PUBLIC_PATH = "/storage/v1/object/public/forum-media/";
const BLOG_MEDIA_PUBLIC_PATH = "/storage/v1/object/public/blog-media/";

export async function deleteForumImage(publicUrl: string, userId: string): Promise<boolean> {
  const ownerId = userId.trim();
  if (!ownerId) return false;

  let filePath: string;
  try {
    const url = new URL(publicUrl);
    const markerIndex = url.pathname.indexOf(FORUM_MEDIA_PUBLIC_PATH);
    if (markerIndex < 0) return false;

    filePath = decodeURIComponent(
      url.pathname.slice(markerIndex + FORUM_MEDIA_PUBLIC_PATH.length),
    );
  } catch {
    return false;
  }

  const segments = filePath.split("/");
  if (
    segments.length < 2 ||
    segments[0] !== ownerId ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    return false;
  }

  const { error } = await supabase.storage.from("forum-media").remove([filePath]);
  if (error) {
    logger.error("Failed to delete forum image from Supabase storage:", error);
    throw error;
  }

  return true;
}

export async function deleteBlogImage(publicUrl: string, userId: string): Promise<boolean> {
  const ownerId = userId.trim();
  if (!ownerId) return false;

  let filePath: string;
  try {
    const url = new URL(publicUrl);
    const markerIndex = url.pathname.indexOf(BLOG_MEDIA_PUBLIC_PATH);
    if (markerIndex < 0) return false;
    filePath = decodeURIComponent(
      url.pathname.slice(markerIndex + BLOG_MEDIA_PUBLIC_PATH.length),
    );
  } catch {
    return false;
  }

  const segments = filePath.split("/");
  if (
    segments.length < 2 ||
    segments[0] !== ownerId ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    return false;
  }

  const { error } = await supabase.storage.from("blog-media").remove([filePath]);
  if (error) {
    logger.error("Failed to delete blog image from Supabase storage:", error);
    throw error;
  }

  return true;
}

export const storageService = {
  uploadForumImage,
  deleteForumImage,
  uploadEventImage,
  uploadEventVideo,
  uploadAvatarImage,
  abandonEventMedia,
  uploadBlogImage,
  deleteBlogImage,
};

export default storageService;
