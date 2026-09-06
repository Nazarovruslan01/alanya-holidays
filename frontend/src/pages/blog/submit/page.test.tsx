import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import BlogSubmitPage from "./page";
import { blogService } from "@/api-services/blog.service";
import { deleteBlogImage, uploadBlogImage } from "@/api-services/storage.service";
import { ApiError } from "@/lib/api-client";

const { inlineUploadHarness } = vi.hoisted(() => ({
  inlineUploadHarness: {
    resolve: undefined as ((url: string) => void) | undefined,
  },
}));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    isAuthenticated: true,
    loading: false,
    user: { id: "user-1" },
  }),
}));

vi.mock("@/api-services/blog.service", async () => {
  const actual = await vi.importActual<typeof import("@/api-services/blog.service")>(
    "@/api-services/blog.service"
  );
  return {
    ...actual,
    blogService: {
      ...actual.blogService,
      getTags: vi.fn(),
      submitGuide: vi.fn(),
    },
  };
});

vi.mock("@/api-services/storage.service", () => ({
  uploadBlogImage: vi.fn(),
  deleteBlogImage: vi.fn(),
}));

vi.mock("@/components/base/RichTextEditor", () => ({
  default: (props: {
    value: string;
    onChange: (value: string) => void;
    onUploadStateChange?: (pending: boolean) => void;
    placeholder?: string;
    inputId?: string;
    ariaLabel?: string;
  }) => (
    <div data-testid="mock-rich-text-editor">
      <textarea
        id={props.inputId}
        aria-label={props.ariaLabel}
        placeholder={props.placeholder}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
      />
      <button
        type="button"
        onClick={() => {
          props.onUploadStateChange?.(true);
          const valueAtStart = props.value;
          void new Promise<string>((resolve) => {
            inlineUploadHarness.resolve = resolve;
          }).then((url) => {
            props.onChange(
              `${valueAtStart}<video src="${url}" controls playsinline preload="metadata"></video>`
            );
            props.onUploadStateChange?.(false);
          });
        }}
      >
        Start deferred inline upload
      </button>
    </div>
  ),
}));

vi.mock("@/pages/home/components/Navbar", () => ({
  default: () => <div>Navbar</div>,
}));

vi.mock("@/pages/home/components/Footer", () => ({
  default: () => <div>Footer</div>,
}));

