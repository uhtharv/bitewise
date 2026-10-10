import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SettingsFormView } from "@/components/settings/settings-form";
import {
  toSettingsFormValues,
  validateAndParseSettingsForm,
} from "@/lib/settings/view-model";

describe("Settings (/settings, S4)", () => {
  it("initializes blank goal fields for null goals and pre-selects browser timezone when settings are unset/default UTC", () => {
    const values = toSettingsFormValues(
      {
        calorie_goal: null,
        protein_goal_g: null,
        carbs_goal_g: null,
        fat_goal_g: null,
        timezone: "UTC",
      },
      "Asia/Kolkata"
    );

    expect(values).toEqual({
      calorieGoal: "",
      proteinGoalG: "",
      carbsGoalG: "",
      fatGoalG: "",
      timezone: "Asia/Kolkata",
    });
  });

  it("converts blank goal inputs to null, parses valid integer goals, and rejects invalid/negative values", () => {
    const nullGoalsResult = validateAndParseSettingsForm({
      calorieGoal: "  ",
      proteinGoalG: "",
      carbsGoalG: "",
      fatGoalG: "",
      timezone: "Asia/Kolkata",
    });
    expect(nullGoalsResult).toEqual({
      ok: true,
      payload: {
        calorie_goal: null,
        protein_goal_g: null,
        carbs_goal_g: null,
        fat_goal_g: null,
        timezone: "Asia/Kolkata",
      },
    });

    const validGoalsResult = validateAndParseSettingsForm({
      calorieGoal: "2000",
      proteinGoalG: "140",
      carbsGoalG: "220",
      fatGoalG: "0",
      timezone: "Asia/Kolkata",
    });
    expect(validGoalsResult).toEqual({
      ok: true,
      payload: {
        calorie_goal: 2000,
        protein_goal_g: 140,
        carbs_goal_g: 220,
        fat_goal_g: 0,
        timezone: "Asia/Kolkata",
      },
    });

    // Calorie goal cannot be 0, macros cannot be negative, decimals rejected
    const invalidResult = validateAndParseSettingsForm({
      calorieGoal: "0",
      proteinGoalG: "-10",
      carbsGoalG: "150.5",
      fatGoalG: "abc",
      timezone: "Invalid/Zone",
    });
    expect(invalidResult.ok).toBe(false);
    if (!invalidResult.ok) {
      expect(invalidResult.fieldErrors.calorieGoal).toBeDefined();
      expect(invalidResult.fieldErrors.proteinGoalG).toBeDefined();
      expect(invalidResult.fieldErrors.carbsGoalG).toBeDefined();
      expect(invalidResult.fieldErrors.fatGoalG).toBeDefined();
      expect(invalidResult.fieldErrors.timezone).toBeDefined();
    }
  });

  it("renders labeled goal inputs, timezone selector, loading skeletons, and error state", () => {
    const formHtml = renderToStaticMarkup(
      <SettingsFormView
        values={{
          calorieGoal: "2000",
          proteinGoalG: "140",
          carbsGoalG: "",
          fatGoalG: "65",
          timezone: "Asia/Kolkata",
        }}
        timezoneOptions={["Asia/Kolkata", "UTC", "America/New_York"]}
      />
    );

    expect(formHtml).toContain("Daily calorie goal (kcal)");
    expect(formHtml).toContain("Protein goal (g)");
    expect(formHtml).toContain("Carbs goal (g)");
    expect(formHtml).toContain("Fat goal (g)");
    expect(formHtml).toContain("Timezone");
    expect(formHtml).toContain("Save settings");

    const loadingHtml = renderToStaticMarkup(
      <SettingsFormView
        values={toSettingsFormValues(null, "Asia/Kolkata")}
        timezoneOptions={["Asia/Kolkata"]}
        isLoading={true}
      />
    );
    expect(loadingHtml).toContain('aria-label="Loading settings"');

    const errorHtml = renderToStaticMarkup(
      <SettingsFormView
        values={toSettingsFormValues(null, "Asia/Kolkata")}
        timezoneOptions={["Asia/Kolkata"]}
        loadError="Food data is unavailable right now. Try again shortly."
      />
    );
    expect(errorHtml).toContain(
      "Food data is unavailable right now. Try again shortly."
    );
    expect(errorHtml).toContain("Try again");
  });
});

