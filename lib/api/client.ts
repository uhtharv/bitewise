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
  calories_per_100g?: number | null;
  protein_per_100g?: number | null;
  carbs_per_100g?: number | null;
  fat_per_100g?: number | null;
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

export function mapStatusToUserMessage(
  status: number,
  code?: string | null
): string {
  if (code === "GUEST_LIMIT_REACHED") {
    return "You've used all 3 free guest analyses for today. Sign in with Google to continue.";
  }
  if (status in BACKEND_ERROR_MESSAGES) {
    return BACKEND_ERROR_MESSAGES[status];
  }
  return BACKEND_ERROR_MESSAGES[502];
}

export class ApiClientError extends Error {
  public readonly status: number;
  public readonly code: string | null;
  public readonly userMessage: string;

  constructor(status: number, userMessage?: string, code?: string | null) {
    const mapped = userMessage ?? mapStatusToUserMessage(status, code);
    super(mapped);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code ?? null;
    this.userMessage = mapped;
  }
}

export interface ApiClientDependencies {
  fetchImpl?: typeof fetch;
  onUnauthorized?: () => void;
}

function defaultOnUnauthorized(): void {
  if (typeof window !== "undefined") {
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = "/sign-in";
  }
}

async function parseErrorResponse(response: Response): Promise<ApiClientError> {
  let parsedError: { error?: { code?: string; message?: string } } | null = null;
  try {
    parsedError = (await response.json()) as {
      error?: { code?: string; message?: string };
    };
  } catch {
    // ignore json error parse failure
  }
  const code = parsedError?.error?.code ?? null;
  const safeMessage = mapStatusToUserMessage(response.status, code);
  return new ApiClientError(response.status, safeMessage, code);
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
    throw await parseErrorResponse(response);
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

export async function analyzeMealStream(
  text: string,
  onItem: (item: ResolvedMealItem) => void,
  deps?: ApiClientDependencies
): Promise<{ items: ResolvedMealItem[] }> {
  const fetchFn = deps?.fetchImpl ?? fetch;
  const onUnauthorized = deps?.onUnauthorized ?? defaultOnUnauthorized;

  let response: Response;
  try {
    response = await fetchFn("/api/analyze", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream, application/json",
      },
      body: JSON.stringify({ text }),
    });
  } catch {
    throw new ApiClientError(502);
  }

  if (response.status === 401) {
    onUnauthorized();
    throw new ApiClientError(401, "Redirecting to sign in...");
  }

  if (!response.ok) {
    throw await parseErrorResponse(response);
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/event-stream") || !response.body) {
    const json = (await response.json()) as { items: ResolvedMealItem[] };
    if (json.items) {
      json.items.forEach(onItem);
    }
    return json;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const collectedItems: ResolvedMealItem[] = [];
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n\n");
      buffer = lines.pop() ?? "";

      for (const block of lines) {
        if (!block.trim()) continue;
        const eventMatch = block.match(/event:\s*([^\n]+)/);
        const dataMatch = block.match(/data:\s*([^\n]+)/);
        const event = eventMatch ? eventMatch[1].trim() : "message";
        const dataStr = dataMatch ? dataMatch[1].trim() : "";

        if (event === "item" && dataStr) {
          try {
            const item = JSON.parse(dataStr) as ResolvedMealItem;
            collectedItems.push(item);
            onItem(item);
          } catch {
            // Ignore malformed event data
          }
        } else if (event === "done" && dataStr) {
          try {
            const result = JSON.parse(dataStr) as { items: ResolvedMealItem[] };
            if (result.items && result.items.length > 0) {
              return result;
            }
          } catch {
            // Return collected items below
          }
        } else if (event === "error") {
          throw new ApiClientError(502);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return { items: collectedItems };
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
