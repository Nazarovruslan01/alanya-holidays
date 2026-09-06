import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { EventMediaRecord } from './event-media.types';

type NewEventMediaRecord = Omit<
  EventMediaRecord,
  'event_id' | 'state' | 'content_sha256'
> & {
  state?: EventMediaRecord['state'];
  content_sha256?: string | null;
};

interface PersistenceError {
  code?: string;
  message: string;
}

interface RpcResult<T> {
  data: T | null;
  error: PersistenceError | null;
}

export class EventMediaPersistenceException extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

@Injectable()
export class EventMediaRepository {
  constructor(private readonly supabaseService: SupabaseService) {}

  private get client() {
    return this.supabaseService.getClient();
  }

  async insert(record: NewEventMediaRecord): Promise<EventMediaRecord> {
    const { data, error } = await this.client
      .from('event_media')
      .insert({
        ...record,
        event_id: null,
        state: record.state ?? 'pending',
      })
      .select()
      .single();
    this.throwIfError(error);
    if (!data) throw new EventMediaPersistenceException('No media returned');
    return data;
  }

  async reserveVideoIntent(
    record: NewEventMediaRecord,
  ): Promise<EventMediaRecord> {
    const { data, error } = (await this.client.rpc(
      'reserve_event_video_intent',
      {
        p_id: record.id,
        p_owner_id: record.owner_id,
        p_object_path: record.object_path,
        p_public_url: record.public_url,
        p_mime_type: record.mime_type,
        p_size_bytes: record.size_bytes,
        p_expires_at: record.expires_at,
      },
    )) as unknown as RpcResult<EventMediaRecord>;
    this.throwIfError(error);
    if (!data) {
      throw new EventMediaPersistenceException('No media intent returned');
    }
    return data;
  }

  async findOwned(
    id: string,
    ownerId: string,
  ): Promise<EventMediaRecord | null> {
    const { data, error } = await this.client
      .from('event_media')
      .select('*')
      .eq('id', id)
      .eq('owner_id', ownerId)
      .maybeSingle();
    this.throwIfError(error);
    return data ?? null;
  }

  async markReady(
    id: string,
    ownerId: string,
  ): Promise<EventMediaRecord | null> {
    const { data, error } = await this.client
      .from('event_media')
      .update({
        state: 'ready',
        expires_at: new Date(Date.now() + 86400000).toISOString(),
      })
      .eq('id', id)
      .eq('owner_id', ownerId)
      .eq('state', 'pending')
      .select()
      .maybeSingle();
    this.throwIfError(error);
    return data ?? null;
  }

  async markPromoting(
    id: string,
    ownerId: string,
    contentSha256: string,
  ): Promise<EventMediaRecord | null> {
    const { data, error } = await this.client
      .from('event_media')
      .update({
        state: 'promoting',
        content_sha256: contentSha256,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('owner_id', ownerId)
      .eq('bucket', 'event-media-staging')
      .eq('state', 'pending')
      .select()
      .maybeSingle();
    this.throwIfError(error);
    return data ?? null;
  }

  async completeVideoPromotion(
    id: string,
    ownerId: string,
  ): Promise<EventMediaRecord | null> {
    const { data, error } = (await this.client.rpc(
      'complete_event_video_promotion',
      {
        p_media_id: id,
        p_owner_id: ownerId,
      },
    )) as unknown as RpcResult<EventMediaRecord>;
    this.throwIfError(error);
    return data ?? null;
  }

  async queueCleanup(id: string, ownerId: string): Promise<boolean> {
    const { data, error } = (await this.client.rpc(
      'queue_owned_event_media_cleanup',
      {
        p_media_id: id,
        p_owner_id: ownerId,
      },
    )) as unknown as RpcResult<boolean>;
    this.throwIfError(error);
    return data === true;
  }

  async queueCleanupPaths(input: {
    mediaId: string;
    bucket: string;
    paths: string[];
    error?: string;
  }): Promise<void> {
    const { error } = await this.client.rpc('queue_event_media_cleanup_paths', {
      p_media_id: input.mediaId,
      p_bucket: input.bucket,
      p_object_paths: input.paths,
      p_last_error: input.error ?? null,
    });
    this.throwIfError(error);
  }

  private throwIfError(error: PersistenceError | null): void {
    if (error) {
      throw new EventMediaPersistenceException(error.message, error.code);
    }
  }
}
