import type { DailyTotals, UserSettings } from "@/lib/api/client";
import type { MealType } from "@/lib/dates";
import type { MealEntryRow } from "@/lib/supabase/user";

export const MEAL_TYPE_ORDER: readonly MealType[] = [
  "breakfast",
  "lunch",
  "dinner",
  "snack",
];

export const MEAL_TYPE_TITLES: Record<MealType, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
};

export interface MealGroup {
  mealType: MealType;
  title: string;
  entries: MealEntryRow[];
}

export interface MacroMetricProgress {
  key: "calories" | "protein_g" | "carbs_g" | "fat_g";
  label: string;
  unit: "kcal" | "g";
  total: number;
  goal: number | null;
  progressPercent: number | null;
  isOverGoal: boolean;
}

/**
 * Groups a day's entries into `breakfast`, `lunch`, `dinner`, and `snack`
 * in canonical order, returning only the non-empty groups (`docs/FRONTEND_PRD.md` §3 S3).
 */
export function groupNonEmptyMealEntries(entries: MealEntryRow[]): MealGroup[] {
  const groups: MealGroup[] = [];

  for (const mealType of MEAL_TYPE_ORDER) {
    const matching = entries.filter((entry) => entry.meal_type === mealType);
    if (matching.length > 0) {
      groups.push({
        mealType,
        title: MEAL_TYPE_TITLES[mealType],
        entries: matching,
      });
    }
  }

  return groups;
}

/**
 * Builds the 4 macro progress view-models directly from `GET /api/summary` `totals` and `goals`
 * without recomputing totals on the client (`docs/FRONTEND_PRD.md` §3 S3 & §7).
 */
export function buildMacroMetrics(
  totals: DailyTotals,
  goals: UserSettings
): MacroMetricProgress[] {
  const definitions: Array<{
    key: MacroMetricProgress["key"];
    label: string;
    unit: "kcal" | "g";
    total: number;
    goal: number | null;
  }> = [
    {
      key: "calories",
      label: "Calories",
      unit: "kcal",
      total: Number(totals.calories),
      goal: goals.calorie_goal,
    },
    {
      key: "protein_g",
      label: "Protein",
      unit: "g",
      total: Number(totals.protein_g),
      goal: goals.protein_goal_g,
    },
    {
      key: "carbs_g",
      label: "Carbs",
      unit: "g",
      total: Number(totals.carbs_g),
      goal: goals.carbs_goal_g,
    },
    {
      key: "fat_g",
      label: "Fat",
      unit: "g",
      total: Number(totals.fat_g),
      goal: goals.fat_goal_g,
    },
  ];

  return definitions.map((def) => {
    const hasGoal = def.goal !== null && def.goal !== undefined;
    if (!hasGoal || def.goal === null) {
      return {
        ...def,
        goal: null,
        progressPercent: null,
        isOverGoal: false,
      };
    }

    const rawPercent =
      def.goal > 0
        ? Math.round((def.total / def.goal) * 100)
        : def.total > 0
          ? 100
          : 0;
    const clampedPercent = Math.max(0, Math.min(100, rawPercent));

    return {
      ...def,
      progressPercent: clampedPercent,
      isOverGoal: def.total > def.goal,
    };
  });
}

