import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BusinessRegisterPage from "./page";
import "@/i18n";

const { mockGetMine, mockCreate } = vi.hoisted(() => ({
  mockGetMine: vi.fn(),
  mockCreate: vi.fn(),
}));

let mockAuthState: {
  user: { id: string; email: string } | null;
  loading: boolean;
} = { user: null, loading: false };

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => mockAuthState,
}));

vi.mock("@/api-services/business-applications.service", () => ({
  businessApplicationsService: {
    getMine: mockGetMine,
    create: mockCreate,
  },
}));

vi.mock("@/pages/register/RegistrationPage", () => ({
  default: () => <div data-testid="guest-registration" />,
}));

vi.mock("@/components/base/PageHeroImage", () => ({
  default: () => <div data-testid="hero-image" />,
}));

function Destination() {
  const location = useLocation();
  return <div data-testid="destination">{location.pathname}</div>;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/business/register"]}>
      <Routes>
        <Route path="/business/register" element={<BusinessRegisterPage />} />
        <Route path="/business/dashboard" element={<Destination />} />
      </Routes>
    </MemoryRouter>,
  );
}

function authenticateAs(id: string, email = `${id}@example.com`) {
  mockAuthState = { user: { id, email }, loading: false };
}

function fillApplicationForm() {
  fireEvent.change(screen.getByLabelText(/business name/i), {
    target: { value: "Alanya Services" },
  });
}

