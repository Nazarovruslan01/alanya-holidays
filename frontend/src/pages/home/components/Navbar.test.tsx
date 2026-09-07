import "@testing-library/jest-dom";
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import Navbar from "./Navbar";
import type { UserProfile } from "@/context/AuthContext";
import i18n from "@/i18n";

const { mockGetMyListings, mockGetMyClaims, mockGetMine } = vi.hoisted(() => ({
  mockGetMyListings: vi.fn(),
  mockGetMyClaims: vi.fn(),
  mockGetMine: vi.fn(),
}));

vi.mock("@/api-services/directory.service", () => ({
  directoryService: {
    getMyListings: mockGetMyListings,
    getMyClaims: mockGetMyClaims,
  },
}));

vi.mock("@/api-services/business-applications.service", () => ({
  businessApplicationsService: {
    getMine: mockGetMine,
  },
}));

// Mock AuthContext
const mockSignOut = vi.fn();

let mockAuthState: {
  user: { id: string; email: string; created_at: string; user_metadata?: Record<string, unknown> } | null;
  profile: UserProfile | null;
  loading: boolean;
  isAuthenticated: boolean;
  signOut: typeof mockSignOut;
} = {
  user: null,
  profile: null,
  loading: false,
  isAuthenticated: false,
  signOut: mockSignOut,
};

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => mockAuthState,
}));

// Mock notifications service to avoid background async errors
vi.mock("@/api-services/notifications.service", () => ({
  subscribeToUserNotifications: vi.fn(() => () => {}),
  notificationsService: {
    getUnreadCount: vi.fn().mockResolvedValue(0),
    getNotifications: vi.fn().mockResolvedValue([]),
  },
}));

// Mock favorites hook
vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({
    favorites: new Set(),
    isFavorite: () => false,
    favoriteCount: 0,
  }),
}));

// Mock cart context
vi.mock("@/context/CartContext", () => ({
  useCart: () => ({
    itemCount: 0,
    items: [],
  }),
}));

function RouteDestination() {
  const location = useLocation();
  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname;
  return <div data-testid="route-destination">{location.pathname}|{from || ""}</div>;
}

const authenticateAs = (id: string, role: string = "user") => {
  mockAuthState = {
    user: { id, email: `${id}@example.com`, created_at: "2026-02-01T00:00:00Z" },
    profile: {
      id,
      email: `${id}@example.com`,
      full_name: id,
      avatar_url: null,
      bio: null,
      phone: null,
      company_name: null,
      role,
      iban: null,
      bank_name: null,
      bank_account_holder_name: null,
      crypto_wallet: null,
      social_links: {},
      created_at: "2026-02-01T00:00:00Z",
      updated_at: "2026-02-01T00:00:00Z",
    } as UserProfile,
    loading: false,
    isAuthenticated: true,
    signOut: mockSignOut,
  };
};

// Mock compare hook
vi.mock("@/hooks/useCompare", () => ({
  useCompare: () => ({
    selectedCount: 0,
  }),
}));

