export type MealType = "breakfast" | "lunch" | "dinner" | "snack";

export interface TimezoneSettingsLike {
  timezone?: string | null;
  calorie_goal?: number | null;
  protein_goal_g?: number | null;
  carbs_goal_g?: number | null;
  fat_goal_g?: number | null;
}

export const STANDARD_IANA_TIMEZONES: readonly string[] = [
  "UTC",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "America/Sao_Paulo",
  "Australia/Sydney",
  "Pacific/Auckland",
];

export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone || typeof timeZone !== "string" || !timeZone.trim()) {
    return false;
  }
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timeZone.trim() });
    return true;
  } catch {
    return false;
  }
}

export function getBrowserTimezone(): string {
  try {
    const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (resolved && isValidTimeZone(resolved)) {
      return resolved;
    }
  } catch {
    // Fallback to UTC below
  }
  return "UTC";
}

/**
 * Resolves the active IANA timezone for computing today's date (`YYYY-MM-DD`)
 * and initializing `/settings` (`docs/FRONTEND_PRD.md` §3 S4 & §7).
 *
 * When a user's settings row is unset (all goals are null and timezone is missing or default 'UTC'),
 * falls back to the browser's detected timezone.
 */
export function resolveActiveTimezone(
  settings?: TimezoneSettingsLike | null,
  browserTimezone?: string
): string {
  const fallbackBrowserTz =
    browserTimezone && isValidTimeZone(browserTimezone)
      ? browserTimezone.trim()
      : getBrowserTimezone();

  if (!settings || !settings.timezone || !isValidTimeZone(settings.timezone)) {
    return fallbackBrowserTz;
  }

  const trimmedTz = settings.timezone.trim();
  const allGoalsUnset =
    (settings.calorie_goal ?? null) === null &&
    (settings.protein_goal_g ?? null) === null &&
    (settings.carbs_goal_g ?? null) === null &&
    (settings.fat_goal_g ?? null) === null;

  if (trimmedTz === "UTC" && allGoalsUnset) {
    return fallbackBrowserTz;
  }

  return trimmedTz;
}

/**
 * Formats `now` as `YYYY-MM-DD` in the given IANA timezone.
 */
export function getTodayInTimezone(
  timezone?: string,
  now: Date = new Date()
): string {
  const safeTz =
    timezone && isValidTimeZone(timezone)
      ? timezone.trim()
      : getBrowserTimezone();

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: safeTz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const year = parts.find((p) => p.type === "year")?.value ?? "1970";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";

  return `${year}-${month}-${day}`;
}

/**
 * Returns the default meal type based on local time of day in the target timezone
 * (`docs/FRONTEND_PRD.md` §3 S2):
 * - 05:00–10:59 -> breakfast
 * - 11:00–15:59 -> lunch
 * - 16:00–18:59 -> snack
 * - 19:00–04:59 -> dinner
 */
export function getDefaultMealType(
  timezone?: string,
  now: Date = new Date()
): MealType {
  const safeTz =
    timezone && isValidTimeZone(timezone)
      ? timezone.trim()
      : getBrowserTimezone();

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: safeTz,
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(now);

  const hourPart = parts.find((p) => p.type === "hour")?.value ?? "12";
  const hour = Number.parseInt(hourPart, 10) % 24;

  if (hour >= 5 && hour < 11) {
    return "breakfast";
  }
  if (hour >= 11 && hour < 16) {
    return "lunch";
  }
  if (hour >= 16 && hour < 19) {
    return "snack";
  }
  return "dinner";
}

/**
 * Builds the list of IANA timezone options for `/settings`, ensuring both the
 * browser's detected timezone and any currently saved timezone appear in the list.
 */
export function getTimezoneOptions(
  browserTimezone?: string,
  savedTimezone?: string | null
): string[] {
  const set = new Set<string>();
  const detected =
    browserTimezone && isValidTimeZone(browserTimezone)
      ? browserTimezone.trim()
      : getBrowserTimezone();

  set.add(detected);
  if (savedTimezone && isValidTimeZone(savedTimezone)) {
    set.add(savedTimezone.trim());
  }
  for (const tz of STANDARD_IANA_TIMEZONES) {
    set.add(tz);
  }
  return Array.from(set);
}

