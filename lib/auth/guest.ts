import { createHash, randomUUID } from "node:crypto";

export const GUEST_COOKIE_NAME = "bw_guest_id";
export const GUEST_DAILY_LIMIT = 3;
export const GUEST_IP_DAILY_LIMIT = 5;
export const AUTHENTICATED_DAILY_LIMIT = 30;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseCookies(cookieHeader: string | null): Record<string, string> {
  if (!cookieHeader) return {};
  const cookies: Record<string, string> = {};
  const pairs = cookieHeader.split(";");
  for (const pair of pairs) {
    const [rawKey, ...valParts] = pair.trim().split("=");
    if (rawKey) {
      cookies[rawKey.trim()] = valParts.join("=").trim();
    }
  }
  return cookies;
}

export function isValidGuestId(guestId: string): boolean {
  return UUID_REGEX.test(guestId);
}

export function getGuestIdFromCookie(cookieHeader: string | null): string | null {
  const cookies = parseCookies(cookieHeader);
  const guestId = cookies[GUEST_COOKIE_NAME];
  if (guestId && isValidGuestId(guestId)) {
    return guestId;
  }
  return null;
}

export function generateGuestId(): string {
  return randomUUID();
}

export function getClientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }

  const realIp = headers.get("x-real-ip");
  if (realIp?.trim()) {
    return realIp.trim();
  }

  const cfConnectingIp = headers.get("cf-connecting-ip");
  if (cfConnectingIp?.trim()) {
    return cfConnectingIp.trim();
  }

  return "127.0.0.1";
}

export function hashIp(ip: string): string {
  return createHash("sha256").update(ip).digest("hex").slice(0, 32);
}

export function buildGuestUserId(guestId: string): string {
  return `guest:${guestId}`;
}

export function buildIpUserId(ipHash: string): string {
  return `ip:${ipHash}`;
}

export function buildGuestCookieHeader(
  guestId: string,
  isSecure = process.env.NODE_ENV === "production"
): string {
  const maxAge = 60 * 60 * 24 * 365; // 1 year
  const secureFlag = isSecure ? "; Secure" : "";
  return `${GUEST_COOKIE_NAME}=${guestId}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secureFlag}`;
}

