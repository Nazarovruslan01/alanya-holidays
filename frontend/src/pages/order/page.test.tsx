import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OrderPage from "./page";
import { ordersService } from "@/api-services/orders.service";
import "@/i18n";

vi.mock("@/pages/home/components/Navbar", () => ({ default: () => null }));
vi.mock("@/pages/home/components/Footer", () => ({ default: () => null }));

describe("OrderPage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("uses a fragment capability as a header and offers payment only after quote", async () => {
    const token = "a".repeat(43);
    const getOrder = vi.spyOn(ordersService, "getOrder").mockResolvedValue({
      id: 77,
      status: "pending_payment",
      currency: "EUR",
      subtotal_items: 50,
      delivery_fee: 8.5,
      total_amount: 58.5,
      delivery_eta: "Tomorrow",
      delivery_quote_confirmed_at: "2026-09-06T10:00:00.000Z",
      payment_provider: "unselected",
      payment_reconciliation_status: "none",
    });
    vi.spyOn(ordersService, "selectManualPayment").mockResolvedValue({
      payment_provider: "manual",
      status: "pending_payment",
    });
    window.history.replaceState(null, "", `/orders/77#access=${token}`);

    render(
      <MemoryRouter initialEntries={[`/orders/77#access=${token}`]}>
        <Routes>
          <Route path="/orders/:orderId" element={<OrderPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("58.50 EUR")).toBeInTheDocument();
    expect(getOrder).toHaveBeenCalledWith("77", token);
    expect(screen.getByRole("button", { name: "Pay online" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Use agreed manual payment" }));
    await waitFor(() =>
      expect(ordersService.selectManualPayment).toHaveBeenCalledWith("77", token),
    );
  });

  it("lets a buyer resume an already selected Stripe checkout after a failed attempt", async () => {
    vi.spyOn(ordersService, "getOrder").mockResolvedValue({
      id: 78,
      status: "pending_payment",
      currency: "EUR",
      subtotal_items: 50,
      delivery_fee: 8.5,
      total_amount: 58.5,
      delivery_eta: "Tomorrow",
      delivery_quote_confirmed_at: "2026-09-06T10:00:00.000Z",
      payment_provider: "stripe",
      payment_reconciliation_status: "none",
    });
    const createOnlinePayment = vi
      .spyOn(ordersService, "createOnlinePayment")
      .mockRejectedValue(new Error("Network unavailable"));
    window.history.replaceState(null, "", "/orders/78");

    render(
      <MemoryRouter initialEntries={["/orders/78"]}>
        <Routes>
          <Route path="/orders/:orderId" element={<OrderPage />} />
        </Routes>
      </MemoryRouter>,
    );

    const resumeButton = await screen.findByRole("button", {
      name: "Continue online payment",
    });
    fireEvent.click(resumeButton);
    await waitFor(() => expect(createOnlinePayment).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("alert")).toHaveTextContent("Network unavailable");

    fireEvent.click(resumeButton);
    await waitFor(() => expect(createOnlinePayment).toHaveBeenCalledTimes(2));
  });
});
