import { beforeEach, describe, expect, it, vi } from "vitest";

const apiClientMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  apiClient: apiClientMock,
}));

import { itinerariesService } from "./itineraries.service";

describe("ItinerariesService cloud mutations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("sends the caller's stable ID when creating an itinerary", async () => {
    const input = {
      id: "d74d2730-bfe5-4e22-854c-b5b8c4c46a25",
      title: "Stable plan",
      params: { description: "Keep this ID" },
      itinerary: [],
    };
    apiClientMock.post.mockResolvedValue({
      ...input,
      user_id: "user-1",
      created_at: "2026-09-05T00:00:00.000Z",
    });

    await expect(itinerariesService.saveItinerary(input)).resolves.toMatchObject({
      id: input.id,
    });
    expect(apiClientMock.post).toHaveBeenCalledWith("/itineraries", input, undefined);
  });

  it("propagates create failures without manufacturing a second local plan", async () => {
    const failure = new Error("cloud create failed");
    apiClientMock.post.mockRejectedValue(failure);

    await expect(
      itinerariesService.saveItinerary({
        id: "7fcd80eb-e340-4b91-996e-e31d6ffdf3c8",
        title: "Offline plan",
        itinerary: [],
      }),
    ).rejects.toBe(failure);
    expect(localStorage.getItem("alanya-planner-plans")).toBeNull();
  });

  it("propagates update and delete failures instead of reporting local success", async () => {
    const updateFailure = new Error("update denied");
    const deleteFailure = new Error("delete denied");
    apiClientMock.put.mockRejectedValue(updateFailure);
    apiClientMock.delete.mockRejectedValue(deleteFailure);

    await expect(
      itinerariesService.updateItinerary("plan-1", { title: "Denied" }),
    ).rejects.toBe(updateFailure);
    await expect(itinerariesService.deleteItinerary("plan-1")).rejects.toBe(deleteFailure);
  });

  it("passes an explicit captured auth header through owner mutations", async () => {
    const options = { headers: { Authorization: "Bearer account-a-token" } };
    apiClientMock.put.mockResolvedValue({ id: "plan-1" });
    apiClientMock.delete.mockResolvedValue({ success: true });

    await itinerariesService.updateItinerary(
      "plan-1",
      { is_public: true },
      options,
    );
    await itinerariesService.deleteItinerary("plan-1", options);

    expect(apiClientMock.put).toHaveBeenCalledWith(
      "/itineraries/plan-1",
      { is_public: true },
      options,
    );
    expect(apiClientMock.delete).toHaveBeenCalledWith("/itineraries/plan-1", options);
  });

  it("treats a successful empty community response as authoritative", async () => {
    localStorage.setItem(
      "alanya-community-plans",
      JSON.stringify([{ shareId: "stale-plan", originalPlanId: "stale-plan" }]),
    );
    apiClientMock.get.mockResolvedValue([]);

    await expect(itinerariesService.getCommunityItineraries()).resolves.toEqual([]);
  });
});
