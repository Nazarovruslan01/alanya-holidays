import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, test, type Locator } from '@playwright/test';
import {
  MOCK_USER_ID,
  mockSupabaseRest,
  seedAuthSession,
} from './utils/mock-utils';

const SUPABASE_ORIGIN = 'https://mdmizeyiyebvhkujjyjg.supabase.co';
const IMAGE_URL =
  `${SUPABASE_ORIGIN}/storage/v1/object/public/forum-media/${MOCK_USER_ID}/inline/image-full.webp`;
const VIDEO_URL =
  `${SUPABASE_ORIGIN}/storage/v1/object/public/inline-media/${MOCK_USER_ID}/videos/20000000-0000-4000-8000-000000000002.mp4`;

function sanitizeWithBackend(input: string): string {
  return execFileSync(
    process.execPath,
    [
      '-r',
      'ts-node/register',
      '-e',
      "const { sanitizeRichTextHtml } = require('./src/utils/rich-text-html'); process.stdout.write(sanitizeRichTextHtml(JSON.parse(process.argv[1])));",
      JSON.stringify(input),
    ],
    {
      cwd: resolve(process.cwd(), '../backend'),
      encoding: 'utf8',
      env: { ...process.env, SUPABASE_URL: SUPABASE_ORIGIN },
    },
  );
}

async function selectEditorText(editor: Locator, text: string): Promise<void> {
  await editor.evaluate((element, selectedText) => {
    const textNodes: Text[] = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      textNodes.push(node as Text);
      node = walker.nextNode();
    }
    const combined = textNodes.map((textNode) => textNode.data).join('');
    const start = combined.indexOf(selectedText);
    if (start < 0) throw new Error(`Could not find editor text: ${selectedText}`);
    const end = start + selectedText.length;
    let offset = 0;
    let startNode: Text | null = null;
    let endNode: Text | null = null;
    let startOffset = 0;
    let endOffset = 0;
    for (const textNode of textNodes) {
      const nextOffset = offset + textNode.data.length;
      if (!startNode && start >= offset && start <= nextOffset) {
        startNode = textNode;
        startOffset = start - offset;
      }
      if (!endNode && end >= offset && end <= nextOffset) {
        endNode = textNode;
        endOffset = end - offset;
        break;
      }
      offset = nextOffset;
    }
    if (!startNode || !endNode) throw new Error('Could not map editor selection');
    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    element.focus();
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  }, text);
}

