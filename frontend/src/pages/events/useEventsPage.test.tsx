import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eventsService, type ForumEvent } from "@/api-services/events.service";
import { useEventsPage } from "./useEventsPage";

function RouterWrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>;
}

describe("useEventsPage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requests only upcoming events for the upcoming events page", async () => {
    const getEvents = vi.spyOn(eventsService, "getEvents").mockResolvedValue([]);

    renderHook(() => useEventsPage(), { wrapper: RouterWrapper });

    await waitFor(() => {
      expect(getEvents).toHaveBeenCalledWith({ upcomingOnly: true });
    });
  });

  it("keeps attendee count and RSVP state after a fresh API reload", async () => {
    const event: ForumEvent = {
      id: "event-reloaded",
      title: "Reloaded meetup",
      date: "2026-09-12",
      day: "12",
      month: "SEP",
      time: "18:00",
      location: "Alanya Harbor",
      category: "Community",
      attendees: 15,
      maxAttendees: 30,
      host: "Community Host",
      hostAvatar: "/images/placeholder-business.svg",
      description: "Meetup details",
      image: "/images/placeholder-business.svg",
      isFeatured: false,
      going_by_me: true,
    };
    const getEvents = vi.spyOn(eventsService, "getEvents")
      .mockResolvedValueOnce([event])
      .mockResolvedValueOnce([{ ...event, attendees: 16, going_by_me: false }]);

    const { result } = renderHook(() => useEventsPage(), { wrapper: RouterWrapper });

    await waitFor(() => {
      expect(result.current.events[0]).toMatchObject({ attendees: 15, going_by_me: true });
    });
    await result.current.loadEvents();

    await waitFor(() => {
      expect(result.current.events[0]).toMatchObject({ attendees: 16, going_by_me: false });
    });
    expect(getEvents).toHaveBeenCalledTimes(2);
  });
});