describe("Navbar Component (Milestone 5 — R4)", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockGetMyListings.mockResolvedValue([]);
    mockGetMyClaims.mockResolvedValue([]);
    mockGetMine.mockResolvedValue(null);
    await i18n.changeLanguage("en");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not advertise unfinished language variants", () => {
    render(
      <MemoryRouter>
        <Navbar />
      </MemoryRouter>
    );

    expect(screen.queryByText("Русский")).not.toBeInTheDocument();
    expect(screen.queryByText("Türkçe")).not.toBeInTheDocument();
  });

  it("renders Sign In and Join Community links when unauthenticated", () => {
    mockAuthState = {
      user: null,
      profile: null,
      loading: false,
      isAuthenticated: false,
      signOut: mockSignOut,
    };

    render(
      <MemoryRouter>
        <Navbar />
      </MemoryRouter>
    );

    const signInLinks = screen.getAllByRole("link", { name: /Sign In/i });
    expect(signInLinks.length).toBeGreaterThan(0);
    expect(signInLinks[0]).toHaveAttribute("href", "/login");
    expect(signInLinks[0]).toHaveClass("bg-white/15", "backdrop-blur-sm");
  });

  it("sends guests from New Thread to registration with a return path", () => {
    mockAuthState = {
      user: null,
      profile: null,
      loading: false,
      isAuthenticated: false,
      signOut: mockSignOut,
    };

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Navbar />} />
          <Route path="/register" element={<RouteDestination />} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("link", { name: /New Thread/i }));

    expect(screen.getByTestId("route-destination")).toHaveTextContent(
      "/register|/new-thread",
    );
  });

  it("uses the Alanya coastal brand mark in the home link", () => {
    render(
      <MemoryRouter>
        <Navbar />
      </MemoryRouter>
    );

    const homeLink = screen.getByRole("link", { name: "Alanya Holidays" });
    const brandImage = homeLink.querySelector("img");
    expect(brandImage).toHaveAttribute(
      "src",
      "/images/alanya-holidays-brand-mark-transparent.png",
    );
    expect(brandImage).not.toHaveClass("mix-blend-multiply");
    expect(brandImage?.parentElement).not.toHaveClass("bg-white");
  });

  it("shows the brand name beside the mark with a compact mobile line break", () => {
    render(
      <MemoryRouter>
        <Navbar />
      </MemoryRouter>
    );

    const brandText = screen.getByText("Alanya");
    expect(brandText).not.toHaveClass("hidden");
    expect(screen.getByText("Holidays")).toHaveClass("block", "sm:inline");
    expect(screen.getByRole("link", { name: "Alanya Holidays" }).querySelector("img")).toBeInTheDocument();
  });

  it("renders authenticated user avatar and opens dropdown with Settings & Favorites", async () => {
    mockAuthState = {
      user: {
        id: "usr-888",
        email: "traveler@alanya-holidays.com",
        created_at: "2026-02-01T00:00:00Z",
      },
      profile: {
        id: "usr-888",
        email: "traveler@alanya-holidays.com",
        full_name: "Elena Rostova",
        avatar_url: null,
        bio: "Travel lover",
        phone: "+90 555 1234",
        company_name: null,
        role: "user",
        iban: null,
        bank_name: null,
        bank_account_holder_name: null,
        crypto_wallet: null,
        social_links: {},
        created_at: "2026-02-01T00:00:00Z",
        updated_at: "2026-02-01T00:00:00Z",
      },
      loading: false,
      isAuthenticated: true,
      signOut: mockSignOut,
    };

    render(
      <MemoryRouter>
        <Navbar />
      </MemoryRouter>
    );

    // Open desktop user dropdown
    const avatarButton = screen.getByRole("button", { name: /User Menu/i });
    expect(avatarButton).toBeInTheDocument();
    fireEvent.click(avatarButton);

    // Check menu contents
    expect(screen.getByText("Elena Rostova")).toBeInTheDocument();
    expect(screen.getByText("traveler@alanya-holidays.com")).toBeInTheDocument();

    // Verify "My Profile & Settings" link to /settings
    const settingsLink = screen.getByRole("link", { name: /My Profile & Settings/i });
    expect(settingsLink).toHaveAttribute("href", "/settings");

    // Verify "Favorites & Activity" link to /settings?tab=activity
    const favoritesLink = screen.getByRole("link", { name: /Favorites & Activity/i });
    expect(favoritesLink).toHaveAttribute("href", "/settings?tab=activity");

    // Verify Sign Out button
    const signOutBtn = screen.getByRole("button", { name: /Sign Out/i });
    expect(signOutBtn).toBeInTheDocument();
    fireEvent.click(signOutBtn);

    await waitFor(() => {
      expect(mockSignOut).toHaveBeenCalled();
    });
  });

  it("shows Add Your Business for an ordinary user without business involvement", async () => {
    authenticateAs("plain-user");

    render(
      <MemoryRouter>
        <Navbar />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: /User Menu/i }));

    const businessLink = await screen.findByRole("link", { name: /Add Your Business/i });
    expect(businessLink).toHaveAttribute("href", "/business/register");
    expect(mockGetMyListings).toHaveBeenCalledTimes(1);
    expect(mockGetMyClaims).toHaveBeenCalledTimes(1);
    expect(mockGetMine).toHaveBeenCalledTimes(1);
  });

  it("does not render an actionable business link while eligibility is unresolved", async () => {
    let resolveListings: (listings: Array<{ id: string }>) => void = () => {};
    const pendingListings = new Promise<Array<{ id: string }>>((resolve) => {
      resolveListings = resolve;
    });
    mockGetMyListings.mockReturnValueOnce(pendingListings);
    authenticateAs("pending-user");

    render(
      <MemoryRouter>
        <Navbar />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: /User Menu/i }));
    expect(screen.queryByRole("link", { name: /Add Your Business/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Dashboard$/i })).not.toBeInTheDocument();

    resolveListings([]);
    expect(await screen.findByRole("link", { name: /Add Your Business/i })).toHaveAttribute(
      "href",
      "/business/register",
    );
  });

  it("refreshes eligibility after closing and reopening the desktop menu", async () => {
    authenticateAs("new-claim-user");

    render(
      <MemoryRouter>
        <Navbar />
      </MemoryRouter>,
    );
    const avatarButton = screen.getByRole("button", { name: /User Menu/i });

    fireEvent.click(avatarButton);
    expect(await screen.findByRole("link", { name: /Add Your Business/i })).toHaveAttribute(
      "href",
      "/business/register",
    );

    fireEvent.click(avatarButton);
    mockGetMyClaims.mockResolvedValue([{ id: "new-claim" }]);
    fireEvent.click(avatarButton);

    expect(await screen.findByRole("link", { name: /^Dashboard$/i })).toHaveAttribute(
      "href",
      "/business/dashboard",
    );
  });

  it("retries rejected eligibility requests on the next menu opening", async () => {
    mockGetMyListings.mockRejectedValueOnce(new Error("listings unavailable"));
    mockGetMyClaims.mockRejectedValueOnce(new Error("claims unavailable"));
    mockGetMine.mockRejectedValueOnce(new Error("application unavailable"));
    authenticateAs("retry-user");

    render(
      <MemoryRouter>
        <Navbar />
      </MemoryRouter>,
    );
    const avatarButton = screen.getByRole("button", { name: /User Menu/i });

    fireEvent.click(avatarButton);
    await waitFor(() => {
      expect(mockGetMine).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("link", { name: /Add Your Business/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: /^Dashboard$/i })).not.toBeInTheDocument();
    });

    fireEvent.click(avatarButton);
    fireEvent.click(avatarButton);
    expect(await screen.findByRole("link", { name: /Add Your Business/i })).toHaveAttribute(
      "href",
      "/business/register",
    );
    expect(mockGetMine).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["an owned listing", () => mockGetMyListings.mockResolvedValue([{ id: "listing-1" }])],
    ["a submitted claim", () => mockGetMyClaims.mockResolvedValue([{ id: "claim-1" }])],
    ["a business application", () => mockGetMine.mockResolvedValue({ id: "application-1" })],
  ])("shows the dashboard for an ordinary user with %s", async (_reason, setup) => {
    setup();
    authenticateAs("business-user");

    render(
      <MemoryRouter>
        <Navbar />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: /User Menu/i }));

    const businessLink = await screen.findByRole("link", { name: /^Dashboard$/i });
    expect(businessLink).toHaveAttribute("href", "/business/dashboard");
  });

  it.each([
    ["host", "host"],
    ["admin", "admin"],
  ])("keeps the dashboard shortcut immediate for a %s", (role, profileRole) => {
    authenticateAs(`${role}-user`, profileRole);

    render(
      <MemoryRouter>
        <Navbar />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: /User Menu/i }));

    expect(screen.getByRole("link", { name: /^Dashboard$/i })).toHaveAttribute(
      "href",
      "/business/dashboard",
    );
    expect(mockGetMyListings).not.toHaveBeenCalled();
    expect(mockGetMyClaims).not.toHaveBeenCalled();
    expect(mockGetMine).not.toHaveBeenCalled();
  });

  it("applies the same Add Your Business rule in the mobile menu", async () => {
    authenticateAs("mobile-user");

    render(
      <MemoryRouter>
        <Navbar />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Open menu/i }));

    const mobileNavigation = document.getElementById("mobile-navigation");
    expect(mobileNavigation).not.toBeNull();
    const businessLink = await within(mobileNavigation!).findByRole("link", {
      name: /Add Your Business/i,
    });
    expect(businessLink).toHaveAttribute("href", "/business/register");
  });

  it("shows the dashboard in the mobile menu for an eligible ordinary user", async () => {
    mockGetMyClaims.mockResolvedValue([{ id: "claim-1" }]);
    authenticateAs("mobile-owner");

    render(
      <MemoryRouter>
        <Navbar />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Open menu/i }));

    const mobileNavigation = document.getElementById("mobile-navigation");
    expect(mobileNavigation).not.toBeNull();
    const businessLink = await within(mobileNavigation!).findByRole("link", {
      name: /^Dashboard$/i,
    });
    expect(businessLink).toHaveAttribute("href", "/business/dashboard");
  });

  it("keeps the admin dashboard shortcut in the mobile menu", () => {
    authenticateAs("mobile-admin", "admin");

    render(
      <MemoryRouter>
        <Navbar />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Open menu/i }));

    const mobileNavigation = document.getElementById("mobile-navigation");
    expect(mobileNavigation).not.toBeNull();
    expect(within(mobileNavigation!).getByRole("link", { name: /^Dashboard$/i })).toHaveAttribute(
      "href",
      "/business/dashboard",
    );
    expect(within(mobileNavigation!).getByRole("link", { name: /Admin Dashboard/i })).toHaveAttribute(
      "href",
      "/admin",
    );
    expect(mockGetMyListings).not.toHaveBeenCalled();
    expect(mockGetMyClaims).not.toHaveBeenCalled();
    expect(mockGetMine).not.toHaveBeenCalled();
  });

  it("does not apply a previous user's eligibility after an account switch", async () => {
    let resolveListings: (listings: Array<{ id: string }>) => void = () => {};
    const firstUserListings = new Promise<Array<{ id: string }>>((resolve) => {
      resolveListings = resolve;
    });
    mockGetMyListings.mockReturnValueOnce(firstUserListings);
    authenticateAs("first-user");

    const { rerender } = render(
      <MemoryRouter>
        <Navbar />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: /User Menu/i }));

    authenticateAs("second-user");
    rerender(
      <MemoryRouter>
        <Navbar />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: /User Menu/i }));

    const secondUserBusinessLink = await screen.findByRole("link", {
      name: /Add Your Business/i,
    });
    expect(secondUserBusinessLink).toHaveAttribute("href", "/business/register");

    resolveListings([{ id: "first-user-listing" }]);
    await waitFor(() => {
      expect(screen.queryByRole("link", { name: /^Dashboard$/i })).not.toBeInTheDocument();
    });
    expect(screen.getByRole("link", { name: /Add Your Business/i })).toHaveAttribute(
      "href",
      "/business/register",
    );
  });

  it("renders Blog in the Discover menu", () => {
    render(
      <MemoryRouter>
        <Navbar />
      </MemoryRouter>
    );

    fireEvent.click(screen.getAllByRole("button", { name: /Discover/i })[0]);

    const blogLinks = screen.getAllByRole("link", { name: /^Blog$/i });
    expect(blogLinks[0]).toHaveAttribute("href", "/blog");
  });

  it("connects the mobile menu button to the controlled navigation region", () => {
    render(
      <MemoryRouter>
        <Navbar />
      </MemoryRouter>
    );

    const menuButton = screen.getByRole("button", { name: /Open menu/i });
    expect(menuButton).toHaveAttribute("aria-controls", "mobile-navigation");
    expect(menuButton).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(menuButton);

    expect(screen.getByRole("button", { name: /Close menu/i })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(document.getElementById("mobile-navigation")).toBeInTheDocument();
  });

  it("restores focus to the mobile menu toggle after closing the cart", () => {
    render(
      <MemoryRouter>
        <Navbar />
      </MemoryRouter>
    );

    const menuButton = screen.getByRole("button", { name: /Open menu/i });
    fireEvent.click(menuButton);
    const mobileNavigation = document.getElementById("mobile-navigation");
    expect(mobileNavigation).not.toBeNull();

    fireEvent.click(within(mobileNavigation!).getByRole("button", { name: /Cart/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(menuButton).toHaveFocus();
  });

  it("restores focus to the mobile menu toggle after backdrop close", () => {
    render(
      <MemoryRouter>
        <Navbar />
      </MemoryRouter>
    );

    const menuButton = screen.getByRole("button", { name: /Open menu/i });
    fireEvent.click(menuButton);
    const mobileNavigation = document.getElementById("mobile-navigation");
    expect(mobileNavigation).not.toBeNull();

    fireEvent.click(within(mobileNavigation!).getByRole("button", { name: /Cart/i }));
    const backdrop = document.querySelector(".fixed.inset-0");
    expect(backdrop).toBeInTheDocument();
    if (backdrop) fireEvent.click(backdrop);

    expect(menuButton).toHaveFocus();
  });

  it("keeps desktop navigation at xl while tablets use the hamburger", () => {
    render(
      <MemoryRouter>
        <Navbar />
      </MemoryRouter>
    );

    const desktopDiscover = screen.getAllByRole("button", { name: /Discover/i })[0];
    const desktopNavigation = desktopDiscover.parentElement?.parentElement?.parentElement;
    expect(desktopNavigation).toHaveClass("hidden", "xl:flex");
    expect(desktopNavigation).not.toHaveClass("md:flex");

    const menuButton = screen.getByRole("button", { name: /Open menu/i });
    expect(menuButton.parentElement).toHaveClass("xl:hidden");
    expect(menuButton.parentElement).not.toHaveClass("md:hidden");
  });

  it("locks body scroll and constrains the mobile menu to the dynamic viewport", () => {
    document.body.style.overflow = "visible";

    render(
      <MemoryRouter>
        <Navbar />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: /Open menu/i }));

    expect(document.body.style.overflow).toBe("hidden");
    expect(document.getElementById("mobile-navigation")).toHaveClass(
      "overflow-y-auto",
      "overscroll-contain",
      "max-h-[calc(100dvh-4rem)]",
    );

    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.getElementById("mobile-navigation")).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe("visible");
    document.body.style.overflow = "";
  });

  it("localizes the Home link in the mobile menu", async () => {
    await i18n.changeLanguage("ru");

    render(
      <MemoryRouter>
        <Navbar />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: /Открыть меню/i }));

    const mobileNavigation = document.getElementById("mobile-navigation");
    expect(mobileNavigation).not.toBeNull();
    expect(
      within(mobileNavigation!).getByRole("link", { name: "Главная" }),
    ).toHaveAttribute("href", "/");
  });

  it("renders Shop dropdown with Shop Marketplace link", () => {
    mockAuthState = {
      user: null,
      profile: null,
      loading: false,
      isAuthenticated: false,
      signOut: mockSignOut,
    };

    render(
      <MemoryRouter>
        <Navbar />
      </MemoryRouter>
    );

    const shopButtons = screen.getAllByRole("button", { name: /Shop/i });
    expect(shopButtons.length).toBeGreaterThan(0);
    fireEvent.click(shopButtons[0]);

    const marketplaceLinks = screen.getAllByRole("link", { name: /Shop Marketplace/i });
    expect(marketplaceLinks.length).toBeGreaterThan(0);
    expect(marketplaceLinks[0]).toHaveAttribute("href", "/shop");
  });
});
