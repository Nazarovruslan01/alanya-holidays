import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { Business } from "@/api-services/directory.service";
import MapView from "./MapView";

const baseBusiness: Business = {
  id: "mapped-business",
  name: "Mapped Business",
  category: "restaurants",
  subcategory: "Restaurant",
  description: "A mapped business",
  address: "Harbor Street",
  phone: "",
  email: "",
  website: "",
  rating: 4.5,
  reviewCount: 10,
  image: "/images/placeholder-business.svg",
  tags: [],
  featured: false,
  priceRange: "$$",
  lat: 36.5437,
  lng: 31.9998,
};

describe("MapView directory data", () => {
  it.each(["", "call 12", "1"])("keeps address-based map search when coordinates are absent (%j)", (phone) => {
    const { lat: _lat, lng: _lng, ...withoutCoordinates } = baseBusiness;
    const missingCoordinates = {
      ...withoutCoordinates,
      id: "missing-coordinates",
      name: "Missing Coordinates",
      phone,
    };

    render(
      <MemoryRouter>
        <MapView
          businesses={[baseBusiness, missingCoordinates]}
          searchQuery=""
          activeCategory="all"
          onSearchChange={() => undefined}
          onCategoryChange={() => undefined}
        />
      </MemoryRouter>
    );

    expect(screen.getByText("2 places found")).toBeInTheDocument();
    expect(screen.getByText("Mapped Business")).toBeInTheDocument();
    expect(screen.getByText("Missing Coordinates")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Missing Coordinates"));

    expect(screen.queryByText("Call")).not.toBeInTheDocument();
    expect(screen.queryByText("Website")).not.toBeInTheDocument();
    expect(screen.getByTitle("Alanya Business Map")).toHaveAttribute(
      "src",
      expect.stringContaining("Missing%20Coordinates%2C%20Harbor%20Street")
    );
  });

  it("accepts and normalizes a formatted phone number", () => {
    const business = { ...baseBusiness, phone: "+90 (242) 511-0000" };

    render(
      <MemoryRouter>
        <MapView
          businesses={[business]}
          searchQuery=""
          activeCategory="all"
          onSearchChange={() => undefined}
          onCategoryChange={() => undefined}
        />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByText("Mapped Business"));

    expect(screen.getByText("Call")).toHaveAttribute("href", "tel:+902425110000");
  });
});
