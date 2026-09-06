import "@testing-library/jest-dom";
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import SettingsPage from "./page";
import { ProfileTab } from "./components/ProfileTab";
import { SecurityTab } from "./components/SecurityTab";
import { SettingsHero } from "./components/SettingsHero";
import type { UserProfile } from "@/context/AuthContext";
import { apiClient } from "@/lib/api-client";

// Mock AuthContext
const mockUpdateProfile = vi.fn();
const mockUpdatePassword = vi.fn();
const mockSignOut = vi.fn();

let mockAuthState: {
  user: { id: string; email: string; created_at: string; user_metadata?: Record<string, unknown> } | null;
  profile: UserProfile | null;
  loading: boolean;
  isAuthenticated: boolean;
  updateProfile: typeof mockUpdateProfile;
  updatePassword: typeof mockUpdatePassword;
  signOut: typeof mockSignOut;
} = {
  user: null,
  profile: null,
  loading: false,
  isAuthenticated: false,
  updateProfile: mockUpdateProfile,
  updatePassword: mockUpdatePassword,
  signOut: mockSignOut,
};

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => mockAuthState,
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock Navbar & Footer to keep tests focused
vi.mock("@/pages/home/components/Navbar", () => ({
  default: () => <div data-testid="navbar">Mock Navbar</div>,
}));

vi.mock("@/pages/home/components/Footer", () => ({
  default: () => <div data-testid="footer">Mock Footer</div>,
}));

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

