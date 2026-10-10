import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  DEFAULT_USER_SETTINGS,
  type UserSettingsPayload,
} from "@/app/api/settings/route";
import { requireAuth } from "@/lib/auth";
import {
  createUserSupabaseClient,
  type Database,
  type MealEntryRow,
  type UserSettingsRow,
} from "@/lib/supabase/user";

const dateParamSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be in YYYY-MM-DD format");

export interface SummaryHandlerDeps {
  supabase?: SupabaseClient<Database>;
}

function roundToTwoDecimals(value: number): number {
  return Math.round(value * 100) / 100;
}

export async function handleGetSummary(
  request: Request,
  deps?: SummaryHandlerDeps
): Promise<NextResponse> {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) {
    return authResult;
  }
  const userId = authResult;

  const url = new URL(request.url);
  const rawDate = url.searchParams.get("date");
  const parsedDate = dateParamSchema.safeParse(rawDate);

  if (!parsedDate.success) {
    return NextResponse.json(
      {
        error: {
          code: "BAD_REQUEST",
          message:
            parsedDate.error.issues[0]?.message ??
            "Query parameter 'date' (YYYY-MM-DD) is required",
        },
      },
      { status: 400 }
    );
  }

  const date = parsedDate.data;
  const supabase = deps?.supabase ?? createUserSupabaseClient();

  const [entriesResult, settingsResult] = await Promise.all([
    supabase
      .from("meal_entries")
      .select("*")
      .eq("logged_on", date)
      .order("created_at", { ascending: true }),
    supabase.from("user_settings").select("*").eq("user_id", userId),
  ]);

  if (entriesResult.error || settingsResult.error) {
    return NextResponse.json(
      {
        error: {
          code: "UPSTREAM_ERROR",
          message: "Failed to load daily summary",
        },
      },
      { status: 502 }
    );
  }

  const entries = (entriesResult.data ?? []) as MealEntryRow[];
  const settingsRow = (settingsResult.data as UserSettingsRow[] | null)?.[0];

  const totals = entries.reduce(
    (acc, entry) => ({
      calories: roundToTwoDecimals(acc.calories + Number(entry.calories)),
      protein_g: roundToTwoDecimals(acc.protein_g + Number(entry.protein_g)),
      carbs_g: roundToTwoDecimals(acc.carbs_g + Number(entry.carbs_g)),
      fat_g: roundToTwoDecimals(acc.fat_g + Number(entry.fat_g)),
    }),
    {
      calories: 0,
      protein_g: 0,
      carbs_g: 0,
      fat_g: 0,
    }
  );

  const goals: UserSettingsPayload = settingsRow
    ? {
        calorie_goal: settingsRow.calorie_goal,
        protein_goal_g: settingsRow.protein_goal_g,
        carbs_goal_g: settingsRow.carbs_goal_g,
        fat_goal_g: settingsRow.fat_goal_g,
        timezone: settingsRow.timezone,
      }
    : { ...DEFAULT_USER_SETTINGS };

  return NextResponse.json(
    {
      date,
      entries,
      totals,
      goals,
    },
    { status: 200 }
  );
}

export async function GET(request: Request): Promise<NextResponse> {
  return handleGetSummary(request);
}

