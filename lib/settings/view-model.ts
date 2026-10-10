import type { UserSettings } from "@/lib/api/client";
import { isValidTimeZone, resolveActiveTimezone } from "@/lib/dates";

export interface SettingsFormValues {
  calorieGoal: string;
  proteinGoalG: string;
  carbsGoalG: string;
  fatGoalG: string;
  timezone: string;
}

export type SettingsFieldErrors = Partial<
  Record<keyof SettingsFormValues, string>
>;

export type SettingsValidationResult =
  | { ok: true; payload: UserSettings }
  | { ok: false; fieldErrors: SettingsFieldErrors };

export function toSettingsFormValues(
  settings?: UserSettings | null,
  browserTimezone?: string
): SettingsFormValues {
  return {
    calorieGoal:
      settings?.calorie_goal !== null && settings?.calorie_goal !== undefined
        ? String(settings.calorie_goal)
        : "",
    proteinGoalG:
      settings?.protein_goal_g !== null &&
      settings?.protein_goal_g !== undefined
        ? String(settings.protein_goal_g)
        : "",
    carbsGoalG:
      settings?.carbs_goal_g !== null && settings?.carbs_goal_g !== undefined
        ? String(settings.carbs_goal_g)
        : "",
    fatGoalG:
      settings?.fat_goal_g !== null && settings?.fat_goal_g !== undefined
        ? String(settings.fat_goal_g)
        : "",
    timezone: resolveActiveTimezone(settings, browserTimezone),
  };
}

function parseNullableIntGoal(
  raw: string,
  options: { allowZero: boolean; label: string }
): { ok: true; value: number | null } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { ok: true, value: null };
  }

  if (!/^-?\d+$/.test(trimmed)) {
    return {
      ok: false,
      error: `${options.label} must be a whole number (or leave blank to unset).`,
    };
  }

  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(parsed)) {
    return {
      ok: false,
      error: `${options.label} is not a valid integer.`,
    };
  }

  if (options.allowZero ? parsed < 0 : parsed <= 0) {
    return {
      ok: false,
      error: options.allowZero
        ? `${options.label} must be 0 or greater (or leave blank to unset).`
        : `${options.label} must be greater than 0 (or leave blank to unset).`,
    };
  }

  return { ok: true, value: parsed };
}

export function validateAndParseSettingsForm(
  values: SettingsFormValues
): SettingsValidationResult {
  const fieldErrors: SettingsFieldErrors = {};

  const calorieRes = parseNullableIntGoal(values.calorieGoal, {
    allowZero: false,
    label: "Calorie goal",
  });
  if (!calorieRes.ok) {
    fieldErrors.calorieGoal = calorieRes.error;
  }

  const proteinRes = parseNullableIntGoal(values.proteinGoalG, {
    allowZero: true,
    label: "Protein goal",
  });
  if (!proteinRes.ok) {
    fieldErrors.proteinGoalG = proteinRes.error;
  }

  const carbsRes = parseNullableIntGoal(values.carbsGoalG, {
    allowZero: true,
    label: "Carbs goal",
  });
  if (!carbsRes.ok) {
    fieldErrors.carbsGoalG = carbsRes.error;
  }

  const fatRes = parseNullableIntGoal(values.fatGoalG, {
    allowZero: true,
    label: "Fat goal",
  });
  if (!fatRes.ok) {
    fieldErrors.fatGoalG = fatRes.error;
  }

  const trimmedTz = values.timezone.trim();
  if (!trimmedTz || !isValidTimeZone(trimmedTz)) {
    fieldErrors.timezone = "Please select a valid timezone.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }

  return {
    ok: true,
    payload: {
      calorie_goal: calorieRes.ok ? calorieRes.value : null,
      protein_goal_g: proteinRes.ok ? proteinRes.value : null,
      carbs_goal_g: carbsRes.ok ? carbsRes.value : null,
      fat_goal_g: fatRes.ok ? fatRes.value : null,
      timezone: trimmedTz,
    },
  };
}

