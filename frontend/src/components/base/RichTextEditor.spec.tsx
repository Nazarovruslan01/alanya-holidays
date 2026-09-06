import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { mockUploadForumImage, mockUploadInlineVideo } = vi.hoisted(() => ({
  mockUploadForumImage: vi.fn(),
  mockUploadInlineVideo: vi.fn(),
}));

vi.mock('@/api-services/storage.service', () => ({
  uploadForumImage: mockUploadForumImage,
  uploadInlineVideo: mockUploadInlineVideo,
  storageService: {
    uploadForumImage: mockUploadForumImage,
    uploadInlineVideo: mockUploadInlineVideo,
  },
}));

vi.mock('quill/blots/block', () => ({
  BlockEmbed: class MockBlockEmbed {
    static create() {
      return document.createElement('video');
    }
  },
}));

let lastQuillOptions: any = null;
let lastQuillInstance: any = null;
let textChangeCallbacks: Array<() => void> = [];

const captureQuillInstance = (instance: unknown) => {
  lastQuillInstance = instance;
};

vi.mock('quill', () => {
  return {
    default: class MockQuill {
      static register = vi.fn();
      container: HTMLElement;
      options: any;
      root: HTMLDivElement;
      selection: { index: number } | null = { index: 3 };
      length = 10;
      insertEmbed = vi.fn();
      setSelection = vi.fn();
      getSelection = vi.fn().mockImplementation(() => this.selection);
      getLength = vi.fn().mockImplementation(() => this.length);
      getSemanticHTML = vi.fn().mockImplementation(() => this.root.innerHTML);
      clipboard = {
        dangerouslyPasteHTML: vi.fn().mockImplementation((...args: unknown[]) => {
          const html = typeof args[0] === 'string' ? args[0] : args[1];
          this.root.innerHTML = String(html || '');
        }),
      };
      on = vi.fn().mockImplementation((event: string, cb: () => void) => {
        if (event === 'text-change') {
          textChangeCallbacks.push(cb);
        }
      });

      constructor(container: HTMLElement, options: any) {
        this.container = container;
        this.options = options;
        lastQuillOptions = options;
        captureQuillInstance(this);

        this.root = document.createElement('div');
        this.root.className = 'ql-editor';
        this.root.setAttribute('data-testid', 'mock-quill-editor');
        container.appendChild(this.root);
      }
    },
  };
});

import RichTextEditor from './RichTextEditor';

