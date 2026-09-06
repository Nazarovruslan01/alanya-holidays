const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^\d+$/;
const INLINE_VIDEO_PATH =
  /^\/storage\/v1\/object\/public\/inline-media\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/videos\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:mp4|webm)$/i;

const youtubeHosts = new Set([
  "youtube.com",
  "www.youtube.com",
  "youtu.be",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);
const vimeoHosts = new Set(["vimeo.com", "www.vimeo.com", "player.vimeo.com"]);

export function normalizeVideoEmbedUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const host = url.hostname.toLowerCase();

    if (youtubeHosts.has(host)) {
      let id = "";
      if (host === "youtu.be") {
        id = url.pathname.split("/").filter(Boolean)[0] ?? "";
      } else if (url.pathname === "/watch") {
        id = url.searchParams.get("v") ?? "";
      } else {
        const segments = url.pathname.split("/").filter(Boolean);
        if (segments[0] === "embed" || segments[0] === "shorts") {
          id = segments[1] ?? "";
        }
      }
      return YOUTUBE_ID.test(id)
        ? `https://www.youtube-nocookie.com/embed/${id}`
        : null;
    }

    if (vimeoHosts.has(host)) {
      const segments = url.pathname.split("/").filter(Boolean);
      const id = [...segments].reverse().find((segment) => VIMEO_ID.test(segment));
      return id ? `https://player.vimeo.com/video/${id}` : null;
    }
  } catch {
    return null;
  }
  return null;
}

export function isApprovedInlineVideoUrl(value: string): boolean {
  const configuredUrl =
    (import.meta.env.VITE_SUPABASE_URL as string | undefined) ||
    (import.meta.env.VITE_PUBLIC_SUPABASE_URL as string | undefined) ||
    "";
  try {
    const expectedHost = new URL(configuredUrl).hostname.toLowerCase();
    const url = new URL(value.trim());
    return (
      Boolean(expectedHost) &&
      url.protocol === "https:" &&
      url.hostname.toLowerCase() === expectedHost &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      INLINE_VIDEO_PATH.test(url.pathname)
    );
  } catch {
    return false;
  }
}

export function isSafeImageUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}
