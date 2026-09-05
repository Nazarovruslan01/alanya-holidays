import "@testing-library/jest-dom";
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import CheckoutPage from "./page";
import { ordersService } from "@/api-services/orders.service";
import { ApiError } from "@/lib/api-client";
import i18n from "@/i18n";

vi.mock("@/pages/home/components/Navbar", () => ({ default: () => <nav /> }));
vi.mock("@/pages/home/components/Footer", () => ({ default: () => <footer /> }));
vi.mock("@/components/base/PageHeroImage", () => ({ default: () => null }));

const mockClearCart = vi.fn();
type MockCartItem = {
  id?: string | number;
  productId?: string | number;
  skuId?: string | number | null;
  productName: string;
  price: string;
  quantity: number;
  icon: string;
  imageUrl?: string;
};

let mockCartItems: MockCartItem[] = [
  {
    productId: 1,
    productName: "Luxury Yacht Voucher",
    price: "€350.00",
    quantity: 1,
    icon: "ri-sailboat-line",
  },
];

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    user: null,
    loading: false,
    isAuthenticated: false,
  }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/hooks/useCart", () => ({
  useCart: () => ({
    items: mockCartItems,
    clearCart: mockClearCart,
    totalItems: mockCartItems.length,
  }),
}));

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

describe("CheckoutPage Component", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    vi.restoreAllMocks();
    mockClearCart.mockClear();
    mockNavigate.mockClear();
    mockCartItems = [
      {
        productId: 1,
        productName: "Luxury Yacht Voucher",
        price: "€350.00",
        quantity: 1,
        icon: "ri-sailboat-line",
      },
    ];
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage("en");
  });

  it("should render order summary and form fields when cart has items", () => {
    render(
      <MemoryRouter>
        <CheckoutPage />
      </MemoryRouter>
    );

    expect(screen.getByRole("heading", { name: "Checkout" })).toBeInTheDocument();
    expect(screen.getAllByText("Luxury Yacht Voucher").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Delivery details")).toBeInTheDocument();
    expect(screen.getByLabelText(/Recipient Name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Recipient Email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Recipient Phone/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Delivery address/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Your Name/i)).not.toBeInTheDocument();
  });

  it("should render a product image in the order summary when available", () => {
    mockCartItems[0].imageUrl = "https://example.com/yacht-voucher.jpg";

    render(
      <MemoryRouter>
        <CheckoutPage />
      </MemoryRouter>
    );

    expect(
      screen.getByRole("img", { name: "Luxury Yacht Voucher" }),
    ).toHaveAttribute("src", "https://example.com/yacht-voucher.jpg");
  });

  it("shows an actionable empty-cart state instead of silently redirecting", () => {
    mockCartItems = [];
    render(
      <MemoryRouter>
        <CheckoutPage />
      </MemoryRouter>
    );

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Your cart is empty" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse the shop" })).toHaveAttribute("href", "/shop");
  });

  it("localizes checkout labels and actions in Russian", async () => {
    await i18n.changeLanguage("ru");

    render(
      <MemoryRouter>
        <CheckoutPage />
      </MemoryRouter>
    );

    expect(screen.getByLabelText("Имя получателя *")).toBeInTheDocument();
    expect(screen.getByLabelText("Email получателя *")).toBeInTheDocument();
    expect(screen.getByLabelText("Телефон получателя *")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Оформить заказ — 350.00 EUR" })).toBeInTheDocument();
    expect(screen.queryByText("Back to Shop")).not.toBeInTheDocument();
  });

  it("should submit order via ordersService.createOrder and show order confirmation", async () => {
    const createOrderSpy = vi.spyOn(ordersService, "createOrder").mockResolvedValueOnce({
      success: true,
      orderId: 98765,
      status: "pending_payment",
      expiresAt: "2026-09-06T12:00:00.000Z",
      guestAccessToken: "a".repeat(43),
    });

    render(
      <MemoryRouter>
        <CheckoutPage />
      </MemoryRouter>
    );

    const recipientNameInput = screen.getByLabelText(/Recipient Name/i);
    const recipientEmailInput = screen.getByLabelText(/Recipient Email/i);
    const recipientPhoneInput = screen.getByLabelText(/Recipient Phone/i);
    const addressInput = screen.getByLabelText(/Delivery address/i);
    const notesInput = screen.getByLabelText(/Order notes/i);

    expect(
      screen.getByRole("button", { name: "Place Order — 350.00 EUR" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Used to contact the recipient about this order."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/send the gift card|send your order confirmation|included with the gift card/i),
    ).not.toBeInTheDocument();

    fireEvent.change(recipientNameInput, { target: { value: "Selin Yilmaz" } });
    fireEvent.change(recipientEmailInput, { target: { value: "selin@example.com" } });
    fireEvent.change(recipientPhoneInput, { target: { value: "+905551234567" } });
    fireEvent.change(addressInput, { target: { value: "10 Harbour Road" } });
    fireEvent.change(notesInput, { target: { value: "Ring the bell" } });

    const form = recipientNameInput.closest("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(createOrderSpy).toHaveBeenCalledWith({
        requestId: expect.any(String),
        guestAccessToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
        recipientName: "Selin Yilmaz",
        recipientEmail: "selin@example.com",
        recipientPhone: "+905551234567",
        recipientAddress: "10 Harbour Road",
        contactMethod: "email",
        customerNotes: "Ring the bell",
        subtotal: 350,
        currency: "EUR",
        items: [
          {
            productId: 1,
            productName: "Luxury Yacht Voucher",
            skuId: undefined,
            skuLabel: undefined,
            quantity: 1,
            price: "€350.00",
            unitPrice: 350,
            finalPrice: 350,
            subtotal: 350,
          },
        ],
      });
    });

    await waitFor(() => {
      expect(mockClearCart).toHaveBeenCalled();
      expect(screen.getByRole("heading", { name: "Order placed" })).toBeInTheDocument();
      expect(screen.getByText("Order #98765 has been placed.")).toBeInTheDocument();
      expect(screen.getAllByText(/Pending payment/i)).toHaveLength(2);
    });
    expect(screen.queryByText(/will be sent|we'll email/i)).not.toBeInTheDocument();
  });

  it("keeps legacy cart rows visible but requires catalog recovery before checkout", () => {
    const createOrderSpy = vi.spyOn(ordersService, "createOrder");
    mockCartItems = [
      {
        productName: "Legacy Gift",
        price: "€25.00",
        quantity: 1,
        icon: "ri-gift-line",
      },
    ];

    render(
      <MemoryRouter>
        <CheckoutPage />
      </MemoryRouter>,
    );

    expect(screen.getAllByText("Legacy Gift").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Remove each unverifiable item or choose a catalog product from Shop before placing this order.",
    );
    expect(screen.getByRole("button", { name: "Place Order — 25.00 EUR" })).toBeDisabled();
    fireEvent.submit(screen.getByLabelText(/Recipient Name/i).closest("form")!);
    expect(createOrderSpy).not.toHaveBeenCalled();
  });

  it("blocks a cart row with a nonnumeric SKU instead of submitting it without a SKU", () => {
    const createOrderSpy = vi.spyOn(ordersService, "createOrder");
    mockCartItems = [
      {
        productId: 100021,
        skuId: "sweet-treat",
        productName: "Sweet Story - Sweet Treat",
        price: "€15.00",
        quantity: 1,
        icon: "ri-gift-line",
      },
    ];

    render(
      <MemoryRouter>
        <CheckoutPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("unverifiable item");
    expect(screen.getByRole("button", { name: "Place Order — 15.00 EUR" })).toBeDisabled();
    fireEvent.submit(screen.getByLabelText(/Recipient Name/i).closest("form")!);
    expect(createOrderSpy).not.toHaveBeenCalled();
  });

  it("keeps a rejected gift-card cart row and gives localized recovery guidance", async () => {
    mockCartItems = [
      {
        productId: 99,
        skuId: 901,
        productName: "Gift Voucher",
        price: "€50.00",
        quantity: 1,
        icon: "ri-gift-line",
      },
    ];
    vi.spyOn(ordersService, "createOrder").mockRejectedValueOnce(
      new ApiError(
        "Gift card sales are temporarily unavailable",
        400,
        "Bad Request",
      ),
    );

    render(
      <MemoryRouter>
        <CheckoutPage />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText(/Recipient Name/i), {
      target: { value: "Selin Yilmaz" },
    });
    fireEvent.change(screen.getByLabelText(/Recipient Email/i), {
      target: { value: "selin@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/Recipient Phone/i), {
      target: { value: "+905551234567" },
    });
    fireEvent.change(screen.getByLabelText(/Delivery address/i), {
      target: { value: "10 Harbour Road" },
    });
    fireEvent.submit(screen.getByLabelText(/Recipient Name/i).closest("form")!);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Gift card sales are temporarily unavailable. Remove each unverifiable item or choose a catalog product from Shop before placing this order.",
    );
    expect(screen.getAllByText("Gift Voucher").length).toBeGreaterThanOrEqual(1);
    expect(mockClearCart).not.toHaveBeenCalled();
  });

  it("reuses a request id after a timeout and rotates it when the form payload changes", async () => {
    const firstId = "11111111-1111-4111-8111-111111111111";
    const secondId = "22222222-2222-4222-8222-222222222222";
    vi.spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValueOnce(firstId)
      .mockReturnValueOnce(secondId);
    const createOrderSpy = vi
      .spyOn(ordersService, "createOrder")
      .mockRejectedValue(new Error("Request timed out"));

    render(
      <MemoryRouter>
        <CheckoutPage />
      </MemoryRouter>
    );

    const recipientNameInput = screen.getByLabelText(/Recipient Name/i);
    fireEvent.change(recipientNameInput, { target: { value: "Selin Yilmaz" } });
    fireEvent.change(screen.getByLabelText(/Recipient Email/i), {
      target: { value: "selin@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/Recipient Phone/i), {
      target: { value: "+905551234567" },
    });
    fireEvent.change(screen.getByLabelText(/Delivery address/i), {
      target: { value: "10 Harbour Road" },
    });

    const form = recipientNameInput.closest("form")!;
    fireEvent.submit(form);
    await waitFor(() => expect(createOrderSpy).toHaveBeenCalledTimes(1));
    fireEvent.submit(form);
    await waitFor(() => expect(createOrderSpy).toHaveBeenCalledTimes(2));

    fireEvent.change(recipientNameInput, { target: { value: "Aylin Yilmaz" } });
    fireEvent.submit(form);
    await waitFor(() => expect(createOrderSpy).toHaveBeenCalledTimes(3));

    expect(createOrderSpy.mock.calls[0][0].requestId).toBe(firstId);
    expect(createOrderSpy.mock.calls[1][0].requestId).toBe(firstId);
    expect(createOrderSpy.mock.calls[2][0].requestId).toBe(secondId);
  });

  it("blocks simultaneous cart checkout submissions synchronously", async () => {
    let resolveOrder!: (value: {
      success: boolean;
      orderId: number;
      status: string;
    }) => void;
    const pendingOrder = new Promise<{
      success: boolean;
      orderId: number;
      status: string;
    }>((resolve) => {
      resolveOrder = resolve;
    });
    const createOrderSpy = vi
      .spyOn(ordersService, "createOrder")
      .mockReturnValueOnce(pendingOrder);

    render(
      <MemoryRouter>
        <CheckoutPage />
      </MemoryRouter>
    );

    const recipientNameInput = screen.getByLabelText(/Recipient Name/i);
    fireEvent.change(recipientNameInput, { target: { value: "Selin Yilmaz" } });
    fireEvent.change(screen.getByLabelText(/Recipient Email/i), {
      target: { value: "selin@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/Recipient Phone/i), {
      target: { value: "+905551234567" },
    });
    fireEvent.change(screen.getByLabelText(/Delivery address/i), {
      target: { value: "10 Harbour Road" },
    });

    const form = recipientNameInput.closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(createOrderSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveOrder({ success: true, orderId: 98765, status: "pending_payment" });
      await pendingOrder;
    });
    await waitFor(() =>
      expect(screen.getByText("Order #98765 has been placed.")).toBeInTheDocument(),
    );
  });

  it("should display error message when order creation fails", async () => {
    vi.spyOn(ordersService, "createOrder").mockRejectedValueOnce(
      new Error("Payment service unavailable")
    );

    render(
      <MemoryRouter>
        <CheckoutPage />
      </MemoryRouter>
    );

    const recipientNameInput = screen.getByLabelText(/Recipient Name/i);
    const recipientEmailInput = screen.getByLabelText(/Recipient Email/i);
    const recipientPhoneInput = screen.getByLabelText(/Recipient Phone/i);
    const addressInput = screen.getByLabelText(/Delivery address/i);

    fireEvent.change(recipientNameInput, { target: { value: "Selin Yilmaz" } });
    fireEvent.change(recipientEmailInput, { target: { value: "selin@example.com" } });
    fireEvent.change(recipientPhoneInput, { target: { value: "+905551234567" } });
    fireEvent.change(addressInput, { target: { value: "10 Harbour Road" } });

    const form = recipientNameInput.closest("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      const errorElements = screen.getAllByText("Payment service unavailable");
      expect(errorElements.length).toBeGreaterThanOrEqual(1);
    });
  });
});
