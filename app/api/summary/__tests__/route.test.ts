import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MealEntryRow, UserSettingsRow } from "@/lib/supabase/user";

const mockRequireAuth = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireAuth: () => mockRequireAuth(),
}));

const VALID_ENV = {
  GEMINI_API_KEY: "test-gemini-key",
  GEMINI_MODEL: "gemini-2.5-flash",
  USDA_API_KEY: "test-usda-key",
  SUPABASE_SERVICE_ROLE_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.service_role",
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.anon",
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_123",
  CLERK_SECRET_KEY: "sk_test_123",
  NEXT_PUBLIC_CLERK_SIGN_IN_URL: "/sign-in",
};

function createMockClerkJwt(sub: string): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" })
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ sub, role: "authenticated" })
  ).toString("base64url");
  return `${header}.${payload}.mock_signature`;
}

function extractJwtSub(authHeader: string | null): string | null {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }
  const parts = authHeader.slice("Bearer ".length).split(".");
  if (parts.length !== 3) {
    return null;
  }
  try {
    const decoded = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8")
    ) as { sub?: unknown };
    return typeof decoded.sub === "string" ? decoded.sub : null;
  } catch {
    return null;
  }
}

function createMockSummaryAndSettingsFetch(options?: {
  initialEntries?: MealEntryRow[];
  initialSettings?: UserSettingsRow[];
}) {
  const entries: MealEntryRow[] = [...(options?.initialEntries ?? [])];
  const settings: UserSettingsRow[] = [...(options?.initialSettings ?? [])];

  const mockFetch: typeof fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? new URL(input)
        : input instanceof URL
          ? input
          : new URL(input.url);
    const headers = new Headers(init?.headers);
    const jwtSub = extractJwtSub(headers.get("Authorization"));
    const method = (init?.method ?? "GET").toUpperCase();

    if (url.pathname.endsWith("/rest/v1/meal_entries")) {
      if (method === "GET") {
        const loggedOnEq = url.searchParams.get("logged_on");
        const targetDate = loggedOnEq?.startsWith("eq.")
          ? loggedOnEq.slice(3)
          : null;
        const visible = entries
          .filter(
            (row) =>
              row.user_id === jwtSub &&
              (!targetDate || row.logged_on === targetDate)
          )
          .sort((a, b) => a.created_at.localeCompare(b.created_at));
        return new Response(JSON.stringify(visible), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    if (url.pathname.endsWith("/rest/v1/user_settings")) {
      if (method === "GET") {
        const visible = settings.filter((row) => row.user_id === jwtSub);
        return new Response(JSON.stringify(visible), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (method === "POST") {
        const bodyText = typeof init?.body === "string" ? init.body : "{}";
        const payload = JSON.parse(bodyText) as Partial<UserSettingsRow>;
        const targetUserId = payload.user_id ?? jwtSub ?? "";
        const row: UserSettingsRow = {
          user_id: targetUserId,
          calorie_goal: payload.calorie_goal ?? null,
          protein_goal_g: payload.protein_goal_g ?? null,
          carbs_goal_g: payload.carbs_goal_g ?? null,
          fat_goal_g: payload.fat_goal_g ?? null,
          timezone: payload.timezone ?? "UTC",
          updated_at: "2026-10-10T12:00:00Z",
        };
        const idx = settings.findIndex((s) => s.user_id === targetUserId);
        if (idx >= 0) {
          settings[idx] = row;
        } else {
          settings.push(row);
        }
        return new Response(JSON.stringify([row]), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  return { mockFetch, entries, settings };
}

describe("07 — Daily Summary & User Settings API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...process.env, ...VALID_ENV };
  });

  it("GET /api/settings returns default null goals and UTC timezone when no row exists", async () => {
    mockRequireAuth.mockResolvedValueOnce("user_a");
    const { createUserSupabaseClient } = await import("@/lib/supabase/user");
    const { handleGetSettings } = await import("@/app/api/settings/route");

    const dbHarness = createMockSummaryAndSettingsFetch();
    const userClient = createUserSupabaseClient({
      accessToken: async () => createMockClerkJwt("user_a"),
      fetch: dbHarness.mockFetch,
    });

    const res = await handleGetSettings({ supabase: userClient });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { settings: Record<string, unknown> };
    expect(body).toEqual({
      settings: {
        calorie_goal: null,
        protein_goal_g: null,
        carbs_goal_g: null,
        fat_goal_g: null,
        timezone: "UTC",
      },
    });
  });

  it("PUT /api/settings upserts calorie/macro goals and timezone and returns 200", async () => {
    mockRequireAuth.mockResolvedValueOnce("user_a");
    const { createUserSupabaseClient } = await import("@/lib/supabase/user");
    const { handlePutSettings } = await import("@/app/api/settings/route");

    const dbHarness = createMockSummaryAndSettingsFetch();
    const userClient = createUserSupabaseClient({
      accessToken: async () => createMockClerkJwt("user_a"),
      fetch: dbHarness.mockFetch,
    });

    const req = new Request("https://example.com/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        calorie_goal: 2000,
        protein_goal_g: 140,
        carbs_goal_g: 220,
        fat_goal_g: 65,
        timezone: "Asia/Kolkata",
      }),
    });

    const res = await handlePutSettings(req, { supabase: userClient });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { settings: Record<string, unknown> };
    expect(body).toEqual({
      settings: {
        calorie_goal: 2000,
        protein_goal_g: 140,
        carbs_goal_g: 220,
        fat_goal_g: 65,
        timezone: "Asia/Kolkata",
      },
    });
    expect(dbHarness.settings).toHaveLength(1);
    expect(dbHarness.settings[0].user_id).toBe("user_a");
  });

  it("GET /api/summary?date=YYYY-MM-DD returns entries, summed totals, and goals for the authenticated user only", async () => {
    mockRequireAuth.mockResolvedValueOnce("user_a");
    const { createUserSupabaseClient } = await import("@/lib/supabase/user");
    const { handleGetSummary } = await import("@/app/api/summary/route");

    const dbHarness = createMockSummaryAndSettingsFetch({
      initialEntries: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          user_id: "user_a",
          logged_on: "2026-10-10",
          meal_type: "breakfast",
          food_id: null,
          food_name: "Boiled Eggs",
          quantity_g: 100,
          calories: 155,
          protein_g: 12.6,
          carbs_g: 1.1,
          fat_g: 10.6,
          is_estimated: false,
          created_at: "2026-10-10T08:00:00Z",
        },
        {
          id: "22222222-2222-4222-8222-222222222222",
          user_id: "user_a",
          logged_on: "2026-10-10",
          meal_type: "lunch",
          food_id: null,
          food_name: "Dal Tadka",
          quantity_g: 300,
          calories: 330,
          protein_g: 16.5,
          carbs_g: 42,
          fat_g: 10.5,
          is_estimated: true,
          created_at: "2026-10-10T13:00:00Z",
        },
        {
          id: "33333333-3333-4333-8333-333333333333",
          user_id: "user_b",
          logged_on: "2026-10-10",
          meal_type: "lunch",
          food_id: null,
          food_name: "Other User Meal",
          quantity_g: 500,
          calories: 999,
          protein_g: 99,
          carbs_g: 99,
          fat_g: 99,
          is_estimated: false,
          created_at: "2026-10-10T13:00:00Z",
        },
      ],
      initialSettings: [
        {
          user_id: "user_a",
          calorie_goal: 2000,
          protein_goal_g: 140,
          carbs_goal_g: 220,
          fat_goal_g: 65,
          timezone: "Asia/Kolkata",
          updated_at: "2026-10-10T08:00:00Z",
        },
      ],
    });
    const userClient = createUserSupabaseClient({
      accessToken: async () => createMockClerkJwt("user_a"),
      fetch: dbHarness.mockFetch,
    });

    const req = new Request(
      "https://example.com/api/summary?date=2026-10-10"
    );
    const res = await handleGetSummary(req, { supabase: userClient });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      date: string;
      entries: MealEntryRow[];
      totals: Record<string, number>;
      goals: Record<string, unknown>;
    };
    expect(body.date).toBe("2026-10-10");
    expect(body.entries).toHaveLength(2);
    expect(body.totals).toEqual({
      calories: 485,
      protein_g: 29.1,
      carbs_g: 43.1,
      fat_g: 21.1,
    });
    expect(body.goals).toEqual({
      calorie_goal: 2000,
      protein_goal_g: 140,
      carbs_goal_g: 220,
      fat_goal_g: 65,
      timezone: "Asia/Kolkata",
    });
  });

  it("GET /api/summary returns empty entries and zero totals for an empty day", async () => {
    mockRequireAuth.mockResolvedValueOnce("user_a");
    const { createUserSupabaseClient } = await import("@/lib/supabase/user");
    const { handleGetSummary } = await import("@/app/api/summary/route");

    const dbHarness = createMockSummaryAndSettingsFetch();
    const userClient = createUserSupabaseClient({
      accessToken: async () => createMockClerkJwt("user_a"),
      fetch: dbHarness.mockFetch,
    });

    const req = new Request(
      "https://example.com/api/summary?date=2026-10-11"
    );
    const res = await handleGetSummary(req, { supabase: userClient });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({
      date: "2026-10-11",
      entries: [],
      totals: {
        calories: 0,
        protein_g: 0,
        carbs_g: 0,
        fat_g: 0,
      },
      goals: {
        calorie_goal: null,
        protein_goal_g: null,
        carbs_goal_g: null,
        fat_goal_g: null,
        timezone: "UTC",
      },
    });
  });

  it("returns 400 on missing or invalid date param or invalid settings payload, and 401 when unauthenticated", async () => {
    mockRequireAuth.mockResolvedValue("user_a");
    const { handleGetSummary } = await import("@/app/api/summary/route");
    const { handlePutSettings, handleGetSettings } = await import(
      "@/app/api/settings/route"
    );

    const missingDateRes = await handleGetSummary(
      new Request("https://example.com/api/summary")
    );
    expect(missingDateRes.status).toBe(400);

    const invalidDateRes = await handleGetSummary(
      new Request("https://example.com/api/summary?date=10-10-2026")
    );
    expect(invalidDateRes.status).toBe(400);

    const invalidSettingsRes = await handlePutSettings(
      new Request("https://example.com/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          calorie_goal: -100,
          protein_goal_g: null,
          carbs_goal_g: null,
          fat_goal_g: null,
          timezone: "UTC",
        }),
      })
    );
    expect(invalidSettingsRes.status).toBe(400);

    mockRequireAuth.mockResolvedValueOnce(
      NextResponse.json(
        { error: { code: "UNAUTHORIZED", message: "Authentication required" } },
        { status: 401 }
      )
    );
    const unauthRes = await handleGetSettings();
    expect(unauthRes.status).toBe(401);
  });

  it("returns 502 UPSTREAM_ERROR when Supabase queries fail in GET /api/summary or GET/PUT /api/settings", async () => {
    mockRequireAuth.mockResolvedValue("user_a");
    const { createUserSupabaseClient } = await import("@/lib/supabase/user");
    const { handleGetSummary } = await import("@/app/api/summary/route");
    const { handleGetSettings, handlePutSettings } = await import(
      "@/app/api/settings/route"
    );

    const failingFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({ message: "Database error", code: "42P01" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );

    const failingClient = createUserSupabaseClient({
      accessToken: async () => createMockClerkJwt("user_a"),
      fetch: failingFetch,
    });

    const summaryRes = await handleGetSummary(
      new Request("https://example.com/api/summary?date=2026-10-10"),
      { supabase: failingClient }
    );
    expect(summaryRes.status).toBe(502);
    const summaryErr = (await summaryRes.json()) as {
      error: { code: string };
    };
    expect(summaryErr.error.code).toBe("UPSTREAM_ERROR");

    const getSettingsRes = await handleGetSettings({
      supabase: failingClient,
    });
    expect(getSettingsRes.status).toBe(502);

    const putSettingsRes = await handlePutSettings(
      new Request("https://example.com/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          calorie_goal: 2000,
          protein_goal_g: 140,
          carbs_goal_g: 220,
          fat_goal_g: 65,
          timezone: "Asia/Kolkata",
        }),
      }),
      { supabase: failingClient }
    );
    expect(putSettingsRes.status).toBe(502);
  });
});

