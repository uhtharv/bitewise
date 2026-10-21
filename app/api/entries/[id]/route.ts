import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import {
  createUserSupabaseClient,
  type Database,
} from "@/lib/supabase/user";

const entryIdSchema = z.string().uuid();

export const patchEntryRequestSchema = z.object({
  quantity_g: z.number().positive(),
});

export interface EntryByIdRouteDependencies {
  supabase?: SupabaseClient<Database>;
}

function errorResponse(
  status: number,
  code: string,
  message: string
): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

function scaleFromPer100g(per100g: number, quantityG: number): number {
  return Math.round(((per100g * quantityG) / 100) * 10) / 10;
}

export async function handlePatchEntry(
  request: Request,
  id: string,
  deps?: EntryByIdRouteDependencies
): Promise<NextResponse> {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const parsedId = entryIdSchema.safeParse(id);
  if (!parsedId.success) {
    return errorResponse(400, "BAD_REQUEST", "Invalid meal entry ID");
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return errorResponse(400, "BAD_REQUEST", "Invalid JSON request body");
  }

  const parsedBody = patchEntryRequestSchema.safeParse(rawBody);
  if (!parsedBody.success) {
    return errorResponse(
      400,
      "BAD_REQUEST",
      "quantity_g must be a positive number"
    );
  }

  const supabase = deps?.supabase ?? createUserSupabaseClient();

  const { data: existingRows, error: selectError } = await supabase
    .from("meal_entries")
    .select("*")
    .eq("id", parsedId.data);

  if (selectError) {
    console.error("[PATCH /api/entries/:id] Select error:", selectError);
    return errorResponse(
      502,
      "UPSTREAM_ERROR",
      "Failed to fetch meal entry"
    );
  }

  if (!existingRows || existingRows.length === 0) {
    return errorResponse(404, "NOT_FOUND", "Meal entry not found");
  }

  const existing = existingRows[0];
  const oldQuantityG = Number(existing.quantity_g);
  const newQuantityG = parsedBody.data.quantity_g;

  let per100Calories =
    existing.calories_per_100g != null
      ? Number(existing.calories_per_100g)
      : null;
  let per100Protein =
    existing.protein_per_100g != null
      ? Number(existing.protein_per_100g)
      : null;
  let per100Carbs =
    existing.carbs_per_100g != null
      ? Number(existing.carbs_per_100g)
      : null;
  let per100Fat =
    existing.fat_per_100g != null
      ? Number(existing.fat_per_100g)
      : null;

  if (per100Calories == null && existing.food_id) {
    try {
      const { data: foodRows } = await supabase
        .from("foods")
        .select("*")
        .eq("id", existing.food_id);

      if (foodRows && foodRows.length > 0) {
        const food = foodRows[0];
        per100Calories = Number(food.calories_per_100g);
        per100Protein = Number(food.protein_per_100g);
        per100Carbs = Number(food.carbs_per_100g);
        per100Fat = Number(food.fat_per_100g);
      }
    } catch {
      // Legacy table may not exist
    }
  }

  const resolvedCalPer100 =
    per100Calories ?? (Number(existing.calories) * 100) / oldQuantityG;
  const resolvedProtPer100 =
    per100Protein ?? (Number(existing.protein_g) * 100) / oldQuantityG;
  const resolvedCarbPer100 =
    per100Carbs ?? (Number(existing.carbs_g) * 100) / oldQuantityG;
  const resolvedFatPer100 =
    per100Fat ?? (Number(existing.fat_g) * 100) / oldQuantityG;

  const nextCalories = scaleFromPer100g(resolvedCalPer100, newQuantityG);
  const nextProteinG = scaleFromPer100g(resolvedProtPer100, newQuantityG);
  const nextCarbsG = scaleFromPer100g(resolvedCarbPer100, newQuantityG);
  const nextFatG = scaleFromPer100g(resolvedFatPer100, newQuantityG);

  const { data: updatedRows, error: updateError } = await supabase
    .from("meal_entries")
    .update({
      quantity_g: newQuantityG,
      calories: nextCalories,
      protein_g: nextProteinG,
      carbs_g: nextCarbsG,
      fat_g: nextFatG,
      calories_per_100g: Math.round(resolvedCalPer100 * 10) / 10,
      protein_per_100g: Math.round(resolvedProtPer100 * 10) / 10,
      carbs_per_100g: Math.round(resolvedCarbPer100 * 10) / 10,
      fat_per_100g: Math.round(resolvedFatPer100 * 10) / 10,
    })
    .eq("id", parsedId.data)
    .select("*");

  if (updateError) {
    console.error("[PATCH /api/entries/:id] Update error:", updateError);
    return errorResponse(
      502,
      "UPSTREAM_ERROR",
      "Failed to update meal entry"
    );
  }

  if (!updatedRows || updatedRows.length === 0) {
    return errorResponse(404, "NOT_FOUND", "Meal entry not found");
  }

  return NextResponse.json({ entry: updatedRows[0] }, { status: 200 });
}

export async function handleDeleteEntry(
  id: string,
  deps?: EntryByIdRouteDependencies
): Promise<NextResponse> {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const parsedId = entryIdSchema.safeParse(id);
  if (!parsedId.success) {
    return errorResponse(400, "BAD_REQUEST", "Invalid meal entry ID");
  }

  const supabase = deps?.supabase ?? createUserSupabaseClient();

  const { data: deletedRows, error: deleteError } = await supabase
    .from("meal_entries")
    .delete()
    .eq("id", parsedId.data)
    .select("*");

  if (deleteError) {
    console.error("[DELETE /api/entries/:id] Delete error:", deleteError);
    return errorResponse(
      502,
      "UPSTREAM_ERROR",
      "Failed to delete meal entry"
    );
  }

  if (!deletedRows || deletedRows.length === 0) {
    return errorResponse(404, "NOT_FOUND", "Meal entry not found");
  }

  return NextResponse.json({ deleted: true }, { status: 200 });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await context.params;
  return handlePatchEntry(request, id);
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await context.params;
  return handleDeleteEntry(id);
}
