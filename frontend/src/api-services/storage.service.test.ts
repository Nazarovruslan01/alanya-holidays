import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockUpload,
  mockUploadToSignedUrl,
  mockRemove,
  mockGetPublicUrl,
  mockFrom,
  mockGetUser,
} = vi.hoisted(() => {
  const mockUpload = vi.fn();
  const mockUploadToSignedUrl = vi.fn();
  const mockRemove = vi.fn();
  const mockGetPublicUrl = vi.fn();
  const mockFrom = vi.fn(() => ({
    upload: mockUpload,
    uploadToSignedUrl: mockUploadToSignedUrl,
    remove: mockRemove,
    getPublicUrl: mockGetPublicUrl,
  }));
  const mockGetUser = vi.fn();
  return {
    mockUpload,
    mockUploadToSignedUrl,
    mockRemove,
    mockGetPublicUrl,
    mockFrom,
    mockGetUser,
  };
});

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getUser: mockGetUser,
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
    },
    storage: {
      from: mockFrom,
    },
  },
}));

import {
  deleteBlogImage,
  deleteForumImage,
  uploadBlogImage,
  uploadEventImage,
  uploadEventVideo,
  uploadAvatarImage,
  uploadForumImage,
  uploadInlineVideo,
  storageService,
} from "./storage.service";
import { apiClient } from "@/lib/api-client";

