import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import {
  createUserSupabaseClient,
  type Database,
} from "@/lib/supabase/user";

const createEntryItemSchema = z.object({
  food_id: z.string().uuid().nullable().optional(),
  food_name: z.string().trim().min(1),
  quantity_g: z.number().positive(),
  calories: z.number().min(0),
  protein_g: z.number().min(0),
  carbs_g: z.number().min(0),
  fat_g: z.number().min(0),
  is_estimated: z.boolean(),
});

export const createEntriesRequestSchema = z.object({
  logged_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  meal_type: z.enum(["breakfast", "lunch", "dinner", "snack"]),
  items: z.array(createEntryItemSchema).min(1),
});

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
  const rowsToInsert = parsedInput.data.items.map((item) => ({
    user_id: userId,
    logged_on: parsedInput.data.logged_on,
    meal_type: parsedInput.data.meal_type,
    food_id: item.food_id ?? null,
    food_name: item.food_name,
    quantity_g: item.quantity_g,
    calories: item.calories,
    protein_g: item.protein_g,
    carbs_g: item.carbs_g,
    fat_g: item.fat_g,
    is_estimated: item.is_estimated,
  }));

  const { data: insertedRows, error } = await supabase
    .from("meal_entries")
    .insert(rowsToInsert)
    .select("*");

  if (error || !insertedRows) {
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

