import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import RejectReasonModal from "../components/RejectReasonModal";
import ListingDetailPreviewModal from "../components/ListingDetailPreviewModal";
import ClaimDetailModal from "../components/ClaimDetailModal";

describe("Admin Moderation Modals Suite", () => {
  describe("RejectReasonModal", () => {
    it("validates minimum character length before submitting", async () => {
      const onConfirm = vi.fn().mockResolvedValue(undefined);
      const onClose = vi.fn();

      render(
        <RejectReasonModal
          isOpen={true}
          onClose={onClose}
          onConfirm={onConfirm}
          title="Reject Spa Listing"
          itemName="Spa Relax"
        />
      );

      expect(screen.getByText("Reject Spa Listing")).toBeInTheDocument();
      expect(screen.getByText("Spa Relax")).toBeInTheDocument();

      const textarea = screen.getByPlaceholderText(/e\.g\. Incomplete business details/i);
      const submitBtn = screen.getByRole("button", { name: /Confirm Rejection/i });

      // Initially disabled when empty
      expect(submitBtn).toBeDisabled();

      // Enter less than 5 characters
      fireEvent.change(textarea, { target: { value: "bad" } });
      expect(submitBtn).toBeDisabled();

      // Enter valid explanation
      fireEvent.change(textarea, {
        target: { value: "Business license does not match provided address." },
      });
      expect(submitBtn).not.toBeDisabled();

      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(onConfirm).toHaveBeenCalledWith(
          "Business license does not match provided address."
        );
        expect(onClose).toHaveBeenCalled();
      });
    });

    it("renders nothing when isOpen is false", () => {
      const { container } = render(
        <RejectReasonModal
          isOpen={false}
          onClose={vi.fn()}
          onConfirm={vi.fn()}
        />
      );
      expect(container.firstChild).toBeNull();
    });
  });

  describe("ListingDetailPreviewModal", () => {
    const mockListing = {
      id: "list-99",
      name: "Luxury Yacht Haven",
      slug: "luxury-yacht-haven",
      category_id: "boat-tours",
      category: "Boat Tours",
      status: "pending",
      tier: "signature",
      location: "Alanya Marina",
      email: "info@yachthaven.test",
      phone: "+90 555 777 6655",
      whatsapp: "+90 555 777 6655",
      website: "https://yachthaven.test",
      short_description: "Top luxury yacht experience",
      description: "Full service charter along the Cleopatra coastline.",
      gallery: ["https://example.com/boat1.jpg", "https://example.com/boat2.jpg"],
      created_at: "2026-08-20T12:00:00Z",
    };

    it("displays full listing preview information with contact links and actions", () => {
      const onApprove = vi.fn();
      const onRequestReject = vi.fn();
      const onClose = vi.fn();

      render(
        <ListingDetailPreviewModal
          listing={mockListing}
          isOpen={true}
          onClose={onClose}
          onApprove={onApprove}
          onRequestReject={onRequestReject}
        />
      );

      expect(screen.getByText("Luxury Yacht Haven")).toBeInTheDocument();
      expect(screen.getByText("Top luxury yacht experience")).toBeInTheDocument();
      expect(screen.getByText(/Full service charter along the Cleopatra/i)).toBeInTheDocument();
      expect(screen.getByText("info@yachthaven.test")).toBeInTheDocument();
      expect(screen.getAllByText("+90 555 777 6655")[0]).toBeInTheDocument();
      expect(screen.getByText("https://yachthaven.test")).toBeInTheDocument();

      // Trigger approve
      const approveBtn = screen.getByRole("button", { name: /Approve Listing/i });
      fireEvent.click(approveBtn);
      expect(onApprove).toHaveBeenCalledWith("list-99");
      expect(onClose).toHaveBeenCalled();
    });

    it("triggers onRequestReject callback when reject button clicked", () => {
      const onRequestReject = vi.fn();
      const onClose = vi.fn();

      render(
        <ListingDetailPreviewModal
          listing={mockListing}
          isOpen={true}
          onClose={onClose}
          onRequestReject={onRequestReject}
        />
      );

      const rejectBtn = screen.getByRole("button", { name: /Reject/i });
      fireEvent.click(rejectBtn);
      expect(onRequestReject).toHaveBeenCalledWith(mockListing);
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe("ClaimDetailModal", () => {
    const mockClaim = {
      id: "claim-88",
      listing_id: "list-99",
      user_id: "user-uuid-88",
      email: "ceo@yachthaven.test",
      phone: "+90 555 333 2211",
      role: "Managing Director",
      business_name: "Luxury Yacht Haven",
      contact_phone: "+90 555 333 2211",
      additional_notes: "Registered official commercial maritime license #TR-8821",
      status: "pending",
      email_verified: true,
      directory_listing: {
        id: "list-99",
        name: "Luxury Yacht Haven",
        slug: "luxury-yacht-haven",
        category_id: "boat-tours",
        tier: "signature",
      },
      created_at: "2026-08-20T15:00:00Z",
    };

    it("waits for ownership transfer approval before closing and blocks duplicate clicks", async () => {
      let resolveApproval!: (approved: boolean) => void;
      const onApprove = vi.fn(
        () => new Promise<boolean>((resolve) => {
          resolveApproval = resolve;
        })
      );
      const onClose = vi.fn();

      render(
        <ClaimDetailModal
          claim={mockClaim}
          isOpen={true}
          onClose={onClose}
          onApprove={onApprove}
        />
      );

      expect(screen.getAllByText("Luxury Yacht Haven")[0]).toBeInTheDocument();
      expect(screen.getByText("Managing Director")).toBeInTheDocument();
      expect(screen.getByText("ceo@yachthaven.test")).toBeInTheDocument();
      expect(screen.getByText(/Registered official commercial maritime license/i)).toBeInTheDocument();
      expect(screen.getByText("Email Verified")).toBeInTheDocument();

      const transferBtn = screen.getByRole("button", { name: /Approve & Transfer Ownership/i });
      fireEvent.click(transferBtn);

      expect(onApprove).toHaveBeenCalledWith("claim-88");
      expect(onApprove).toHaveBeenCalledTimes(1);
      expect(onClose).not.toHaveBeenCalled();
      expect(transferBtn).toBeDisabled();

      fireEvent.click(transferBtn);
      expect(onApprove).toHaveBeenCalledTimes(1);

      resolveApproval(true);
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    });

    it("stays open after failed approval and allows retry", async () => {
      const onApprove = vi.fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
      const onClose = vi.fn();

      render(
        <ClaimDetailModal
          claim={{ ...mockClaim, email_verified: false }}
          isOpen={true}
          onClose={onClose}
          onApprove={onApprove}
        />
      );

      expect(screen.getByText("Email Unverified")).toBeInTheDocument();
      const transferBtn = screen.getByRole("button", { name: /Approve & Transfer Ownership/i });
      fireEvent.click(transferBtn);

      await waitFor(() => expect(onApprove).toHaveBeenCalledTimes(1));
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      await waitFor(() => expect(transferBtn).not.toBeDisabled());

      fireEvent.click(transferBtn);
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    });
  });
});
