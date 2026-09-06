import { createRequire } from 'node:module';
import type sanitizeHtmlType from 'sanitize-html';

const sanitizeHtml = createRequire(__filename)(
  'sanitize-html',
) as typeof sanitizeHtmlType;

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^\d+$/;
const INLINE_VIDEO_PATH =
  /^\/storage\/v1\/object\/public\/inline-media\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/videos\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:mp4|webm)$/i;

const youtubeHosts = new Set([
  'youtube.com',
  'www.youtube.com',
  'youtu.be',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);
const vimeoHosts = new Set(['vimeo.com', 'www.vimeo.com', 'player.vimeo.com']);

export function normalizeVideoEmbedUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    const host = url.hostname.toLowerCase();

    if (youtubeHosts.has(host)) {
      let id = '';
      if (host === 'youtu.be') {
        id = url.pathname.split('/').filter(Boolean)[0] ?? '';
      } else if (url.pathname === '/watch') {
        id = url.searchParams.get('v') ?? '';
      } else {
        const segments = url.pathname.split('/').filter(Boolean);
        if (segments[0] === 'embed' || segments[0] === 'shorts') {
          id = segments[1] ?? '';
        }
      }
      return YOUTUBE_ID.test(id)
        ? `https://www.youtube-nocookie.com/embed/${id}`
        : null;
    }

    if (vimeoHosts.has(host)) {
      const segments = url.pathname.split('/').filter(Boolean);
      const id = [...segments]
        .reverse()
        .find((segment) => VIMEO_ID.test(segment));
      return id ? `https://player.vimeo.com/video/${id}` : null;
    }
  } catch {
    return null;
  }
  return null;
}

export function isApprovedInlineVideoUrl(value: string): boolean {
  const configuredUrl =
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
  try {
    const expectedHost = new URL(configuredUrl).hostname.toLowerCase();
    const url = new URL(value.trim());
    return (
      Boolean(expectedHost) &&
      url.protocol === 'https:' &&
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

function isSafeImageUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

export function sanitizeRichTextHtml(dirty: string): string {
  return sanitizeHtml(dirty, {
    allowedTags: [
      'p',
      'br',
      'strong',
      'b',
      'em',
      'i',
      's',
      'strike',
      'code',
      'pre',
      'blockquote',
      'h2',
      'h3',
      'h4',
      'ul',
      'ol',
      'li',
      'a',
      'span',
      'img',
      'iframe',
      'video',
    ],
    allowedAttributes: {
      a: ['href', 'target', 'rel'],
      img: ['src', 'alt', 'title', 'width', 'height', 'class'],
      iframe: ['src', 'title', 'allow', 'allowfullscreen', 'class'],
      video: ['src', 'controls', 'playsinline', 'preload', 'class'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesByTag: {
      img: ['http', 'https'],
      iframe: ['http', 'https'],
      video: ['https'],
    },
    transformTags: {
      a: (_tagName, attribs) => ({
        tagName: 'a',
        attribs: {
          ...(attribs.href ? { href: attribs.href } : {}),
          ...(attribs.target === '_blank'
            ? { target: '_blank', rel: 'noopener noreferrer' }
            : {}),
        },
      }),
      iframe: (_tagName, attribs) => {
        const src = normalizeVideoEmbedUrl(attribs.src ?? '');
        const sanitizedAttributes: Record<string, string> = src
          ? {
              src,
              title: attribs.title?.trim() || 'Embedded video',
              allow:
                'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen',
              allowfullscreen: '',
              class: 'my-4 aspect-video w-full rounded-lg border-0',
            }
          : {};
        return {
          tagName: 'iframe',
          attribs: sanitizedAttributes,
        };
      },
      video: (_tagName, attribs) => {
        const sanitizedAttributes: Record<string, string> =
          isApprovedInlineVideoUrl(attribs.src ?? '')
            ? {
                src: attribs.src.trim(),
                controls: '',
                playsinline: '',
                preload: 'metadata',
                class:
                  'my-4 aspect-video w-full rounded-lg bg-black object-contain',
              }
            : {};
        return { tagName: 'video', attribs: sanitizedAttributes };
      },
      img: (_tagName, attribs) => ({
        tagName: 'img',
        attribs: isSafeImageUrl(attribs.src ?? '')
          ? {
              src: attribs.src.trim(),
              ...(attribs.alt ? { alt: attribs.alt } : {}),
              ...(attribs.title ? { title: attribs.title } : {}),
              ...(attribs.width ? { width: attribs.width } : {}),
              ...(attribs.height ? { height: attribs.height } : {}),
              class: 'my-4 max-w-full rounded-lg',
            }
          : {},
      }),
    },
    exclusiveFilter: (frame) =>
      (frame.tag === 'iframe' ||
        frame.tag === 'video' ||
        frame.tag === 'img') &&
      !frame.attribs.src,
  });
}
