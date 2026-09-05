import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  user: { id: "user-a" } as { id: string } | null,
  session: { access_token: "token-a" } as { access_token: string } | null,
}));

const itineraryMocks = vi.hoisted(() => ({
  getMyItineraries: vi.fn(),
  saveItinerary: vi.fn(),
  updateItinerary: vi.fn(),
  deleteItinerary: vi.fn(),
}));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => authState,
}));

vi.mock("@/api-services/itineraries.service", () => ({
  itinerariesService: itineraryMocks,
}));

import { usePlanner } from "./usePlanner";

function savedFrom(input: { id: string; title: string; params?: unknown; itinerary: unknown[] }) {
  return {
    ...input,
    user_id: authState.user?.id,
    created_at: "2026-09-05T00:00:00.000Z",
  };
}

describe("usePlanner cloud identity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    authState.user = { id: "user-a" };
    authState.session = { access_token: "token-a" };
    itineraryMocks.getMyItineraries.mockResolvedValue([]);
    itineraryMocks.saveItinerary.mockImplementation(async (input) => savedFrom(input));
    itineraryMocks.updateItinerary.mockImplementation(async (id, input) => ({
      id,
      title: input.title || "Plan",
      params: input.params,
      itinerary: input.itinerary || [],
      created_at: "2026-09-05T00:00:00.000Z",
    }));
    itineraryMocks.deleteItinerary.mockResolvedValue(true);
  });

  it("waits for a delayed create before updating the same stable cloud ID", async () => {
    let resolveCreate!: (value: ReturnType<typeof savedFrom>) => void;
    const createPending = new Promise<ReturnType<typeof savedFrom>>((resolve) => {
      resolveCreate = resolve;
    });
    itineraryMocks.saveItinerary.mockReturnValueOnce(createPending);
    const { result } = renderHook(() => usePlanner());

    let plan!: ReturnType<typeof result.current.createPlan>;
    act(() => {
      plan = result.current.createPlan("Original", "Description");
    });

    let updatePending!: Promise<void>;
    act(() => {
      updatePending = result.current.updatePlan(plan.id, { name: "Updated" });
    });
    expect(itineraryMocks.updateItinerary).not.toHaveBeenCalled();

    await act(async () => {
      resolveCreate(
        savedFrom({
          id: plan.id,
          title: "Original",
          params: { description: "Description" },
          itinerary: [],
        }),
      );
      await updatePending;
    });

    expect(itineraryMocks.saveItinerary).toHaveBeenCalledWith(
      expect.objectContaining({ id: plan.id }),
      { headers: { Authorization: "Bearer token-a" } },
    );
    expect(itineraryMocks.updateItinerary).toHaveBeenCalledWith(
      plan.id,
      expect.objectContaining({ title: "Updated" }),
      { headers: { Authorization: "Bearer token-a" } },
    );
  });

  it("reuses the local UUID when an explicit save retries a create", async () => {
    const { result } = renderHook(() => usePlanner());
    let plan!: ReturnType<typeof result.current.createPlan>;
    act(() => {
      plan = result.current.createPlan("Retry plan", "");
    });

    await act(async () => {
      await result.current.savePlanToCloud(plan.id);
    });

    const requestedIds = itineraryMocks.saveItinerary.mock.calls.map(([input]) => input.id);
    expect(requestedIds).toEqual([plan.id, plan.id]);
  });

  it("keeps an authenticated plan when the owner delete request fails", async () => {
    const failure = new Error("delete denied");
    itineraryMocks.deleteItinerary.mockRejectedValueOnce(failure);
    const { result } = renderHook(() => usePlanner());
    let plan!: ReturnType<typeof result.current.createPlan>;
    act(() => {
      plan = result.current.createPlan("Keep me", "");
    });

    await act(async () => {
      await Promise.resolve();
    });
    await expect(result.current.deletePlan(plan.id)).rejects.toBe(failure);
    expect(result.current.getPlan(plan.id)).toMatchObject({ name: "Keep me" });
  });

  it("keeps guest drafts usable without attempting an authenticated cloud write", () => {
    authState.user = null;
    authState.session = null;
    const { result } = renderHook(() => usePlanner());

    act(() => {
      result.current.createPlan("Guest draft", "Works offline");
    });

    expect(result.current.plans).toHaveLength(1);
    expect(itineraryMocks.saveItinerary).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem("alanya-planner-plans") || "[]")).toHaveLength(1);
  });

  it("isolates persisted plans and delayed writes when the account changes", async () => {
    localStorage.setItem(
      "alanya-planner-plans:user-b",
      JSON.stringify([
        {
          id: "b-plan",
          name: "Bob's plan",
          description: "",
          createdAt: "2026-09-05T00:00:00.000Z",
          updatedAt: "2026-09-05T00:00:00.000Z",
          items: [],
        },
      ]),
    );
    let resolveAliceCreate!: (value: ReturnType<typeof savedFrom>) => void;
    itineraryMocks.saveItinerary.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveAliceCreate = resolve;
      }),
    );
    const { result, rerender } = renderHook(() => usePlanner());
    let alicePlan!: ReturnType<typeof result.current.createPlan>;
    act(() => {
      alicePlan = result.current.createPlan("Alice's plan", "");
    });

    authState.user = { id: "user-b" };
    authState.session = { access_token: "token-b" };
    rerender();

    await waitFor(() => {
      expect(result.current.plans.map((plan) => plan.id)).toEqual(["b-plan"]);
    });
    await act(async () => {
      resolveAliceCreate(
        savedFrom({
          id: alicePlan.id,
          title: "Alice's plan",
          itinerary: [],
        }),
      );
      await Promise.resolve();
    });

    expect(result.current.plans.map((plan) => plan.id)).toEqual(["b-plan"]);
    expect(itineraryMocks.saveItinerary).toHaveBeenCalledWith(
      expect.objectContaining({ id: alicePlan.id }),
      { headers: { Authorization: "Bearer token-a" } },
    );
  });

  it("persists authenticated item mutations to the stable ID and survives reload sync", async () => {
    let cloudRecord: ReturnType<typeof savedFrom> | null = null;
    itineraryMocks.saveItinerary.mockImplementation(async (input) => {
      cloudRecord ??= savedFrom(input);
      return cloudRecord;
    });
    itineraryMocks.updateItinerary.mockImplementation(async (id, input) => {
      cloudRecord = savedFrom({
        id,
        title: input.title || cloudRecord?.title || "Plan",
        params: input.params || cloudRecord?.params,
        itinerary: input.itinerary || cloudRecord?.itinerary || [],
      });
      return cloudRecord;
    });
    const first = renderHook(() => usePlanner());
    let plan!: ReturnType<typeof first.result.current.createPlan>;
    act(() => {
      plan = first.result.current.createPlan("Cloud plan", "");
    });
    await act(async () => {
      await Promise.resolve();
    });

    let firstItem!: ReturnType<typeof first.result.current.addItem>;
    act(() => {
      firstItem = first.result.current.addItem(plan.id, {
        type: "custom",
        customName: "Castle",
        dayLabel: "Day 1",
        timeSlot: "Morning",
        notes: "",
        completed: false,
        order: 1,
      });
    });
    await waitFor(() => {
      expect(itineraryMocks.updateItinerary).toHaveBeenLastCalledWith(
        plan.id,
        expect.objectContaining({
          itinerary: [expect.objectContaining({ id: firstItem.id })],
        }),
        { headers: { Authorization: "Bearer token-a" } },
      );
    });

    act(() => {
      first.result.current.updateItem(plan.id, firstItem.id, { completed: true });
    });
    await waitFor(() => {
      expect(cloudRecord?.itinerary).toEqual([
        expect.objectContaining({ id: firstItem.id, completed: true }),
      ]);
    });

    act(() => {
      first.result.current.reorderItems(plan.id, [
        { ...first.result.current.getPlan(plan.id)!.items[0], order: 4 },
      ]);
    });
    await waitFor(() => {
      expect(cloudRecord?.itinerary).toEqual([expect.objectContaining({ order: 4 })]);
    });

    act(() => {
      first.result.current.removeItem(plan.id, firstItem.id);
    });
    await waitFor(() => {
      expect(cloudRecord?.itinerary).toEqual([]);
    });
    first.unmount();

    itineraryMocks.getMyItineraries.mockResolvedValue([cloudRecord]);
    const second = renderHook(() => usePlanner());
    await act(async () => {
      await second.result.current.syncWithCloud();
    });
    expect(second.result.current.getPlan(plan.id)?.items).toEqual([]);
  });

  it("keeps a failed item mutation as an unsaved local draft during reconciliation", async () => {
    const { result } = renderHook(() => usePlanner());
    let plan!: ReturnType<typeof result.current.createPlan>;
    act(() => {
      plan = result.current.createPlan("Locally recoverable", "");
    });
    await act(async () => {
      await Promise.resolve();
    });
    itineraryMocks.updateItinerary.mockRejectedValueOnce(new Error("offline"));

    act(() => {
      result.current.addItem(plan.id, {
        type: "custom",
        customName: "Offline item",
        dayLabel: "Day 1",
        timeSlot: "Morning",
        notes: "",
        completed: false,
        order: 1,
      });
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    itineraryMocks.getMyItineraries.mockResolvedValueOnce([]);
    await act(async () => {
      await result.current.syncWithCloud();
    });
    expect(result.current.getPlan(plan.id)?.items).toHaveLength(1);
  });

  it("removes confirmed cloud rows that are absent from a fresh owner list", async () => {
    localStorage.setItem(
      "alanya-planner-plans:user-a",
      JSON.stringify([
        {
          id: "deleted-on-device-two",
          name: "Deleted elsewhere",
          description: "",
          createdAt: "2026-09-05T00:00:00.000Z",
          updatedAt: "2026-09-05T00:00:00.000Z",
          items: [],
          isCloudSaved: true,
        },
        {
          id: "unsaved-local",
          name: "Keep local",
          description: "",
          createdAt: "2026-09-05T00:00:00.000Z",
          updatedAt: "2026-09-05T00:00:00.000Z",
          items: [],
          isCloudSaved: false,
        },
      ]),
    );
    itineraryMocks.getMyItineraries.mockResolvedValue([]);
    const { result } = renderHook(() => usePlanner());

    await act(async () => {
      await result.current.syncWithCloud();
    });

    expect(result.current.plans.map((entry) => entry.id)).toEqual(["unsaved-local"]);
  });

  it("removes a confirmed delete from the original account after switching accounts", async () => {
    let resolveDelete!: (value: boolean) => void;
    itineraryMocks.deleteItinerary.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveDelete = resolve;
      }),
    );
    const { result, rerender } = renderHook(() => usePlanner());
    let alicePlan!: ReturnType<typeof result.current.createPlan>;
    act(() => {
      alicePlan = result.current.createPlan("Delete after switch", "");
    });
    await act(async () => {
      await Promise.resolve();
    });
    let deletion!: Promise<void>;
    act(() => {
      deletion = result.current.deletePlan(alicePlan.id);
    });

    authState.user = { id: "user-b" };
    authState.session = { access_token: "token-b" };
    rerender();
    await act(async () => {
      resolveDelete(true);
      await deletion;
    });

    const aliceStored = JSON.parse(
      localStorage.getItem("alanya-planner-plans:user-a") || "[]",
    );
    expect(aliceStored).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: alicePlan.id })]),
    );
  });

  it("preserves publication metadata through item and planner edits", async () => {
    const { result } = renderHook(() => usePlanner());
    let plan!: ReturnType<typeof result.current.createPlan>;
    act(() => {
      plan = result.current.createPlan("Published plan", "Original description");
    });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.setPlanPublicationMetadata(plan.id, {
        originalPlanId: plan.id,
        category: "Community",
        authorName: "Alice",
      });
    });
    act(() => {
      result.current.addItem(plan.id, {
        type: "custom",
        customName: "Published item",
        dayLabel: "Day 1",
        timeSlot: "Morning",
        notes: "",
        completed: false,
        order: 1,
      });
    });
    await waitFor(() => {
      expect(itineraryMocks.updateItinerary).toHaveBeenCalledWith(
        plan.id,
        expect.objectContaining({
          params: expect.objectContaining({
            originalPlanId: plan.id,
            category: "Community",
            authorName: "Alice",
          }),
        }),
        { headers: { Authorization: "Bearer token-a" } },
      );
    });

    await act(async () => {
      await result.current.updatePlan(plan.id, {
        name: "Edited published plan",
        description: "Edited description",
      });
    });
    expect(itineraryMocks.updateItinerary).toHaveBeenLastCalledWith(
      plan.id,
      expect.objectContaining({
        params: expect.objectContaining({
          description: "Edited description",
          originalPlanId: plan.id,
          category: "Community",
          authorName: "Alice",
        }),
      }),
      { headers: { Authorization: "Bearer token-a" } },
    );
  });

  it("keeps a newer item mutation dirty when delayed create succeeds and its PUT fails", async () => {
    let resolveCreate!: (value: ReturnType<typeof savedFrom>) => void;
    itineraryMocks.saveItinerary.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    );
    itineraryMocks.updateItinerary.mockRejectedValueOnce(new Error("PUT failed"));
    const first = renderHook(() => usePlanner());
    let plan!: ReturnType<typeof first.result.current.createPlan>;
    act(() => {
      plan = first.result.current.createPlan("Delayed", "");
    });
    act(() => {
      first.result.current.addItem(plan.id, {
        type: "custom",
        customName: "Must survive",
        dayLabel: "Day 1",
        timeSlot: "Morning",
        notes: "",
        completed: false,
        order: 1,
      });
    });

    await act(async () => {
      resolveCreate(
        savedFrom({ id: plan.id, title: plan.name, itinerary: [] }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(itineraryMocks.updateItinerary).toHaveBeenCalled();
      expect(first.result.current.getPlan(plan.id)?.isCloudSaved).toBe(false);
    });
    first.unmount();

    itineraryMocks.getMyItineraries.mockResolvedValueOnce([
      savedFrom({ id: plan.id, title: plan.name, itinerary: [] }),
    ]);
    const second = renderHook(() => usePlanner());
    await act(async () => {
      await second.result.current.syncWithCloud();
    });
    expect(second.result.current.getPlan(plan.id)?.items).toEqual([
      expect.objectContaining({ customName: "Must survive" }),
    ]);
  });
});
