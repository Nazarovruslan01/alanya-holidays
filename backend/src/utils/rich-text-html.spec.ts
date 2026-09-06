import { execFileSync } from 'node:child_process';

function sanitizeRichTextHtml(input: string): string {
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
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        SUPABASE_URL: 'https://project-ref.supabase.co',
      },
    },
  );
}

function sanitizeThroughForumUpdate(input: string): string {
  return execFileSync(
    process.execPath,
    [
      '-r',
      'ts-node/register',
      '-e',
      [
        "const { ForumDiscussionService } = require('./src/forum/application/forum-discussion.service');",
        'let saved;',
        "const repository = { getPostById: async () => ({ id: 'post-1', author_id: '10000000-0000-4000-8000-000000000001' }), updatePost: async (_id, update) => { saved = update; return { id: 'post-1', ...update }; } };",
        "const roles = { getRole: async () => 'user' };",
        "new ForumDiscussionService(repository, roles).updateForumPost('post-1', { body: JSON.parse(process.argv[1]) }, '10000000-0000-4000-8000-000000000001').then(() => process.stdout.write(saved.body));",
      ].join(' '),
      JSON.stringify(input),
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        SUPABASE_URL: 'https://project-ref.supabase.co',
      },
    },
  );
}

describe('sanitizeRichTextHtml', () => {
  it('preserves the editor formatting and safe images', () => {
    const html = [
      '<h2>Heading</h2>',
      '<p><strong>Bold</strong> <em>italic</em> <s>strike</s> <code>code</code></p>',
      '<ol><li>One</li></ol>',
      '<blockquote>Quote</blockquote>',
      '<img src="https://images.example.com/photo.webp" alt="Beach">',
    ].join('');

    const sanitized = sanitizeRichTextHtml(html);
    expect(sanitized).toContain('<h2>Heading</h2>');
    expect(sanitized).toContain(
      '<p><strong>Bold</strong> <em>italic</em> <s>strike</s> <code>code</code></p>',
    );
    expect(sanitized).toContain('<ol><li>One</li></ol>');
    expect(sanitized).toContain('<blockquote>Quote</blockquote>');
    expect(sanitized).toContain(
      '<img src="https://images.example.com/photo.webp" alt="Beach" class="my-4 max-w-full rounded-lg" />',
    );
  });

  it.each([
    [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    ],
    [
      'https://youtu.be/dQw4w9WgXcQ?t=4',
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    ],
    ['https://vimeo.com/76979871', 'https://player.vimeo.com/video/76979871'],
  ])('normalizes an approved video link', (input, expected) => {
    expect(sanitizeRichTextHtml(`<iframe src="${input}"></iframe>`)).toBe(
      `<iframe src="${expected}" title="Embedded video" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen" allowfullscreen class="my-4 aspect-video w-full rounded-lg border-0"></iframe>`,
    );
  });

  it('removes arbitrary frames, executable URLs, and event handlers', () => {
    const sanitized = sanitizeRichTextHtml(
      '<p onclick="alert(1)">Safe</p>' +
        '<a href="javascript:alert(1)">link</a>' +
        '<img src="data:text/html,boom" onerror="alert(1)">' +
        '<iframe src="https://youtube.com.evil.test/embed/dQw4w9WgXcQ"></iframe>',
    );

    expect(sanitized).toBe('<p>Safe</p><a>link</a>');
  });

  it('keeps only server-owned inline video paths on the configured Supabase host', () => {
    const approved =
      'https://project-ref.supabase.co/storage/v1/object/public/inline-media/' +
      '10000000-0000-4000-8000-000000000001/videos/' +
      '20000000-0000-4000-8000-000000000002.mp4';
    const wrongHost = approved.replace(
      'project-ref.supabase.co',
      'project-ref.supabase.co.evil.test',
    );
    const wrongBucket = approved.replace('inline-media', 'event-media');

    expect(
      sanitizeRichTextHtml(
        `<video src="${approved}" autoplay loop controls></video>` +
          `<video src="${wrongHost}" controls></video>` +
          `<video src="${wrongBucket}" controls></video>`,
      ),
    ).toBe(
      `<video src="${approved}" controls playsinline preload="metadata" class="my-4 aspect-video w-full rounded-lg bg-black object-contain"></video>`,
    );
  });

  it('applies the real sanitizer at the forum update persistence boundary', () => {
    const approved =
      'https://project-ref.supabase.co/storage/v1/object/public/inline-media/' +
      '10000000-0000-4000-8000-000000000001/videos/' +
      '20000000-0000-4000-8000-000000000002.webm';
    const saved = sanitizeThroughForumUpdate(
      '<p>Before <strong>bold</strong></p><ul><li>One</li></ul>' +
        '<iframe src="https://vimeo.com/76979871"></iframe>' +
        `<video src="${approved}" autoplay controls></video>` +
        '<script>alert(1)</script><iframe src="https://evil.example/embed"></iframe>',
    );

    expect(saved).toContain('<p>Before <strong>bold</strong></p>');
    expect(saved).toContain('<ul><li>One</li></ul>');
    expect(saved).toContain('https://player.vimeo.com/video/76979871');
    expect(saved).toContain(approved);
    expect(saved).not.toMatch(/<video[^>]*\sautoplay/);
    expect(saved).not.toContain('script');
    expect(saved).not.toContain('evil.example');
  });
});
