import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const VALID_ENV = {
    GEMINI_API_KEY: "test-gemini-key",
    GEMINI_MODEL: "gemini-2.5-flash",
    USDA_API_KEY: "test-usda-key",
    SUPABASE_SERVICE_ROLE_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.service_role",
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.anon",
    FOOD_DATABASE_URL: "https://food-ref.supabase.co",
    FOOD_DATABASE_ANON_KEY: "food-ref-anon-key",
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_123",
    CLERK_SECRET_KEY: "sk_test_123",
    NEXT_PUBLIC_CLERK_SIGN_IN_URL: "/sign-in",
  };
  Object.assign(process.env, VALID_ENV);
});

import type { SupabaseClient } from "@supabase/supabase-js";
import { handleAnalyzePost } from "../route";
import type { AIProvider } from "@/lib/ai/provider";

function createMockSupabase(initialUsage: { user_id: string; usage_date: string; count: number }[] = []) {
  const usageStore = [...initialUsage];

  const client = {
    from: vi.fn((table: string) => {
      if (table === "ai_usage") {
        return {
          select: vi.fn(() => ({
            in: vi.fn((_col: string, values: string[]) => ({
              eq: vi.fn((_dateCol: string, dateVal: string) => ({
                data: usageStore.filter(
                  (u) => values.includes(u.user_id) && u.usage_date === dateVal
                ),
                error: null,
              })),
            })),
            eq: vi.fn((_col: string, val: string) => ({
              eq: vi.fn((_dateCol: string, dateVal: string) => ({
                data: usageStore.filter(
                  (u) => u.user_id === val && u.usage_date === dateVal
                ),
                error: null,
              })),
            })),
          })),
          insert: vi.fn((payload: { user_id: string; usage_date: string; count: number }) => {
            usageStore.push(payload);
            return Promise.resolve({ data: [payload], error: null });
          }),
          update: vi.fn((payload: { count: number }) => ({
            eq: vi.fn((_col: string, val: string) => ({
              eq: vi.fn((_dateCol: string, dateVal: string) => {
                const row = usageStore.find(
                  (u) => u.user_id === val && u.usage_date === dateVal
                );
                if (row) {
                  row.count = payload.count;
                }
                return Promise.resolve({ data: row, error: null });
              }),
            })),
          })),
        };
      }
      return {
        select: vi.fn(() => ({
          ilike: vi.fn(() => ({
            data: [],
            error: null,
          })),
        })),
        upsert: vi.fn(() => Promise.resolve({ error: null })),
      };
    }),
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
  } as unknown as SupabaseClient;

  return { client, usageStore };
}

const mockAiProvider: AIProvider = {
  parseMealText: vi.fn().mockResolvedValue([
    {
      display_name: "Oatmeal",
      normalized_name: "oatmeal, cooked",
      quantity_g: 200,
      estimated_macros_per_100g: {
        calories_per_100g: 70,
        protein_per_100g: 2.5,
        carbs_per_100g: 12,
        fat_per_100g: 1.5,
        is_estimated: false,
      },
    },
  ]),
  estimateMacrosPer100g: vi.fn().mockResolvedValue({
    calories_per_100g: 70,
    protein_per_100g: 2.5,
    carbs_per_100g: 12,
    fat_per_100g: 1.5,
    is_estimated: false,
  }),
};

