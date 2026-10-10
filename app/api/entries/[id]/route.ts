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

function rescaleMacro(
  oldMacro: number,
  oldQuantityG: number,
  newQuantityG: number
): number {
  const per100gMacro = (oldMacro * 100) / oldQuantityG;
  return Math.round(per100gMacro * (newQuantityG / 100) * 100) / 100;
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

  const { data: updatedRows, error: updateError } = await supabase
    .from("meal_entries")
    .update({
      quantity_g: newQuantityG,
      calories: rescaleMacro(
        Number(existing.calories),
        oldQuantityG,
        newQuantityG
      ),
      protein_g: rescaleMacro(
        Number(existing.protein_g),
        oldQuantityG,
        newQuantityG
      ),
      carbs_g: rescaleMacro(
        Number(existing.carbs_g),
        oldQuantityG,
        newQuantityG
      ),
      fat_g: rescaleMacro(Number(existing.fat_g), oldQuantityG, newQuantityG),
    })
    .eq("id", parsedId.data)
    .select("*");

  if (updateError) {
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

