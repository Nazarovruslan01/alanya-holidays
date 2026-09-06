import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import HostEventModal from "./HostEventModal";
import {
  eventsService,
  type BackendForumEvent,
  type CreateEventPayload,
  type ForumEvent,
} from "@/api-services/events.service";
import { forumService, type Category } from "@/api-services/forum.service";
import { storageService } from "@/api-services/storage.service";

vi.mock("@/api-services/events.service", () => ({
  eventsService: {
    createEvent: vi.fn(),
  },
}));

vi.mock("@/api-services/forum.service", () => ({
  forumService: {
    getCategories: vi.fn(),
  },
}));

vi.mock("@/api-services/storage.service", () => ({
  storageService: {
    uploadEventImage: vi.fn(),
    uploadEventVideo: vi.fn(),
    abandonEventMedia: vi.fn(),
  },
}));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1" } }),
}));

const categoryId = "11111111-2222-4333-8444-555555555555";

const createdEvent: ForumEvent = {
  id: "event-1",
  title: "Sunset Sports Meetup",
  date: "2026-09-01",
  day: "01",
  month: "SEP",
  time: "18:00",
  location: "Cleopatra Beach",
  category: "Sports Activities",
  attendees: 0,
  maxAttendees: 50,
  host: "Admin",
  hostAvatar: "/images/placeholder-business.svg",
  description: "Join the community for an evening sports meetup.",
  image: "/images/placeholder-business.svg",
  isFeatured: false,
};

