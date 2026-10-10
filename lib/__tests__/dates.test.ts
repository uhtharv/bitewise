import { describe, expect, it } from "vitest";
import {
  getDefaultMealType,
  getTimezoneOptions,
  getTodayInTimezone,
  isValidTimeZone,
  resolveActiveTimezone,
} from "@/lib/dates";

describe("lib/dates", () => {
  it("formats today's date as YYYY-MM-DD in the target IANA timezone across day boundaries", () => {
    // 2026-10-10T21:30:00Z is 2026-10-11 03:00 in Asia/Kolkata (+05:30)
    // and 2026-10-10 17:30 in America/New_York (-04:00)
    const instant = new Date("2026-10-10T21:30:00Z");

    expect(getTodayInTimezone("UTC", instant)).toBe("2026-10-10");
    expect(getTodayInTimezone("Asia/Kolkata", instant)).toBe("2026-10-11");
    expect(getTodayInTimezone("America/New_York", instant)).toBe("2026-10-10");
  });

  it("falls back safely when timezone is invalid or omitted", () => {
    const instant = new Date("2026-10-10T12:00:00Z");
    expect(getTodayInTimezone("Invalid/Timezone", instant)).toMatch(
      /^\d{4}-\d{2}-\d{2}$/
    );
    expect(isValidTimeZone("Asia/Kolkata")).toBe(true);
    expect(isValidTimeZone("Not/AZone")).toBe(false);
  });

  it("resolves active timezone to browser timezone when user settings are unset/default UTC", () => {
    expect(resolveActiveTimezone(null, "Asia/Kolkata")).toBe("Asia/Kolkata");
    expect(
      resolveActiveTimezone(
        {
          timezone: "UTC",
          calorie_goal: null,
          protein_goal_g: null,
          carbs_goal_g: null,
          fat_goal_g: null,
        },
        "Asia/Kolkata"
      )
    ).toBe("Asia/Kolkata");

    // Explicit non-UTC timezone is preserved even when goals are null
    expect(
      resolveActiveTimezone(
        {
          timezone: "Europe/London",
          calorie_goal: null,
          protein_goal_g: null,
          carbs_goal_g: null,
          fat_goal_g: null,
        },
        "Asia/Kolkata"
      )
    ).toBe("Europe/London");

    // UTC is preserved when user has configured goals
    expect(
      resolveActiveTimezone(
        {
          timezone: "UTC",
          calorie_goal: 2000,
          protein_goal_g: null,
          carbs_goal_g: null,
          fat_goal_g: null,
        },
        "Asia/Kolkata"
      )
    ).toBe("UTC");
  });

  it("selects default meal_type by local time of day in the given timezone", () => {
    // 08:00 UTC -> breakfast
    expect(
      getDefaultMealType("UTC", new Date("2026-10-10T08:00:00Z"))
    ).toBe("breakfast");
    // 13:00 UTC -> lunch
    expect(
      getDefaultMealType("UTC", new Date("2026-10-10T13:00:00Z"))
    ).toBe("lunch");
    // 17:00 UTC -> snack
    expect(
      getDefaultMealType("UTC", new Date("2026-10-10T17:00:00Z"))
    ).toBe("snack");
    // 20:30 UTC -> dinner
    expect(
      getDefaultMealType("UTC", new Date("2026-10-10T20:30:00Z"))
    ).toBe("dinner");
    // 02:00 UTC -> dinner
    expect(
      getDefaultMealType("UTC", new Date("2026-10-10T02:00:00Z"))
    ).toBe("dinner");
  });

  it("builds deduplicated timezone options including browser and saved timezones", () => {
    const options = getTimezoneOptions("Asia/Calcutta", "America/Phoenix");
    expect(options[0]).toBe("Asia/Calcutta");
    expect(options).toContain("America/Phoenix");
    expect(options).toContain("Asia/Kolkata");
    expect(new Set(options).size).toBe(options.length);
  });
});

