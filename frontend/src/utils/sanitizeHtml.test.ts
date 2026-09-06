import { afterEach, describe, expect, it, vi } from "vitest";
import { sanitizeForumHtml } from "./sanitizeHtml";

describe("sanitizeForumHtml media policy", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("keeps formatting and normalizes approved provider frames", () => {
    const result = sanitizeForumHtml(
      '<h2>Title</h2><p><strong>Bold</strong></p><ul><li>One</li></ul>' +
        '<iframe src="https://youtu.be/dQw4w9WgXcQ"></iframe>',
    );

    expect(result).toContain("<h2>Title</h2>");
    expect(result).toContain("<ul><li>One</li></ul>");
    expect(result).toContain(
      'src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"',
    );
  });

  it("removes arbitrary frames and executable image URLs", () => {
    expect(
      sanitizeForumHtml(
        '<iframe src="https://evil.test/player"></iframe>' +
          '<img src="javascript:alert(1)" onerror="alert(2)">',
      ),
    ).toBe("");
  });

  it("keeps only validated inline-media video URLs", () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://project-ref.supabase.co");
    const approved =
      "https://project-ref.supabase.co/storage/v1/object/public/inline-media/" +
      "10000000-0000-4000-8000-000000000001/videos/" +
      "20000000-0000-4000-8000-000000000002.mp4";

    expect(
      sanitizeForumHtml(
        `<video src="${approved}" autoplay controls></video>` +
          '<video src="https://evil.test/video.mp4" controls></video>',
      ),
    ).toBe(
      `<video src="${approved}" controls="" playsinline="" preload="metadata" class="my-4 aspect-video w-full rounded-lg bg-black object-contain"></video>`,
    );
  });
});