describe("HostEventModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn((file: File) => `blob:${file.name}`),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    vi.mocked(forumService.getCategories).mockResolvedValue([
      {
        id: categoryId,
        name: "Sports Activities",
        slug: "events-sports",
      } as Category,
    ]);
    vi.mocked(eventsService.createEvent).mockResolvedValue(createdEvent);
    vi.mocked(storageService.uploadEventImage).mockResolvedValue({
      mediaId: "image-media-1",
      url: "https://project.supabase.co/storage/v1/object/public/forum-media/user-1/events/cover.webp",
      thumbnailUrl:
        "https://project.supabase.co/storage/v1/object/public/forum-media/user-1/events/cover-thumb.webp",
    });
    vi.mocked(storageService.uploadEventVideo).mockResolvedValue({
      mediaId: "video-media-1",
      url: "https://project.supabase.co/storage/v1/object/public/event-media/user-1/events/clip.mp4",
    });
    vi.mocked(storageService.abandonEventMedia).mockResolvedValue(undefined);
  });

  async function fillRequiredFields() {
    const categorySelect = await screen.findByRole("combobox");
    fireEvent.change(categorySelect, { target: { value: categoryId } });
    fireEvent.change(
      screen.getByPlaceholderText("e.g. Sunset Yoga at Cleopatra Beach"),
      {
        target: { value: "Sunset Sports Meetup" },
      },
    );
    fireEvent.change(
      screen.getByPlaceholderText("e.g. Cleopatra Beach, Alanya"),
      {
        target: { value: "Cleopatra Beach" },
      },
    );
    fireEvent.change(
      screen.getByPlaceholderText(
        "Describe the event — what to bring, what to expect, who is it for...",
      ),
      { target: { value: "Join the community for an evening sports meetup." } },
    );
    fireEvent.change(
      document.querySelector('input[name="eventDate"]') as HTMLInputElement,
      {
        target: { value: "2026-09-01" },
      },
    );
    fireEvent.change(
      document.querySelector('input[name="eventTime"]') as HTMLInputElement,
      {
        target: { value: "18:00" },
      },
    );
  }

  it("submits the selected forum category UUID and shows the success state", async () => {
    const onEventCreated = vi.fn();
    render(<HostEventModal isOpen onClose={vi.fn()} onEventCreated={onEventCreated} />);

    const categorySelect = await screen.findByRole("combobox");
    const categoryOption = screen.getByRole("option", { name: "Sports Activities" });
    fireEvent.change(categorySelect, { target: { value: categoryOption.getAttribute("value") } });
    fireEvent.change(screen.getByPlaceholderText("e.g. Sunset Yoga at Cleopatra Beach"), {
      target: { value: "Sunset Sports Meetup" },
    });
    fireEvent.change(screen.getByPlaceholderText("e.g. Cleopatra Beach, Alanya"), {
      target: { value: "Cleopatra Beach" },
    });
    fireEvent.change(
      screen.getByPlaceholderText("Describe the event — what to bring, what to expect, who is it for..."),
      { target: { value: "Join the community for an evening sports meetup." } },
    );
    fireEvent.change(document.querySelector('input[name="eventDate"]') as HTMLInputElement, {
      target: { value: "2026-09-01" },
    });
    fireEvent.change(document.querySelector('input[name="eventTime"]') as HTMLInputElement, {
      target: { value: "18:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Publish Event" }));

    await waitFor(() => {
      expect(eventsService.createEvent).toHaveBeenCalledWith(
        expect.objectContaining({ category_id: categoryId }),
        expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        ),
      );
    });
    expect(onEventCreated).toHaveBeenCalledWith(createdEvent);
    expect(await screen.findByRole("heading", { name: "Event Published!" })).toBeInTheDocument();
  });

  it("edits an existing event with local datetime fields and preserves its instant", async () => {
    const onSave = vi.fn(
      async (_payload: CreateEventPayload, _idempotencyKey: string) => undefined,
    );
    const initialEvent: BackendForumEvent = {
      id: "event-1",
      title: "Harbour Meetup",
      description: "Meet the community beside the harbour in Alanya.",
      location: "Alanya Harbour",
      event_date: "2026-09-01T18:00:00.456Z",
      category_id: categoryId,
      category: {
        id: categoryId,
        name: "Sports Activities",
        slug: "events-sports",
      },
      image_url: "https://legacy.example/cover.jpg",
      video_url: "https://legacy.example/clip.mp4",
      is_published: false,
    };

    render(
      <HostEventModal
        isOpen
        onClose={vi.fn()}
        initialEvent={initialEvent}
        isAdmin
        onSave={onSave}
      />,
    );

    await screen.findByRole("option", { name: "Sports Activities" });
    expect(screen.getByLabelText("Date")).toHaveValue("2026-09-01");
    expect(screen.getByLabelText("Time")).toHaveValue("21:00");
    expect(screen.getByLabelText("Published")).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Save event" }));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          event_date: "2026-09-01T18:00:00.456Z",
          category_id: categoryId,
          is_published: false,
        }),
        expect.any(String),
      ),
    );
    const payload = onSave.mock.calls[0][0];
    expect(payload).not.toHaveProperty("image_url");
    expect(payload).not.toHaveProperty("video_url");
    expect(payload).not.toHaveProperty("image_media_id");
    expect(payload).not.toHaveProperty("video_media_id");
  });

  it("allows a metadata-only edit of a legacy event without a category", async () => {
    const onSave = vi.fn(
      async (_payload: CreateEventPayload, _idempotencyKey: string) => undefined,
    );
    render(
      <HostEventModal
        isOpen
        onClose={vi.fn()}
        isAdmin
        initialEvent={{
          id: "legacy-event",
          title: "Old",
          description: null,
          location: null,
          event_date: "2026-09-01T18:00:00.000Z",
          category_id: null,
        }}
        onSave={onSave}
      />,
    );

    await screen.findByRole("option", { name: "Sports Activities" });
    fireEvent.click(screen.getByLabelText("Published"));
    fireEvent.click(screen.getByRole("button", { name: "Save event" }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).not.toHaveProperty("category_id");
  });

  it("keeps valid media local until submit, then persists opaque media IDs", async () => {
    render(
      <HostEventModal isOpen onClose={vi.fn()} onEventCreated={vi.fn()} />,
    );
    await fillRequiredFields();
    const cover = new File(["cover"], "cover.png", { type: "image/png" });
    const video = new File(["video"], "clip.mp4", { type: "video/mp4" });

    fireEvent.change(screen.getByLabelText("Event cover image"), {
      target: { files: [cover] },
    });
    fireEvent.change(screen.getByLabelText("Event video"), {
      target: { files: [video] },
    });

    expect(screen.getByRole("img", { name: "Cover preview" })).toHaveAttribute(
      "src",
      "blob:cover.png",
    );
    expect(screen.getByText("clip.mp4")).toBeInTheDocument();
    expect(storageService.uploadEventImage).not.toHaveBeenCalled();
    expect(storageService.uploadEventVideo).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Publish Event" }));

    await waitFor(() => {
      expect(storageService.uploadEventImage).toHaveBeenCalledWith(cover);
      expect(storageService.uploadEventVideo).toHaveBeenCalledWith(
        video,
        "user-1",
      );
      expect(eventsService.createEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          image_media_id: "image-media-1",
          video_media_id: "video-media-1",
        }),
        expect.any(String),
      );
    });
  });

  it("supports replacing and removing a local cover without uploading it", async () => {
    render(<HostEventModal isOpen onClose={vi.fn()} />);
    const input = screen.getByLabelText("Event cover image");

    fireEvent.change(input, {
      target: { files: [new File(["one"], "one.jpg", { type: "image/jpeg" })] },
    });
    fireEvent.change(input, {
      target: {
        files: [new File(["two"], "two.webp", { type: "image/webp" })],
      },
    });

    expect(screen.getByRole("img", { name: "Cover preview" })).toHaveAttribute(
      "src",
      "blob:two.webp",
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove cover image" }));
    expect(
      screen.queryByRole("img", { name: "Cover preview" }),
    ).not.toBeInTheDocument();
    expect(storageService.uploadEventImage).not.toHaveBeenCalled();
  });

  it.each([
    [
      "Event cover image",
      "cover.svg",
      "image/svg+xml",
      1,
      "Only JPEG, PNG, and WebP images are allowed",
    ],
    [
      "Event video",
      "clip.mov",
      "video/quicktime",
      1,
      "Only MP4 and WebM videos are allowed",
    ],
    [
      "Event cover image",
      "huge.png",
      "image/png",
      5 * 1024 * 1024 + 1,
      "Image must not exceed 5 MB",
    ],
    [
      "Event video",
      "huge.mp4",
      "video/mp4",
      50 * 1024 * 1024 + 1,
      "Video must not exceed 50 MB",
    ],
  ])(
    "rejects invalid media before any network call",
    async (label, name, type, size, message) => {
      render(<HostEventModal isOpen onClose={vi.fn()} />);
      await fillRequiredFields();
      const file = new File(["content"], name, { type });
      Object.defineProperty(file, "size", { value: size });

      fireEvent.change(screen.getByLabelText(label), {
        target: { files: [file] },
      });

      expect(await screen.findByText(message)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Publish Event" }));
      expect(storageService.uploadEventImage).not.toHaveBeenCalled();
      expect(storageService.uploadEventVideo).not.toHaveBeenCalled();
      expect(eventsService.createEvent).not.toHaveBeenCalled();
    },
  );

  it("reuses one key and uploaded media after an uncertain create failure", async () => {
    vi.mocked(eventsService.createEvent)
      .mockRejectedValueOnce(new Error("network response lost"))
      .mockResolvedValueOnce(createdEvent);
    render(<HostEventModal isOpen onClose={vi.fn()} />);
    await fillRequiredFields();
    fireEvent.change(screen.getByLabelText("Event cover image"), {
      target: {
        files: [new File(["cover"], "cover.png", { type: "image/png" })],
      },
    });
    fireEvent.change(screen.getByLabelText("Event video"), {
      target: {
        files: [new File(["video"], "clip.webm", { type: "video/webm" })],
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Publish Event" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not publish this event right now. Please try again.",
    );
    expect(storageService.abandonEventMedia).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Publish Event" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Publish Event" }));

    await screen.findByRole("heading", { name: "Event Published!" });
    expect(storageService.uploadEventImage).toHaveBeenCalledTimes(1);
    expect(storageService.uploadEventVideo).toHaveBeenCalledTimes(1);
    expect(eventsService.createEvent).toHaveBeenCalledTimes(2);
    expect(vi.mocked(eventsService.createEvent).mock.calls[1][0]).toEqual(
      vi.mocked(eventsService.createEvent).mock.calls[0][0],
    );
    expect(vi.mocked(eventsService.createEvent).mock.calls[1][1]).toBe(
      vi.mocked(eventsService.createEvent).mock.calls[0][1],
    );
  });

  it("abandons retained uploads and starts a new logical attempt after a form change", async () => {
    vi.mocked(eventsService.createEvent)
      .mockRejectedValueOnce(new Error("network response lost"))
      .mockResolvedValueOnce(createdEvent);
    render(<HostEventModal isOpen onClose={vi.fn()} />);
    await fillRequiredFields();
    const cover = new File(["cover"], "cover.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Event cover image"), {
      target: { files: [cover] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Publish Event" }));
    await screen.findByRole("alert");
    const firstKey = vi.mocked(eventsService.createEvent).mock.calls[0][1];

    fireEvent.change(
      screen.getByPlaceholderText("e.g. Sunset Yoga at Cleopatra Beach"),
      { target: { value: "Changed title" } },
    );

    await waitFor(() =>
      expect(storageService.abandonEventMedia).toHaveBeenCalledWith(
        "image-media-1",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Publish Event" }));

    await screen.findByRole("heading", { name: "Event Published!" });
    expect(storageService.uploadEventImage).toHaveBeenCalledTimes(2);
    expect(vi.mocked(eventsService.createEvent).mock.calls[1][1]).not.toBe(
      firstKey,
    );
  });

  it("moves focus into the modal, traps it, isolates the background, and restores focus", async () => {
    const opener = document.createElement("button");
    opener.textContent = "Open";
    document.body.appendChild(opener);
    opener.focus();
    const onClose = vi.fn();
    const { rerender } = render(
      <HostEventModal isOpen onClose={onClose} />,
    );

    const dialog = screen.getByRole("dialog");
    const close = screen.getByRole("button", { name: "Close modal" });
    expect(close).toHaveFocus();
    expect(dialog).toHaveAttribute("aria-modal", "true");

    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(document.activeElement).not.toBe(opener);
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(<HostEventModal isOpen={false} onClose={onClose} />);
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it("blocks a duplicate submit while publication is pending", async () => {
    let resolveCreation: ((value: ForumEvent) => void) | undefined;
    vi.mocked(eventsService.createEvent).mockReturnValueOnce(
      new Promise<ForumEvent>((resolve) => {
        resolveCreation = resolve;
      }),
    );
    render(<HostEventModal isOpen onClose={vi.fn()} />);
    await fillRequiredFields();

    const publish = screen.getByRole("button", { name: "Publish Event" });
    fireEvent.click(publish);
    fireEvent.submit(publish.closest("form") as HTMLFormElement);

    expect(eventsService.createEvent).toHaveBeenCalledTimes(1);
    resolveCreation?.(createdEvent);
    expect(await screen.findByRole("heading", { name: "Event Published!" })).toBeInTheDocument();
  });

  it("ignores draft edits and media drops while an uncertain publication is pending", async () => {
    let rejectCreation: ((reason?: unknown) => void) | undefined;
    vi.mocked(eventsService.createEvent)
      .mockReturnValueOnce(
        new Promise<ForumEvent>((_resolve, reject) => {
          rejectCreation = reject;
        }),
      )
      .mockResolvedValueOnce(createdEvent);
    render(<HostEventModal isOpen onClose={vi.fn()} />);
    await fillRequiredFields();
    const coverInput = screen.getByLabelText("Event cover image");
    const videoInput = screen.getByLabelText("Event video");
    fireEvent.change(coverInput, {
      target: {
        files: [new File(["cover"], "cover.png", { type: "image/png" })],
      },
    });
    fireEvent.change(videoInput, {
      target: {
        files: [new File(["video"], "clip.webm", { type: "video/webm" })],
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Publish Event" }));
    await waitFor(() => expect(eventsService.createEvent).toHaveBeenCalledTimes(1));
    const firstCall = vi.mocked(eventsService.createEvent).mock.calls[0];

    fireEvent.change(
      screen.getByPlaceholderText("e.g. Sunset Yoga at Cleopatra Beach"),
      { target: { value: "Changed while pending" } },
    );
    fireEvent.drop(coverInput.parentElement as HTMLElement, {
      dataTransfer: {
        files: [new File(["other"], "other.webp", { type: "image/webp" })],
      },
    });
    fireEvent.drop(videoInput.parentElement as HTMLElement, {
      dataTransfer: {
        files: [new File(["other"], "other.mp4", { type: "video/mp4" })],
      },
    });
    fireEvent.submit(
      screen.getByRole("button", { name: /Publishing|Uploading media/ }).closest(
        "form",
      ) as HTMLFormElement,
    );

    expect(eventsService.createEvent).toHaveBeenCalledTimes(1);
    expect(storageService.abandonEventMedia).not.toHaveBeenCalled();
    rejectCreation?.(new Error("network response lost"));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Publish Event" }));

    await screen.findByRole("heading", { name: "Event Published!" });
    expect(storageService.uploadEventImage).toHaveBeenCalledTimes(1);
    expect(storageService.uploadEventVideo).toHaveBeenCalledTimes(1);
    expect(eventsService.createEvent).toHaveBeenCalledTimes(2);
    expect(vi.mocked(eventsService.createEvent).mock.calls[1]).toEqual(
      firstCall,
    );
  });
});