function applicationFor(userId: string, status: "pending" | "approved" | "rejected" = "pending") {
  return {
    id: "application-1",
    userId,
    accountType: "seller",
    businessName: "Existing Business",
    contactEmail: "owner@example.com",
    contactPhone: null,
    website: null,
    status,
    rejectionReason: null,
    reviewedBy: null,
    reviewedAt: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

describe("BusinessRegisterPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMine.mockResolvedValue(null);
    mockCreate.mockResolvedValue(applicationFor("user-1"));
    mockAuthState = { user: null, loading: false };
  });

  it("keeps guests on the existing business signup page", () => {
    renderPage();

    expect(screen.getByTestId("guest-registration")).toBeInTheDocument();
    expect(mockGetMine).not.toHaveBeenCalled();
  });

  it("waits for auth loading before choosing the guest or signed-in flow", async () => {
    mockAuthState = { user: { id: "user-1", email: "owner@example.com" }, loading: true };
    const { rerender } = renderPage();

    expect(screen.getByRole("status")).toHaveTextContent("Loading...");
    expect(mockGetMine).not.toHaveBeenCalled();

    mockAuthState = { user: { id: "user-1", email: "owner@example.com" }, loading: false };
    rerender(
      <MemoryRouter initialEntries={["/business/register"]}>
        <Routes>
          <Route path="/business/register" element={<BusinessRegisterPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByLabelText(/business name/i)).toBeInTheDocument();
    expect(mockGetMine).toHaveBeenCalledTimes(1);
  });

  it("loads the existing application and links to the dashboard without resubmitting", async () => {
    authenticateAs("user-1");
    mockGetMine.mockResolvedValue(applicationFor("user-1", "pending"));

    renderPage();

    expect(await screen.findByText("Existing Business")).toBeInTheDocument();
    expect(screen.getByText("pending")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute(
      "href",
      "/business/dashboard",
    );
    expect(screen.queryByLabelText(/business name/i)).not.toBeInTheDocument();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("prefills contact email and submits the signed-in application fields", async () => {
    authenticateAs("user-1", "owner@example.com");
    renderPage();

    expect(await screen.findByLabelText(/business name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toHaveValue("owner@example.com");
    fillApplicationForm();
    fireEvent.change(screen.getByLabelText(/account type/i), {
      target: { value: "service_provider" },
    });
    fireEvent.change(screen.getByLabelText(/contact phone/i), {
      target: { value: " +90 555 123 4567 " },
    });
    fireEvent.change(screen.getByLabelText(/website/i), {
      target: { value: " https://example.com " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(mockCreate).toHaveBeenCalledWith({
      businessName: "Alanya Services",
      accountType: "service_provider",
      contactEmail: "owner@example.com",
      contactPhone: "+90 555 123 4567",
      website: "https://example.com",
    });
    expect(await screen.findByTestId("destination")).toHaveTextContent(
      "/business/dashboard",
    );
  });

  it("validates contact email with the existing auth schema", async () => {
    authenticateAs("user-1");
    renderPage();
    await screen.findByLabelText(/business name/i);
    fillApplicationForm();
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "invalid" } });
    fireEvent.submit(screen.getByRole("button", { name: "Submit" }).closest("form")!);

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email address");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("disables duplicate submissions and surfaces a create error", async () => {
    authenticateAs("user-1");
    let rejectCreate: (error: Error) => void = () => {};
    mockCreate.mockReturnValueOnce(
      new Promise((_, reject) => {
        rejectCreate = reject;
      }),
    );
    renderPage();
    await screen.findByLabelText(/business name/i);
    fillApplicationForm();

    const submit = screen.getByRole("button", { name: "Submit" });
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(submit).toBeDisabled();

    rejectCreate(new Error("Application service unavailable"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Failed to submit business application. Please try again.",
    );
    expect(screen.queryByText("Application service unavailable")).not.toBeInTheDocument();
  });

  it("shows a retry after an existing application lookup error", async () => {
    authenticateAs("user-1");
    mockGetMine.mockRejectedValueOnce(new Error("Application lookup unavailable"));
    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Failed to load your business application. Please try again.",
    );
    expect(screen.queryByText("Application lookup unavailable")).not.toBeInTheDocument();
    mockGetMine.mockResolvedValueOnce(null);
    fireEvent.click(screen.getByRole("button", { name: "Try Again" }));
    expect(await screen.findByLabelText(/business name/i)).toBeInTheDocument();
    expect(mockGetMine).toHaveBeenCalledTimes(2);
  });

  it("does not retain an earlier user's application after an account switch", async () => {
    let resolveFirst: (application: ReturnType<typeof applicationFor>) => void = () => {};
    const firstLookup = new Promise<ReturnType<typeof applicationFor>>((resolve) => {
      resolveFirst = resolve;
    });
    mockGetMine.mockReturnValueOnce(firstLookup).mockResolvedValue(null);
    authenticateAs("first-user", "first@example.com");
    const { rerender } = renderPage();

    authenticateAs("second-user", "second@example.com");
    rerender(
      <MemoryRouter initialEntries={["/business/register"]}>
        <Routes>
          <Route path="/business/register" element={<BusinessRegisterPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByLabelText(/business name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toHaveValue("second@example.com");
    resolveFirst(applicationFor("first-user"));
    await waitFor(() => {
      expect(screen.queryByText("Existing Business")).not.toBeInTheDocument();
    });
  });

  it("does not redirect when an in-flight submission resolves after an account switch", async () => {
    let resolveCreate: () => void = () => {};
    mockCreate.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveCreate = resolve;
      }),
    );
    mockGetMine.mockResolvedValue(null);
    authenticateAs("first-user", "first@example.com");
    const { rerender } = renderPage();
    await screen.findByLabelText(/business name/i);
    fillApplicationForm();
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    authenticateAs("second-user", "second@example.com");
    rerender(
      <MemoryRouter initialEntries={["/business/register"]}>
        <Routes>
          <Route path="/business/register" element={<BusinessRegisterPage />} />
          <Route path="/business/dashboard" element={<Destination />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByLabelText(/business name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toHaveValue("second@example.com");
    resolveCreate();
    await waitFor(() => {
      expect(screen.queryByTestId("destination")).not.toBeInTheDocument();
    });
    expect(screen.getByLabelText(/email/i)).toHaveValue("second@example.com");
  });
});
