import type { MealType } from "@/lib/dates";
import type { ResolvedMealItem } from "@/lib/nutrition/resolve-food";
import type { MealEntryRow } from "@/lib/supabase/user";

export interface UserSettings {
  calorie_goal: number | null;
  protein_goal_g: number | null;
  carbs_goal_g: number | null;
  fat_goal_g: number | null;
  timezone: string;
}

export interface DailyTotals {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

export interface DailySummaryResponse {
  date: string;
  entries: MealEntryRow[];
  totals: DailyTotals;
  goals: UserSettings;
}

export interface CreateEntryItemInput {
  food_id?: string | null;
  food_name: string;
  quantity_g: number;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  is_estimated: boolean;
}

export interface CreateEntriesInput {
  logged_on: string;
  meal_type: MealType;
  items: CreateEntryItemInput[];
}

/**
 * Locked user-facing error messages mapped from backend HTTP status codes
 * (`docs/FRONTEND_PRD.md` §5).
 */
export const BACKEND_ERROR_MESSAGES: Record<number, string> = {
  400: "Please check what you entered.",
  422: "Couldn't understand that meal. Try rephrasing.",
  429: "You've hit today's analysis limit. Try again tomorrow.",
  502: "Food data is unavailable right now. Try again shortly.",
};

export function mapStatusToUserMessage(status: number): string {
  if (status in BACKEND_ERROR_MESSAGES) {
    return BACKEND_ERROR_MESSAGES[status];
  }
  return BACKEND_ERROR_MESSAGES[502];
}

export class ApiClientError extends Error {
  public readonly status: number;
  public readonly userMessage: string;

  constructor(status: number, userMessage?: string) {
    const mapped = userMessage ?? mapStatusToUserMessage(status);
    super(mapped);
    this.name = "ApiClientError";
    this.status = status;
    this.userMessage = mapped;
  }
}

export interface ApiClientDependencies {
  fetchImpl?: typeof fetch;
  onUnauthorized?: () => void;
}

function defaultOnUnauthorized(): void {
  if (typeof window !== "undefined") {
    window.location.href = "/sign-in";
  }
}

async function requestJson<T>(
  path: string,
  init?: RequestInit,
  deps?: ApiClientDependencies
): Promise<T> {
  const fetchFn = deps?.fetchImpl ?? fetch;
  const onUnauthorized = deps?.onUnauthorized ?? defaultOnUnauthorized;

  let response: Response;
  try {
    response = await fetchFn(path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    throw new ApiClientError(502);
  }

  if (response.status === 401) {
    onUnauthorized();
    throw new ApiClientError(401, "Redirecting to sign in...");
  }

  if (!response.ok) {
    throw new ApiClientError(response.status);
  }

  return (await response.json()) as T;
}

export async function analyzeMeal(
  text: string,
  deps?: ApiClientDependencies
): Promise<{ items: ResolvedMealItem[] }> {
  return requestJson<{ items: ResolvedMealItem[] }>(
    "/api/analyze",
    {
      method: "POST",
      body: JSON.stringify({ text }),
    },
    deps
  );
}

export async function createEntries(
  payload: CreateEntriesInput,
  deps?: ApiClientDependencies
): Promise<{ entries: MealEntryRow[] }> {
  return requestJson<{ entries: MealEntryRow[] }>(
    "/api/entries",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    deps
  );
}

export async function updateEntryQuantity(
  id: string,
  quantity_g: number,
  deps?: ApiClientDependencies
): Promise<{ entry: MealEntryRow }> {
  return requestJson<{ entry: MealEntryRow }>(
    `/api/entries/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ quantity_g }),
    },
    deps
  );
}

export async function deleteEntry(
  id: string,
  deps?: ApiClientDependencies
): Promise<{ deleted: boolean }> {
  return requestJson<{ deleted: boolean }>(
    `/api/entries/${encodeURIComponent(id)}`,
    {
      method: "DELETE",
    },
    deps
  );
}

export async function getDailySummary(
  date: string,
  deps?: ApiClientDependencies
): Promise<DailySummaryResponse> {
  return requestJson<DailySummaryResponse>(
    `/api/summary?date=${encodeURIComponent(date)}`,
    {
      method: "GET",
    },
    deps
  );
}

export async function getUserSettings(
  deps?: ApiClientDependencies
): Promise<{ settings: UserSettings }> {
  return requestJson<{ settings: UserSettings }>(
    "/api/settings",
    {
      method: "GET",
    },
    deps
  );
}

export async function updateUserSettings(
  settings: UserSettings,
  deps?: ApiClientDependencies
): Promise<{ settings: UserSettings }> {
  return requestJson<{ settings: UserSettings }>(
    "/api/settings",
    {
      method: "PUT",
      body: JSON.stringify(settings),
    },
    deps
  );
}