test('saves, renders, and reopens complete inline media in real Quill', async ({ page }) => {
  await seedAuthSession(page);
  await mockSupabaseRest(page);

  let persistedBody = '<p>Starting content for the media round trip.</p>';
  const mediaAuthorizationHeaders: Array<string | undefined> = [];
  let releaseVideoUpload: (() => void) | undefined;
  const videoUploadGate = new Promise<void>((resolve) => {
    releaseVideoUpload = resolve;
  });
  const post = () => ({
    id: 'post-1',
    slug: 'inline-media-roundtrip',
    title: 'Inline media round trip',
    body: persistedBody,
    category_id: 'general',
    author_id: MOCK_USER_ID,
    post_type: 'discussion',
    views_count: 2,
    likes_count: 0,
    comments_count: 0,
    is_pinned: false,
    created_at: '2026-09-06T12:00:00.000Z',
    category: { id: 'general', name: 'General', slug: 'general' },
    author: {
      full_name: 'Test User',
      role: 'guest',
      created_at: '2024-01-01T00:00:00.000Z',
    },
  });

  await page.route('**/api/media/upload', async (route) => {
    mediaAuthorizationHeaders.push(route.request().headers().authorization);
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        originalName: 'image.png',
        url: IMAGE_URL,
        thumbnailUrl: IMAGE_URL,
        format: 'webp',
        sizeBytes: 8,
      }),
    });
  });
  await page.route('**/api/media/content/video', async (route) => {
    mediaAuthorizationHeaders.push(route.request().headers().authorization);
    await videoUploadGate;
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        url: VIDEO_URL,
        mimeType: 'video/mp4',
        sizeBytes: 12,
      }),
    });
  });
  await page.route('**/api/forum/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;

    if (request.method() === 'GET' && path.endsWith('/forum/posts/slug/inline-media-roundtrip')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(post()) });
      return;
    }
    if (request.method() === 'GET' && path.endsWith('/forum/comments/post/post-1')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      return;
    }
    if (request.method() === 'PUT' && path.endsWith('/forum/posts/post-1')) {
      const body = request.postDataJSON() as { body: string };
      persistedBody = sanitizeWithBackend(body.body);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(post()) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true }),
    });
  });

  await page.goto('/thread/inline-media-roundtrip');
  const postArticle = page.locator('article');
  await expect(postArticle.getByRole('button', { name: 'Edit Post' })).toBeVisible();
  await postArticle.getByRole('button', { name: 'Edit Post' }).click();

  const editor = postArticle.locator('.ql-editor');
  await expect(editor).toBeVisible();
  await editor.fill(
    'Opening paragraph\nBold phrase\nFirst item\nSecond item\nClosing paragraph',
  );
  await selectEditorText(editor, 'Bold phrase');
  await postArticle.locator('button.ql-bold').click();
  await expect(editor.locator('strong')).toContainText('Bold phrase');
  await selectEditorText(editor, 'First item');
  await postArticle.locator('button.ql-list[value="bullet"]').click();
  await expect(editor.locator('li').filter({ hasText: 'First item' })).toHaveCount(1);

  const imageChooser = page.waitForEvent('filechooser');
  await postArticle.locator('button.ql-image').click();
  await (await imageChooser).setFiles({
    name: 'image.png',
    mimeType: 'image/png',
    buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  });
  await expect(editor.locator(`img[src="${IMAGE_URL}"]`)).toBeVisible();

  await postArticle.locator('button.ql-video').click();
  await postArticle.getByLabel('Video link').fill('https://youtu.be/dQw4w9WgXcQ?t=12');
  await postArticle.getByRole('button', { name: 'Insert video' }).click();
  await expect(
    editor.locator('iframe[src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"]'),
  ).toBeVisible();

  await postArticle.locator('button.ql-video').click();
  await postArticle.getByLabel('Upload MP4 or WebM').setInputFiles({
    name: 'clip.mp4',
    mimeType: 'video/mp4',
    buffer: Buffer.from('ftyp-real-validation-is-covered-by-the-backend-ffprobe-gate'),
  });
  await expect(postArticle.getByRole('button', { name: 'Save Changes' })).toBeDisabled();
  releaseVideoUpload?.();
  await expect(editor.locator(`video[src="${VIDEO_URL}"]`)).toBeVisible();
  await expect(postArticle.getByRole('button', { name: 'Save Changes' })).toBeEnabled();

  const updateResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      response.url().endsWith('/api/forum/posts/post-1'),
  );
  await postArticle.getByRole('button', { name: 'Save Changes' }).click();
  await updateResponse;

  expect(mediaAuthorizationHeaders).toHaveLength(2);
  expect(mediaAuthorizationHeaders.every((header) => header?.startsWith('Bearer '))).toBe(true);
  const normalizedPersistedBody = persistedBody.replace(/\u00a0/g, ' ');
  expect(normalizedPersistedBody).toContain('<strong>Bold phrase</strong>');
  expect(normalizedPersistedBody).toContain('<li>First item</li>');
  expect(persistedBody).toContain(IMAGE_URL);
  expect(persistedBody).toContain('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  expect(persistedBody).toContain(VIDEO_URL);

  await page.reload();
  await expect(postArticle.locator('strong')).toContainText('Bold phrase');
  await expect(postArticle.locator('li').filter({ hasText: 'First item' })).toHaveCount(1);
  await expect(postArticle.locator(`img[src="${IMAGE_URL}"]`)).toBeVisible();
  await expect(
    postArticle.locator('iframe[src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"]'),
  ).toBeVisible();
  await expect(postArticle.locator(`video[src="${VIDEO_URL}"]`)).toBeVisible();

  await postArticle.getByRole('button', { name: 'Edit Post' }).click();
  const reopenedEditor = postArticle.locator('.ql-editor');
  await expect(reopenedEditor.locator('strong')).toContainText('Bold phrase');
  await expect(reopenedEditor.locator('li').filter({ hasText: 'First item' })).toHaveCount(1);
  await expect(reopenedEditor.locator(`img[src="${IMAGE_URL}"]`)).toBeVisible();
  await expect(reopenedEditor.locator('iframe')).toHaveAttribute(
    'src',
    'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
  );
  await expect(reopenedEditor.locator(`video[src="${VIDEO_URL}"]`)).toBeVisible();
});
