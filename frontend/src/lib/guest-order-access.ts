import { safeStorage } from "@/lib/storage";

const KEY_PREFIX = "guest-order-access:";

export function isGuestOrderAccessToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

export function saveGuestOrderAccess(orderId: string | number, token: string): void {
  if (isGuestOrderAccessToken(token)) safeStorage.set(`${KEY_PREFIX}${orderId}`, token);
}

export function getGuestOrderAccess(orderId: string | number): string | null {
  const token = safeStorage.get<string | null>(`${KEY_PREFIX}${orderId}`, null);
  return isGuestOrderAccessToken(token) ? token : null;
}

export function consumeGuestOrderAccessFragment(orderId: string | number): string | null {
  if (typeof window === "undefined") return null;
  const token = new URLSearchParams(window.location.hash.slice(1)).get("access");
  if (!isGuestOrderAccessToken(token)) return getGuestOrderAccess(orderId);
  saveGuestOrderAccess(orderId, token);
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  return token;
}

export function createGuestOrderStatusLink(orderId: string | number, token: string): string {
  return `${window.location.origin}/orders/${orderId}#access=${token}`;
}
