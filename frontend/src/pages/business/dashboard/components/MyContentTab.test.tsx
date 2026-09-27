import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { blogService } from "@/api-services/blog.service";
import i18n from "@/i18n";
import { MyContentTab } from "./MyContentTab";

vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "author-1" } }) }));

const quillState = vi.hoisted(() => ({
  textChangeCallbacks: [] as Array<() => void>,
}));

vi.mock("@/api-services/blog.service", async () => {
  const actual = await vi.importActual<typeof import("@/api-services/blog.service")>(
    "@/api-services/blog.service",
  );
  return {
    ...actual,
    blogService: {
      ...actual.blogService,
      getMyPosts: vi.fn(),
      getMySubmissions: vi.fn(),
      updateMyPost: vi.fn(),
      updateMySubmission: vi.fn(),
      resubmitMySubmission: vi.fn(),
    },
  };
});

vi.mock("@/api-services/storage.service", () => ({
  uploadForumImage: vi.fn(),
  uploadInlineVideo: vi.fn(),
}));

vi.mock("quill/blots/block", () => ({
  BlockEmbed: class MockBlockEmbed {
    static create() {
      return document.createElement("div");
    }
  },
}));

vi.mock("quill", () => ({
  default: class MockQuill {
    static register = vi.fn();
    root: HTMLDivElement;
    clipboard: { dangerouslyPasteHTML: (...args: unknown[]) => void };

    constructor(container: HTMLElement) {
      this.root = document.createElement("div");
      this.root.className = "ql-editor";
      this.root.setAttribute("data-testid", "mock-quill-editor");
      this.clipboard = {
        dangerouslyPasteHTML: (...args: unknown[]) => {
          const html = typeof args[0] === "string" ? args[0] : args[1];
          this.root.innerHTML = String(html || "");
        },
      };
      container.appendChild(this.root);
    }

    getSemanticHTML() {
      return this.root.innerHTML;
    }

    on(event: string, callback: () => void) {
      if (event === "text-change") quillState.textChangeCallbacks.push(callback);
    }
  },
}));

const post = {
  id: "post-1",
  title: "Harbor guide",
  slug: "harbor-guide",
  content: "<p>Original <strong>formatted</strong> content.</p>",
  category: "guides",
  status: "published",
};

const submission = {
  id: "submission-1",
  user_id: "user-1",
  title: "Harbor story",
  content: "<p>Submission <strong>draft</strong>.</p>",
  category: "stories",
  status: "pending_review" as const,
  rejection_reason: null,
  created_at: "2026-09-09T08:00:00.000Z",
};

describe("MyContentTab", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    vi.clearAllMocks();
    quillState.textChangeCallbacks = [];
    vi.mocked(blogService.getMyPosts).mockResolvedValue([post]);
    vi.mocked(blogService.getMySubmissions).mockResolvedValue([]);
    vi.mocked(blogService.updateMyPost).mockResolvedValue(post);
    vi.mocked(blogService.updateMySubmission).mockResolvedValue(submission);
  });

  it.each([
    ["en", "Edit"],
    ["ru", "Изменить"],
    ["tr", "Düzenle"],
  ])("shows the %s edit label in the selected language", async (language, label) => {
    await i18n.changeLanguage(language);
    vi.mocked(blogService.getMyPosts).mockResolvedValue([post]);

    render(<MyContentTab />);

    expect(await screen.findByRole("button", { name: label })).toBeInTheDocument();
  });

  it("hydrates formatted HTML, submits edits, and retains content after a save failure", async () => {
    render(<MyContentTab />);
    expect(await screen.findByText("Harbor guide")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /edit/i }));
    const editor = screen.getByTestId("mock-quill-editor");
    expect(editor).toHaveAttribute("aria-label", "Content");
    expect(editor.innerHTML).toBe(post.content);

    const editedHtml = "<p>Edited <em>HTML</em> content.</p>";
    editor.innerHTML = editedHtml;
    act(() => quillState.textChangeCallbacks.forEach((callback) => callback()));
    vi.mocked(blogService.updateMyPost).mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(blogService.updateMyPost).toHaveBeenCalledWith(
      "post-1",
      expect.objectContaining({ content: editedHtml }),
    ));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByTestId("mock-quill-editor").innerHTML).toBe(editedHtml);
  });

  it("edits and submits an editorial submission through the shared editor", async () => {
    vi.mocked(blogService.getMyPosts).mockResolvedValue([]);
    vi.mocked(blogService.getMySubmissions).mockResolvedValue([submission]);
    vi.mocked(blogService.updateMySubmission).mockResolvedValue(submission);

    render(<MyContentTab />);
    expect(await screen.findByText("Harbor story")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /edit/i }));
    const editor = screen.getByTestId("mock-quill-editor");
    expect(editor.innerHTML).toBe(submission.content);

    const editedHtml = "<p>Updated <u>submission</u> content.</p>";
    editor.innerHTML = editedHtml;
    act(() => quillState.textChangeCallbacks.forEach((callback) => callback()));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(blogService.updateMySubmission).toHaveBeenCalledWith(
      "submission-1",
      expect.objectContaining({ content: editedHtml }),
    ));
  });

  it("hides the old rejection reason after an edited submission returns to review", async () => {
    vi.mocked(blogService.getMyPosts).mockResolvedValue([]);
    const rejected = { ...submission, status: "rejected" as const, rejection_reason: "Please add sources." };
    const updated = { ...rejected, content: "<p>Updated submission content.</p>", status: "pending_review" as const, rejection_reason: null };
    vi.mocked(blogService.getMySubmissions).mockResolvedValue([rejected]);
    vi.mocked(blogService.updateMySubmission).mockResolvedValue(updated);

    render(<MyContentTab />);
    expect(await screen.findByText("Please add sources.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const editor = screen.getByTestId("mock-quill-editor");
    editor.innerHTML = updated.content;
    act(() => quillState.textChangeCallbacks.forEach((callback) => callback()));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(blogService.updateMySubmission).toHaveBeenCalled());
    await waitFor(() => {
      expect(screen.queryByText("Please add sources.")).not.toBeInTheDocument();
      expect(screen.getByText("pending review")).toBeInTheDocument();
    });
  });

  it("does not show a legacy rejection reason while a submission is pending review", async () => {
    vi.mocked(blogService.getMyPosts).mockResolvedValue([]);
    vi.mocked(blogService.getMySubmissions).mockResolvedValue([
      { ...submission, rejection_reason: "Old rejection note" },
    ]);

    render(<MyContentTab />);

    expect(await screen.findByText("Harbor story")).toBeInTheDocument();
    expect(screen.queryByText("Old rejection note")).not.toBeInTheDocument();
  });

  it("filters posts and submissions locally without changing the loaded data", async () => {
    vi.mocked(blogService.getMyPosts).mockResolvedValue([
      post,
      { ...post, id: "post-2", title: "Mountain trails", content: "Pine route" },
    ]);
    vi.mocked(blogService.getMySubmissions).mockResolvedValue([submission]);

    render(<MyContentTab />);
    expect(await screen.findByText("Harbor guide")).toBeInTheDocument();
    expect(screen.getByText("Harbor story")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "Search" }), {
      target: { value: "HARBOR" },
    });
    expect(screen.getByText("Harbor guide")).toBeInTheDocument();
    expect(screen.getByText("Harbor story")).toBeInTheDocument();
    expect(screen.queryByText("Mountain trails")).not.toBeInTheDocument();
  });
});
