import { execFileSync } from 'node:child_process';

// One 16x16 H.264 frame in a real MP4 container, generated with ffmpeg.
const MP4_FIXTURE =
  'AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAANcbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAAHgAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAod0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAAHgAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAABAAAAAQAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAB4AAAEAAABAAAAAAH/bWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAyAAAACABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABqm1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAWpzdGJsAAAAvnN0c2QAAAAAAAAAAQAAAK5hdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAABAAEABIAAAASAAAAAAAAAABFUxhdmM2Mi4xMS4xMDAgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAANGF2Y0MBZAAK/+EAF2dkAAqs2V7ARAAAAwAEAAADAMg8SJZYAQAGaOvjyyLA/fj4AAAAABBwYXNwAAAAAQAAAAEAAAAUYnRydAAAAAAAAL7iAAAAAAAAABhzdHRzAAAAAAAAAAEAAAADAAACAAAAABRzdHNzAAAAAAAAAAEAAAABAAAAKGN0dHMAAAAAAAAAAwAAAAEAAAQAAAAAAQAABgAAAAABAAACAAAAABxzdHNjAAAAAAAAAAEAAAABAAAAAwAAAAEAAAAgc3RzegAAAAAAAAAAAAAAAwAAAsUAAAAMAAAADAAAABRzdGNvAAAAAAAAAAEAAAOMAAAAYXVkdGEAAABZbWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAbWRpcmFwcGwAAAAAAAAAAAAAAAAsaWxzdAAAACSpdG9vAAAAHGRhdGEAAAABAAAAAExhdmY2Mi4zLjEwMAAAAAhmcmVlAAAC5W1kYXQAAAKuBgX//6rcRem95tlIt5Ys2CDZI+7veDI2NCAtIGNvcmUgMTY1IHIzMjIyIGIzNTYwNWEgLSBILjI2NC9NUEVHLTQgQVZDIGNvZGVjIC0gQ29weWxlZnQgMjAwMy0yMDI1IC0gaHR0cDovL3d3dy52aWRlb2xhbi5vcmcveDI2NC5odG1sIC0gb3B0aW9uczogY2FiYWM9MSByZWY9MyBkZWJsb2NrPTE6MDowIGFuYWx5c2U9MHgzOjB4MTEzIG1lPWhleCBzdWJtZT03IHBzeT0xIHBzeV9yZD0xLjAwOjAuMDAgbWl4ZWRfcmVmPTEgbWVfcmFuZ2U9MTYgY2hyb21hX21lPTEgdHJlbGxpcz0xIDh4OGRjdD0xIGNxbT0wIGRlYWR6b25lPTIxLDExIGZhc3RfcHNraXA9MSBjaHJvbWFfcXBfb2Zmc2V0PS0yIHRocmVhZHM9MSBsb29rYWhlYWRfdGhyZWFkcz0xIHNsaWNlZF90aHJlYWRzPTAgbnI9MCBkZWNpbWF0ZT0xIGludGVybGFjZWQ9MCBibHVyYXlfY29tcGF0PTAgY29uc3RyYWluZWRfaW50cmE9MCBiZnJhbWVzPTMgYl9weXJhbWlkPTIgYl9hZGFwdD0xIGJfYmlhcz0wIGRpcmVjdD0xIHdlaWdodGI9MSBvcGVuX2dvcD0wIHdlaWdodHA9MiBrZXlpbnQ9MjUwIGtleWludF9taW49MjUgc2NlbmVjdXQ9NDAgaW50cmFfcmVmcmVzaD0wIHJjX2xvb2thaGVhZD00MCByYz1jcmYgbWJ0cmVlPTEgY3JmPTIzLjAgcWNvbXA9MC42MCBxcG1pbj0wIHFwbWF4PTY5IHFwc3RlcD00IGlwX3JhdGlvPTEuNDAgYXE9MToxLjAwAIAAAAAPZYiEADP//vbsvgU2FMjBAAAACEGaImxCv/7AAAAACAGeQXkK/8SB';

describe('InlineMediaService ffprobe integration', () => {
  it('probes real H.264 MP4 bytes before the immutable storage upload', () => {
    const output = execFileSync(
      process.execPath,
      [
        '-r',
        'ts-node/register',
        '-e',
        [
          "const { InlineMediaService } = require('./src/media/inline-media.service');",
          "const buffer = Buffer.from(process.argv[1], 'base64');",
          'let stored;',
          "const storage = { upload: async (path, bytes, options) => { stored = { path, size: bytes.length, options }; return { error: null }; }, remove: async () => ({ error: null }), getPublicUrl: (path) => ({ data: { publicUrl: 'https://project-ref.supabase.co/storage/v1/object/public/inline-media/' + path } }) };",
          'const supabase = { getClient: () => ({ storage: { from: () => storage } }) };',
          "new InlineMediaService(supabase).uploadVideo({ buffer, size: buffer.length, mimetype: 'video/mp4', originalname: 'fixture.mp4' }, '10000000-0000-4000-8000-000000000001').then((result) => process.stdout.write(JSON.stringify({ result, stored })));",
        ].join(' '),
        MP4_FIXTURE,
      ],
      { cwd: process.cwd(), encoding: 'utf8' },
    );
    const { result, stored } = JSON.parse(output) as {
      result: { url: string; mimeType: string; sizeBytes: number };
      stored: {
        path: string;
        size: number;
        options: { contentType: string; upsert: boolean };
      };
    };

    expect(result).toEqual({
      url: expect.stringContaining(
        '/inline-media/10000000-0000-4000-8000-000000000001/videos/',
      ),
      mimeType: 'video/mp4',
      sizeBytes: 1641,
    });
    expect(stored.path).toMatch(
      /^10000000-0000-4000-8000-000000000001\/videos\/[0-9a-f-]{36}\.mp4$/,
    );
    expect(stored.size).toBe(1641);
    expect(stored.options).toMatchObject({
      contentType: 'video/mp4',
      upsert: false,
    });
  });
});
