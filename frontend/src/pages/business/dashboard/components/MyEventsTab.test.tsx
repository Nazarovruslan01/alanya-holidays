import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eventsService, type ForumEvent } from "@/api-services/events.service";
import { MyEventsTab } from "./MyEventsTab";

vi.mock("@/api-services/events.service", async () => {
  const actual = await vi.importActual<typeof import("@/api-services/events.service")>(
    "@/api-services/events.service",
  );
  return {
    ...actual,
    eventsService: {
      ...actual.eventsService,
      getMyEvents: vi.fn(),
      updateEvent: vi.fn(),
    },
  };
});

const event: ForumEvent = {
  id: "event-1",
  title: "Harbor meetup",
  date: "2026-09-09",
  day: "09",
  month: "SEP",
  time: "12:30 PM",
  location: "Alanya Harbor",
  category: "Community",
  attendees: 10,
  maxAttendees: 30,
  host: "Merchant Host",
  hostAvatar: "/images/placeholder-business.svg",
  description: "Meet the community by the harbor.",
  image: "/images/placeholder-business.svg",
  isFeatured: false,
  eventDate: "2026-09-09T09:30:00.000Z",
  isPublished: true,
};

const toDateTimeLocalValue = (value: string) => {
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

describe("MyEventsTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(eventsService.getMyEvents).mockResolvedValue([event]);
    vi.mocked(eventsService.updateEvent).mockResolvedValue(event);
  });

  it("shows local time and preserves the same instant when saved unchanged", async () => {
    render(<MyEventsTab />);
    expect(await screen.findByText("Harbor meetup")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const dateTime = screen.getByLabelText("Date and time") as HTMLInputElement;
    expect(dateTime.value).toBe(toDateTimeLocalValue(event.eventDate!));

    fireEvent.click(screen.getByRole("button", { name: "Save event" }));
    await waitFor(() =>
      expect(eventsService.updateEvent).toHaveBeenCalledWith(
        "event-1",
        expect.objectContaining({ event_date: event.eventDate }),
      ),
    );
  });

  it("serializes an edited local time to its correct ISO instant", async () => {
    render(<MyEventsTab />);
    await screen.findByText("Harbor meetup");

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Date and time"), {
      target: { value: "2026-09-09T13:30" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save event" }));

    await waitFor(() =>
      expect(eventsService.updateEvent).toHaveBeenCalledWith(
      "event-1",
        expect.objectContaining({ event_date: new Date("2026-09-09T13:30").toISOString() }),
      ),
    );
  });

  it("preserves an unchanged instant across a local date boundary", async () => {
    const boundaryEvent = {
      ...event,
      eventDate: "2026-09-09T22:30:00.000Z",
    };
    vi.mocked(eventsService.getMyEvents).mockResolvedValue([boundaryEvent]);

    render(<MyEventsTab />);
    await screen.findByText("Harbor meetup");

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect((screen.getByLabelText("Date and time") as HTMLInputElement).value).toBe(
      toDateTimeLocalValue(boundaryEvent.eventDate),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save event" }));

    await waitFor(() =>
      expect(eventsService.updateEvent).toHaveBeenCalledWith(
        "event-1",
        expect.objectContaining({ event_date: boundaryEvent.eventDate }),
      ),
    );
  });
});
