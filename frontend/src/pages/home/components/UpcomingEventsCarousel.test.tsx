import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import UpcomingEventsCarousel from "./UpcomingEventsCarousel";
import { eventsService, type ForumEvent } from "@/api-services/events.service";
import i18n from "@/i18n";

const currentEvent: ForumEvent = {
  id: "current-event",
  title: "Alanya Summer Community Picnic",
  date: "2026-08-30",
  day: "30",
  month: "AUG",
  time: "5:00 PM",
  location: "Alanya Castle",
  category: "Traveler Meetups",
  attendees: 12,
  maxAttendees: 30,
  host: "Community Team",
  hostAvatar: "/images/placeholder-business.svg",
  description: "A current community event.",
  image: "/images/placeholder-business.svg",
  isFeatured: true,
};

async function renderCarousel() {
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(<MemoryRouter><UpcomingEventsCarousel /></MemoryRouter>);
  });
  return view;
}

describe("UpcomingEventsCarousel Component", () => {
  it('distinguishes loading and failure from empty data and retries live events', async () => {
    vi.setSystemTime(new Date('2026-08-30T12:00:00+03:00'));
    let reject!: (error: Error) => void;
    vi.spyOn(eventsService, 'getEvents').mockImplementationOnce(() => new Promise((_, rejectRequest) => { reject = rejectRequest; })).mockResolvedValueOnce([currentEvent]);
    const sync = vi.spyOn(eventsService, 'getEventsSync');
    await renderCarousel();
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    expect(screen.queryByText('No events scheduled this week')).not.toBeInTheDocument();
    expect(sync).not.toHaveBeenCalled();
    await act(async () => { reject(new Error('internal SQL failure')); });
    expect(screen.getByRole('alert')).toHaveTextContent(i18n.t('home.eventsUnavailable'));
    expect(screen.queryByText('internal SQL failure')).not.toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try Again' })); });
    expect(screen.getByText(currentEvent.title)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  const originalScrollBy = Element.prototype.scrollBy;

  beforeEach(async () => {
    await i18n.changeLanguage("en");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-08T12:00:00+03:00"));
    Element.prototype.scrollBy = vi.fn();
    vi.restoreAllMocks();
    vi.spyOn(eventsService, "getEvents").mockResolvedValue(eventsService.getEventsSync());
  });

  afterEach(async () => {
    Element.prototype.scrollBy = originalScrollBy;
    vi.restoreAllMocks();
    vi.useRealTimers();
    await i18n.changeLanguage("en");
  });

  it("renders events from the current seven-day window instead of a fixed historical week", async () => {
    vi.setSystemTime(new Date("2026-08-30T12:00:00+03:00"));
    vi.spyOn(eventsService, "getEvents").mockResolvedValue([currentEvent]);

    await renderCarousel();

    expect(screen.getByText("Alanya Summer Community Picnic")).toBeInTheDocument();
  });

  it("keeps the events entry point visible when the current week has no events", async () => {
    vi.setSystemTime(new Date("2026-08-31T12:00:00+03:00"));
    vi.spyOn(eventsService, "getEvents").mockResolvedValue([]);

    await renderCarousel();

    expect(screen.getByText(/This Week's Events/i)).toBeInTheDocument();
    expect(screen.getByText("No events scheduled this week")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Browse all events/i })).toHaveAttribute(
      "href",
      "/events"
    );
  });

  it("localizes the no-events entry point in Russian", async () => {
    await i18n.changeLanguage("ru");
    vi.setSystemTime(new Date("2026-08-31T12:00:00+03:00"));
    vi.spyOn(eventsService, "getEvents").mockResolvedValue([]);

    await renderCarousel();

    expect(screen.getByText("События этой недели")).toBeInTheDocument();
    expect(screen.getByText("На этой неделе мероприятий нет")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Все мероприятия" })).toHaveAttribute("href", "/events");
    expect(screen.queryByText("No events scheduled this week")).not.toBeInTheDocument();
  });

  it("renders This Week's Events heading with count badge", async () => {
    await renderCarousel();

    expect(screen.getByText(/This Week's Events/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /view all/i })).toHaveAttribute("href", "/events");
  });

  it("renders event date badges, attendee numbers, and spot indicators", async () => {
    await renderCarousel();

    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("JUN")).toBeInTheDocument();
    expect(screen.getByText(/Digital Nomad Beach Meetup/i)).toBeInTheDocument();
    expect(screen.getByText(/spots/i)).toBeInTheDocument();
  });

  it("renders browse all events card", async () => {
    await renderCarousel();

    expect(screen.getByText(/Browse All Events/i)).toBeInTheDocument();
  });

  it("does not render scroll arrows when content fits within container without overflow", async () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1200);
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(550);
    vi.spyOn(HTMLElement.prototype, "scrollLeft", "get").mockReturnValue(0);

    await renderCarousel();

    expect(screen.queryByRole("button", { name: /scroll right/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /scroll left/i })).not.toBeInTheDocument();
  });

  it("renders right scroll arrow when content overflows and triggers smooth scrolling on click", async () => {
    const scrollByMock = vi.fn();
    Element.prototype.scrollBy = scrollByMock;

    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(400);
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(1000);
    vi.spyOn(HTMLElement.prototype, "scrollLeft", "get").mockReturnValue(0);

    await renderCarousel();

    const rightArrow = screen.getByRole("button", { name: /scroll right/i });
    expect(rightArrow).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /scroll left/i })).not.toBeInTheDocument();

    fireEvent.click(rightArrow);
    expect(scrollByMock).toHaveBeenCalledWith(
      expect.objectContaining({
        left: 320,
        behavior: "smooth",
      })
    );
  });

  it("dynamically updates scroll arrows on window resize", async () => {
    const clientWidthSpy = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1200);
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(1000);
    vi.spyOn(HTMLElement.prototype, "scrollLeft", "get").mockReturnValue(0);

    await renderCarousel();

    expect(screen.queryByRole("button", { name: /scroll right/i })).not.toBeInTheDocument();

    // Shrink viewport so content now overflows
    clientWidthSpy.mockReturnValue(500);
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    expect(screen.getByRole("button", { name: /scroll right/i })).toBeInTheDocument();
  });
});
