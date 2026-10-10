import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  DailyTrackerFallback,
  DailyTrackerView,
} from "@/components/today/daily-tracker";
import type { DailySummaryResponse } from "@/lib/api/client";
import {
  buildMacroMetrics,
  groupNonEmptyMealEntries,
} from "@/lib/tracker/view-model";

const SAMPLE_SUMMARY_NULL_GOALS: DailySummaryResponse = {
  date: "2026-10-10",
  entries: [
    {
      id: "11111111-1111-4111-8111-111111111111",
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
      id: "22222222-2222-4222-8222-222222222222",
      user_id: "user_a",
      logged_on: "2026-10-10",
      meal_type: "breakfast",
      food_id: null,
      food_name: "Boiled Egg",
      quantity_g: 100,
      calories: 155,
      protein_g: 12.6,
      carbs_g: 1.1,
      fat_g: 10.6,
      is_estimated: false,
      created_at: "2026-10-10T08:00:00Z",
    },
  ],
  totals: {
    calories: 485,
    protein_g: 29.1,
    carbs_g: 43.1,
    fat_g: 21.1,
  },
  goals: {
    calorie_goal: null,
    protein_goal_g: null,
    carbs_goal_g: null,
    fat_goal_g: null,
    timezone: "Asia/Kolkata",
  },
};

describe("Daily Tracker (/today, S3)", () => {
  it("renders a deterministic static shell in DailyTrackerFallback", () => {
    const html = renderToStaticMarkup(<DailyTrackerFallback />);
    expect(html).toContain("Today&#x27;s log");
    expect(html).toContain("Manage goals");
  });

  it("groups entries in canonical meal order and omits empty meal groups", () => {
    const groups = groupNonEmptyMealEntries(SAMPLE_SUMMARY_NULL_GOALS.entries);
    expect(groups.map((g) => g.mealType)).toEqual(["breakfast", "lunch"]);
    expect(groups[0].entries[0].food_name).toBe("Boiled Egg");
    expect(groups[1].entries[0].food_name).toBe("Dal Tadka");
  });

  it("renders totals without Progress bars when goals are null, and renders the Estimated badge on is_estimated: true entries", () => {
    const html = renderToStaticMarkup(
      <DailyTrackerView
        summary={SAMPLE_SUMMARY_NULL_GOALS}
        todayDate="2026-10-10"
      />
    );

    expect(html).toContain("485 kcal");
    expect(html).toContain("29.1 g");
    expect(html).toContain("43.1 g");
    expect(html).toContain("21.1 g");
    // No progress bars when goals are null
    expect(html).not.toContain('data-slot="progress"');

    // Only Breakfast and Lunch groups rendered (Dinner and Snack omitted)
    expect(html).toContain("Breakfast");
    expect(html).toContain("Lunch");
    expect(html).not.toContain(">Dinner<");
    expect(html).not.toContain(">Snack<");

    // Estimated badge rendered once (for Dal Tadka)
    const badgeMatches = html.match(/>Estimated</g) ?? [];
    expect(badgeMatches).toHaveLength(1);
  });

  it("renders Progress bars when goals are non-null, clamps fill at 100%, and applies warning styling when total > goal", () => {
    const summaryWithGoals: DailySummaryResponse = {
      ...SAMPLE_SUMMARY_NULL_GOALS,
      totals: {
        calories: 2300,
        protein_g: 70,
        carbs_g: 200,
        fat_g: 50,
      },
      goals: {
        calorie_goal: 2000,
        protein_goal_g: 140,
        carbs_goal_g: null,
        fat_goal_g: 65,
        timezone: "Asia/Kolkata",
      },
    };

    const metrics = buildMacroMetrics(
      summaryWithGoals.totals,
      summaryWithGoals.goals
    );
    expect(metrics[0]).toMatchObject({
      key: "calories",
      total: 2300,
      goal: 2000,
      progressPercent: 100,
      isOverGoal: true,
    });
    expect(metrics[1]).toMatchObject({
      key: "protein_g",
      total: 70,
      goal: 140,
      progressPercent: 50,
      isOverGoal: false,
    });
    expect(metrics[2]).toMatchObject({
      key: "carbs_g",
      goal: null,
      progressPercent: null,
      isOverGoal: false,
    });

    const html = renderToStaticMarkup(
      <DailyTrackerView summary={summaryWithGoals} todayDate="2026-10-10" />
    );

    expect(html).toContain("2300 / 2000 kcal");
    expect(html).toContain("70 / 140 g");
    expect(html).toContain("200 g");
    expect(html).toContain('data-over-goal="true"');
    expect(html).toContain("bg-warning-deep");
  });

  it("renders empty state when entries is empty and error state when summary fails", () => {
    const emptyHtml = renderToStaticMarkup(
      <DailyTrackerView
        summary={{
          ...SAMPLE_SUMMARY_NULL_GOALS,
          entries: [],
          totals: { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
        }}
        todayDate="2026-10-10"
      />
    );
    expect(emptyHtml).toContain(
      "Nothing is logged for today (2026-10-10) yet."
    );

    const errorHtml = renderToStaticMarkup(
      <DailyTrackerView
        summary={null}
        todayDate="2026-10-10"
        errorMessage="Food data is unavailable right now. Try again shortly."
      />
    );
    expect(errorHtml).toContain(
      "Food data is unavailable right now. Try again shortly."
    );
    expect(errorHtml).toContain("Try again");
  });
});

