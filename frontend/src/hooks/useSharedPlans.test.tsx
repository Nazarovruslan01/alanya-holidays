import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  user: { id: "user-a" } as { id: string } | null,
  session: { access_token: "token-a" } as { access_token: string } | null,
}));

const itineraryMocks = vi.hoisted(() => ({
  getCommunityItineraries: vi.fn(),
  updateItinerary: vi.fn(),
}));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => authState,
}));

vi.mock("@/api-services/itineraries.service", () => ({
  itinerariesService: itineraryMocks,
}));

import { useSharedPlans, type SharedPlan } from "./useSharedPlans";

const plan = {
  id: "731887c2-1120-4a92-957e-f8628cfbfefc",
  name: "Owner plan",
  description: "Publish me",
  items: [
    {
      id: "item-1",
      type: "custom" as const,
      customName: "Castle",
      dayLabel: "Day 1",
      timeSlot: "Morning",
      notes: "",
      completed: false,
      order: 1,
    },
  ],
};

describe("useSharedPlans publication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    authState.user = { id: "user-a" };
    authState.session = { access_token: "token-a" };
    itineraryMocks.getCommunityItineraries.mockResolvedValue([]);
  });

  it("adds a shared plan only after the owner publish API confirms", async () => {
    let resolvePublish!: (value: unknown) => void;
    itineraryMocks.updateItinerary.mockReturnValueOnce(
      new Promise((resolve) => {
        resolvePublish = resolve;
      }),
    );
    const { result } = renderHook(() => useSharedPlans());

    let publishing!: Promise<SharedPlan>;
    act(() => {
      publishing = result.current.sharePlan(plan, "Alice");
    });
    expect(result.current.isPlanShared(plan.id)).toBeNull();

    await act(async () => {
      resolvePublish({ id: plan.id, is_public: true });
      await publishing;
    });

    expect(result.current.isPlanShared(plan.id)).toBe(plan.id);
    expect(itineraryMocks.updateItinerary).toHaveBeenCalledWith(
      plan.id,
      expect.objectContaining({
        is_public: true,
        params: expect.not.objectContaining({ shared: expect.anything() }),
      }),
      { headers: { Authorization: "Bearer token-a" } },
    );
  });

  it("does not publish locally when the owner API denies permission", async () => {
    const failure = new Error("forbidden");
    itineraryMocks.updateItinerary.mockRejectedValueOnce(failure);
    const { result } = renderHook(() => useSharedPlans());

    await expect(result.current.sharePlan(plan, "Alice")).rejects.toBe(failure);
    expect(result.current.isPlanShared(plan.id)).toBeNull();
  });

  it("keeps a shared plan until unpublish succeeds and preserves it on failure", async () => {
    const existing: SharedPlan = {
      shareId: plan.id,
      originalPlanId: plan.id,
      name: plan.name,
      description: plan.description,
      authorName: "Alice",
      sharedAt: "2026-09-05T00:00:00.000Z",
      category: "Community",
      items: plan.items.map(({ id: _id, ...item }) => item),
      copyCount: 0,
    };
    localStorage.setItem("alanya-community-plans", JSON.stringify([existing]));
    const failure = new Error("unpublish denied");
    itineraryMocks.updateItinerary.mockRejectedValueOnce(failure);
    const { result } = renderHook(() => useSharedPlans());

    await expect(result.current.unsharePlan(plan.id)).rejects.toBe(failure);
    expect(result.current.isPlanShared(plan.id)).toBe(plan.id);

    itineraryMocks.updateItinerary.mockResolvedValueOnce({ id: plan.id, is_public: false });
    await act(async () => {
      await result.current.unsharePlan(plan.id);
    });
    expect(result.current.isPlanShared(plan.id)).toBeNull();
  });

  it("removes another viewer's stale cached publication after a fresh empty response", async () => {
    localStorage.setItem(
      "alanya-community-plans",
      JSON.stringify([
        {
          shareId: "stale-publication",
          originalPlanId: "stale-owner-plan",
          name: "No longer public",
          description: "",
          authorName: "Someone",
          sharedAt: "2026-09-05T00:00:00.000Z",
          category: "Community",
          items: [],
          copyCount: 0,
        },
      ]),
    );
    itineraryMocks.getCommunityItineraries.mockResolvedValueOnce([]);
    const { result } = renderHook(() => useSharedPlans());
    expect(result.current.isPlanShared("stale-owner-plan")).toBe("stale-publication");

    await act(async () => {
      await result.current.fetchCommunityPlans();
    });

    expect(result.current.isPlanShared("stale-owner-plan")).toBeNull();
    expect(result.current.sharedPlans.map((shared) => shared.shareId)).toEqual(
      expect.arrayContaining(["community-1", "community-2", "community-3"]),
    );
  });

  it("unpublishes by canonical server ID when optional publication params are absent", async () => {
    itineraryMocks.getCommunityItineraries.mockResolvedValueOnce([
      {
        id: plan.id,
        title: "Edited public plan",
        params: { description: "Metadata was trimmed" },
        itinerary: plan.items,
        is_public: true,
        created_at: "2026-09-05T00:00:00.000Z",
      },
    ]);
    itineraryMocks.updateItinerary.mockResolvedValueOnce({
      id: plan.id,
      is_public: false,
    });
    const { result } = renderHook(() => useSharedPlans());
    await act(async () => {
      await result.current.fetchCommunityPlans();
    });

    expect(result.current.isPlanShared(plan.id)).toBe(plan.id);
    await act(async () => {
      await result.current.unsharePlan(plan.id);
    });
    expect(itineraryMocks.updateItinerary).toHaveBeenLastCalledWith(
      plan.id,
      { is_public: false },
      { headers: { Authorization: "Bearer token-a" } },
    );
  });
});
