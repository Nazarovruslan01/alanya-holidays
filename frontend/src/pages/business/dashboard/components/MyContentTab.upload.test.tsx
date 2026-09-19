import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { blogService } from "@/api-services/blog.service";
import { MyContentTab } from "./MyContentTab";

vi.mock("@/api-services/blog.service", () => ({
  blogService: {
    getMyPosts: vi.fn(),
    getMySubmissions: vi.fn(),
    updateMyPost: vi.fn(),
    updateMySubmission: vi.fn(),
  },
}));

vi.mock("@/components/base/RichTextEditor", () => ({
  default: (props: {
    value: string;
    onChange: (value: string) => void;
    onUploadStateChange?: (pending: boolean) => void;
  }) => (
    <div>
      <textarea value={props.value} onChange={(event) => props.onChange(event.target.value)} />
      <button type="button" onClick={() => props.onUploadStateChange?.(true)}>
        Start upload
      </button>
    </div>
  ),
}));

describe("MyContentTab upload state", () => {
  beforeEach(() => {
    vi.mocked(blogService.getMyPosts).mockResolvedValue([
      {
        id: "post-1",
        title: "Harbor guide",
        slug: "harbor-guide",
        content: "<p>Enough content.</p>",
        category: "guides",
        status: "draft",
      },
    ]);
    vi.mocked(blogService.getMySubmissions).mockResolvedValue([]);
  });

  it("disables saving while an inline upload is pending", async () => {
    render(<MyContentTab />);
    fireEvent.click(await screen.findByRole("button", { name: /edit/i }));
    fireEvent.click(screen.getByRole("button", { name: "Start upload" }));
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });
});