describe("storage.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  });

  describe("event media", () => {
    it("uploads video only through a backend-issued signed non-upsert intent", async () => {
      const file = new File(["video"], "clip.mp4", { type: "video/mp4" });
      const intent = {
        mediaId: "11111111-1111-4111-a111-111111111111",
        path: "owner-1/events/22222222-2222-4222-a222-222222222222.mp4",
        token: "one-time-token",
      };
      const finalized = {
        mediaId: intent.mediaId,
        url: "https://project.supabase.co/storage/v1/object/public/event-media/owner-1/events/22222222-2222-4222-a222-222222222222.mp4",
      };
      vi.spyOn(apiClient, "post")
        .mockResolvedValueOnce(intent)
        .mockResolvedValueOnce(finalized);
      mockUploadToSignedUrl.mockResolvedValue({
        data: { path: intent.path },
        error: null,
      });
      mockUpload.mockResolvedValue({ data: { path: intent.path }, error: null });
      mockGetPublicUrl.mockReturnValue({ data: { publicUrl: finalized.url } });

      await expect(uploadEventVideo(file, "owner-1")).resolves.toEqual(finalized);

      expect(apiClient.post).toHaveBeenNthCalledWith(1, "/media/events/video-intent", {
        fileName: "clip.mp4",
        mimeType: "video/mp4",
        sizeBytes: file.size,
      });
      expect(mockUploadToSignedUrl).toHaveBeenCalledWith(
        intent.path,
        intent.token,
        file,
        { cacheControl: "3600", contentType: "video/mp4", upsert: false },
      );
      expect(mockFrom).toHaveBeenCalledWith("event-media-staging");
      expect(apiClient.post).toHaveBeenNthCalledWith(
        2,
        `/media/events/${intent.mediaId}/finalize`,
        {},
      );
      expect(mockUpload).not.toHaveBeenCalled();
    });

    it("uploads an event image through the authenticated media API", async () => {
      const file = new File(["cover"], "cover.png", { type: "image/png" });
      const uploaded = {
        mediaId: "11111111-1111-4111-a111-111111111111",
        url: "https://project.supabase.co/storage/v1/object/public/forum-media/user-1/events/full.webp",
        thumbnailUrl:
          "https://project.supabase.co/storage/v1/object/public/forum-media/user-1/events/thumb.webp",
      };
      vi.spyOn(apiClient, "post").mockResolvedValue(uploaded);

      await expect(uploadEventImage(file)).resolves.toEqual(uploaded);

      expect(apiClient.post).toHaveBeenCalledTimes(1);
      const [endpoint, body] = vi.mocked(apiClient.post).mock.calls[0];
      expect(endpoint).toBe("/media/events/image");
      expect(body).toBeInstanceOf(FormData);
      const form = body as FormData;
      expect(form.get("file")).toBe(file);
      expect(form.get("bucket")).toBeNull();
      expect(form.get("folder")).toBeNull();
    });

    it.each([
      ["image/svg+xml", 1, "Only JPEG, PNG, and WebP images are allowed"],
      ["image/png", 0, "Image file must not be empty"],
      ["image/png", 5 * 1024 * 1024 + 1, "Image must not exceed 5 MB"],
    ])(
      "rejects invalid event images before the network request",
      async (type, size, message) => {
        const file = new File(["cover"], "cover.png", { type });
        Object.defineProperty(file, "size", { value: size });
        const postSpy = vi.spyOn(apiClient, "post");

        await expect(uploadEventImage(file)).rejects.toThrow(message);

        expect(postSpy).not.toHaveBeenCalled();
        expect(mockUpload).not.toHaveBeenCalled();
      },
    );

    it.each([
      ["video/quicktime", 1, "Only MP4 and WebM videos are allowed"],
      ["video/webm", 0, "Video file must not be empty"],
      ["video/webm", 50 * 1024 * 1024 + 1, "Video must not exceed 50 MB"],
    ])(
      "rejects invalid event videos before authentication or upload",
      async (type, size, message) => {
        const file = new File(["video"], "clip.webm", { type });
        Object.defineProperty(file, "size", { value: size });

        await expect(uploadEventVideo(file, "user-1")).rejects.toThrow(message);

        expect(mockGetUser).not.toHaveBeenCalled();
        expect(mockUploadToSignedUrl).not.toHaveBeenCalled();
      },
    );
  });

  describe("uploadAvatarImage", () => {
    it("uploads an avatar through the authenticated media API", async () => {
      const file = new File(["avatar"], "avatar.png", { type: "image/png" });
      const uploaded = {
        originalName: "avatar.png",
        url: "https://project.supabase.co/storage/v1/object/public/forum-media/user-1/avatars/full.webp",
        thumbnailUrl:
          "https://project.supabase.co/storage/v1/object/public/forum-media/user-1/avatars/thumb.webp",
        format: "webp" as const,
        sizeBytes: 42,
      };
      vi.spyOn(apiClient, "post").mockResolvedValue(uploaded);

      await expect(uploadAvatarImage(file)).resolves.toEqual(uploaded);

      expect(apiClient.post).toHaveBeenCalledTimes(1);
      const [endpoint, body] = vi.mocked(apiClient.post).mock.calls[0];
      expect(endpoint).toBe("/media/upload");
      expect(body).toBeInstanceOf(FormData);
      const form = body as FormData;
      expect(form.get("file")).toBe(file);
      expect(form.get("bucket")).toBe("forum-media");
      expect(form.get("folder")).toBe("avatars");
    });

    it.each([
      ["image/svg+xml", 1, "Only JPEG, PNG, and WebP images are allowed"],
      ["image/png", 0, "Image file must not be empty"],
      ["image/png", 5 * 1024 * 1024 + 1, "Image must not exceed 5 MB"],
    ])("rejects invalid avatar files before the network request", async (type, size, message) => {
      const file = new File(["avatar"], "avatar.png", { type });
      Object.defineProperty(file, "size", { value: size });
      const postSpy = vi.spyOn(apiClient, "post");

      await expect(uploadAvatarImage(file)).rejects.toThrow(message);

      expect(postSpy).not.toHaveBeenCalled();
    });
  });

  describe("uploadForumImage", () => {
    it("uploads through the authenticated backend-derived inline folder", async () => {
      const mockFile = new File(["dummy content"], "photo.jpg", { type: "image/jpeg" });
      const uploaded = {
        originalName: "photo.jpg",
        url: "https://project.supabase.co/storage/v1/object/public/forum-media/user-1/inline/file-full.webp",
        thumbnailUrl: "https://project.supabase.co/storage/v1/object/public/forum-media/user-1/inline/file-thumb.webp",
        format: "webp" as const,
        sizeBytes: 42,
      };
      vi.spyOn(apiClient, "post").mockResolvedValue(uploaded);

      await expect(uploadForumImage(mockFile)).resolves.toBe(uploaded.url);

      const [endpoint, body] = vi.mocked(apiClient.post).mock.calls[0];
      expect(endpoint).toBe("/media/upload");
      expect(body).toBeInstanceOf(FormData);
      const form = body as FormData;
      expect(form.get("file")).toBe(mockFile);
      expect(form.get("bucket")).toBe("forum-media");
      expect(form.get("folder")).toBe("inline");
      expect(mockUpload).not.toHaveBeenCalled();
    });

    it.each([
      ["image/svg+xml", 1, "Only JPEG, PNG, and WebP images are allowed"],
      ["image/png", 0, "Image file must not be empty"],
      ["image/png", 5 * 1024 * 1024 + 1, "Image must not exceed 5 MB"],
    ])("rejects invalid inline images before the request", async (type, size, message) => {
      const file = new File(["image"], "image.png", { type });
      Object.defineProperty(file, "size", { value: size });
      const postSpy = vi.spyOn(apiClient, "post");

      await expect(uploadForumImage(file)).rejects.toThrow(message);
      expect(postSpy).not.toHaveBeenCalled();
    });

    it("uploads a validated inline video through the dedicated endpoint", async () => {
      const file = new File(["video"], "clip.webm", { type: "video/webm" });
      const uploaded = {
        url: "https://project.supabase.co/storage/v1/object/public/inline-media/user/videos/file.webm",
        mimeType: "video/webm" as const,
        sizeBytes: file.size,
      };
      vi.spyOn(apiClient, "post").mockResolvedValue(uploaded);

      await expect(uploadInlineVideo(file)).resolves.toEqual(uploaded);

      const [endpoint, body] = vi.mocked(apiClient.post).mock.calls[0];
      expect(endpoint).toBe("/media/content/video");
      expect((body as FormData).get("file")).toBe(file);
    });

    it.each([
      ["video/quicktime", 1, "Only MP4 and WebM videos are allowed"],
      ["video/mp4", 0, "Video file must not be empty"],
      ["video/mp4", 50 * 1024 * 1024 + 1, "Video must not exceed 50 MB"],
    ])("rejects invalid inline videos before the request", async (type, size, message) => {
      const file = new File(["video"], "clip.mp4", { type });
      Object.defineProperty(file, "size", { value: size });
      const postSpy = vi.spyOn(apiClient, "post");

      await expect(uploadInlineVideo(file)).rejects.toThrow(message);
      expect(postSpy).not.toHaveBeenCalled();
    });

    it("should export the inline media helpers", () => {
      expect(storageService).toEqual(
        expect.objectContaining({
          uploadForumImage: expect.any(Function),
          uploadInlineVideo: expect.any(Function),
        }),
      );
    });
  });

  describe("blog images", () => {
    it("uploads an owned image to the blog-media bucket", async () => {
      const file = new File(["cover"], "alanya.webp", { type: "image/webp" });
      const expectedUrl =
        "https://project.supabase.co/storage/v1/object/public/blog-media/user-1/cover.webp";
      mockUpload.mockResolvedValue({ data: { path: "user-1/cover.webp" }, error: null });
      mockGetPublicUrl.mockReturnValue({ data: { publicUrl: expectedUrl } });

      const url = await uploadBlogImage(file, "user-1");

      expect(mockFrom).toHaveBeenCalledWith("blog-media");
      const [path, uploadedFile, options] = mockUpload.mock.calls[0];
      expect(path).toMatch(/^user-1\/[0-9a-f-]+\.webp$/);
      expect(uploadedFile).toBe(file);
      expect(options).toEqual({ cacheControl: "3600", upsert: false });
      expect(url).toBe(expectedUrl);
    });

    it("deletes an owned image from the blog-media bucket", async () => {
      mockRemove.mockResolvedValue({ data: [], error: null });

      const deleted = await deleteBlogImage(
        "https://project.supabase.co/storage/v1/object/public/blog-media/user-1/cover.webp",
        "user-1"
      );

      expect(mockFrom).toHaveBeenCalledWith("blog-media");
      expect(mockRemove).toHaveBeenCalledWith(["user-1/cover.webp"]);
      expect(deleted).toBe(true);
    });

    it("refuses to delete another user's blog image", async () => {
      const deleted = await deleteBlogImage(
        "https://project.supabase.co/storage/v1/object/public/blog-media/user-2/cover.webp",
        "user-1"
      );

      expect(deleted).toBe(false);
      expect(mockRemove).not.toHaveBeenCalled();
    });
  });

  describe("deleteForumImage", () => {
    it("deletes an owned object from the forum-media bucket", async () => {
      mockRemove.mockResolvedValue({ data: [], error: null });

      const deleted = await deleteForumImage(
        "https://project.supabase.co/storage/v1/object/public/forum-media/user-1/cover.webp",
        "user-1",
      );

      expect(mockFrom).toHaveBeenCalledWith("forum-media");
      expect(mockRemove).toHaveBeenCalledWith(["user-1/cover.webp"]);
      expect(deleted).toBe(true);
    });

    it("refuses to delete another user's object", async () => {
      const deleted = await deleteForumImage(
        "https://project.supabase.co/storage/v1/object/public/forum-media/user-2/cover.webp",
        "user-1",
      );

      expect(deleted).toBe(false);
      expect(mockRemove).not.toHaveBeenCalled();
    });

    it("throws when Supabase fails to delete an owned object", async () => {
      mockRemove.mockResolvedValue({ data: null, error: new Error("Delete failed") });

      await expect(
        deleteForumImage(
          "https://project.supabase.co/storage/v1/object/public/forum-media/user-1/cover.webp",
          "user-1",
        ),
      ).rejects.toThrow("Delete failed");
    });
  });
});
