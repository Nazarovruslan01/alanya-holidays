import { describe, expect, it } from "vitest";
import { getOrderRequestAttempt } from "./order-request-attempt";

describe("getOrderRequestAttempt", () => {
  it("reuses one request ID only for the same owner and logical payload", () => {
    const payload = { currency: "EUR", items: [{ productId: "gift-1", quantity: 1 }] };
    const first = getOrderRequestAttempt(null, "customer-1", payload);

    expect(getOrderRequestAttempt(first, "customer-1", { ...payload })).toBe(first);
    expect(getOrderRequestAttempt(first, "customer-2", payload).requestId).not.toBe(
      first.requestId,
    );
    expect(
      getOrderRequestAttempt(first, "customer-1", {
        ...payload,
        items: [{ productId: "gift-1", quantity: 2 }],
      }).requestId,
    ).not.toBe(first.requestId);
    expect(first.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(first.guestAccessToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(
      getOrderRequestAttempt(first, "customer-2", payload).guestAccessToken,
    ).not.toBe(first.guestAccessToken);
  });
});
