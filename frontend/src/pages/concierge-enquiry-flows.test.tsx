import "@testing-library/jest-dom";
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import VillaStaysPage from "./villa-stays/page";
import YachtChartersPage from "./yacht-charters/page";
import LuxuryExperiencePage from "./luxury-experience/page";
import ContactPage from "./contact/page";
import { adminService } from "@/api-services/admin.service";
import { conciergeService, type Yacht } from "@/api-services/concierge.service";
import { propertiesService } from "@/api-services/properties.service";

const mockNavigate = vi.fn();

const liveVilla = {
  id: "live-villa-1",
  title: "Approved Sea View Villa",
  description: "An approved live villa listing.",
  type: "villa",
  location: "Alanya Center",
  pricePerNight: 300,
  currency: "EUR",
  bedrooms: 3,
  bathrooms: 2,
  maxGuests: 6,
  hasPool: true,
  hasSeaView: true,
  image: "/images/placeholder-business.svg",
  amenities: ["WiFi"],
  rating: 4.8,
  reviewCount: 10,
  featured: false,
  minStay: 2,
  distanceToBeach: "500m",
  status: "approved",
};

const liveYacht: Yacht = {
  id: "live-yacht-1",
  name: "Approved Alanya Yacht",
  company: "Approved Charter Provider",
  type: "Motor Yacht",
  capacity: 8,
  cabins: 4,
  length: "22m",
  year: 2024,
  pricePerDay: 1200,
  currency: "EUR",
  halfDayPrice: 650,
  image: "/images/placeholder-business.svg",
  description: "An approved live yacht listing.",
  amenities: ["WiFi"],
  crewIncluded: true,
  skipperRequired: false,
  rating: 4.8,
  reviewCount: 12,
  availableRoutes: ["Alanya Coastline"],
  featured: false,
  port: "Alanya Marina",
  crew: [],
};

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock("@/pages/home/components/Navbar", () => ({
  default: () => <div data-testid="navbar" />,
}));

vi.mock("@/pages/home/components/Footer", () => ({
  default: () => <div data-testid="footer" />,
}));

vi.mock("@/components/feature/RelatedExperiences", () => ({
  default: () => <div data-testid="related-experiences" />,
}));