describe('RichTextEditor Component (React 19 Native Quill)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastQuillOptions = null;
    lastQuillInstance = null;
    textChangeCallbacks = [];
  });

  it('instantiates native Quill editor with placeholder and initial value', () => {
    const handleChange = vi.fn();
    render(
      <RichTextEditor
        value="<p>Hello world</p>"
        onChange={handleChange}
        placeholder="Share your thoughts..."
      />
    );

    expect(screen.getByTestId('rich-text-editor-container')).toBeInTheDocument();
    expect(lastQuillInstance).not.toBeNull();
    expect(lastQuillOptions?.placeholder).toBe('Share your thoughts...');
    expect(lastQuillInstance.root.innerHTML).toBe('<p>Hello world</p>');
  });

  it('renders character count when maxLength is specified', () => {
    const { rerender } = render(
      <RichTextEditor
        value="<p>Short</p>"
        onChange={() => {}}
        maxLength={50}
      />
    );

    // Strips HTML <p>Short</p> -> "Short" (length 5)
    expect(screen.getByText('5/50')).toBeInTheDocument();

    rerender(
      <RichTextEditor
        value="<p>This is a much longer text exceeding thirty characters</p>"
        onChange={() => {}}
        maxLength={30}
      />
    );

    expect(screen.getByText('54/30')).toHaveClass('text-primary-500');
  });

  it('triggers onChange when text-change event fires in Quill', () => {
    const handleChange = vi.fn();
    render(
      <RichTextEditor
        value=""
        onChange={handleChange}
      />
    );

    lastQuillInstance.root.innerHTML = '<p>Updated content</p>';
    textChangeCallbacks.forEach((cb) => cb());

    expect(handleChange).toHaveBeenCalledWith('<p>Updated content</p>');
  });

  it('configures custom image toolbar handler with uploadForumImage', async () => {
    render(
      <RichTextEditor
        value=""
        onChange={() => {}}
        userId="user-789"
      />
    );

    expect(lastQuillOptions).toBeDefined();
    expect(lastQuillOptions.modules.toolbar.handlers.image).toBeDefined();

    mockUploadForumImage.mockResolvedValue('https://cdn.supabase.co/storage/v1/object/public/forum-media/user-789/img.png');

    const imageHandler = lastQuillOptions.modules.toolbar.handlers.image;

    const file = new File(['fake-img'], 'uploaded.png', { type: 'image/png' });
    const originalCreateElement = document.createElement.bind(document);
    let capturedInput: HTMLInputElement | null = null;

    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      const el = originalCreateElement(tagName);
      if (tagName === 'input') {
        capturedInput = el as HTMLInputElement;
      }
      return el;
    });

    imageHandler();

    expect(capturedInput).not.toBeNull();
    const inputEl = capturedInput as unknown as HTMLInputElement;
    expect(inputEl.type).toBe('file');
    expect(inputEl.accept).toBe('image/jpeg,image/png,image/webp');

    Object.defineProperty(inputEl, 'files', {
      value: [file],
      writable: false,
    });

    if (inputEl.onchange) {
      inputEl.onchange(new Event('change'));
    }

    await waitFor(() => {
      expect(mockUploadForumImage).toHaveBeenCalledWith(file);
      expect(lastQuillInstance.insertEmbed).toHaveBeenCalledWith(3, 'image', 'https://cdn.supabase.co/storage/v1/object/public/forum-media/user-789/img.png', 'user');
      expect(lastQuillInstance.setSelection).toHaveBeenCalledWith(4, 0, 'silent');
    });
  });

  it('uses custom onImageUpload callback when provided', async () => {
    const customUpload = vi.fn().mockResolvedValue('https://custom-cdn.com/my-pic.jpg');

    render(
      <RichTextEditor
        value=""
        onChange={() => {}}
        onImageUpload={customUpload}
      />
    );

    lastQuillInstance.selection = null;
    lastQuillInstance.length = 0;

    const imageHandler = lastQuillOptions.modules.toolbar.handlers.image;
    const file = new File(['fake-img'], 'custom.jpg', { type: 'image/jpeg' });
    let capturedInput: HTMLInputElement | null = null;
    const originalCreateElement = document.createElement.bind(document);

    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      const el = originalCreateElement(tagName);
      if (tagName === 'input') {
        capturedInput = el as HTMLInputElement;
      }
      return el;
    });

    imageHandler();

    const inputEl = capturedInput as unknown as HTMLInputElement;
    Object.defineProperty(inputEl, 'files', {
      value: [file],
      writable: false,
    });

    if (inputEl.onchange) {
      inputEl.onchange(new Event('change'));
    }

    await waitFor(() => {
      expect(customUpload).toHaveBeenCalledWith(file);
      expect(mockUploadForumImage).not.toHaveBeenCalled();
      expect(lastQuillInstance.insertEmbed).toHaveBeenCalledWith(0, 'image', 'https://custom-cdn.com/my-pic.jpg', 'user');
    });
  });

  it('handles image upload errors gracefully without throwing', async () => {
    mockUploadForumImage.mockRejectedValue(new Error('Network upload failure'));

    render(
      <RichTextEditor
        value=""
        onChange={() => {}}
        userId="user-789"
      />
    );

    const imageHandler = lastQuillOptions.modules.toolbar.handlers.image;
    const file = new File(['fake-img'], 'err.jpg', { type: 'image/jpeg' });
    let capturedInput: HTMLInputElement | null = null;
    const originalCreateElement = document.createElement.bind(document);

    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      const el = originalCreateElement(tagName);
      if (tagName === 'input') {
        capturedInput = el as HTMLInputElement;
      }
      return el;
    });

    imageHandler();

    const inputEl = capturedInput as unknown as HTMLInputElement;
    Object.defineProperty(inputEl, 'files', {
      value: [file],
      writable: false,
    });

    if (inputEl.onchange) {
      inputEl.onchange(new Event('change'));
    }

    await waitFor(() => {
      expect(mockUploadForumImage).toHaveBeenCalled();
      expect(screen.getByRole('alert')).toHaveTextContent('public.richTextImageUploadFailed');
    });
  });

  it('merges image and video handlers into an array toolbar configuration', () => {
    const toolbar = [['bold'], ['image', 'video']];

    render(
      <RichTextEditor
        value=""
        onChange={() => {}}
        modules={{ toolbar }}
      />,
    );

    expect(lastQuillOptions.modules.toolbar.container).toBe(toolbar);
    expect(lastQuillOptions.modules.toolbar.handlers.image).toEqual(expect.any(Function));
    expect(lastQuillOptions.modules.toolbar.handlers.video).toEqual(expect.any(Function));
  });

  it('inserts only normalized YouTube and Vimeo URLs from the video chooser', () => {
    render(<RichTextEditor value="" onChange={() => {}} userId="user-789" />);

    act(() => lastQuillOptions.modules.toolbar.handlers.video());
    fireEvent.change(screen.getByLabelText('public.richTextVideoUrl'), {
      target: { value: 'https://youtu.be/dQw4w9WgXcQ?t=10' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'public.richTextInsertVideo' }));

    expect(lastQuillInstance.insertEmbed).toHaveBeenCalledWith(
      3,
      'inline-frame',
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
      'user',
    );

    act(() => lastQuillOptions.modules.toolbar.handlers.video());
    fireEvent.change(screen.getByLabelText('public.richTextVideoUrl'), {
      target: { value: 'https://example.com/watch/unsafe' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'public.richTextInsertVideo' }));
    expect(screen.getByRole('alert')).toHaveTextContent('public.richTextInvalidVideoUrl');
    expect(lastQuillInstance.insertEmbed).toHaveBeenCalledTimes(1);
  });

  it('uploads a native video at the captured selection and reports pending state', async () => {
    const onUploadStateChange = vi.fn();
    mockUploadInlineVideo.mockResolvedValue({
      url: 'http://127.0.0.1:54321/storage/v1/object/public/inline-media/11111111-1111-4111-8111-111111111111/videos/22222222-2222-4222-8222-222222222222.mp4',
      mimeType: 'video/mp4',
      sizeBytes: 9,
    });
    render(
      <RichTextEditor
        value=""
        onChange={() => {}}
        userId="user-789"
        onUploadStateChange={onUploadStateChange}
      />,
    );

    act(() => lastQuillOptions.modules.toolbar.handlers.video());
    lastQuillInstance.selection = { index: 8 };
    const input = screen.getByLabelText('public.richTextUploadVideo');
    const file = new File(['video'], 'clip.mp4', { type: 'video/mp4' });
    fireEvent.change(input, { target: { files: [file] } });

    expect(onUploadStateChange).toHaveBeenCalledWith(true);
    await waitFor(() => {
      expect(mockUploadInlineVideo).toHaveBeenCalledWith(file);
      expect(lastQuillInstance.insertEmbed).toHaveBeenCalledWith(
        3,
        'inline-video',
        expect.stringContaining('/inline-media/'),
        'user',
      );
      expect(onUploadStateChange).toHaveBeenLastCalledWith(false);
    });
  });

  it('does not insert an upload that completes after the editor unmounts', async () => {
    let resolveUpload: ((value: { url: string; mimeType: string; sizeBytes: number }) => void) | undefined;
    mockUploadInlineVideo.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUpload = resolve;
        }),
    );
    const { unmount } = render(
      <RichTextEditor value="" onChange={() => {}} userId="user-789" />,
    );

    act(() => lastQuillOptions.modules.toolbar.handlers.video());
    fireEvent.change(screen.getByLabelText('public.richTextUploadVideo'), {
      target: { files: [new File(['video'], 'clip.webm', { type: 'video/webm' })] },
    });
    const abandonedEditor = lastQuillInstance;
    unmount();
    resolveUpload?.({
      url: 'http://127.0.0.1:54321/storage/v1/object/public/inline-media/11111111-1111-4111-8111-111111111111/videos/22222222-2222-4222-8222-222222222222.webm',
      mimeType: 'video/webm',
      sizeBytes: 9,
    });

    await Promise.resolve();
    expect(abandonedEditor.insertEmbed).not.toHaveBeenCalled();
  });
});
