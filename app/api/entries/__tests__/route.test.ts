import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MealEntryRow } from "@/lib/supabase/user";

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

function createMockEntriesRlsFetch(initialEntries: MealEntryRow[] = []) {
  const entries: MealEntryRow[] = [...initialEntries];

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

    if (!url.pathname.endsWith("/rest/v1/meal_entries")) {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const eqId = url.searchParams.get("id");
    const targetId = eqId?.startsWith("eq.") ? eqId.slice(3) : null;

    if (method === "GET") {
      const visible = entries.filter(
        (row) => row.user_id === jwtSub && (!targetId || row.id === targetId)
      );
      return new Response(JSON.stringify(visible), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (method === "POST") {
      const bodyText = typeof init?.body === "string" ? init.body : "[]";
      const parsed = JSON.parse(bodyText) as
        | Array<Partial<MealEntryRow>>
        | Partial<MealEntryRow>;
      const rawItems = Array.isArray(parsed) ? parsed : [parsed];
      const inserted: MealEntryRow[] = rawItems.map((item, idx) => {
        const newRow: MealEntryRow = {
          id:
            item.id ??
            `00000000-0000-4000-8000-00000000000${entries.length + idx + 1}`,
          user_id: item.user_id ?? jwtSub ?? "",
          logged_on: item.logged_on ?? "2026-10-10",
          meal_type: item.meal_type ?? "lunch",
          food_id: item.food_id ?? null,
          food_name: item.food_name ?? "",
          quantity_g: Number(item.quantity_g ?? 0),
          calories: Number(item.calories ?? 0),
          protein_g: Number(item.protein_g ?? 0),
          carbs_g: Number(item.carbs_g ?? 0),
          fat_g: Number(item.fat_g ?? 0),
          is_estimated: Boolean(item.is_estimated),
          created_at: "2026-10-10T12:00:00Z",
        };
        entries.push(newRow);
        return newRow;
      });
      return new Response(JSON.stringify(inserted), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (method === "PATCH") {
      const bodyText = typeof init?.body === "string" ? init.body : "{}";
      const patch = JSON.parse(bodyText) as Partial<MealEntryRow>;
      const updated: MealEntryRow[] = [];
      for (let i = 0; i < entries.length; i += 1) {
        const row = entries[i];
        if (row.user_id === jwtSub && (!targetId || row.id === targetId)) {
          const nextRow: MealEntryRow = {
            ...row,
            ...patch,
          };
          entries[i] = nextRow;
          updated.push(nextRow);
        }
      }
      return new Response(JSON.stringify(updated), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (method === "DELETE") {
      const deleted: MealEntryRow[] = [];
      for (let i = entries.length - 1; i >= 0; i -= 1) {
        const row = entries[i];
        if (row.user_id === jwtSub && (!targetId || row.id === targetId)) {
          entries.splice(i, 1);
          deleted.push(row);
        }
      }
      return new Response(JSON.stringify(deleted), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  return { mockFetch, entries };
}

describe("06 — Meal Entries CRUD API (/api/entries & /api/entries/:id)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...process.env, ...VALID_ENV };
  });

  it("POST /api/entries inserts a batch of meal items via user-scoped RLS client and returns 201", async () => {
    mockRequireAuth.mockResolvedValueOnce("user_a");
    const { createUserSupabaseClient } = await import("@/lib/supabase/user");
    const { handleCreateEntries } = await import("@/app/api/entries/route");

    const dbHarness = createMockEntriesRlsFetch();
    const userClient = createUserSupabaseClient({
      accessToken: async () => createMockClerkJwt("user_a"),
      fetch: dbHarness.mockFetch,
    });

    const req = new Request("https://example.com/api/entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        logged_on: "2026-10-10",
        meal_type: "lunch",
        items: [
          {
            food_id: "11111111-1111-4111-8111-111111111111",
            food_name: "Dal Tadka",
            quantity_g: 300,
            calories: 330,
            protein_g: 16.5,
            carbs_g: 42,
            fat_g: 10.5,
            is_estimated: true,
          },
        ],
      }),
    });

    const res = await handleCreateEntries(req, { supabase: userClient });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { entries: MealEntryRow[] };
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]).toMatchObject({
      user_id: "user_a",
      logged_on: "2026-10-10",
      meal_type: "lunch",
      food_id: "11111111-1111-4111-8111-111111111111",
      food_name: "Dal Tadka",
      quantity_g: 300,
      calories: 330,
      protein_g: 16.5,
      carbs_g: 42,
      fat_g: 10.5,
      is_estimated: true,
    });
  });

  it("PATCH /api/entries/:id updates quantity_g and proportionally rescales macros", async () => {
    mockRequireAuth.mockResolvedValueOnce("user_a");
    const { createUserSupabaseClient } = await import("@/lib/supabase/user");
    const { handlePatchEntry } = await import("@/app/api/entries/[id]/route");

    const entryId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const dbHarness = createMockEntriesRlsFetch([
      {
        id: entryId,
        user_id: "user_a",
        logged_on: "2026-10-10",
        meal_type: "lunch",
        food_id: "11111111-1111-4111-8111-111111111111",
        food_name: "Dal Tadka",
        quantity_g: 300,
        calories: 330,
        protein_g: 16.5,
        carbs_g: 42,
        fat_g: 10.5,
        is_estimated: true,
        created_at: "2026-10-10T12:00:00Z",
      },
    ]);
    const userClient = createUserSupabaseClient({
      accessToken: async () => createMockClerkJwt("user_a"),
      fetch: dbHarness.mockFetch,
    });

    const req = new Request(`https://example.com/api/entries/${entryId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quantity_g: 150 }),
    });

    const res = await handlePatchEntry(req, entryId, { supabase: userClient });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { entry: MealEntryRow };
    expect(body.entry).toMatchObject({
      id: entryId,
      quantity_g: 150,
      calories: 165,
      protein_g: 8.25,
      carbs_g: 21,
      fat_g: 5.25,
    });
  });

  it("DELETE /api/entries/:id deletes the entry and returns 200", async () => {
    mockRequireAuth.mockResolvedValueOnce("user_a");
    const { createUserSupabaseClient } = await import("@/lib/supabase/user");
    const { handleDeleteEntry } = await import("@/app/api/entries/[id]/route");

    const entryId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const dbHarness = createMockEntriesRlsFetch([
      {
        id: entryId,
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
        created_at: "2026-10-10T12:00:00Z",
      },
    ]);
    const userClient = createUserSupabaseClient({
      accessToken: async () => createMockClerkJwt("user_a"),
      fetch: dbHarness.mockFetch,
    });

    const res = await handleDeleteEntry(entryId, { supabase: userClient });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { deleted: boolean };
    expect(body).toEqual({ deleted: true });
    expect(dbHarness.entries).toHaveLength(0);
  });

  it("returns 404 when attempting to PATCH or DELETE a non-existent or another user's entry", async () => {
    mockRequireAuth.mockResolvedValue("user_a");
    const { createUserSupabaseClient } = await import("@/lib/supabase/user");
    const { handlePatchEntry, handleDeleteEntry } = await import(
      "@/app/api/entries/[id]/route"
    );

    const userBEntryId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const missingId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const dbHarness = createMockEntriesRlsFetch([
      {
        id: userBEntryId,
        user_id: "user_b",
        logged_on: "2026-10-10",
        meal_type: "dinner",
        food_id: null,
        food_name: "Paneer",
        quantity_g: 200,
        calories: 500,
        protein_g: 36,
        carbs_g: 6,
        fat_g: 40,
        is_estimated: false,
        created_at: "2026-10-10T19:00:00Z",
      },
    ]);
    const userAClient = createUserSupabaseClient({
      accessToken: async () => createMockClerkJwt("user_a"),
      fetch: dbHarness.mockFetch,
    });

    const patchOtherUserRes = await handlePatchEntry(
      new Request(`https://example.com/api/entries/${userBEntryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantity_g: 100 }),
      }),
      userBEntryId,
      { supabase: userAClient }
    );
    expect(patchOtherUserRes.status).toBe(404);

    const deleteOtherUserRes = await handleDeleteEntry(userBEntryId, {
      supabase: userAClient,
    });
    expect(deleteOtherUserRes.status).toBe(404);
    expect(dbHarness.entries).toHaveLength(1);

    const deleteMissingRes = await handleDeleteEntry(missingId, {
      supabase: userAClient,
    });
    expect(deleteMissingRes.status).toBe(404);
  });

  it("returns 400 on malformed input and 401 when unauthenticated", async () => {
    mockRequireAuth.mockResolvedValue("user_a");
    const { handleCreateEntries } = await import("@/app/api/entries/route");
    const { handlePatchEntry, handleDeleteEntry } = await import(
      "@/app/api/entries/[id]/route"
    );

    const invalidPostRes = await handleCreateEntries(
      new Request("https://example.com/api/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          logged_on: "not-a-date",
          meal_type: "lunch",
          items: [],
        }),
      })
    );
    expect(invalidPostRes.status).toBe(400);

    const invalidPatchRes = await handlePatchEntry(
      new Request(
        "https://example.com/api/entries/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ quantity_g: -10 }),
        }
      ),
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    );
    expect(invalidPatchRes.status).toBe(400);

    const invalidDeleteIdRes = await handleDeleteEntry("not-a-uuid");
    expect(invalidDeleteIdRes.status).toBe(400);

    mockRequireAuth.mockResolvedValueOnce(
      NextResponse.json(
        { error: { code: "UNAUTHORIZED", message: "Authentication required" } },
        { status: 401 }
      )
    );
    const unauthRes = await handleCreateEntries(
      new Request("https://example.com/api/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
    );
    expect(unauthRes.status).toBe(401);
  });
});
