import { createClient } from "@supabase/supabase-js";
import "@supabase/functions-js/edge-runtime.d.ts";

interface CleanupRow {
  id: number;
  media_id: string | null;
  bucket: "forum-media" | "event-media-staging" | "event-media";
  object_paths: string[];
  attempts: number;
}

interface CleanupError {
  message: string;
}

interface CleanupRpcResult {
  data: CleanupRow[] | number | boolean | null;
  error: CleanupError | null;
}

export interface CleanupClient {
  rpc(
    name: string,
    params: Record<string, unknown>,
  ): Promise<CleanupRpcResult>;
  storage: {
    from(bucket: CleanupRow["bucket"]): {
      remove(paths: string[]): Promise<{ error: CleanupError | null }>;
    };
  };
}

interface CleanupHandlerOptions {
  cronSecret?: string;
  clientFactory?: () => CleanupClient;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (
    typeof error === "object" && error !== null && "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return String(error);
}

export function createCleanupHandler(options: CleanupHandlerOptions = {}) {
  const cronSecret = options.cronSecret ?? Deno.env.get("CRON_SECRET");
  const clientFactory = options.clientFactory ?? (() =>
    createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    ) as unknown as CleanupClient);

  return async (request: Request): Promise<Response> => {
    if (!cronSecret || request.headers.get("x-cron-secret") !== cronSecret) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const supabase = clientFactory();
    try {
      const { error: expiryError } = await supabase.rpc(
        "enqueue_expired_event_media",
        { p_batch_size: 50 },
      );
      if (expiryError) throw expiryError;

      const { data, error: claimError } = await supabase.rpc(
        "claim_event_media_cleanup",
        { p_batch_size: 20 },
      );
      if (claimError) throw claimError;
      const rows = Array.isArray(data) ? data : [];

      let deleted = 0;
      for (const row of rows) {
        try {
          const { error: removeError } = await supabase.storage
            .from(row.bucket)
            .remove(row.object_paths);
          if (removeError) throw removeError;

          const { error: completeError } = await supabase.rpc(
            "complete_event_media_cleanup",
            { p_id: row.id, p_success: true, p_error: null },
          );
          if (completeError) throw completeError;
          deleted += 1;
        } catch (error) {
          const message = errorMessage(error);
          const { error: retryError } = await supabase.rpc(
            "complete_event_media_cleanup",
            { p_id: row.id, p_success: false, p_error: message },
          );
          if (retryError) {
            console.error(
              `Failed to record cleanup retry for outbox ${row.id}: ${retryError.message}`,
            );
          }
        }
      }

      return new Response(JSON.stringify({ claimed: rows.length, deleted }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      const message = errorMessage(error);
      console.error("process-event-media-cleanup failed:", message);
      return new Response(JSON.stringify({ error: message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  };
}

if (import.meta.main) Deno.serve(createCleanupHandler());
