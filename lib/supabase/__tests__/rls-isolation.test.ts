import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
  const token = authHeader.slice("Bearer ".length);
  const parts = token.split(".");
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

interface MockMealEntryRow {
  id: string;
  user_id: string;
  logged_on: string;
  meal_type: "breakfast" | "lunch" | "dinner" | "snack";
  food_id: string | null;
  food_name: string;
  quantity_g: number;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  is_estimated: boolean;
  created_at: string;
}

interface MockUserSettingsRow {
  user_id: string;
  calorie_goal: number | null;
  protein_goal_g: number | null;
  carbs_goal_g: number | null;
  fat_goal_g: number | null;
  timezone: string;
  updated_at: string;
}

/**
 * Test-only mock PostgREST fetch harness that enforces the RLS policies
 * declared in `supabase/migrations/0001_initial_schema.sql`:
 *   USING ((auth.jwt() ->> 'sub') = user_id)
 *   WITH CHECK ((auth.jwt() ->> 'sub') = user_id)
 */
function createMockRlsPostgrestHarness(migrationSql: string) {
  const rlsEnabledOnMealEntries =
    /ALTER\s+TABLE\s+(?:public\.)?meal_entries\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(
      migrationSql
    );
  const rlsEnabledOnUserSettings =
    /ALTER\s+TABLE\s+(?:public\.)?user_settings\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(
      migrationSql
    );

  const mealEntries: MockMealEntryRow[] = [
    {
      id: "11111111-1111-4111-8111-111111111111",
      user_id: "user_a",
      logged_on: "2026-10-10",
      meal_type: "breakfast",
      food_id: null,
      food_name: "Oats",
      quantity_g: 100,
      calories: 389,
      protein_g: 16.9,
      carbs_g: 66.3,
      fat_g: 6.9,
      is_estimated: false,
      created_at: "2026-10-10T08:00:00Z",
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      user_id: "user_b",
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
  ];

  const userSettings: MockUserSettingsRow[] = [
    {
      user_id: "user_a",
      calorie_goal: 2000,
      protein_goal_g: 140,
      carbs_goal_g: 200,
      fat_goal_g: 65,
      timezone: "Asia/Kolkata",
      updated_at: "2026-10-10T08:00:00Z",
    },
    {
      user_id: "user_b",
      calorie_goal: 2500,
      protein_goal_g: 180,
      carbs_goal_g: 260,
      fat_goal_g: 80,
      timezone: "UTC",
      updated_at: "2026-10-10T08:00:00Z",
    },
  ];

  const recordedHeaders: Array<{ apikey: string | null; auth: string | null }> =
    [];

  function matchesFilters<T extends object>(
    row: T,
    searchParams: URLSearchParams
  ): boolean {
    for (const [key, rawVal] of searchParams.entries()) {
      if (key === "select" || key === "order" || key === "columns") {
        continue;
      }
      if (rawVal.startsWith("eq.")) {
        const expected = rawVal.slice(3);
        const actual = (row as Record<string, unknown>)[key];
        if (String(actual) !== expected) {
          return false;
        }
      }
    }
    return true;
  }

  const mockFetch: typeof fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? new URL(input)
        : input instanceof URL
          ? input
          : new URL(input.url);
    const headers = new Headers(init?.headers);
    const authHeader = headers.get("Authorization");
    const apikeyHeader = headers.get("apikey");
    recordedHeaders.push({ apikey: apikeyHeader, auth: authHeader });

    const jwtSub = extractJwtSub(authHeader);
    const method = (init?.method ?? "GET").toUpperCase();
    const table = url.pathname.replace(/^\/rest\/v1\//, "");

    const bodyText =
      typeof init?.body === "string"
        ? init.body
        : init?.body
          ? String(init.body)
          : "";
    const parsedBody = bodyText
      ? (JSON.parse(bodyText) as Record<string, unknown>)
      : {};

    if (table === "meal_entries") {
      if (!rlsEnabledOnMealEntries) {
        throw new Error("RLS is not enabled on meal_entries");
      }

      if (method === "GET") {
        const visible = mealEntries.filter(
          (row) =>
            row.user_id === jwtSub && matchesFilters(row, url.searchParams)
        );
        return new Response(JSON.stringify(visible), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (method === "PATCH") {
        const updated: MockMealEntryRow[] = [];
        for (let i = 0; i < mealEntries.length; i += 1) {
          const row = mealEntries[i];
          if (row.user_id === jwtSub && matchesFilters(row, url.searchParams)) {
            const nextRow = {
              ...row,
              ...parsedBody,
            } as MockMealEntryRow;
            if (nextRow.user_id !== jwtSub) {
              return new Response(
                JSON.stringify({
                  code: "42501",
                  message:
                    'new row violates row-level security policy for table "meal_entries"',
                }),
                { status: 403, headers: { "Content-Type": "application/json" } }
              );
            }
            mealEntries[i] = nextRow;
            updated.push(nextRow);
          }
        }
        return new Response(JSON.stringify(updated), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (method === "DELETE") {
        const deleted: MockMealEntryRow[] = [];
        for (let i = mealEntries.length - 1; i >= 0; i -= 1) {
          const row = mealEntries[i];
          if (row.user_id === jwtSub && matchesFilters(row, url.searchParams)) {
            mealEntries.splice(i, 1);
            deleted.push(row);
          }
        }
        return new Response(JSON.stringify(deleted), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    if (table === "user_settings") {
      if (!rlsEnabledOnUserSettings) {
        throw new Error("RLS is not enabled on user_settings");
      }

      if (method === "GET") {
        const visible = userSettings.filter(
          (row) =>
            row.user_id === jwtSub && matchesFilters(row, url.searchParams)
        );
        return new Response(JSON.stringify(visible), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (method === "POST") {
        const targetUserId =
          typeof parsedBody.user_id === "string" ? parsedBody.user_id : jwtSub;
        if (!jwtSub || targetUserId !== jwtSub) {
          return new Response(
            JSON.stringify({
              code: "42501",
              message:
                'new row violates row-level security policy for table "user_settings"',
            }),
            { status: 403, headers: { "Content-Type": "application/json" } }
          );
        }
      }

      if (method === "PATCH") {
        const updated: MockUserSettingsRow[] = [];
        for (let i = 0; i < userSettings.length; i += 1) {
          const row = userSettings[i];
          if (row.user_id === jwtSub && matchesFilters(row, url.searchParams)) {
            const nextRow = {
              ...row,
              ...parsedBody,
            } as MockUserSettingsRow;
            if (nextRow.user_id !== jwtSub) {
              return new Response(
                JSON.stringify({
                  code: "42501",
                  message:
                    'new row violates row-level security policy for table "user_settings"',
                }),
                { status: 403, headers: { "Content-Type": "application/json" } }
              );
            }
            userSettings[i] = nextRow;
            updated.push(nextRow);
          }
        }
        return new Response(JSON.stringify(updated), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (method === "DELETE") {
        const deleted: MockUserSettingsRow[] = [];
        for (let i = userSettings.length - 1; i >= 0; i -= 1) {
          const row = userSettings[i];
          if (row.user_id === jwtSub && matchesFilters(row, url.searchParams)) {
            userSettings.splice(i, 1);
            deleted.push(row);
          }
        }
        return new Response(JSON.stringify(deleted), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  return {
    mockFetch,
    mealEntries,
    userSettings,
    recordedHeaders,
  };
}

describe("02 — Supabase Schema Migration, Dual Clients & RLS Isolation", () => {
  const migrationPath = path.resolve(
    process.cwd(),
    "supabase/migrations/0001_initial_schema.sql"
  );

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...process.env, ...VALID_ENV };
  });

  it("migration file creates foods, meal_entries, user_settings, and ai_usage with RLS enabled and never disabled", () => {
    const sql = fs.readFileSync(migrationPath, "utf8");

    expect(sql).toMatch(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?foods/i);
    expect(sql).toMatch(
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?meal_entries/i
    );
    expect(sql).toMatch(
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?user_settings/i
    );
    expect(sql).toMatch(
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?ai_usage/i
    );
    expect(sql).toMatch(
      /CREATE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?idx_meal_entries_user_date\s+ON\s+(?:public\.)?meal_entries\s*\(\s*user_id\s*,\s*logged_on\s*\)/i
    );

    expect(sql).toMatch(
      /ALTER\s+TABLE\s+(?:public\.)?foods\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i
    );
    expect(sql).toMatch(
      /ALTER\s+TABLE\s+(?:public\.)?meal_entries\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i
    );
    expect(sql).toMatch(
      /ALTER\s+TABLE\s+(?:public\.)?user_settings\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i
    );
    expect(sql).toMatch(
      /ALTER\s+TABLE\s+(?:public\.)?ai_usage\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i
    );

    expect(sql).not.toMatch(/DISABLE\s+ROW\s+LEVEL\s+SECURITY/i);

    expect(sql).toMatch(
      /ON\s+(?:public\.)?meal_entries\s+FOR\s+ALL\s+TO\s+authenticated\s+USING\s*\(\s*\(auth\.jwt\(\)\s*->>\s*'sub'\)\s*=\s*user_id\s*\)\s+WITH\s+CHECK\s*\(\s*\(auth\.jwt\(\)\s*->>\s*'sub'\)\s*=\s*user_id\s*\)/i
    );
    expect(sql).toMatch(
      /ON\s+(?:public\.)?user_settings\s+FOR\s+ALL\s+TO\s+authenticated\s+USING\s*\(\s*\(auth\.jwt\(\)\s*->>\s*'sub'\)\s*=\s*user_id\s*\)\s+WITH\s+CHECK\s*\(\s*\(auth\.jwt\(\)\s*->>\s*'sub'\)\s*=\s*user_id\s*\)/i
    );
  });

  it("User A cannot SELECT User B's meal_entries", async () => {
    const sql = fs.readFileSync(migrationPath, "utf8");
    const harness = createMockRlsPostgrestHarness(sql);
    const { createUserSupabaseClient } = await import("@/lib/supabase/user");

    const userAClient = createUserSupabaseClient({
      accessToken: async () => createMockClerkJwt("user_a"),
      fetch: harness.mockFetch,
    });

    const { data: allVisible, error } = await userAClient
      .from("meal_entries")
      .select("*");

    expect(error).toBeNull();
    expect(allVisible).toHaveLength(1);
    expect(allVisible?.[0]?.user_id).toBe("user_a");

    const { data: userBEntry } = await userAClient
      .from("meal_entries")
      .select("*")
      .eq("id", "22222222-2222-4222-8222-222222222222");

    expect(userBEntry).toEqual([]);
  });

  it("User A cannot UPDATE User B's meal_entries", async () => {
    const sql = fs.readFileSync(migrationPath, "utf8");
    const harness = createMockRlsPostgrestHarness(sql);
    const { createUserSupabaseClient } = await import("@/lib/supabase/user");

    const userAClient = createUserSupabaseClient({
      accessToken: async () => createMockClerkJwt("user_a"),
      fetch: harness.mockFetch,
    });

    const { data: updatedRows, error } = await userAClient
      .from("meal_entries")
      .update({ quantity_g: 999 })
      .eq("id", "22222222-2222-4222-8222-222222222222")
      .select("*");

    expect(error).toBeNull();
    expect(updatedRows).toEqual([]);
    expect(
      harness.mealEntries.find(
        (r) => r.id === "22222222-2222-4222-8222-222222222222"
      )?.quantity_g
    ).toBe(300);
  });

  it("User A cannot DELETE User B's meal_entries", async () => {
    const sql = fs.readFileSync(migrationPath, "utf8");
    const harness = createMockRlsPostgrestHarness(sql);
    const { createUserSupabaseClient } = await import("@/lib/supabase/user");

    const userAClient = createUserSupabaseClient({
      accessToken: async () => createMockClerkJwt("user_a"),
      fetch: harness.mockFetch,
    });

    const { data: deletedRows, error } = await userAClient
      .from("meal_entries")
      .delete()
      .eq("id", "22222222-2222-4222-8222-222222222222")
      .select("*");

    expect(error).toBeNull();
    expect(deletedRows).toEqual([]);
    expect(
      harness.mealEntries.find(
        (r) => r.id === "22222222-2222-4222-8222-222222222222"
      )
    ).toBeDefined();
  });

  it("User A cannot access (SELECT, UPDATE, DELETE, or INSERT for) User B's user_settings", async () => {
    const sql = fs.readFileSync(migrationPath, "utf8");
    const harness = createMockRlsPostgrestHarness(sql);
    const { createUserSupabaseClient } = await import("@/lib/supabase/user");

    const userAClient = createUserSupabaseClient({
      accessToken: async () => createMockClerkJwt("user_a"),
      fetch: harness.mockFetch,
    });

    const { data: selectedB } = await userAClient
      .from("user_settings")
      .select("*")
      .eq("user_id", "user_b");
    expect(selectedB).toEqual([]);

    const { data: updatedB } = await userAClient
      .from("user_settings")
      .update({ calorie_goal: 1200 })
      .eq("user_id", "user_b")
      .select("*");
    expect(updatedB).toEqual([]);
    expect(
      harness.userSettings.find((s) => s.user_id === "user_b")?.calorie_goal
    ).toBe(2500);

    const { data: deletedB } = await userAClient
      .from("user_settings")
      .delete()
      .eq("user_id", "user_b")
      .select("*");
    expect(deletedB).toEqual([]);
    expect(
      harness.userSettings.find((s) => s.user_id === "user_b")
    ).toBeDefined();

    const { error: insertBError } = await userAClient
      .from("user_settings")
      .insert({ user_id: "user_b", calorie_goal: 1500, timezone: "UTC" });
    expect(insertBError).not.toBeNull();
  });

  it("createServiceSupabaseClient uses SUPABASE_SERVICE_ROLE_KEY for foods and ai_usage", async () => {
    const sql = fs.readFileSync(migrationPath, "utf8");
    const harness = createMockRlsPostgrestHarness(sql);
    const { createServiceSupabaseClient } = await import(
      "@/lib/supabase/service"
    );

    const serviceClient = createServiceSupabaseClient({
      fetch: harness.mockFetch,
    });

    await serviceClient.from("foods").select("*");

    expect(harness.recordedHeaders[0]).toEqual({
      apikey: VALID_ENV.SUPABASE_SERVICE_ROLE_KEY,
      auth: `Bearer ${VALID_ENV.SUPABASE_SERVICE_ROLE_KEY}`,
    });
  });
});

