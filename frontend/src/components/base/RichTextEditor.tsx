import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Quill from 'quill';
import { BlockEmbed } from 'quill/blots/block';
import 'quill/dist/quill.snow.css';
import {
  uploadForumImage,
  uploadInlineVideo,
} from '@/api-services/storage.service';
import { logger } from '@/lib/logger';
import { normalizeVideoEmbedUrl } from '@/utils/richTextMedia';

class InlineVideoBlot extends BlockEmbed {
  static blotName = 'inline-video';
  static tagName = 'video';

  static create(value: string) {
    const node = super.create() as HTMLVideoElement;
    node.setAttribute('src', value);
    node.setAttribute('controls', '');
    node.setAttribute('playsinline', '');
    node.setAttribute('preload', 'metadata');
    node.className = 'ql-video';
    return node;
  }

  static value(node: HTMLVideoElement) {
    return node.getAttribute('src') || '';
  }
}

class InlineFrameBlot extends BlockEmbed {
  static blotName = 'inline-frame';
  static tagName = 'iframe';

  static create(value: string) {
    const node = super.create() as HTMLIFrameElement;
    node.setAttribute('src', value);
    node.setAttribute('title', 'Embedded video');
    node.setAttribute(
      'allow',
      'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen',
    );
    node.setAttribute('allowfullscreen', '');
    node.className = 'ql-video';
    return node;
  }

  static value(node: HTMLIFrameElement) {
    return node.getAttribute('src') || '';
  }
}

Quill.register(InlineVideoBlot);
Quill.register(InlineFrameBlot);

export interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
  className?: string;
  inputId?: string;
  ariaLabel?: string;
  userId?: string;
  onImageUpload?: { (file: File): Promise<string> };
  onUploadStateChange?: (pending: boolean) => void;
  modules?: Record<string, unknown>;
  insertContent?: { id: number; html: string } | null;
}

interface UploadOperation {
  editor: Quill;
  index: number;
  operation: number;
  userId?: string;
}

