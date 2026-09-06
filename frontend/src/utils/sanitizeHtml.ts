import DOMPurify from 'dompurify';
import {
  isApprovedInlineVideoUrl,
  isSafeImageUrl,
  normalizeVideoEmbedUrl,
} from './richTextMedia';

const FORUM_ALLOWED_TAGS = [
  'p', 'br', 'strong', 'em', 's', 'code', 'pre', 'blockquote',
  'ul', 'ol', 'li', 'a', 'img', 'iframe', 'video',
  'h2', 'h3', 'h4',
];

const FORUM_ALLOWED_ATTR = ['href', 'src', 'alt', 'title', 'width', 'height', 'allow', 'allowfullscreen', 'controls', 'playsinline', 'preload', 'target', 'rel'];

export const sanitizeForumHtml = (dirty: string): string => {
  const sanitized = DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS: FORUM_ALLOWED_TAGS,
    ALLOWED_ATTR: FORUM_ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
  });
  const template = document.createElement('template');
  template.innerHTML = sanitized;

  template.content.querySelectorAll('iframe').forEach((frame) => {
    const src = normalizeVideoEmbedUrl(frame.getAttribute('src') ?? '');
    if (!src) {
      frame.remove();
      return;
    }
    frame.replaceChildren();
    [...frame.attributes].forEach((attribute) => frame.removeAttribute(attribute.name));
    frame.setAttribute('src', src);
    frame.setAttribute('title', 'Embedded video');
    frame.setAttribute(
      'allow',
      'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen',
    );
    frame.setAttribute('allowfullscreen', '');
    frame.setAttribute('class', 'my-4 aspect-video w-full rounded-lg border-0');
  });

  template.content.querySelectorAll('video').forEach((video) => {
    const src = video.getAttribute('src') ?? '';
    if (!isApprovedInlineVideoUrl(src)) {
      video.remove();
      return;
    }
    video.replaceChildren();
    [...video.attributes].forEach((attribute) => video.removeAttribute(attribute.name));
    video.setAttribute('src', src);
    video.setAttribute('controls', '');
    video.setAttribute('playsinline', '');
    video.setAttribute('preload', 'metadata');
    video.setAttribute('class', 'my-4 aspect-video w-full rounded-lg bg-black object-contain');
  });

  template.content.querySelectorAll('img').forEach((image) => {
    if (!isSafeImageUrl(image.getAttribute('src') ?? '')) {
      image.remove();
      return;
    }
    image.setAttribute('class', 'my-4 max-w-full rounded-lg');
  });

  template.content.querySelectorAll('a[target="_blank"]').forEach((link) => {
    link.setAttribute('rel', 'noopener noreferrer');
  });

  return template.innerHTML;
};