describe("concierge enquiry page flows", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockNavigate.mockClear();

    vi.spyOn(propertiesService, "getProperties").mockResolvedValue({ data: [liveVilla], total: 1 });
    vi.spyOn(conciergeService, "getYachts").mockResolvedValue([liveYacht]);
    vi.spyOn(conciergeService, "submitConciergeEnquiry").mockResolvedValue({
      success: true,
      id: "enq-123",
    });
    vi.spyOn(adminService, "submitEnquiry").mockResolvedValue({ success: true, id: "contact-123" });
  });

  const fillContactForm = () => {
    fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: "Aylin Kaya" } });
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: "aylin@example.com" } });
    fireEvent.change(screen.getByLabelText(/your message/i), { target: { value: "Please help with my trip." } });
  };

  it("redirects villa enquiries to booking confirmation with enquiry state", async () => {
    render(
      <MemoryRouter>
        <VillaStaysPage />
      </MemoryRouter>
    );

    fireEvent.click((await screen.findAllByRole("button", { name: /view details/i }))[0]);

    const nameInput = screen.getByPlaceholderText(/your full name/i);
    const emailInput = screen.getByPlaceholderText(/your email address/i);
    const notesInput = screen.getByPlaceholderText(/preferred dates, number of guests, or special requests/i);

    fireEvent.change(nameInput, { target: { value: "Elena Rostova" } });
    fireEvent.change(emailInput, { target: { value: "elena@example.com" } });
    fireEvent.change(notesInput, { target: { value: "Need a sea-view villa for 4 guests." } });

    fireEvent.submit(nameInput.closest("form")!);

    await waitFor(() => {
      expect(conciergeService.submitConciergeEnquiry).toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith(
        "/booking-confirmation",
        expect.objectContaining({
          state: expect.objectContaining({
            name: "Elena Rostova",
            email: "elena@example.com",
            subject: "Villa Stay",
            message: "Need a sea-view villa for 4 guests.",
            timestamp: expect.any(String),
          }),
        })
      );
    });
  });

  it("redirects yacht enquiries to booking confirmation with request wording and itinerary context", async () => {
    render(
      <MemoryRouter>
        <YachtChartersPage />
      </MemoryRouter>
    );

    fireEvent.click((await screen.findAllByRole("button", { name: /view details/i }))[0]);
    fireEvent.click(screen.getByRole("button", { name: /half day/i }));

    const nameInput = screen.getByPlaceholderText(/your full name/i);
    const emailInput = screen.getByPlaceholderText(/your email address/i);
    const notesInput = screen.getByPlaceholderText(/number of guests, preferred route, or special requests/i);

    fireEvent.change(nameInput, { target: { value: "Murat Demir" } });
    fireEvent.change(emailInput, { target: { value: "murat@example.com" } });
    fireEvent.change(notesInput, { target: { value: "Sunset charter for anniversary." } });

    expect(screen.getByRole("button", { name: /request half day charter/i })).toBeInTheDocument();

    fireEvent.submit(nameInput.closest("form")!);

    await waitFor(() => {
      expect(conciergeService.submitConciergeEnquiry).toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith(
        "/booking-confirmation",
        expect.objectContaining({
          state: expect.objectContaining({
            name: "Murat Demir",
            email: "murat@example.com",
            subject: "Yacht Charter",
            message: expect.stringContaining("Duration: Half Day"),
            timestamp: expect.any(String),
          }),
        })
      );
    });
  });

  it("redirects luxury concierge requests to booking confirmation", async () => {
    render(
      <MemoryRouter>
        <LuxuryExperiencePage />
      </MemoryRouter>
    );

    const nameInput = screen.getByPlaceholderText(/your full name/i);
    const emailInput = screen.getByPlaceholderText(/your email address/i);
    const notesInput = screen.getByPlaceholderText(/tell us what you're looking for/i);

    fireEvent.change(nameInput, { target: { value: "Aylin Kaya" } });
    fireEvent.change(emailInput, { target: { value: "aylin@example.com" } });
    fireEvent.change(notesInput, { target: { value: "Planning a bespoke proposal setup." } });

    fireEvent.submit(nameInput.closest("form")!);

    await waitFor(() => {
      expect(conciergeService.submitConciergeEnquiry).toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith(
        "/booking-confirmation",
        expect.objectContaining({
          state: expect.objectContaining({
            name: "Aylin Kaya",
            email: "aylin@example.com",
            subject: "Luxury Experience",
            message: "Planning a bespoke proposal setup.",
            timestamp: expect.any(String),
          }),
        })
      );
    });
  });

  it.each(["whatsapp", "phone_call"] as const)(
    "requires and submits a phone number for %s contact",
    async (preferredContact) => {
      render(
        <MemoryRouter>
          <ContactPage />
        </MemoryRouter>,
      );

      fillContactForm();
      fireEvent.click(screen.getByRole("radio", { name: preferredContact === "whatsapp" ? "WhatsApp" : "Phone Call" }));
      fireEvent.submit(screen.getByRole("button", { name: /send message/i }).closest("form")!);

      expect(screen.getByText(/please enter your phone number/i)).toBeInTheDocument();
      expect(adminService.submitEnquiry).not.toHaveBeenCalled();

      fireEvent.change(screen.getByLabelText(/phone number/i), { target: { value: " +90 555 123 4567 " } });
      fireEvent.submit(screen.getByRole("button", { name: /send message/i }).closest("form")!);

      await waitFor(() => {
        expect(adminService.submitEnquiry).toHaveBeenCalledWith(
          expect.objectContaining({
            phone: "+90 555 123 4567",
            preferred_contact: preferredContact,
            message: expect.stringContaining("Preferred contact method"),
          }),
        );
      });
    },
  );

  it("submits an email enquiry without requiring a phone number", async () => {
    render(
      <MemoryRouter>
        <ContactPage />
      </MemoryRouter>,
    );

    fillContactForm();
    fireEvent.submit(screen.getByRole("button", { name: /send message/i }).closest("form")!);

    await waitFor(() => {
      expect(adminService.submitEnquiry).toHaveBeenCalledWith(
        expect.objectContaining({ preferred_contact: "email", phone: undefined }),
      );
      expect(mockNavigate).toHaveBeenCalledWith("/booking-confirmation", expect.anything());
    });
  });

  it("ignores the honeypot without sending an enquiry", () => {
    render(
      <MemoryRouter>
        <ContactPage />
      </MemoryRouter>,
    );

    const honeypot = document.querySelector<HTMLInputElement>('input[name="phone_alt"]');
    expect(honeypot).not.toBeNull();
    fireEvent.change(honeypot!, { target: { value: "bot-value" } });
    fireEvent.submit(screen.getByRole("button", { name: /send message/i }).closest("form")!);

    expect(adminService.submitEnquiry).not.toHaveBeenCalled();
  });

  it("retains the phone and message when submission fails", async () => {
    vi.mocked(adminService.submitEnquiry).mockRejectedValueOnce(new Error("Network down"));
    render(
      <MemoryRouter>
        <ContactPage />
      </MemoryRouter>,
    );

    fillContactForm();
    fireEvent.click(screen.getByRole("radio", { name: "WhatsApp" }));
    fireEvent.change(screen.getByLabelText(/phone number/i), { target: { value: "+90 555 123 4567" } });
    fireEvent.submit(screen.getByRole("button", { name: /send message/i }).closest("form")!);

    await waitFor(() => {
      expect(screen.getByText("Network down")).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/phone number/i)).toHaveValue("+90 555 123 4567");
    expect(screen.getByLabelText(/your message/i)).toHaveValue("Please help with my trip.");
  });
});
