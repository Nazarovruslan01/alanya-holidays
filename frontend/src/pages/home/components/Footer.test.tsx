import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Footer from "./Footer";
import i18n from "@/i18n";

const mockAuth = vi.hoisted(() => ({
  user: null as { id: string } | null,
  profile: null as { role?: string } | null,
  isAuthenticated: false,
  isAdmin: false,
  loading: false,
}));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => mockAuth,
}));

describe("Footer", () => {
  beforeEach(() => {
    Object.assign(mockAuth, {
      user: null,
      profile: null,
      isAuthenticated: false,
      isAdmin: false,
      loading: false,
    });
  });

  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("shows the admin link only for administrators", () => {
    const guest = render(
      <MemoryRouter>
        <Footer />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("link", { name: "Admin" })).not.toBeInTheDocument();
    guest.unmount();

    Object.assign(mockAuth, {
      user: { id: "regular-user" },
      profile: { role: "user" },
      isAuthenticated: true,
    });
    const user = render(
      <MemoryRouter>
        <Footer />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("link", { name: "Admin" })).not.toBeInTheDocument();
    user.unmount();

    Object.assign(mockAuth, { isAdmin: true });
    render(
      <MemoryRouter>
        <Footer />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "Admin" })).toHaveAttribute("href", "/admin");
  });

  it("does not publish generic social-network homepages as company accounts", () => {
    render(
      <MemoryRouter>
        <Footer />
      </MemoryRouter>,
    );

    expect(document.querySelector('a[href="https://instagram.com"]')).not.toBeInTheDocument();
    expect(document.querySelector('a[href="https://facebook.com"]')).not.toBeInTheDocument();
    expect(document.querySelector('a[href="https://twitter.com"]')).not.toBeInTheDocument();
  });

  it("localizes the copyright text without translating the company name", async () => {
    await i18n.changeLanguage("ru");
    render(
      <MemoryRouter>
        <Footer />
      </MemoryRouter>,
    );

    expect(screen.getByText("© 2026 Alanya Holidays. Все права защищены.")).toBeInTheDocument();
    expect(screen.queryByText(/All rights reserved/)).not.toBeInTheDocument();
  });
});
