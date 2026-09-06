import { test, expect } from "@playwright/test";

test("public search preserves URL, partial results and member pagination", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("alanya-language", "en"));
  let productRequests = 0;
  const memberOffsets: string[] = [];
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    let data: unknown = [];
    if (url.pathname === "/api/forum/posts")
      data = {
        data: [
          {
            id: "thread-1",
            title: "Beach discussion",
            created_at: "2026-09-01T10:00:00Z",
          },
        ],
        total: 1,
      };
    if (url.pathname === "/api/forum/events")
      data = [
        {
          id: "event-1",
          title: "Beach meetup",
          event_date: "2026-09-10T10:00:00Z",
          is_published: true,
        },
      ];
    if (url.pathname === "/api/forum/members") {
      const offset = url.searchParams.get("offset") ?? "0";
      memberOffsets.push(offset);
      data =
        offset === "0"
          ? Array.from({ length: 20 }, (_, id) => ({
              id: String(id),
              full_name: `Beach member ${id}`,
            }))
          : [{ id: "20", full_name: "Beach member 20" }];
    }
    if (url.pathname === "/api/directory/search")
      data = {
        data: [{ id: "business-1", name: "Beach Cafe", status: "approved" }],
        total: 1,
      };
    if (url.pathname === "/api/products/catalog") {
      productRequests++;
      if (productRequests === 1)
        return route.fulfill({ status: 503, json: { message: "Unavailable" } });
      data = { products: [{ id: 1, name: "Beach towel" }], categories: [] };
    }
    if (url.pathname === "/api/blog/posts") {
      expect(url.searchParams.get("status")).toBe("published");
      data = {
        data: [
          {
            id: "article-1",
            title: "Beach guide",
            slug: "beach-guide",
            status: "published",
          },
        ],
        total: 1,
      };
    }
    await route.fulfill({ json: data });
  });

  await page.goto("/search?q=beach");
  await expect(page.getByRole("searchbox")).toHaveValue("beach");
  await expect(
    page.getByRole("link", { name: "Beach discussion", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Beach Cafe", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Beach guide", exact: true }),
  ).toHaveAttribute("href", "/blog/beach-guide");
  const products = page.getByRole("region", { name: "Products", exact: true });
  await expect(products.getByRole("alert")).toBeVisible();
  await products.getByRole("button", { name: "Try again" }).click();
  await expect(
    products.getByRole("link", { name: "Beach towel" }),
  ).toBeVisible();
  const members = page.getByRole("region", { name: "Members", exact: true });
  await members.getByRole("button", { name: "Load more" }).click();
  await expect(members.getByRole("link")).toHaveCount(21);
  expect(memberOffsets).toContain("20");
  await expect(
    page.getByRole("button", { name: /itinerar|planner/i }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: /clear search/i }).click();
  await expect(page).toHaveURL(/\/search$/);
  await expect(
    page.getByRole("heading", { name: "Search Alanya Holidays" }),
  ).toBeVisible();
});
