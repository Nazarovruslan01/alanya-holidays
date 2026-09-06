export type EventMediaKind = 'image' | 'video';
export type EventMediaState =
  'pending' | 'promoting' | 'ready' | 'attached' | 'cleanup_pending' | 'failed';

export interface EventMediaRecord {
  id: string;
  owner_id: string;
  event_id: string | null;
  kind: EventMediaKind;
  bucket: 'forum-media' | 'event-media-staging' | 'event-media';
  object_path: string;
  thumbnail_path: string | null;
  public_url: string;
  thumbnail_url: string | null;
  mime_type: string;
  size_bytes: number;
  content_sha256: string | null;
  state: EventMediaState;
  expires_at: string | null;
}

export interface EventImageUploadResult {
  mediaId: string;
  url: string;
  thumbnailUrl: string;
}

export interface EventVideoIntentResult {
  mediaId: string;
  path: string;
  token: string;
}

export interface FinalizedEventVideoResult {
  mediaId: string;
  url: string;
}
