import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isApprovedInlineVideoUrl,
  normalizeVideoEmbedUrl,
} from "./richTextMedia";

describe("rich-text media URL policy", () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=ignored",
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    ],
    [
      "https://youtu.be/dQw4w9WgXcQ?t=4",
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    ],
    [
      "https://vimeo.com/76979871",
      "https://player.vimeo.com/video/76979871",
    ],
  ])("normalizes approved provider links", (input, expected) => {
    expect(normalizeVideoEmbedUrl(input)).toBe(expected);
  });

  it.each([
    "javascript:alert(1)",
    "https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ",
    "https://vimeo.com.evil.test/76979871",
    "https://www.youtube.com/watch?v=too-short",
  ])("rejects an unapproved embed URL", (input) => {
    expect(normalizeVideoEmbedUrl(input)).toBeNull();
  });

  it("requires the configured Supabase host and immutable inline-media path", () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://project-ref.supabase.co");
    const approved =
      "https://project-ref.supabase.co/storage/v1/object/public/inline-media/" +
      "10000000-0000-4000-8000-000000000001/videos/" +
      "20000000-0000-4000-8000-000000000002.webm";

    expect(isApprovedInlineVideoUrl(approved)).toBe(true);
    expect(
      isApprovedInlineVideoUrl(
        approved.replace("project-ref.supabase.co", "project-ref.supabase.co.evil.test"),
      ),
    ).toBe(false);
    expect(isApprovedInlineVideoUrl(approved.replace("inline-media", "event-media"))).toBe(
      false,
    );
  });
});
