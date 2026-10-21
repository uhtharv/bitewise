import { describe, expect, it, vi } from "vitest";
import {
  analyzeMeal,
  ApiClientError,
  createEntries,
  deleteEntry,
  getDailySummary,
  getUserSettings,
  mapStatusToUserMessage,
  updateEntryQuantity,
  updateUserSettings,
} from "@/lib/api/client";

describe("lib/api/client", () => {
  it("maps HTTP 400, 422, 429, and 502 responses to the exact locked user messages without exposing raw error text", async () => {
    expect(mapStatusToUserMessage(400)).toBe("Please check what you entered.");
    expect(mapStatusToUserMessage(422)).toBe(
      "Couldn't understand that meal. Try rephrasing."
    );
    expect(mapStatusToUserMessage(429)).toBe(
      "You've hit today's analysis limit. Try again tomorrow."
    );
    expect(mapStatusToUserMessage(502)).toBe(
      "Food data is unavailable right now. Try again shortly."
    );
    // Unexpected 500 also maps to the friendly upstream failure copy
    expect(mapStatusToUserMessage(500)).toBe(
      "Food data is unavailable right now. Try again shortly."
    );

    const statusCases = [
      { status: 400, expected: "Please check what you entered." },
      {
        status: 422,
        expected: "Couldn't understand that meal. Try rephrasing.",
      },
      {
        status: 429,
        expected: "You've hit today's analysis limit. Try again tomorrow.",
      },
      {
        status: 502,
        expected: "Food data is unavailable right now. Try again shortly.",
      },
    ];

    for (const { status, expected } of statusCases) {
      const mockFetch: typeof fetch = vi.fn().mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: "INTERNAL_SECRET_TRACE",
              message: "Raw stack trace at Object.<anonymous> (/secret.ts:12)",
            },
          }),
          { status, headers: { "Content-Type": "application/json" } }
        )
      );

      let caught: unknown;
      try {
        await analyzeMeal("2 eggs", { fetchImpl: mockFetch });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(ApiClientError);
      const apiErr = caught as ApiClientError;
      expect(apiErr.status).toBe(status);
      expect(apiErr.userMessage).toBe(expected);
      expect(apiErr.message).toBe(expected);
      expect(apiErr.message).not.toContain("Raw stack trace");
    }
  });

  it("triggers redirect to /sign-in on HTTP 401", async () => {
    const onUnauthorized = vi.fn();
    const mockFetch: typeof fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }));

    await expect(
      getDailySummary("2026-10-10", {
        fetchImpl: mockFetch,
        onUnauthorized,
      })
    ).rejects.toMatchObject({
      status: 401,
    });

    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("maps network fetch rejections to 502 user message", async () => {
    const mockFetch: typeof fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));

    await expect(
      getUserSettings({ fetchImpl: mockFetch })
    ).rejects.toMatchObject({
      status: 502,
      userMessage: "Food data is unavailable right now. Try again shortly.",
    });
  });

  it("calls each backend endpoint with the expected method, path, and JSON body", async () => {
    const mockFetch = vi.fn<typeof fetch>(async () => {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    await analyzeMeal("2 rotis", { fetchImpl: mockFetch });
    expect(mockFetch).toHaveBeenLastCalledWith(
      "/api/analyze",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ text: "2 rotis" }),
      })
    );

    await createEntries(
      {
        logged_on: "2026-10-10",
        meal_type: "lunch",
        items: [
          {
            food_id: "11111111-1111-4111-8111-111111111111",
            food_name: "Roti",
            quantity_g: 70,
            calories: 210,
            protein_g: 6,
            carbs_g: 42,
            fat_g: 2,
            is_estimated: true,
          },
        ],
      },
      { fetchImpl: mockFetch }
    );
    expect(mockFetch).toHaveBeenLastCalledWith(
      "/api/entries",
      expect.objectContaining({
        method: "POST",
      })
    );

    await updateEntryQuantity(
      "11111111-1111-4111-8111-111111111111",
      105,
      { fetchImpl: mockFetch }
    );
    expect(mockFetch).toHaveBeenLastCalledWith(
      "/api/entries/11111111-1111-4111-8111-111111111111",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ quantity_g: 105 }),
      })
    );

    await deleteEntry("11111111-1111-4111-8111-111111111111", {
      fetchImpl: mockFetch,
    });
    expect(mockFetch).toHaveBeenLastCalledWith(
      "/api/entries/11111111-1111-4111-8111-111111111111",
      expect.objectContaining({
        method: "DELETE",
      })
    );

    await updateUserSettings(
      {
        calorie_goal: 2000,
        protein_goal_g: 140,
        carbs_goal_g: 220,
        fat_goal_g: 65,
        timezone: "Asia/Kolkata",
      },
      { fetchImpl: mockFetch }
    );
    expect(mockFetch).toHaveBeenLastCalledWith(
      "/api/settings",
      expect.objectContaining({
        method: "PUT",
      })
    );
  });

  it("handles GUEST_LIMIT_REACHED code on 429 response", async () => {
    const mockFetch: typeof fetch = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            code: "GUEST_LIMIT_REACHED",
            message: "You've used all 3 free guest analyses for today. Sign in with Google to continue.",
          },
        }),
        { status: 429, headers: { "Content-Type": "application/json" } }
      )
    );

    let caught: unknown;
    try {
      await analyzeMeal("1 apple", { fetchImpl: mockFetch });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ApiClientError);
    const apiErr = caught as ApiClientError;
    expect(apiErr.status).toBe(429);
    expect(apiErr.code).toBe("GUEST_LIMIT_REACHED");
    expect(apiErr.userMessage).toBe(
      "You've used all 3 free guest analyses for today. Sign in with Google to continue."
    );
  });
});

