import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { productsService } from "@/api-services/products.service";
import ShopPage from "./page";

const shopMocks = vi.hoisted(() => ({
  addToCart: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock("@/pages/home/components/Navbar", () => ({ default: () => null }));
vi.mock("@/pages/home/components/Footer", () => ({ default: () => null }));
vi.mock("@/components/base/PageHeroImage", () => ({ default: () => null }));
vi.mock("@/pages/shop/components/PersonalShopperForm", () => ({ default: () => null }));
vi.mock("@/pages/shop/components/RecentEnquiriesSidebar", () => ({ default: () => null }));
vi.mock("@/hooks/useCart", () => ({
  useCart: () => ({ addToCart: shopMocks.addToCart }),
}));
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    showToast: shopMocks.showToast,
    ToastContainer: () => null,
  }),
}));

describe("ShopPage cart identity", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    shopMocks.addToCart.mockClear();
    shopMocks.showToast.mockClear();
    vi.spyOn(productsService, "getShopCatalog").mockResolvedValue({
      products: [
        {
          id: 77,
          name: "Ceramic Vase",
          description: "Handmade in Alanya",
          price: 40,
          currency: "EUR",
          stock: 5,
          media: [
            {
              type: "image",
              url: "https://example.com/ceramic-vase.jpg",
            },
          ],
          category_id: null,
          product_categories: null,
        },
        {
          id: 99,
          name: "Gift Voucher",
          description: "Paused gift card",
          price: 50,
          currency: "EUR",
          stock: 5,
          media: [],
          category_id: 9,
          product_categories: { id: 9, name: "Gift Cards" },
        },
      ],
      categories: [{ id: 9, name: "Gift Cards", sort_order: 1 }],
    });
  });

  it("adds the canonical catalog product ID and image to the cart", async () => {
    render(
      <MemoryRouter>
        <ShopPage />
      </MemoryRouter>,
    );

    await screen.findByRole("heading", { name: "Ceramic Vase" });
    fireEvent.click(screen.getByRole("button", { name: /add to cart/i }));

    expect(shopMocks.addToCart).toHaveBeenCalledWith(
      expect.objectContaining({
        productId: 77,
        name: "Ceramic Vase",
        imageUrl: "https://example.com/ceramic-vase.jpg",
      }),
    );
    expect(screen.queryByRole("heading", { name: "Gift Voucher" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Gift Cards" })).not.toBeInTheDocument();
  });
});
