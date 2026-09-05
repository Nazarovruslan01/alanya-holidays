import { beforeEach, describe, expect, it } from "vitest";
import {
  consumeGuestOrderAccessFragment,
  getGuestOrderAccess,
  saveGuestOrderAccess,
} from "./guest-order-access";

describe("guest order access", () => {
  beforeEach(() => window.localStorage.clear());

  it("stores one capability per order and strips it from the visible fragment", () => {
    const first = "a".repeat(43);
    const second = "b".repeat(43);
    window.history.replaceState(null, "", `/orders/41#access=${first}`);

    expect(consumeGuestOrderAccessFragment(41)).toBe(first);
    expect(window.location.hash).toBe("");
    saveGuestOrderAccess(42, second);
    expect(getGuestOrderAccess(41)).toBe(first);
    expect(getGuestOrderAccess(42)).toBe(second);
  });
});
