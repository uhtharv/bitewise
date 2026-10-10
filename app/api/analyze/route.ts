import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  GeminiProvider,
  UnparseableMealError,
  type AIProvider,
} from "@/lib/ai/provider";
import { requireAuth } from "@/lib/auth";
import {
  resolveFoodItem,
  type ResolvedMealItem,
} from "@/lib/nutrition/resolve-food";
import { type UsdaFoodMatch } from "@/lib/nutrition/usda";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import type { Database, FoodRow } from "@/lib/supabase/user";

const DAILY_AI_ANALYSIS_LIMIT = 30;

export const analyzeRequestSchema = z.object({
  text: z.string().trim().min(1).max(500),
});

export interface AnalyzeRouteDependencies {
  supabase?: SupabaseClient<Database>;
  aiProvider?: AIProvider;
  lookupUsdaFood?: (query: string) => Promise<UsdaFoodMatch | null>;
  now?: () => Date;
}

function errorResponse(
  status: number,
  code: string,
  message: string
): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function handleAnalyzePost(
  request: Request,
  deps?: AnalyzeRouteDependencies
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

  const parsedInput = analyzeRequestSchema.safeParse(rawBody);
  if (!parsedInput.success) {
    return errorResponse(
      400,
      "BAD_REQUEST",
      "Meal text must be a non-empty string up to 500 characters"
    );
  }

  const supabase = deps?.supabase ?? createServiceSupabaseClient();
  const usageDate = (deps?.now ? deps.now() : new Date())
    .toISOString()
    .slice(0, 10);

  // Step 1: Rate Limit Check (`ai_usage`, 30/day)
  const { data: existingUsageRows, error: usageSelectError } = await supabase
    .from("ai_usage")
    .select("*")
    .eq("user_id", userId)
    .eq("usage_date", usageDate);

  if (usageSelectError) {
    return errorResponse(
      502,
      "UPSTREAM_ERROR",
      "Failed to check daily AI usage limit"
    );
  }

  const existingRow =
    existingUsageRows && existingUsageRows.length > 0
      ? existingUsageRows[0]
      : null;
  const currentCount = existingRow ? Number(existingRow.count) : 0;

  if (currentCount >= DAILY_AI_ANALYSIS_LIMIT) {
    return errorResponse(
      429,
      "RATE_LIMITED",
      "Daily AI analysis limit of 30 reached"
    );
  }

  let aiProvider: AIProvider;
  try {
    aiProvider = deps?.aiProvider ?? new GeminiProvider();
  } catch {
    return errorResponse(
      502,
      "UPSTREAM_ERROR",
      "AI provider is misconfigured or unavailable"
    );
  }

  // Step 1b + Step 2: Run the `ai_usage` increment write concurrently with `parseMealText`
  const usageWritePromise = existingRow
    ? supabase
        .from("ai_usage")
        .update({ count: currentCount + 1 })
        .eq("user_id", userId)
        .eq("usage_date", usageDate)
    : supabase.from("ai_usage").insert({
        user_id: userId,
        usage_date: usageDate,
        count: 1,
      });

  const parseMealOutcomePromise = aiProvider
    .parseMealText(parsedInput.data.text)
    .then(
      (items) => ({ ok: true as const, items }),
      (error: unknown) => ({ ok: false as const, error })
    );

  const [usageWriteResult, parseMealOutcome] = await Promise.all([
    usageWritePromise,
    parseMealOutcomePromise,
  ]);

  if (usageWriteResult.error) {
    return errorResponse(
      502,
      "UPSTREAM_ERROR",
      existingRow
        ? "Failed to update daily AI usage counter"
        : "Failed to record daily AI usage counter"
    );
  }

  if (!parseMealOutcome.ok) {
    if (parseMealOutcome.error instanceof UnparseableMealError) {
      return errorResponse(
        422,
        "UNPROCESSABLE_ENTITY",
        "Could not parse the input text into food items"
      );
    }
    return errorResponse(
      502,
      "UPSTREAM_ERROR",
      "Upstream AI meal parsing failed"
    );
  }

  const parsedItems = parseMealOutcome.items;

  if (!parsedItems || parsedItems.length === 0) {
    return errorResponse(
      422,
      "UNPROCESSABLE_ENTITY",
      "Could not parse the input text into food items"
    );
  }

  // Steps 3–5: Resolve all items in parallel via `foods` cache -> USDA -> Gemini fallback
  // with in-flight deduplication by `normalized_name`
  const inFlightFoods = new Map<
    string,
    Promise<{ food: FoodRow; fromCache: boolean }>
  >();

  let resolvedItems: ResolvedMealItem[];
  try {
    resolvedItems = await Promise.all(
      parsedItems.map((item) =>
        resolveFoodItem(item, {
          supabase,
          aiProvider,
          lookupUsdaFood: deps?.lookupUsdaFood,
          inFlightFoods,
        })
      )
    );
  } catch {
    return errorResponse(
      502,
      "UPSTREAM_ERROR",
      "Upstream nutrition lookup failed"
    );
  }

  return NextResponse.json({ items: resolvedItems }, { status: 200 });
}

export async function POST(request: Request): Promise<NextResponse> {
  return handleAnalyzePost(request);
}

