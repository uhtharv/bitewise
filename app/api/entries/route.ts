import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import {
  createUserSupabaseClient,
  type Database,
} from "@/lib/supabase/user";

const createEntryItemSchema = z.object({
  food_id: z.string().nullable().optional(),
  food_name: z.string().trim().min(1),
  quantity_g: z.number().positive(),
  calories: z.number().min(0),
  protein_g: z.number().min(0),
  carbs_g: z.number().min(0),
  fat_g: z.number().min(0),
  calories_per_100g: z.number().min(0).nullable().optional(),
  protein_per_100g: z.number().min(0).nullable().optional(),
  carbs_per_100g: z.number().min(0).nullable().optional(),
  fat_per_100g: z.number().min(0).nullable().optional(),
  is_estimated: z.boolean(),
});

export const createEntriesRequestSchema = z.object({
  logged_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  meal_type: z.enum(["breakfast", "lunch", "dinner", "snack"]),
  items: z.array(createEntryItemSchema).min(1),
});

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function sanitizeFoodId(foodId?: string | null): string | null {
  if (!foodId) {
    return null;
  }
  const trimmed = foodId.trim();
  return UUID_REGEX.test(trimmed) ? trimmed : null;
}

export interface EntriesRouteDependencies {
  supabase?: SupabaseClient<Database>;
}

function errorResponse(
  status: number,
  code: string,
  message: string
): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function handleCreateEntries(
  request: Request,
  deps?: EntriesRouteDependencies
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
    return errorResponse(400, "BAD_REQUEST", "Invalid JSON request body");
  }

  const parsedInput = createEntriesRequestSchema.safeParse(rawBody);
  if (!parsedInput.success) {
    return errorResponse(
      400,
      "BAD_REQUEST",
      "Invalid meal entries payload"
    );
  }

  const supabase = deps?.supabase ?? createUserSupabaseClient();
  const rowsToInsert = parsedInput.data.items.map((item) => {
    const caloriesPer100g =
      item.calories_per_100g ??
      Math.round(((item.calories * 100) / item.quantity_g) * 10) / 10;
    const proteinPer100g =
      item.protein_per_100g ??
      Math.round(((item.protein_g * 100) / item.quantity_g) * 10) / 10;
    const carbsPer100g =
      item.carbs_per_100g ??
      Math.round(((item.carbs_g * 100) / item.quantity_g) * 10) / 10;
    const fatPer100g =
      item.fat_per_100g ??
      Math.round(((item.fat_g * 100) / item.quantity_g) * 10) / 10;

    return {
      user_id: userId,
      logged_on: parsedInput.data.logged_on,
      meal_type: parsedInput.data.meal_type,
      food_id: sanitizeFoodId(item.food_id),
      food_name: item.food_name,
      quantity_g: item.quantity_g,
      calories: item.calories,
      protein_g: item.protein_g,
      carbs_g: item.carbs_g,
      fat_g: item.fat_g,
      calories_per_100g: caloriesPer100g,
      protein_per_100g: proteinPer100g,
      carbs_per_100g: carbsPer100g,
      fat_per_100g: fatPer100g,
      is_estimated: item.is_estimated,
    };
  });

  const { data: insertedRows, error } = await supabase
    .from("meal_entries")
    .insert(rowsToInsert)
    .select("*");

  if (error || !insertedRows) {
    console.error("[POST /api/entries] Insert error:", error);
    return errorResponse(
      502,
      "UPSTREAM_ERROR",
      "Failed to insert meal entries"
    );
  }

  return NextResponse.json({ entries: insertedRows }, { status: 201 });
}

export async function POST(request: Request): Promise<NextResponse> {
  return handleCreateEntries(request);
}

