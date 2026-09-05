import "@testing-library/jest-dom";
import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProductDetailPage from "./page";
import { productsService } from "@/api-services/products.service";
import { ApiError } from "@/lib/api-client";

const cartMocks = vi.hoisted(() => ({ addToCart: vi.fn() }));

vi.mock("@/pages/home/components/Navbar", () => ({ default: () => null }));
vi.mock("@/pages/home/components/Footer", () => ({ default: () => null }));
vi.mock("@/hooks/useCart", () => ({
  useCart: () => ({ addToCart: cartMocks.addToCart }),
}));
vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({
    favorites: new Set<string>(),
    isFavorite: vi.fn(() => false),
    toggleFavorite: vi.fn(),
  }),
}));
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    showToast: vi.fn(),
    ToastContainer: () => null,
  }),
}));
vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: null }),
}));

const productDetail = {
  product: {
    id: 101,
    name: "Ceramic Vase",
    description: "Handmade in Alanya",
    price: 40,
    currency: "EUR",
    stock: 5,
    media: [],
    category_id: null,
    product_categories: null,
  },
  variants: [],
  skus: [],
};

function renderProductPage() {
  return render(
    <MemoryRouter initialEntries={["/shop/101"]}>
      <Routes>
        <Route path="/shop/:productId" element={<ProductDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function openAndFillCheckout() {
  await screen.findByRole("heading", { name: "Ceramic Vase" });
  fireEvent.click(screen.getByRole("button", { name: /buy now/i }));
  const name = screen.getByLabelText(/full name/i);
  fireEvent.change(name, { target: { value: "Aylin Kaya" } });
  fireEvent.change(screen.getByRole("textbox", { name: /^email/i }), {
    target: { value: "aylin@example.com" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: /phone/i }), {
    target: { value: "5551234567" },
  });
  fireEvent.change(screen.getByLabelText(/delivery address/i), {
    target: { value: "10 Harbour Road" },
  });
  return { form: name.closest("form")!, name };
}

describe("ProductDetailPage checkout", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    cartMocks.addToCart.mockClear();
    vi.spyOn(productsService, "getProductDetails").mockResolvedValue(productDetail);
  });

  it("adds the canonical product and selected SKU identity to the cart", async () => {
    vi.spyOn(productsService, "getProductDetails").mockResolvedValueOnce({
      ...productDetail,
      variants: [
        {
          id: 301,
          product_id: 101,
          name: "Size",
          options: ["Standard"],
        },
      ],
      skus: [
        {
          id: 501,
          product_id: 101,
          label: "Standard",
          options: { Size: "Standard" },
          price: 45,
          stock: 3,
        },
      ],
    });

    renderProductPage();
    await screen.findByText(/Selected:/);
    fireEvent.click(screen.getByRole("button", { name: /add to cart/i }));

    expect(cartMocks.addToCart).toHaveBeenCalledWith(
      expect.objectContaining({
        productId: 101,
        skuId: 501,
        skuLabel: "Standard",
        variantLabel: "Standard",
      }),
    );
  });

  it("localizes the paused response from a gift-card direct URL", async () => {
    vi.spyOn(productsService, "getProductDetails").mockRejectedValueOnce(
      new ApiError(
        "Gift card sales are temporarily unavailable",
        400,
        "Bad Request",
      ),
    );

    renderProductPage();

    expect(
      await screen.findByText("Gift card sales are temporarily unavailable."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add to cart/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /buy now/i })).not.toBeInTheDocument();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reuses a request id after timeout and rotates it for changed details", async () => {
    const firstId = "11111111-1111-4111-8111-111111111111";
    const secondId = "22222222-2222-4222-8222-222222222222";
    vi.spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValueOnce(firstId)
      .mockReturnValueOnce(secondId);
    const createOrderSpy = vi
      .spyOn(productsService, "createProductOrder")
      .mockRejectedValue(new Error("Request timed out"));

    renderProductPage();
    const { form, name } = await openAndFillCheckout();

    fireEvent.submit(form);
    await waitFor(() => expect(createOrderSpy).toHaveBeenCalledTimes(1));
    fireEvent.submit(form);
    await waitFor(() => expect(createOrderSpy).toHaveBeenCalledTimes(2));
    fireEvent.change(name, { target: { value: "Deniz Kaya" } });
    fireEvent.submit(form);
    await waitFor(() => expect(createOrderSpy).toHaveBeenCalledTimes(3));

    expect(createOrderSpy.mock.calls[0][0].requestId).toBe(firstId);
    expect(createOrderSpy.mock.calls[1][0].requestId).toBe(firstId);
    expect(createOrderSpy.mock.calls[2][0].requestId).toBe(secondId);
  });

  it("blocks simultaneous submits and shows the pending server status truthfully", async () => {
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
      .spyOn(productsService, "createProductOrder")
      .mockReturnValueOnce(pendingOrder);

    renderProductPage();
    const { form } = await openAndFillCheckout();

    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(createOrderSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveOrder({ success: true, orderId: 42, status: "pending_payment" });
      await pendingOrder;
    });

    expect(await screen.findByText("Order placed")).toBeInTheDocument();
    expect(screen.getByText(/Pending payment/i)).toBeInTheDocument();
    expect(screen.queryByText(/confirmation and delivery details/i)).not.toBeInTheDocument();
  });
});
