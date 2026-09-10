import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import MembersPage from "./page";
import { forumService, type ForumMember } from "@/api-services/forum.service";

vi.mock("@/pages/home/components/Navbar", () => ({ default: () => <nav /> }));
vi.mock("@/pages/home/components/Footer", () => ({ default: () => <footer /> }));
vi.mock("./components/MemberHero", () => ({ default: () => <header /> }));

vi.mock("@/api-services/forum.service", () => ({
  forumService: {
    getMembers: vi.fn(),
  },
  memberRoles: [],
}));

function member(id: string, fullName: string): ForumMember {
  return {
    id,
    username: id,
    fullName,
    role: "Member",
    location: "Alanya",
    joinDate: "2026-01-01",
    posts: 1,
    reputation: 1,
    isOnline: false,
    avatar: "/avatar.svg",
    bio: "",
    badges: [],
  };
}

const initialMembers = Array.from({ length: 20 }, (_, index) =>
  member(`member-${index}`, `Initial Member ${index}`),
);
const searchedMember = member("member-outside-first-page", "Member Outside Initial Page");

describe("MembersPage search lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(forumService.getMembers).mockReset();
  });

  it("searches member names on the server and restores the initial page when cleared", async () => {
    vi.mocked(forumService.getMembers)
      .mockResolvedValueOnce(initialMembers)
      .mockResolvedValueOnce([searchedMember])
      .mockResolvedValueOnce(initialMembers);

    render(
      <MemoryRouter>
        <MembersPage />
      </MemoryRouter>,
    );

    const search = await screen.findByRole("textbox");
    expect((await screen.findAllByText("Initial Member 0")).length).toBeGreaterThan(0);

    fireEvent.change(search, { target: { value: "outside initial" } });

    expect((await screen.findAllByText("Member Outside Initial Page")).length).toBeGreaterThan(0);
    expect(forumService.getMembers).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ params: { search: "outside initial" } }),
    );

    fireEvent.change(search, { target: { value: "" } });

    expect((await screen.findAllByText("Initial Member 0")).length).toBeGreaterThan(0);
    expect(forumService.getMembers).toHaveBeenNthCalledWith(3, expect.any(Object));
    expect(vi.mocked(forumService.getMembers).mock.calls[2][0]).not.toHaveProperty("params.search");
  });

  it("keeps the retry action for a failed server search", async () => {
    vi.mocked(forumService.getMembers)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce([searchedMember]);

    render(
      <MemoryRouter>
        <MembersPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /retry|try again/i }));
    expect((await screen.findAllByText("Member Outside Initial Page")).length).toBeGreaterThan(0);
    expect(forumService.getMembers).toHaveBeenCalledTimes(2);
  });

  it("ignores an older response after a newer search starts", async () => {
    let resolveInitial!: (value: ForumMember[]) => void;
    let resolveSearch!: (value: ForumMember[]) => void;
    const initialRequest = new Promise<ForumMember[]>((resolve) => {
      resolveInitial = resolve;
    });
    const searchRequest = new Promise<ForumMember[]>((resolve) => {
      resolveSearch = resolve;
    });
    vi.mocked(forumService.getMembers).mockImplementation((options) =>
      options?.params?.search ? searchRequest : initialRequest,
    );

    render(
      <MemoryRouter>
        <MembersPage />
      </MemoryRouter>,
    );

    const search = screen.getByRole("textbox");
    fireEvent.change(search, { target: { value: "outside" } });
    await waitFor(() => expect(forumService.getMembers).toHaveBeenCalledTimes(2));

    resolveSearch([searchedMember]);
    expect((await screen.findAllByText("Member Outside Initial Page")).length).toBeGreaterThan(0);

    resolveInitial(initialMembers);
    await waitFor(() => expect(screen.queryAllByText("Initial Member 0")).toHaveLength(0));
    expect(screen.getAllByText("Member Outside Initial Page").length).toBeGreaterThan(0);
  });
});
