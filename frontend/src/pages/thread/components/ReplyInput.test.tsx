import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import ReplyInput from "./ReplyInput";

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1" } }),
}));

vi.mock("@/components/base/RichTextEditor", () => ({
  default: ({
    value,
    onChange,
    placeholder,
  }: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
  }) => (
    <textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
    />
  ),
}));

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("ReplyInput", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("awaits a successful submission and clears only the submitted draft", async () => {
    const submission = deferred();
    const onSubmit = vi.fn(() => submission.promise);

    render(
      <ReplyInput
        replyTo={null}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    const editor = screen.getByPlaceholderText(/share your thoughts/i);
    const form = editor.closest("form");
    expect(form).not.toBeNull();
    fireEvent.change(editor, { target: { value: "First draft" } });
    fireEvent.submit(form!);
    fireEvent.submit(form!);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(editor).toHaveValue("First draft");

    fireEvent.change(editor, { target: { value: "Newer draft" } });
    submission.resolve();

    await waitFor(() => expect(editor).toHaveValue("Newer draft"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("clears an unchanged draft after a successful submission", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <ReplyInput
        replyTo={null}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    const editor = screen.getByPlaceholderText(/share your thoughts/i);
    fireEvent.change(editor, { target: { value: "Published draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Post Comment" }));

    await waitFor(() => expect(editor).toHaveValue(""));
  });

  it.each([
    ["429", Object.assign(new Error("rate limited"), { status: 429 })],
    ["500", Object.assign(new Error("server failure"), { status: 500 })],
    ["network", new TypeError("network failure")],
  ])("retains the draft and shows a translated error after a %s failure", async (_case, error) => {
    const onSubmit = vi.fn().mockRejectedValue(error);

    render(
      <ReplyInput
        replyTo="reply-1"
        replyToAuthor="Reply Author"
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    const editor = screen.getByPlaceholderText(/reply author/i);
    fireEvent.change(editor, { target: { value: "Keep this reply" } });
    fireEvent.click(screen.getByRole("button", { name: "Post Reply" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your reply could not be posted. Please try again.",
    );
    expect(editor).toHaveValue("Keep this reply");
    expect(screen.getByText("Reply Author")).toBeInTheDocument();
  });
});
