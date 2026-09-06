import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import i18n from "@/i18n";

const api = vi.hoisted(() => ({
  threads: vi.fn(),
  events: vi.fn(),
  members: vi.fn(),
  businesses: vi.fn(),
  products: vi.fn(),
  articles: vi.fn(),
}));
vi.mock("@/api-services/forum.service", () => ({
  forumService: { getThreads: api.threads, getMembers: api.members },
}));
vi.mock("@/api-services/events.service", () => ({
  eventsService: { getEvents: api.events },
}));
vi.mock("@/api-services/directory.service", () => ({
  directoryService: { searchListings: api.businesses },
}));
vi.mock("@/api-services/products.service", () => ({
  productsService: { getShopCatalog: api.products },
}));
vi.mock("@/api-services/blog.service", () => ({
  blogService: { getPosts: api.articles },
}));
vi.mock("@/pages/home/components/Navbar", () => ({ default: () => null }));
vi.mock("@/pages/home/components/Footer", () => ({ default: () => null }));
import SearchPage, { HighlightMatch } from "./SearchPage";

const tick = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(350);
  });
const start = (q = "") => {
  window.history.replaceState(
    {},
    "",
    `/search${q ? `?q=${encodeURIComponent(q)}` : ""}`,
  );
  render(
    <BrowserRouter>
      <SearchPage />
    </BrowserRouter>,
  );
};
const search = async (q: string) => {
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: q } });
  await tick();
};

describe("Public search", () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    await i18n.changeLanguage("en");
    vi.useFakeTimers();
    api.threads.mockResolvedValue({
      threads: [{ id: "thread-1", title: "Beach discussion" }],
    });
    api.events.mockResolvedValue([{ id: "event-1", title: "Beach meetup" }]);
    api.members.mockResolvedValue([
      { id: "member-99", fullName: "Beach Guide" },
    ]);
    api.businesses.mockResolvedValue({
      data: [{ id: "business-1", name: "Beach Cafe" }],
    });
    api.products.mockResolvedValue({
      products: [{ id: 1, name: "Beach towel" }],
    });
    api.articles.mockResolvedValue({
      posts: [{ id: "article-1", title: "Beach guide", slug: "beach-guide" }],
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    window.history.replaceState({}, "", "/");
  });

  it("does not fetch empty or whitespace queries, and keeps suggestions usable", async () => {
    start("   ");
    await tick();
    Object.values(api).forEach((method) =>
      expect(method).not.toHaveBeenCalled(),
    );
    fireEvent.click(screen.getByText("Alanya beaches"));
    await tick();
    expect(api.members).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { search: "Alanya beaches", offset: 0 },
        limit: 20,
      }),
    );
  });

  it("restores URL query and links all six public result types", async () => {
    start("beach");
    await tick();
    expect(screen.getByRole("searchbox")).toHaveValue("beach");
    for (const [name, href] of [
      ["Beach discussion", "/thread/thread-1"],
      ["Beach meetup", "/events"],
      ["Beach Guide", "/member/member-99"],
      ["Beach Cafe", "/business/business-1"],
      ["Beach towel", "/shop/1"],
      ["Beach guide", "/blog/beach-guide"],
    ]) {
      expect(screen.getByRole("link", { name })).toHaveAttribute(
        "href",
        href,
      );
    }
    expect(api.articles).toHaveBeenCalledWith(
      expect.objectContaining({ status: "published", contentType: "blog" }),
    );
    expect(api.events).toHaveBeenCalledWith(
      expect.objectContaining({ includeUnpublished: false }),
    );
    expect(screen.queryByText(/Found 6 results/)).not.toBeInTheDocument();
  });

  it("debounces changes, persists q, switches sections, and clears the URL", async () => {
    start();
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "be" },
    });
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "beach" },
    });
    await tick();
    expect(api.threads).toHaveBeenCalledTimes(1);
    expect(new URLSearchParams(window.location.search).get("q")).toBe("beach");
    fireEvent.click(
      screen.getByRole("button", { name: "Products" }),
    );
    expect(
      screen.getByRole("link", { name: "Beach towel" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Beach discussion" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /clear search/i }));
    await tick();
    expect(window.location.search).toBe("");
  });

  it("keeps successful sections when one fails and retries only that section", async () => {
    api.products.mockRejectedValueOnce(new Error("offline"));
    start("beach");
    await tick();
    expect(
      screen.getByRole("link", { name: "Beach discussion" }),
    ).toBeInTheDocument();
    const products = within(screen.getByRole("region", { name: "Products" }));
    expect(products.getByRole("alert")).toHaveTextContent(
      "could not be loaded",
    );
    fireEvent.click(products.getByRole("button", { name: "Try again" }));
    await tick();
    expect(
      products.getByRole("link", { name: "Beach towel" }),
    ).toBeInTheDocument();
    expect(api.threads).toHaveBeenCalledTimes(1);
  });

  it("loads next member page on the server and preserves previous results on failure", async () => {
    api.members
      .mockResolvedValueOnce(
        Array.from({ length: 20 }, (_, id) => ({
          id: String(id),
          fullName: `Person ${id}`,
        })),
      )
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce([{ id: "20", fullName: "Person 20" }]);
    start("Person");
    await tick();
    const members = within(screen.getByRole("region", { name: "Members" }));
    fireEvent.click(members.getByRole("button", { name: "Load more" }));
    await tick();
    expect(
      members.getByRole("link", { name: "Person 0" }),
    ).toBeInTheDocument();
    fireEvent.click(members.getByRole("button", { name: "Try again" }));
    await tick();
    expect(api.members).toHaveBeenLastCalledWith(
      expect.objectContaining({ params: { search: "Person", offset: 20 } }),
    );
    expect(members.getAllByRole("link")).toHaveLength(21);
    expect(
      members.queryByRole("button", { name: "Load more" }),
    ).not.toBeInTheDocument();
  });

  it("ignores late responses after a new query or a clear", async () => {
    let resolve!: (value: unknown) => void;
    api.products.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    start("old");
    await tick();
    await search("new");
    await act(async () => {
      resolve({ products: [{ id: 9, name: "Old product" }] });
    });
    expect(screen.queryByText("Old product")).not.toBeInTheDocument();
    expect(api.products.mock.calls[0][0].signal.aborted).toBe(true);
    await search("");
    expect(
      screen.queryByRole("link", { name: "Beach towel" }),
    ).not.toBeInTheDocument();
  });

  it.each(["ru", "tr"])(
    "translates new section and failure copy in %s",
    async (language) => {
      await i18n.changeLanguage(language);
      api.products.mockRejectedValue(new Error("offline"));
      start("beach");
      await tick();
      expect(
        screen.queryByRole("button", { name: "Products" }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole("alert").textContent).not.toContain(
        "could not be loaded",
      );
      expect(screen.getByRole("alert").textContent).not.toContain(
        "public.search.",
      );
    },
  );

  it("highlights literal regex metacharacters without throwing", () => {
    const { container } = render(
      <HighlightMatch text="Cafe (A+B)" query="(A+B)" />,
    );
    expect(container.querySelector("mark")).toHaveTextContent("(A+B)");
  });
});