describe("Settings Hub (Milestone 3)", () => {
  const defaultUser = {
    id: "usr_777",
    email: "vip.traveler@alanya-holidays.com",
    created_at: "2026-01-15T10:00:00.000Z",
  };

  const defaultProfile: UserProfile = {
    id: "usr_777",
    email: "vip.traveler@alanya-holidays.com",
    full_name: "Elena Rostova",
    avatar_url: "https://images.unsplash.com/photo-1534528741775-53994a69daeb",
    bio: "Passionate Mediterranean traveler and villa lover.",
    phone: "+90 532 555 0199",
    company_name: "Rostova Luxury Travels",
    role: "host",
    iban: null,
    bank_name: null,
    bank_account_holder_name: null,
    crypto_wallet: null,
    social_links: {
      instagram: "elenarostova",
      telegram: "elena_alanya",
      whatsapp: "+905325550199",
      website: "https://elenarostova.luxury",
      twitter: "elena_r",
    },
    created_at: "2026-01-15T10:00:00.000Z",
    updated_at: "2026-02-01T12:00:00.000Z",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockNavigate.mockClear();
    mockUpdateProfile.mockResolvedValue({ profile: defaultProfile, error: null });
    mockUpdatePassword.mockResolvedValue({ error: null });
    vi.spyOn(apiClient, "post");
    mockAuthState = {
      user: defaultUser,
      profile: defaultProfile,
      loading: false,
      isAuthenticated: true,
      updateProfile: mockUpdateProfile,
      updatePassword: mockUpdatePassword,
      signOut: mockSignOut,
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Authentication Guard & Page Layout", () => {
    it("redirects unauthenticated users to /login preserving return path", () => {
      mockAuthState = {
        ...mockAuthState,
        user: null,
        profile: null,
        isAuthenticated: false,
        loading: false,
      };

      render(
        <MemoryRouter initialEntries={["/settings"]}>
          <SettingsPage />
        </MemoryRouter>
      );

      expect(mockNavigate).toHaveBeenCalledWith("/login", expect.objectContaining({
        replace: true,
        state: expect.objectContaining({
          from: expect.objectContaining({ pathname: "/settings" }),
        }),
      }));
    });

    it("renders loading state when auth is loading", () => {
      mockAuthState = {
        ...mockAuthState,
        loading: true,
      };

      render(
        <MemoryRouter initialEntries={["/settings"]}>
          <SettingsPage />
        </MemoryRouter>
      );

      expect(screen.getByTestId("settings-loading-skeleton")).toBeInTheDocument();
    });

    it("renders Settings Hero with profile information and tabs", () => {
      render(
        <MemoryRouter initialEntries={["/settings"]}>
          <SettingsPage />
        </MemoryRouter>
      );

      expect(screen.getByText("Elena Rostova")).toBeInTheDocument();
      expect(screen.getByText("vip.traveler@alanya-holidays.com")).toBeInTheDocument();
      expect(screen.getByText(/Host/i)).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: /profile/i })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: /security/i })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: /activity/i })).toBeInTheDocument();
    });

    it("switches to Security tab when tab clicked", async () => {
      render(
        <MemoryRouter initialEntries={["/settings"]}>
          <SettingsPage />
        </MemoryRouter>
      );

      const securityTabBtn = screen.getByRole("tab", { name: /security/i });
      fireEvent.click(securityTabBtn);

      await waitFor(() => {
        expect(screen.getByText(/Change Password/i)).toBeInTheDocument();
      });
    });

    it("initializes on Security tab when query param ?tab=security is present", () => {
      render(
        <MemoryRouter initialEntries={["/settings?tab=security"]}>
          <SettingsPage />
        </MemoryRouter>
      );

      expect(screen.getByText(/Change Password/i)).toBeInTheDocument();
    });

    it("initializes on Activity tab when query param ?tab=activity is present", () => {
      render(
        <MemoryRouter initialEntries={["/settings?tab=activity"]}>
          <SettingsPage />
        </MemoryRouter>
      );

      expect(screen.getByText(/User Activity & History Hub/i)).toBeInTheDocument();
    });
  });

  describe("SettingsHero Component", () => {
    it("renders initials fallback when avatar_url is missing", () => {
      const profileNoAvatar: UserProfile = {
        ...defaultProfile,
        avatar_url: null,
        full_name: "Marco Rossi",
      };

      const handleTabChange = vi.fn();

      render(
        <MemoryRouter>
          <SettingsHero
            user={defaultUser}
            profile={profileNoAvatar}
            activeTab="profile"
            onTabChange={handleTabChange}
          />
        </MemoryRouter>
      );

      expect(screen.getByText("MR")).toBeInTheDocument();
      expect(screen.getByText("Marco Rossi")).toBeInTheDocument();
    });

    it("calls onTabChange when tab button is clicked", () => {
      const handleTabChange = vi.fn();

      render(
        <MemoryRouter>
          <SettingsHero
            user={defaultUser}
            profile={defaultProfile}
            activeTab="profile"
            onTabChange={handleTabChange}
          />
        </MemoryRouter>
      );

      const secTab = screen.getByRole("tab", { name: /security/i });
      fireEvent.click(secTab);

      expect(handleTabChange).toHaveBeenCalledWith("security");
    });

    it("renders Dashboard quick-action link pointing to /business/dashboard", () => {
      render(
        <MemoryRouter>
          <SettingsHero
            user={defaultUser}
            profile={defaultProfile}
            activeTab="profile"
            onTabChange={vi.fn()}
          />
        </MemoryRouter>
      );

      const merchantLink = screen.getByRole("link", { name: /^Dashboard$/i });
      expect(merchantLink).toBeInTheDocument();
      expect(merchantLink).toHaveAttribute("href", "/business/dashboard");
    });
  });

  describe("ProfileTab (R1)", () => {
    it("populates form fields from profile data", () => {
      render(
        <ProfileTab
          profile={defaultProfile}
          onProfileUpdated={vi.fn()}
        />
      );

      expect(screen.getByLabelText(/Full Name/i)).toHaveValue("Elena Rostova");
      expect(screen.getByLabelText(/Phone/i)).toHaveValue("+90 532 555 0199");
      expect(screen.getByLabelText(/Company/i)).toHaveValue("Rostova Luxury Travels");
      expect(screen.getByLabelText(/Bio/i)).toHaveValue("Passionate Mediterranean traveler and villa lover.");
      expect(screen.getByLabelText(/Instagram/i)).toHaveValue("elenarostova");
      expect(screen.getByLabelText(/Telegram/i)).toHaveValue("elena_alanya");
    });

    it("validates full name requirement and shows error if empty", async () => {
      render(
        <ProfileTab
          profile={defaultProfile}
          onProfileUpdated={vi.fn()}
        />
      );

      const nameInput = screen.getByLabelText(/Full Name/i);
      fireEvent.change(nameInput, { target: { value: "   " } });

      const saveBtn = screen.getByRole("button", { name: /Save Changes/i });
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(screen.getByText(/Full name is required/i)).toBeInTheDocument();
      });
      expect(mockUpdateProfile).not.toHaveBeenCalled();
    });

    it("submits updated profile data successfully and triggers callback", async () => {
      const onUpdated = vi.fn();

      render(
        <ProfileTab
          profile={defaultProfile}
          onProfileUpdated={onUpdated}
        />
      );

      const nameInput = screen.getByLabelText(/Full Name/i);
      fireEvent.change(nameInput, { target: { value: "Elena Rostova-Alanya" } });

      const bioInput = screen.getByLabelText(/Bio/i);
      fireEvent.change(bioInput, { target: { value: "Updated luxury host bio." } });

      const saveBtn = screen.getByRole("button", { name: /Save Changes/i });
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(mockUpdateProfile).toHaveBeenCalledWith(
          expect.objectContaining({
            full_name: "Elena Rostova-Alanya",
            bio: "Updated luxury host bio.",
          })
        );
      });

      await waitFor(() => {
        expect(screen.getByText(/Profile updated successfully/i)).toBeInTheDocument();
      });
      expect(onUpdated).toHaveBeenCalled();
    });

    it("displays error message when updateProfile fails", async () => {
      mockUpdateProfile.mockResolvedValueOnce({
        profile: null,
        error: new Error("Network error updating profile"),
      });

      render(
        <ProfileTab
          profile={defaultProfile}
          onProfileUpdated={vi.fn()}
        />
      );

      const saveBtn = screen.getByRole("button", { name: /Save Changes/i });
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(screen.getByText(/Failed to update profile. Please try again./i)).toBeInTheDocument();
        expect(screen.queryByText(/Network error updating profile/i)).not.toBeInTheDocument();
      });
    });

    it("resets form changes when Cancel/Reset is clicked", () => {
      render(
        <ProfileTab
          profile={defaultProfile}
          onProfileUpdated={vi.fn()}
        />
      );

      const nameInput = screen.getByLabelText(/Full Name/i);
      fireEvent.change(nameInput, { target: { value: "Modified Name" } });
      expect(nameInput).toHaveValue("Modified Name");

      const resetBtn = screen.getByRole("button", { name: /^Reset$/i });
      fireEvent.click(resetBtn);

      expect(nameInput).toHaveValue("Elena Rostova");
    });

    it("previews a selected file, drafts the processed URL, and saves it", async () => {
      const upload = Promise.resolve({
        originalName: "avatar.png",
        url: "https://cdn.example/avatar-full.webp",
        thumbnailUrl: "https://cdn.example/avatar-thumb.webp",
        format: "webp" as const,
        sizeBytes: 120,
      });
      vi.mocked(apiClient.post).mockResolvedValueOnce(upload);
      const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:avatar-preview");
      const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

      render(<ProfileTab profile={defaultProfile} onProfileUpdated={vi.fn()} />);

      const file = new File(["avatar"], "avatar.png", { type: "image/png" });
      fireEvent.change(screen.getByLabelText(/Upload avatar/i), { target: { files: [file] } });

      expect(screen.getByAltText("Avatar preview")).toHaveAttribute("src", "blob:avatar-preview");
      await waitFor(() => {
        expect(screen.getByLabelText(/Avatar Image/i)).toHaveValue("https://cdn.example/avatar-full.webp");
      });
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:avatar-preview");

      fireEvent.click(screen.getByRole("button", { name: /Save Changes/i }));
      await waitFor(() => {
        expect(mockUpdateProfile).toHaveBeenCalledWith(expect.objectContaining({
          avatar_url: "https://cdn.example/avatar-full.webp",
        }));
      });
      createObjectURL.mockRestore();
      revokeObjectURL.mockRestore();
    });

    it.each([
      ["image/svg+xml", 1, /JPEG, PNG, and WebP/i],
      ["image/png", 5 * 1024 * 1024 + 1, /5 MB/i],
      ["image/png", 0, /empty/i],
    ])("shows a local avatar validation error and keeps the previous avatar", async (type, size, message) => {
      const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:invalid");
      const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
      const file = new File(["avatar"], "avatar.png", { type });
      Object.defineProperty(file, "size", { value: size });

      render(<ProfileTab profile={defaultProfile} />);
      fireEvent.change(screen.getByLabelText(/Upload avatar/i), { target: { files: [file] } });

      await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(message));
      expect(screen.getByLabelText(/Avatar Image/i)).toHaveValue(defaultProfile.avatar_url);
      expect(apiClient.post).not.toHaveBeenCalled();
      createObjectURL.mockRestore();
      revokeObjectURL.mockRestore();
    });

    it("keeps the previous avatar after an upload error and allows retry", async () => {
      vi.mocked(apiClient.post)
        .mockRejectedValueOnce(new Error("Upload unavailable"))
        .mockResolvedValueOnce({
          originalName: "avatar.png",
          url: "https://cdn.example/retry.webp",
          thumbnailUrl: "https://cdn.example/retry-thumb.webp",
          format: "webp" as const,
          sizeBytes: 100,
        });
      vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:retry");
      vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

      render(<ProfileTab profile={defaultProfile} />);
      const input = screen.getByLabelText(/Upload avatar/i);
      const file = new File(["avatar"], "avatar.png", { type: "image/png" });
      fireEvent.change(input, { target: { files: [file] } });
      await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Avatar upload failed. Please try again."));
      expect(screen.queryByText("Upload unavailable")).not.toBeInTheDocument();
      expect(screen.getByLabelText(/Avatar Image/i)).toHaveValue(defaultProfile.avatar_url);

      fireEvent.change(input, { target: { files: [file] } });
      await waitFor(() => expect(screen.getByLabelText(/Avatar Image/i)).toHaveValue("https://cdn.example/retry.webp"));
    });

    it("blocks save while an avatar upload is pending", async () => {
      let resolveUpload: (value: unknown) => void = () => undefined;
      vi.mocked(apiClient.post).mockReturnValueOnce(new Promise((resolve) => { resolveUpload = resolve; }));
      vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:pending");
      vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

      render(<ProfileTab profile={defaultProfile} />);
      fireEvent.change(screen.getByLabelText(/Upload avatar/i), {
        target: { files: [new File(["avatar"], "avatar.png", { type: "image/png" })] },
      });
      const saveButton = screen.getByRole("button", { name: /Save Changes/i });
      expect(saveButton).toBeDisabled();
      fireEvent.click(saveButton);
      expect(mockUpdateProfile).not.toHaveBeenCalled();

      resolveUpload({
        originalName: "avatar.png",
        url: "https://cdn.example/pending.webp",
        thumbnailUrl: "https://cdn.example/pending-thumb.webp",
        format: "webp",
        sizeBytes: 100,
      });
      await waitFor(() => expect(saveButton).not.toBeDisabled());
    });

    it("ignores a stale upload after a newer preset selection", async () => {
      let resolveUpload: (value: unknown) => void = () => undefined;
      vi.mocked(apiClient.post).mockReturnValueOnce(new Promise((resolve) => { resolveUpload = resolve; }));
      vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:stale");
      vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

      render(<ProfileTab profile={defaultProfile} />);
      fireEvent.change(screen.getByLabelText(/Upload avatar/i), {
        target: { files: [new File(["avatar"], "avatar.png", { type: "image/png" })] },
      });
      const preset = screen.getByRole("button", { name: "Preset 1" });
      fireEvent.click(preset);
      const presetUrl = preset.querySelector("img")?.getAttribute("src");

      resolveUpload({
        originalName: "avatar.png",
        url: "https://cdn.example/stale.webp",
        thumbnailUrl: "https://cdn.example/stale-thumb.webp",
        format: "webp",
        sizeBytes: 100,
      });
      await waitFor(() => expect(screen.getByLabelText(/Avatar Image/i)).toHaveValue(presetUrl));
      expect(screen.getByLabelText(/Avatar Image/i)).not.toHaveValue("https://cdn.example/stale.webp");
    });

    it("clears an old profile during a user switch and ignores its late upload", async () => {
      let resolveUpload: (value: unknown) => void = () => undefined;
      vi.mocked(apiClient.post).mockReturnValueOnce(new Promise((resolve) => { resolveUpload = resolve; }));
      vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:user-a");
      vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

      const { rerender } = render(<ProfileTab profile={defaultProfile} />);
      fireEvent.change(screen.getByLabelText(/Upload avatar/i), {
        target: { files: [new File(["avatar"], "avatar.png", { type: "image/png" })] },
      });

      mockAuthState = {
        ...mockAuthState,
        user: { id: "usr_b", email: "b@example.com", created_at: "2026-02-01T00:00:00.000Z" },
      };
      rerender(<ProfileTab profile={defaultProfile} />);

      expect(screen.getByLabelText(/Full Name/i)).toHaveValue("");
      expect(screen.getByLabelText(/Avatar Image/i)).toHaveValue("");
      expect(screen.getByRole("button", { name: /Save Changes/i })).toBeDisabled();
      expect(screen.getByLabelText(/Upload avatar/i)).toBeDisabled();

      resolveUpload({
        originalName: "avatar.png",
        url: "https://cdn.example/user-a.webp",
        thumbnailUrl: "https://cdn.example/user-a-thumb.webp",
        format: "webp",
        sizeBytes: 100,
      });
      await waitFor(() => expect(screen.getByLabelText(/Avatar Image/i)).toHaveValue(""));

      const profileB: UserProfile = {
        ...defaultProfile,
        id: "usr_b",
        email: "b@example.com",
        full_name: "Traveler B",
        avatar_url: "https://cdn.example/user-b.webp",
      };
      mockAuthState = { ...mockAuthState, profile: profileB };
      rerender(<ProfileTab profile={profileB} />);

      await waitFor(() => {
        expect(screen.getByLabelText(/Full Name/i)).toHaveValue("Traveler B");
        expect(screen.getByLabelText(/Avatar Image/i)).toHaveValue("https://cdn.example/user-b.webp");
      });
    });
  });

  describe("SecurityTab (R2)", () => {
    it("validates minimum password length (>=8 chars)", async () => {
      render(<SecurityTab />);

      const newPasswordInput = screen.getByLabelText(/^New Password/i);
      const confirmPasswordInput = screen.getByLabelText(/^Confirm Password/i);
      const submitBtn = screen.getByRole("button", { name: /Update Password/i });

      fireEvent.change(newPasswordInput, { target: { value: "short" } });
      fireEvent.change(confirmPasswordInput, { target: { value: "short" } });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(screen.getByText(/Password must be at least 8 characters/i)).toBeInTheDocument();
      });
      expect(mockUpdatePassword).not.toHaveBeenCalled();
    });

    it("validates password confirmation matching", async () => {
      render(<SecurityTab />);

      const newPasswordInput = screen.getByLabelText(/^New Password/i);
      const confirmPasswordInput = screen.getByLabelText(/^Confirm Password/i);
      const submitBtn = screen.getByRole("button", { name: /Update Password/i });

      fireEvent.change(newPasswordInput, { target: { value: "SuperSecret123!" } });
      fireEvent.change(confirmPasswordInput, { target: { value: "DifferentSecret123!" } });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(screen.getByText(/Passwords do not match/i)).toBeInTheDocument();
      });
      expect(mockUpdatePassword).not.toHaveBeenCalled();
    });

    it("submits valid password, calls updatePassword and clears inputs", async () => {
      render(<SecurityTab />);

      const newPasswordInput = screen.getByLabelText(/^New Password/i);
      const confirmPasswordInput = screen.getByLabelText(/^Confirm Password/i);
      const submitBtn = screen.getByRole("button", { name: /Update Password/i });

      fireEvent.change(newPasswordInput, { target: { value: "StrongPass2026!" } });
      fireEvent.change(confirmPasswordInput, { target: { value: "StrongPass2026!" } });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(mockUpdatePassword).toHaveBeenCalledWith("StrongPass2026!");
      });

      await waitFor(() => {
        expect(screen.getByText(/Your password has been changed successfully/i)).toBeInTheDocument();
      });

      expect(newPasswordInput).toHaveValue("");
      expect(confirmPasswordInput).toHaveValue("");
    });

    it("displays error message if updatePassword fails", async () => {
      mockUpdatePassword.mockResolvedValueOnce({
        error: new Error("Auth session expired. Please sign in again."),
      });

      render(<SecurityTab />);

      const newPasswordInput = screen.getByLabelText(/^New Password/i);
      const confirmPasswordInput = screen.getByLabelText(/^Confirm Password/i);
      const submitBtn = screen.getByRole("button", { name: /Update Password/i });

      fireEvent.change(newPasswordInput, { target: { value: "StrongPass2026!" } });
      fireEvent.change(confirmPasswordInput, { target: { value: "StrongPass2026!" } });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(screen.getByText(/Failed to update password. Please try again./i)).toBeInTheDocument();
        expect(screen.queryByText(/Auth session expired/i)).not.toBeInTheDocument();
      });
    });

    it("toggles password visibility when eye button is clicked", () => {
      render(<SecurityTab />);

      const newPasswordInput = screen.getByLabelText(/^New Password/i);
      expect(newPasswordInput).toHaveAttribute("type", "password");

      const toggleBtn = screen.getByLabelText(/Toggle new password visibility/i);
      fireEvent.click(toggleBtn);
      expect(newPasswordInput).toHaveAttribute("type", "text");

      fireEvent.click(toggleBtn);
      expect(newPasswordInput).toHaveAttribute("type", "password");
    });
  });
});
