import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ForumEvent } from "@/api-services/events.service";
import EventCard from "./EventCard";

const event: ForumEvent = {
  id: "event-1",
  title: "Sunset Sports Meetup",
  date: "2026-09-01",
  day: "01",
  month: "SEP",
  time: "6:00 PM",
  location: "Cleopatra Beach",
  category: "Sports Activities",
  attendees: 4,
  maxAttendees: 20,
  host: "Community Host",
  hostAvatar: "/images/placeholder-business.svg",
  description: "Join the community for an evening sports meetup.",
  image: "https://example.com/cover.webp",
  videoUrl: "https://example.com/event.mp4",
  isFeatured: false,
};

const props = {
  event,
  isRsvpd: false,
  isSaved: false,
  onRsvp: vi.fn(),
  onCancelRsvp: vi.fn(),
  onSave: vi.fn(),
  onUnsave: vi.fn(),
};

describe("EventCard event video", () => {
  it("opens accessible user-triggered playback without autoplay and closes on Escape", () => {
    const { container } = render(<EventCard {...props} />);

    const playButton = screen.getByRole("button", {
      name: "Play video for Sunset Sports Meetup",
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(playButton);

    const dialog = screen.getByRole("dialog", {
      name: "Sunset Sports Meetup video",
    });
    const video = dialog.querySelector("video");
    const closeButtons = within(dialog).getAllByRole("button", {
      name: "Close video",
    });
    const closeButton = closeButtons[closeButtons.length - 1];
    expect(video).toHaveAttribute("src", "https://example.com/event.mp4");
    expect(video).toHaveAttribute("controls");
    expect(video).not.toHaveAttribute("autoplay");
    expect(closeButton).toHaveFocus();
    expect(container).toHaveAttribute("inert");
    expect(container).toHaveAttribute("aria-hidden", "true");

    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(video).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(closeButton).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(playButton).toHaveFocus();
    expect(container).not.toHaveAttribute("inert");
    expect(container).not.toHaveAttribute("aria-hidden");
  });

  it("does not render playback controls when an event has no video", () => {
    render(<EventCard {...props} event={{ ...event, videoUrl: undefined }} />);

    expect(
      screen.queryByRole("button", { name: /Play video for/ }),
    ).not.toBeInTheDocument();
  });
});
