import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import {
  createUserSupabaseClient,
  type Database,
  type UserSettingsRow,
} from "@/lib/supabase/user";

export interface UserSettingsPayload {
  calorie_goal: number | null;
  protein_goal_g: number | null;
  carbs_goal_g: number | null;
  fat_goal_g: number | null;
  timezone: string;
}

export const DEFAULT_USER_SETTINGS: UserSettingsPayload = {
  calorie_goal: null,
  protein_goal_g: null,
  carbs_goal_g: null,
  fat_goal_g: null,
  timezone: "UTC",
};

const putSettingsSchema = z.object({
  calorie_goal: z.number().int().positive().nullable(),
  protein_goal_g: z.number().int().min(0).nullable(),
  carbs_goal_g: z.number().int().min(0).nullable(),
  fat_goal_g: z.number().int().min(0).nullable(),
  timezone: z.string().trim().min(1),
});

export interface SettingsHandlerDeps {
  supabase?: SupabaseClient<Database>;
}

function formatSettingsResponse(
  row: UserSettingsRow | undefined
): UserSettingsPayload {
  if (!row) {
    return { ...DEFAULT_USER_SETTINGS };
  }
  return {
    calorie_goal: row.calorie_goal,
    protein_goal_g: row.protein_goal_g,
    carbs_goal_g: row.carbs_goal_g,
    fat_goal_g: row.fat_goal_g,
    timezone: row.timezone,
  };
}

export async function handleGetSettings(
  deps?: SettingsHandlerDeps
): Promise<NextResponse> {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) {
    return authResult;
  }
  const userId = authResult;
  const supabase = deps?.supabase ?? createUserSupabaseClient();

  const { data, error } = await supabase
    .from("user_settings")
    .select("*")
    .eq("user_id", userId);

  if (error) {
    return NextResponse.json(
      {
        error: {
          code: "UPSTREAM_ERROR",
          message: "Failed to load user settings",
        },
      },
      { status: 502 }
    );
  }

  const row = (data as UserSettingsRow[] | null)?.[0];
  return NextResponse.json(
    { settings: formatSettingsResponse(row) },
    { status: 200 }
  );
}

export async function handlePutSettings(
  request: Request,
  deps?: SettingsHandlerDeps
): Promise<NextResponse> {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) {
    return authResult;
  }
  const userId = authResult;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json(
      {
        error: {
          code: "BAD_REQUEST",
          message: "Request body must be valid JSON",
        },
      },
      { status: 400 }
    );
  }

  const parsed = putSettingsSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "BAD_REQUEST",
          message:
            parsed.error.issues[0]?.message ?? "Invalid user settings payload",
        },
      },
      { status: 400 }
    );
  }

  const supabase = deps?.supabase ?? createUserSupabaseClient();
  const { data, error } = await supabase
    .from("user_settings")
    .upsert(
      {
        user_id: userId,
        calorie_goal: parsed.data.calorie_goal,
        protein_goal_g: parsed.data.protein_goal_g,
        carbs_goal_g: parsed.data.carbs_goal_g,
        fat_goal_g: parsed.data.fat_goal_g,
        timezone: parsed.data.timezone,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    )
    .select("*");

  if (error) {
    return NextResponse.json(
      {
        error: {
          code: "UPSTREAM_ERROR",
          message: "Failed to save user settings",
        },
      },
      { status: 502 }
    );
  }

  const row = (data as UserSettingsRow[] | null)?.[0];
  return NextResponse.json(
    { settings: formatSettingsResponse(row) },
    { status: 200 }
  );
}

export async function GET(): Promise<NextResponse> {
  return handleGetSettings();
}

export async function PUT(request: Request): Promise<NextResponse> {
  return handlePutSettings(request);
}

