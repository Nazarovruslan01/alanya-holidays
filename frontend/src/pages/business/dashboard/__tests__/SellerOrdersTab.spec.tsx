import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SellerOrdersTab } from "../components/SellerOrdersTab";
import { ordersService, type SellerOrder } from "@/api-services/orders.service";

vi.mock("@/api-services/orders.service", async () => {
  const actual = await vi.importActual<typeof import("@/api-services/orders.service")>(
    "@/api-services/orders.service"
  );
  return {
    ...actual,
    ordersService: {
      getSellerOrders: vi.fn(),
      updateSellerOrderStatus: vi.fn(),
      confirmDeliveryQuote: vi.fn(),
    },
  };
});

const mockedOrders = vi.mocked(ordersService.getSellerOrders);
const mockedUpdate = vi.mocked(ordersService.updateSellerOrderStatus);
const mockedQuote = vi.mocked(ordersService.confirmDeliveryQuote);

const paidOrder: SellerOrder = {
  id: 7,
  status: "paid",
  currency: "EUR",
  created_at: "2026-08-25T10:00:00Z",
  recipient: { name: "Ayşe Yılmaz", email: "ayse@example.com" },
  can_manage_order: true,
  items: [
    { id: 1, product_name: "Ceramic Bowl", quantity: 2, subtotal: 49.8 },
    { id: 2, product_name: "Olive Soap", quantity: 1, subtotal: 6 },
  ],
};

describe("SellerOrdersTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders order cards with status badge and line items", async () => {
    mockedOrders.mockResolvedValueOnce([paidOrder]);

    render(<SellerOrdersTab />);

    expect(await screen.findByText("Order #7")).toBeInTheDocument();
    expect(screen.getByText(/Paid/)).toBeInTheDocument();
    expect(screen.getByText(/Ceramic Bowl/)).toBeInTheDocument();
    expect(screen.getByText(/Ayşe Yılmaz/)).toBeInTheDocument();
    expect(screen.getByText("EUR 55.80")).toBeInTheDocument();
  });

  it("shows an empty state when the seller has no orders", async () => {
    mockedOrders.mockResolvedValueOnce([]);

    render(<SellerOrdersTab />);

    expect(await screen.findByText(/No orders yet/i)).toBeInTheDocument();
  });

  it("moves a paid order to shipped and reflects the new status optimistically", async () => {
    mockedOrders.mockResolvedValueOnce([{ ...paidOrder }]);
    mockedUpdate.mockResolvedValueOnce({ success: true });

    render(<SellerOrdersTab />);
    fireEvent.click(await screen.findByRole("button", { name: /Mark as Shipped/i }));

    await waitFor(() => {
      expect(mockedUpdate).toHaveBeenCalledWith(7, "shipped");
    });
    // Status badge flips without a refetch.
    expect(await screen.findByText(/Shipped/)).toBeInTheDocument();
  });

  it("shows an error banner when the fulfillment transition fails", async () => {
    mockedOrders.mockResolvedValueOnce([{ ...paidOrder }]);
    mockedUpdate.mockResolvedValueOnce({ success: false, message: "Invalid transition" });

    render(<SellerOrdersTab />);
    fireEvent.click(await screen.findByRole("button", { name: /Mark as Shipped/i }));

    expect(await screen.findByText(/Invalid transition/)).toBeInTheDocument();
  });

  it("does not interpret an empty delivery fee as an immutable zero quote", async () => {
    mockedOrders.mockResolvedValueOnce([
      {
        ...paidOrder,
        status: "pending_payment",
        payment_provider: "unselected",
      },
    ]);

    render(<SellerOrdersTab />);
    fireEvent.change(await screen.findByLabelText("Delivery time"), {
      target: { value: "Tomorrow" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm delivery" }));

    expect(mockedQuote).not.toHaveBeenCalled();
  });
});