export default function RichTextEditor({
  value,
  onChange,
  placeholder = 'Write something...',
  maxLength,
  className = '',
  inputId,
  ariaLabel,
  userId,
  onImageUpload,
  onUploadStateChange,
  modules: customModules,
  insertContent,
}: RichTextEditorProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const quillRef = useRef<Quill | null>(null);
  const isInternalChangeRef = useRef(false);
  const onChangeRef = useRef(onChange);
  const onImageUploadRef = useRef(onImageUpload);
  const onUploadStateChangeRef = useRef(onUploadStateChange);
  const userIdRef = useRef(userId);
  const tRef = useRef(t);
  const uploadOperationRef = useRef(0);
  const mediaInsertIndexRef = useRef<number | null>(null);
  const uploadPendingRef = useRef(false);
  const isMountedRef = useRef(true);
  const initialModulesRef = useRef(customModules);
  const initialValueRef = useRef(value);
  const [uploadPending, setUploadPending] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [showVideoChooser, setShowVideoChooser] = useState(false);
  const [videoUrl, setVideoUrl] = useState('');

  onChangeRef.current = onChange;
  onImageUploadRef.current = onImageUpload;
  onUploadStateChangeRef.current = onUploadStateChange;
  userIdRef.current = userId;
  tRef.current = t;

  const setPending = useCallback((pending: boolean) => {
    uploadPendingRef.current = pending;
    if (isMountedRef.current) {
      setUploadPending(pending);
    }
    onUploadStateChangeRef.current?.(pending);
  }, []);

  const captureMediaInsertIndex = useCallback(() => {
    const editor = quillRef.current;
    if (!editor) return;
    mediaInsertIndexRef.current =
      editor.getSelection()?.index ?? Math.max(0, editor.getLength() - 1);
  }, []);

  const beginUpload = useCallback(() => {
    if (uploadPendingRef.current) return null;
    const editor = quillRef.current;
    if (!editor) return null;

    setUploadError('');
    setPending(true);
    const operation = ++uploadOperationRef.current;
    const index =
      mediaInsertIndexRef.current ??
      editor.getSelection(true)?.index ??
      Math.max(0, editor.getLength() - 1);
    return { editor, index, operation, userId: userIdRef.current };
  }, [setPending]);

  const operationIsCurrent = useCallback(
    (upload: UploadOperation) =>
      isMountedRef.current &&
      upload.operation === uploadOperationRef.current &&
      upload.editor === quillRef.current &&
      upload.userId === userIdRef.current,
    [],
  );

  const finishUpload = useCallback(
    (upload: UploadOperation) => {
      if (upload.operation === uploadOperationRef.current) {
        setPending(false);
      }
    },
    [setPending],
  );

  const handleImageFile = useCallback(
    async (file: File) => {
      if (!onImageUploadRef.current && !userIdRef.current) {
        setUploadError(tRef.current('public.richTextSignInToUpload'));
        return;
      }

      const upload = beginUpload();
      if (!upload) return;
      try {
        const url = onImageUploadRef.current
          ? await onImageUploadRef.current(file)
          : await uploadForumImage(file);
        if (!operationIsCurrent(upload)) return;
        upload.editor.insertEmbed(upload.index, 'image', url, 'user');
        upload.editor.setSelection(upload.index + 1, 0, 'silent');
        mediaInsertIndexRef.current = null;
      } catch (error) {
        logger.error('Failed to upload image in RichTextEditor:', error);
        if (operationIsCurrent(upload)) {
          setUploadError(tRef.current('public.richTextImageUploadFailed'));
        }
      } finally {
        finishUpload(upload);
      }
    },
    [beginUpload, finishUpload, operationIsCurrent],
  );

  const handleImageUpload = useCallback(() => {
    captureMediaInsertIndex();
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp';
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) void handleImageFile(file);
    };
    input.click();
  }, [captureMediaInsertIndex, handleImageFile]);

  const handleVideoUpload = useCallback(() => {
    captureMediaInsertIndex();
    setUploadError('');
    setShowVideoChooser(true);
  }, [captureMediaInsertIndex]);

  const handleVideoFile = useCallback(
    async (file: File) => {
      if (!userIdRef.current) {
        setUploadError(tRef.current('public.richTextSignInToUpload'));
        return;
      }
      const upload = beginUpload();
      if (!upload) return;
      try {
        const uploaded = await uploadInlineVideo(file);
        if (!operationIsCurrent(upload)) return;
        upload.editor.insertEmbed(upload.index, 'inline-video', uploaded.url, 'user');
        upload.editor.setSelection(upload.index + 1, 0, 'silent');
        mediaInsertIndexRef.current = null;
        setShowVideoChooser(false);
      } catch (error) {
        logger.error('Failed to upload video in RichTextEditor:', error);
        if (operationIsCurrent(upload)) {
          setUploadError(tRef.current('public.richTextVideoUploadFailed'));
        }
      } finally {
        finishUpload(upload);
      }
    },
    [beginUpload, finishUpload, operationIsCurrent],
  );

  const insertVideoUrl = useCallback(() => {
    const normalizedUrl = normalizeVideoEmbedUrl(videoUrl);
    if (!normalizedUrl) {
      setUploadError(tRef.current('public.richTextInvalidVideoUrl'));
      return;
    }
    const editor = quillRef.current;
    if (!editor) return;
    const index =
      mediaInsertIndexRef.current ??
      editor.getSelection(true)?.index ??
      Math.max(0, editor.getLength() - 1);
    editor.insertEmbed(index, 'inline-frame', normalizedUrl, 'user');
    editor.setSelection(index + 1, 0, 'silent');
    mediaInsertIndexRef.current = null;
    setVideoUrl('');
    setUploadError('');
    setShowVideoChooser(false);
  }, [videoUrl]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Clear previous editor DOM if any
    container.innerHTML = '';
    const editorDiv = document.createElement('div');
    container.appendChild(editorDiv);

    const defaultToolbar = [
      ['bold', 'italic', 'strike', 'code'],
      [{ header: [2, 3, 4, false] }],
      ['blockquote', 'code-block'],
      [{ list: 'ordered' }, { list: 'bullet' }],
      ['link', 'image', 'video'],
      ['clean'],
    ];
    const sourceModules = initialModulesRef.current || { toolbar: defaultToolbar };
    const modules: Record<string, unknown> = { ...sourceModules };
    const toolbar = modules.toolbar;
    if (Array.isArray(toolbar)) {
      modules.toolbar = {
        container: toolbar,
        handlers: { image: handleImageUpload, video: handleVideoUpload },
      };
    } else if (toolbar && typeof toolbar === 'object') {
      const toolbarOptions = toolbar as Record<string, unknown>;
      const handlers =
        toolbarOptions.handlers && typeof toolbarOptions.handlers === 'object'
          ? (toolbarOptions.handlers as Record<string, unknown>)
          : {};
      modules.toolbar = {
        ...toolbarOptions,
        handlers: { ...handlers, image: handleImageUpload, video: handleVideoUpload },
      };
    }

    const quill = new Quill(editorDiv, {
      theme: 'snow',
      placeholder,
      modules,
      formats: [
        'bold', 'italic', 'strike', 'code',
        'header',
        'blockquote', 'code-block',
        'list',
        'link', 'image', 'video', 'inline-frame', 'inline-video',
      ],
    });

    if (quill.root) {
      if (placeholder) {
        quill.root.setAttribute('placeholder', placeholder);
      }
      if (inputId) {
        quill.root.id = inputId;
      }
      if (ariaLabel) {
        quill.root.setAttribute('aria-label', ariaLabel);
      }
      Object.defineProperty(quill.root, 'value', {
        get() {
          return this.innerHTML;
        },
        set(val: string) {
          this.innerHTML = val;
        },
        configurable: true,
      });
    }

    const handleDomEvent = (e: Event) => {
      const target = e.target as HTMLElement;
      if (target && 'value' in target && typeof (target as unknown as { value: string }).value === 'string') {
        onChangeRef.current((target as unknown as { value: string }).value);
      } else {
        const html = quill.getSemanticHTML().trim();
        onChangeRef.current(html === '<p><br></p>' ? '' : html);
      }
    };
    editorDiv.addEventListener('input', handleDomEvent);
    editorDiv.addEventListener('change', handleDomEvent);

    quillRef.current = quill;

    if (initialValueRef.current) {
      quill.clipboard.dangerouslyPasteHTML(initialValueRef.current);
    }

    quill.on('text-change', () => {
      if (isInternalChangeRef.current) return;
      const html = quill.getSemanticHTML().trim();
      onChangeRef.current(html === '<p><br></p>' ? '' : html);
    });

    return () => {
      editorDiv.removeEventListener('input', handleDomEvent);
      editorDiv.removeEventListener('change', handleDomEvent);
      quillRef.current = null;
      mediaInsertIndexRef.current = null;
      if (container) {
        container.innerHTML = '';
      }
    };
  }, [ariaLabel, handleImageUpload, handleVideoUpload, inputId, placeholder]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      uploadOperationRef.current += 1;
      if (uploadPendingRef.current) {
        uploadPendingRef.current = false;
        onUploadStateChangeRef.current?.(false);
      }
    };
  }, []);

  useEffect(() => {
    const quill = quillRef.current;
    if (!quill) return;

    const currentHtml = quill.getSemanticHTML().trim();
    const isCleanEmpty = (currentHtml === '<p><br></p>' || !currentHtml) && !value;

    if (currentHtml !== value && !isCleanEmpty) {
      isInternalChangeRef.current = true;
      quill.clipboard.dangerouslyPasteHTML(value || '');
      isInternalChangeRef.current = false;
    }
  }, [value]);

  useEffect(() => {
    const editor = quillRef.current;
    if (!editor || !insertContent?.html) return;
    const range = editor.getSelection(true);
    const index = range?.index ?? Math.max(0, editor.getLength() - 1);
    editor.clipboard.dangerouslyPasteHTML(index, insertContent.html, 'user');
    editor.setSelection(index + 1, 0);
  }, [insertContent]);

  const textLength = value.replace(/<[^>]*>/g, '').length;
  const showCounter = maxLength !== undefined;

  return (
    <div className={`relative ${className}`} data-testid="rich-text-editor-container">
      <div
        ref={containerRef}
        className="bg-background-0 border border-background-200/70 rounded-lg focus-within:border-primary-500 focus-within:ring-2 focus-within:ring-primary-100/60 transition-all overflow-hidden [&_.ql-container]:h-auto [&_.ql-editor]:min-h-40 [&_.ql-editor]:text-base"
      />
      {showVideoChooser && (
        <div className="mt-2 rounded-lg border border-background-200 bg-background-0 p-3">
          <div className="flex items-center justify-between gap-2">
            <label className="block text-sm font-medium text-foreground-700" htmlFor={`${inputId || 'rich-text'}-video-url`}>
              {t('public.richTextVideoUrl')}
            </label>
            <button
              type="button"
              onClick={() => {
                setShowVideoChooser(false);
                setVideoUrl('');
                setUploadError('');
                mediaInsertIndexRef.current = null;
              }}
              disabled={uploadPending}
              className="text-sm text-foreground-500 hover:text-foreground-700 disabled:opacity-50"
            >
              {t('public.cancel')}
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              id={`${inputId || 'rich-text'}-video-url`}
              type="url"
              value={videoUrl}
              onChange={(event) => setVideoUrl(event.target.value)}
              placeholder={t('public.richTextVideoUrlPlaceholder')}
              className="min-w-0 flex-1 rounded-md border border-background-300 bg-background-0 px-3 py-2 text-sm"
              disabled={uploadPending}
            />
            <button
              type="button"
              onClick={insertVideoUrl}
              disabled={uploadPending}
              className="rounded-md bg-primary-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {t('public.richTextInsertVideo')}
            </button>
          </div>
          <label className="mt-3 inline-flex cursor-pointer items-center rounded-md border border-background-300 px-3 py-2 text-sm font-medium text-foreground-700">
            {t('public.richTextUploadVideo')}
            <input
              type="file"
              accept="video/mp4,video/webm"
              className="sr-only"
              disabled={uploadPending}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleVideoFile(file);
                event.target.value = '';
              }}
            />
          </label>
        </div>
      )}
      {uploadPending && (
        <p className="mt-2 text-sm text-foreground-500" role="status">
          {t('public.richTextUploadPending')}
        </p>
      )}
      {uploadError && (
        <p className="mt-2 text-sm text-primary-600" role="alert">
          {uploadError}
        </p>
      )}
      {showCounter && (
        <div className="flex justify-end mt-1">
          <span
            className={`text-xs ${
              textLength > maxLength ? 'text-primary-500' : 'text-foreground-400'
            }`}
          >
            {textLength}/{maxLength}
          </span>
        </div>
      )}
    </div>
  );
}
