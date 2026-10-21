import { describe, expect, it } from "vitest";
import {
  buildGuestCookieHeader,
  buildGuestUserId,
  buildIpUserId,
  generateGuestId,
  getClientIp,
  getGuestIdFromCookie,
  GUEST_COOKIE_NAME,
  GUEST_DAILY_LIMIT,
  GUEST_IP_DAILY_LIMIT,
  hashIp,
  isValidGuestId,
  parseCookies,
} from "../guest";

describe("lib/auth/guest", () => {
  it("defines locked guest limits", () => {
    expect(GUEST_DAILY_LIMIT).toBe(3);
    expect(GUEST_IP_DAILY_LIMIT).toBe(5);
  });

  it("parses cookies properly", () => {
    expect(parseCookies(null)).toEqual({});
    expect(parseCookies("")).toEqual({});
    expect(parseCookies("a=1; b=hello%20world")).toEqual({
      a: "1",
      b: "hello%20world",
    });
  });

  it("validates and extracts guestId from cookie", () => {
    const validUuid = "123e4567-e89b-12d3-a456-426614174000";
    expect(isValidGuestId(validUuid)).toBe(true);
    expect(isValidGuestId("invalid-uuid")).toBe(false);

    expect(
      getGuestIdFromCookie(`${GUEST_COOKIE_NAME}=${validUuid}; other=value`)
    ).toBe(validUuid);
    expect(getGuestIdFromCookie(`${GUEST_COOKIE_NAME}=invalid`)).toBeNull();
    expect(getGuestIdFromCookie("other=value")).toBeNull();
  });

  it("generates a valid UUID for new guests", () => {
    const id = generateGuestId();
    expect(isValidGuestId(id)).toBe(true);
  });

  it("extracts client IP with priority to x-forwarded-for first hop", () => {
    const headers1 = new Headers({
      "x-forwarded-for": "203.0.113.195, 70.41.3.18, 150.172.238.178",
      "x-real-ip": "70.41.3.18",
    });
    expect(getClientIp(headers1)).toBe("203.0.113.195");

    const headers2 = new Headers({
      "x-real-ip": "198.51.100.1",
    });
    expect(getClientIp(headers2)).toBe("198.51.100.1");

    const headers3 = new Headers({
      "cf-connecting-ip": "198.51.100.2",
    });
    expect(getClientIp(headers3)).toBe("198.51.100.2");

    const headersEmpty = new Headers();
    expect(getClientIp(headersEmpty)).toBe("127.0.0.1");
  });

  it("hashes IP address consistently with SHA-256 slice", () => {
    const ip = "203.0.113.195";
    const hash1 = hashIp(ip);
    const hash2 = hashIp(ip);
    expect(hash1).toBe(hash2);
    expect(hash1.length).toBe(32);
    expect(hashIp("203.0.113.196")).not.toBe(hash1);
  });

  it("builds prefixed user IDs for ai_usage", () => {
    expect(buildGuestUserId("uuid-123")).toBe("guest:uuid-123");
    expect(buildIpUserId("hash-abc")).toBe("ip:hash-abc");
  });

  it("builds valid HttpOnly Set-Cookie header", () => {
    const header = buildGuestCookieHeader("test-uuid", true);
    expect(header).toContain("bw_guest_id=test-uuid");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Secure");
    expect(header).toContain("Path=/");
  });
});

