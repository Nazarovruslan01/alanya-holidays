import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { productsService } from "@/api-services/products.service";
import FeaturedProducts from "./FeaturedProducts";

describe("FeaturedProducts gift-card pause", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(productsService, "getFeaturedProducts").mockResolvedValue([
      {
        id: 7,
        name: "Ceramic Vase",
        description: "Handmade in Alanya",
        price: 40,
        currency: "EUR",
        stock: 5,
        media: [],
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
    ]);
  });

  it("keeps ordinary featured products but does not promote gift cards", async () => {
    render(
      <MemoryRouter>
        <FeaturedProducts />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "Ceramic Vase" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Gift Voucher" })).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "Every purchase helps keep AlanyaHolidays running — from server costs to community events.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Gift cards and community favorites/i)).not.toBeInTheDocument();
  });
});