describe("BlogSubmitPage taxonomy", () => {
  const renderPage = () =>
    render(
      <MemoryRouter>
        <BlogSubmitPage />
      </MemoryRouter>
    );

  const fillRequiredFields = () => {
    fireEvent.change(screen.getByPlaceholderText("e.g., Hidden Gems in Alanya Old Town"), {
      target: { value: "A local guide" },
    });
    fireEvent.change(
      screen.getByPlaceholderText(
        "Write your blog post content here. Share your experiences, tips, and recommendations..."
      ),
      { target: { value: "Useful recommendations for visitors." } }
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
    inlineUploadHarness.resolve = undefined;
    vi.mocked(blogService.getTags).mockResolvedValue([
      {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Essential",
        slug: "essential",
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        name: "Family",
        slug: "family",
      },
    ]);
    vi.mocked(blogService.submitGuide).mockResolvedValue({
      success: true,
      id: "submission-1",
    });
    vi.mocked(uploadBlogImage).mockResolvedValue(
      "https://project.supabase.co/storage/v1/object/public/blog-media/user-1/cover.webp"
    );
    vi.mocked(deleteBlogImage).mockResolvedValue(true);
    URL.createObjectURL = vi.fn(() => "blob:cover-preview");
    URL.revokeObjectURL = vi.fn();
  });

  it("previews rich text formatting from the shared editor", () => {
    renderPage();
    const contentInput = screen.getByPlaceholderText(
      "Write your blog post content here. Share your experiences, tips, and recommendations..."
    );
    fireEvent.change(contentInput, {
      target: { value: "<p>Best <strong>beaches</strong> in Alanya</p>" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(screen.getByText("beaches").tagName).toBe("STRONG");
  });

  it("previews article content and preserves it when returning to write mode", async () => {
    renderPage();
    const contentInput = screen.getByPlaceholderText(
      "Write your blog post content here. Share your experiences, tips, and recommendations..."
    );
    fireEvent.change(contentInput, {
      target: { value: "<h2>Best beaches</h2><p>Bring water and sunscreen.</p>" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    expect(screen.getByRole("heading", { name: "Best beaches" })).toBeInTheDocument();
    expect(screen.getByText("Bring water and sunscreen.")).toBeInTheDocument();
    expect(contentInput).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Write" }));

    expect(
      screen.getByPlaceholderText(
        "Write your blog post content here. Share your experiences, tips, and recommendations..."
      )
    ).toHaveValue("<h2>Best beaches</h2><p>Bring water and sunscreen.</p>");
  });

  it("keeps a pending inline upload alive and blocks preview and submission until it finishes", async () => {
    const videoUrl =
      "https://mdmizeyiyebvhkujjyjg.supabase.co/storage/v1/object/public/inline-media/10000000-0000-4000-8000-000000000001/videos/20000000-0000-4000-8000-000000000002.mp4";
    const { container } = renderPage();
    fireEvent.change(screen.getByPlaceholderText("e.g., Hidden Gems in Alanya Old Town"), {
      target: { value: "A video guide" },
    });
    const editor = screen.getByPlaceholderText(
      "Write your blog post content here. Share your experiences, tips, and recommendations..."
    );
    fireEvent.change(editor, {
      target: { value: "<p>Useful recommendations for visitors.</p>" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Start deferred inline upload" }));

    const previewButton = screen.getByRole("button", { name: "Preview" });
    const submitButton = screen.getByRole("button", { name: "Submit Post" });
    expect(previewButton).toBeDisabled();
    expect(submitButton).toBeDisabled();
    fireEvent.click(previewButton);
    expect(editor).toBeInTheDocument();

    await act(async () => {
      inlineUploadHarness.resolve?.(videoUrl);
    });
    await waitFor(() => expect((editor as HTMLTextAreaElement).value).toContain(videoUrl));
    expect(previewButton).toBeEnabled();
    expect(submitButton).toBeEnabled();

    fireEvent.click(previewButton);
    expect(screen.getByText("Useful recommendations for visitors.")).toBeInTheDocument();
    expect(container.querySelector(`video[src="${videoUrl}"]`)).toBeInTheDocument();
    fireEvent.click(submitButton);
    await waitFor(() =>
      expect(blogService.submitGuide).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining(videoUrl) })
      )
    );
  });

  it("shows inline validation errors without calling the API", async () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Submit Post" }));

    expect(await screen.findByText("Please enter a post title.")).toBeInTheDocument();
    expect(screen.getByText("Content must be at least 10 characters.")).toBeInTheDocument();
    expect(blogService.submitGuide).not.toHaveBeenCalled();
  });

  it.each([
    [400, "Some fields are invalid. Please review your post and try again."],
    [401, "Your session has expired. Please sign in again."],
    [429, "You have submitted too many posts. Please try again later."],
    [503, "The server is currently unavailable. Please try again later."],
  ])("shows a specific message for API status %i", async (status, message) => {
    vi.mocked(blogService.submitGuide).mockRejectedValueOnce(
      new ApiError("Request failed", status, "Request failed")
    );
    renderPage();
    await screen.findByRole("combobox");
    fillRequiredFields();

    fireEvent.click(screen.getByRole("button", { name: "Submit Post" }));

    expect(await screen.findByText(message)).toBeInTheDocument();
  });

  it("shows a cover upload error separately from submission errors", async () => {
    vi.mocked(uploadBlogImage).mockRejectedValueOnce(new Error("Storage unavailable"));
    renderPage();
    await screen.findByRole("combobox");
    const cover = new File(["cover"], "cover.webp", { type: "image/webp" });
    fireEvent.change(screen.getByLabelText("Cover image"), {
      target: { files: [cover] },
    });
    fillRequiredFields();

    fireEvent.click(screen.getByRole("button", { name: "Submit Post" }));

    expect(
      await screen.findByText("Cover image upload failed. Please try again or remove the image.")
    ).toBeInTheDocument();
    expect(blogService.submitGuide).not.toHaveBeenCalled();
  });

  it("submits an independent category and selected tag UUIDs", async () => {
    render(
      <MemoryRouter>
        <BlogSubmitPage />
      </MemoryRouter>
    );

    await screen.findByRole("checkbox", { name: "Essential" });
    expect(screen.getByRole("combobox", { name: "Category" })).toHaveValue("Guides");
    fireEvent.change(screen.getByRole("combobox", { name: "Category" }), {
      target: { value: "Beaches" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Essential" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Family" }));

    fireEvent.change(screen.getByPlaceholderText("e.g., Hidden Gems in Alanya Old Town"), {
      target: { value: "A local guide" },
    });
    fireEvent.change(
      screen.getByPlaceholderText(
        "Write your blog post content here. Share your experiences, tips, and recommendations..."
      ),
      { target: { value: "Useful recommendations for visitors." } }
    );
    fireEvent.click(screen.getByRole("button", { name: "Submit Post" }));

    await waitFor(() => {
      expect(blogService.submitGuide).toHaveBeenCalledWith({
        title: "A local guide",
        category: "Beaches",
        content: "Useful recommendations for visitors.",
        tags: [
          "11111111-1111-4111-8111-111111111111",
          "22222222-2222-4222-8222-222222222222",
        ],
        video_url: undefined,
        media_urls: undefined,
      });
    });
  });

  it("uploads a selected cover and submits its public URL", async () => {
    render(
      <MemoryRouter>
        <BlogSubmitPage />
      </MemoryRouter>
    );

    await screen.findByRole("combobox");
    const cover = new File(["cover"], "cover.webp", { type: "image/webp" });
    fireEvent.change(screen.getByLabelText("Cover image"), {
      target: { files: [cover] },
    });
    fireEvent.change(screen.getByPlaceholderText("e.g., Hidden Gems in Alanya Old Town"), {
      target: { value: "A visual guide" },
    });
    fireEvent.change(
      screen.getByPlaceholderText(
        "Write your blog post content here. Share your experiences, tips, and recommendations..."
      ),
      { target: { value: "A guide with a locally uploaded cover." } }
    );
    fireEvent.click(screen.getByRole("button", { name: "Submit Post" }));

    await waitFor(() => {
      expect(uploadBlogImage).toHaveBeenCalledWith(cover, "user-1");
      expect(blogService.submitGuide).toHaveBeenCalledWith(
        expect.objectContaining({
          media_urls: [
            "https://project.supabase.co/storage/v1/object/public/blog-media/user-1/cover.webp",
          ],
        })
      );
    });
  });

  it("deletes an uploaded cover when submission creation fails", async () => {
    vi.mocked(blogService.submitGuide).mockRejectedValueOnce(new Error("Submission failed"));
    render(
      <MemoryRouter>
        <BlogSubmitPage />
      </MemoryRouter>
    );

    await screen.findByRole("combobox");
    const cover = new File(["cover"], "cover.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Cover image"), {
      target: { files: [cover] },
    });
    fireEvent.change(screen.getByPlaceholderText("e.g., Hidden Gems in Alanya Old Town"), {
      target: { value: "Failed guide" },
    });
    fireEvent.change(
      screen.getByPlaceholderText(
        "Write your blog post content here. Share your experiences, tips, and recommendations..."
      ),
      { target: { value: "This submission will fail after upload." } }
    );
    fireEvent.click(screen.getByRole("button", { name: "Submit Post" }));

    await waitFor(() => {
      expect(deleteBlogImage).toHaveBeenCalledWith(
        "https://project.supabase.co/storage/v1/object/public/blog-media/user-1/cover.webp",
        "user-1"
      );
    });
    expect(screen.getByText("Failed to submit post. Please try again later.")).toBeInTheDocument();
  });
});
