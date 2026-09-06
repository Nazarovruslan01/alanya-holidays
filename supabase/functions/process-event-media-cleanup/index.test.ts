import { type CleanupClient, createCleanupHandler } from "./index.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("rejects requests without the cron secret before creating a client", async () => {
  let clientCreated = false;
  const handler = createCleanupHandler({
    cronSecret: "expected-secret",
    clientFactory: () => {
      clientCreated = true;
      throw new Error("client must not be created");
    },
  });

  const response = await handler(new Request("http://localhost"));

  assert(response.status === 401, "missing cron secret must be rejected");
  assert(!clientCreated, "unauthorized request reached service-role client");
});

Deno.test("records success only after removal and preserves failures for retry", async () => {
  const rpcCalls: Array<{ name: string; params: Record<string, unknown> }> = [];
  const removed: Array<{ bucket: string; paths: string[] }> = [];
  const rows = [
    {
      id: 1,
      media_id: "10000000-0000-4000-8000-000000000001",
      bucket: "event-media" as const,
      object_paths: ["owner/events/ok.mp4"],
      attempts: 1,
    },
    {
      id: 2,
      media_id: "10000000-0000-4000-8000-000000000002",
      bucket: "forum-media" as const,
      object_paths: ["owner/events/full.webp", "owner/events/thumb.webp"],
      attempts: 1,
    },
  ];
  const client: CleanupClient = {
    rpc: (name, params) => {
      rpcCalls.push({ name, params });
      if (name === "claim_event_media_cleanup") {
        return Promise.resolve({ data: rows, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    storage: {
      from: (bucket) => ({
        remove: (paths) => {
          removed.push({ bucket, paths });
          return Promise.resolve({
            error: bucket === "forum-media"
              ? { message: "temporary storage failure" }
              : null,
          });
        },
      }),
    },
  };
  const handler = createCleanupHandler({
    cronSecret: "expected-secret",
    clientFactory: () => client,
  });

  const response = await handler(
    new Request("http://localhost", {
      headers: { "x-cron-secret": "expected-secret" },
    }),
  );
  const body = await response.json() as { claimed: number; deleted: number };

  assert(response.status === 200, "valid cleanup request failed");
  assert(body.claimed === 2 && body.deleted === 1, "cleanup counts are wrong");
  assert(removed.length === 2, "claimed rows were not both attempted");
  assert(
    rpcCalls.some((call) =>
      call.name === "complete_event_media_cleanup" &&
      call.params.p_id === 1 && call.params.p_success === true
    ),
    "successful removal was not completed",
  );
  assert(
    rpcCalls.some((call) =>
      call.name === "complete_event_media_cleanup" &&
      call.params.p_id === 2 && call.params.p_success === false &&
      call.params.p_error === "temporary storage failure"
    ),
    "failed removal was not returned to the durable retry seam",
  );
});

Deno.test("records a fifth failure and can complete the same cleanup on a later claim", async () => {
  const completions: Array<Record<string, unknown>> = [];
  let invocation = 0;
  const client: CleanupClient = {
    rpc: (name, params) => {
      if (name === "claim_event_media_cleanup") {
        invocation += 1;
        return Promise.resolve({
          data: [{
            id: 5,
            media_id: "10000000-0000-4000-8000-000000000005",
            bucket: "event-media" as const,
            object_paths: ["owner/events/retry.mp4"],
            attempts: invocation === 1 ? 5 : 6,
          }],
          error: null,
        });
      }
      if (name === "complete_event_media_cleanup") completions.push(params);
      return Promise.resolve({ data: null, error: null });
    },
    storage: {
      from: () => ({
        remove: () =>
          Promise.resolve({
            error: invocation === 1
              ? { message: "fifth transient storage failure" }
              : null,
          }),
      }),
    },
  };
  const handler = createCleanupHandler({
    cronSecret: "expected-secret",
    clientFactory: () => client,
  });
  const request = () =>
    new Request("http://localhost", {
      headers: { "x-cron-secret": "expected-secret" },
    });

  await handler(request());
  await handler(request());

  assert(
    completions.length === 2 &&
      completions[0].p_id === 5 &&
      completions[0].p_success === false &&
      completions[0].p_error === "fifth transient storage failure" &&
      completions[1].p_id === 5 && completions[1].p_success === true,
    "cleanup did not recover after its fifth transient failure",
  );
});

Deno.test("removes objects uploaded before or after abandon once their leases are claimable", async () => {
  const beforePath = "owner/events/upload-before-abandon.mp4";
  const afterPath = "owner/events/upload-after-abandon.mp4";
  const existingObjects = new Set([beforePath]);
  const completed: number[] = [];
  const client: CleanupClient = {
    rpc: (name, params) => {
      if (name === "claim_event_media_cleanup") {
        existingObjects.add(afterPath);
        return Promise.resolve({
          data: [
            {
              id: 11,
              media_id: "10000000-0000-4000-8000-000000000011",
              bucket: "event-media-staging" as const,
              object_paths: [beforePath],
              attempts: 1,
            },
            {
              id: 12,
              media_id: "10000000-0000-4000-8000-000000000012",
              bucket: "event-media-staging" as const,
              object_paths: [afterPath],
              attempts: 1,
            },
          ],
          error: null,
        });
      }
      if (
        name === "complete_event_media_cleanup" &&
        params.p_success === true
      ) {
        completed.push(params.p_id as number);
      }
      return Promise.resolve({ data: null, error: null });
    },
    storage: {
      from: () => ({
        remove: (paths) => {
          const found = paths.every((path) => existingObjects.delete(path));
          return Promise.resolve({
            error: found ? null : { message: "object was not present" },
          });
        },
      }),
    },
  };
  const handler = createCleanupHandler({
    cronSecret: "expected-secret",
    clientFactory: () => client,
  });

  const response = await handler(
    new Request("http://localhost", {
      headers: { "x-cron-secret": "expected-secret" },
    }),
  );

  assert(response.status === 200, "leased cleanup invocation failed");
  assert(existingObjects.size === 0, "an abandoned upload remained in Storage");
  assert(
    completed.length === 2 && completed[0] === 11 && completed[1] === 12,
    "abandoned upload tombstones were not completed after removal",
  );
});