describe("POST /api/analyze — Guest Trial & Anti-Abuse Rate Limiting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("issues a new bw_guest_id cookie to a guest with no existing cookie", async () => {
    const { client } = createMockSupabase();
    const request = new Request("https://example.com/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "200g oatmeal" }),
    });

    const response = await handleAnalyzePost(request, {
      supabase: client,
      aiProvider: mockAiProvider,
      auth: async () => ({ userId: null }),
      now: () => new Date("2026-10-21T12:00:00Z"),
    });

    expect(response.status).toBe(200);
    const setCookie = response.headers.get("Set-Cookie");
    expect(setCookie).toBeDefined();
    expect(setCookie).toContain("bw_guest_id=");
    expect(setCookie).toContain("HttpOnly");
  });

  it("increments guest usage under guest:<uuid> and ip:<hash>", async () => {
    const { client, usageStore } = createMockSupabase();
    const guestUuid = "123e4567-e89b-12d3-a456-426614174000";
    const request = new Request("https://example.com/api/analyze", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `bw_guest_id=${guestUuid}`,
        "x-forwarded-for": "198.51.100.5",
      },
      body: JSON.stringify({ text: "200g oatmeal" }),
    });

    const response = await handleAnalyzePost(request, {
      supabase: client,
      aiProvider: mockAiProvider,
      auth: async () => ({ userId: null }),
      now: () => new Date("2026-10-21T12:00:00Z"),
    });

    expect(response.status).toBe(200);
    const guestRow = usageStore.find((u) => u.user_id === `guest:${guestUuid}`);
    expect(guestRow).toBeDefined();
    expect(guestRow?.count).toBe(1);

    const ipRow = usageStore.find((u) => u.user_id.startsWith("ip:"));
    expect(ipRow).toBeDefined();
    expect(ipRow?.count).toBe(1);
  });

  it("blocks guest when their cookie limit has reached 3 analyses", async () => {
    const guestUuid = "123e4567-e89b-12d3-a456-426614174000";
    const { client } = createMockSupabase([
      {
        user_id: `guest:${guestUuid}`,
        usage_date: "2026-10-21",
        count: 3,
      },
    ]);

    const request = new Request("https://example.com/api/analyze", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `bw_guest_id=${guestUuid}`,
        "x-forwarded-for": "198.51.100.5",
      },
      body: JSON.stringify({ text: "200g oatmeal" }),
    });

    const response = await handleAnalyzePost(request, {
      supabase: client,
      aiProvider: mockAiProvider,
      auth: async () => ({ userId: null }),
      now: () => new Date("2026-10-21T12:00:00Z"),
    });

    expect(response.status).toBe(429);
    const data = (await response.json()) as { error: { code: string; message: string } };
    expect(data.error.code).toBe("GUEST_LIMIT_REACHED");
    expect(data.error.message).toContain("You've used all 3 free guest analyses for today");
  });

  it("blocks guest when their IP limit has reached 5 analyses (preventing Incognito / cookie reset exploit)", async () => {
    const { hashIp } = await import("@/lib/auth/guest");
    const ip = "198.51.100.99";
    const ipHash = hashIp(ip);

    const { client } = createMockSupabase([
      {
        user_id: `ip:${ipHash}`,
        usage_date: "2026-10-21",
        count: 5,
      },
    ]);

    // Fresh guest in Incognito with NO cookie
    const request = new Request("https://example.com/api/analyze", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": ip,
      },
      body: JSON.stringify({ text: "200g oatmeal" }),
    });

    const response = await handleAnalyzePost(request, {
      supabase: client,
      aiProvider: mockAiProvider,
      auth: async () => ({ userId: null }),
      now: () => new Date("2026-10-21T12:00:00Z"),
    });

    expect(response.status).toBe(429);
    const data = (await response.json()) as { error: { code: string; message: string } };
    expect(data.error.code).toBe("GUEST_LIMIT_REACHED");
    expect(data.error.message).toContain("You've used all 3 free guest analyses for today");
  });

  it("allows authenticated user up to 30 analyses and does not apply guest restrictions", async () => {
    const { client } = createMockSupabase([
      {
        user_id: "user_registered123",
        usage_date: "2026-10-21",
        count: 10,
      },
    ]);

    const request = new Request("https://example.com/api/analyze", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: "200g oatmeal" }),
    });

    const response = await handleAnalyzePost(request, {
      supabase: client,
      aiProvider: mockAiProvider,
      auth: async () => ({ userId: "user_registered123" }),
      now: () => new Date("2026-10-21T12:00:00Z"),
    });

    expect(response.status).toBe(200);
  });
});
