import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthUserId } from "@/lib/auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  GeminiProvider,
  UnparseableMealError,
  type AIProvider,
} from "@/lib/ai/provider";
import {
  AUTHENTICATED_DAILY_LIMIT,
  buildGuestCookieHeader,
  buildGuestUserId,
  buildIpUserId,
  generateGuestId,
  getClientIp,
  getGuestIdFromCookie,
  GUEST_DAILY_LIMIT,
  GUEST_IP_DAILY_LIMIT,
  hashIp,
} from "@/lib/auth/guest";
import {
  resolveFoodItem,
  tryResolveMealTextFromCache,
  type ResolvedFoodNutrientRow,
  type ResolvedMealItem,
} from "@/lib/nutrition/resolve-food";
import { type UsdaFoodMatch } from "@/lib/nutrition/usda";
import { createFoodReferenceClient } from "@/lib/supabase/food-db";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import type { Database } from "@/lib/supabase/user";

export const analyzeRequestSchema = z.object({
  text: z.string().trim().min(1).max(500),
});

export interface AnalyzeRouteDependencies {
  supabase?: SupabaseClient<Database>;
  foodDbClient?: SupabaseClient;
  aiProvider?: AIProvider;
  lookupUsdaFood?: (query: string) => Promise<UsdaFoodMatch | null>;
  now?: () => Date;
  auth?: () => Promise<{ userId: string | null }>;
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  headers?: Record<string, string>
): NextResponse {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers }
  );
}

export async function handleAnalyzePost(
  request: Request,
  deps?: AnalyzeRouteDependencies
): Promise<Response> {
  let authUserId: string | null = null;
  try {
    authUserId = deps?.auth
      ? (await deps.auth()).userId ?? null
      : await getAuthUserId();
  } catch {
    authUserId = null;
  }

  const isGuest = !authUserId;
  let guestId: string | null = null;
  let clientIpHash: string | null = null;
  let cookieNeedsSet = false;

  if (isGuest) {
    const cookieHeader = request.headers.get("cookie");
    const existingGuestId = getGuestIdFromCookie(cookieHeader);
    if (existingGuestId) {
      guestId = existingGuestId;
      cookieNeedsSet = false;
    } else {
      guestId = generateGuestId();
      cookieNeedsSet = true;
    }
    const clientIp = getClientIp(request.headers);
    clientIpHash = hashIp(clientIp);
  }

  const responseHeaders: Record<string, string> = {};
  if (cookieNeedsSet && guestId) {
    responseHeaders["Set-Cookie"] = buildGuestCookieHeader(guestId);
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return errorResponse(400, "BAD_REQUEST", "Invalid JSON request body", responseHeaders);
  }

  const parsedInput = analyzeRequestSchema.safeParse(rawBody);
  if (!parsedInput.success) {
    return errorResponse(
      400,
      "BAD_REQUEST",
      "Meal text must be a non-empty string up to 500 characters",
      responseHeaders
    );
  }

  const supabase = deps?.supabase ?? createServiceSupabaseClient();
  const foodDbClient =
    deps?.foodDbClient ??
    (deps?.supabase
      ? (deps.supabase as unknown as SupabaseClient)
      : createFoodReferenceClient());
  const usageDate = (deps?.now ? deps.now() : new Date())
    .toISOString()
    .slice(0, 10);

  // Step 1: Rate Limit Check (`ai_usage`)
  let existingAuthRow: { user_id: string; usage_date: string; count: number } | null = null;
  let authCurrentCount = 0;

  let guestUserId: string | null = null;
  let ipUserId: string | null = null;
  let guestCount = 0;
  let ipCount = 0;

  if (isGuest) {
    guestUserId = buildGuestUserId(guestId!);
    ipUserId = buildIpUserId(clientIpHash!);

    const { data: usageRows, error: usageSelectError } = await supabase
      .from("ai_usage")
      .select("*")
      .in("user_id", [guestUserId, ipUserId])
      .eq("usage_date", usageDate);

    if (usageSelectError) {
      return errorResponse(
        502,
        "UPSTREAM_ERROR",
        "Failed to check daily AI usage limit",
        responseHeaders
      );
    }

    const guestRow = usageRows?.find((r) => r.user_id === guestUserId);
    const ipRow = usageRows?.find((r) => r.user_id === ipUserId);
    guestCount = guestRow ? Number(guestRow.count) : 0;
    ipCount = ipRow ? Number(ipRow.count) : 0;

    if (guestCount >= GUEST_DAILY_LIMIT || ipCount >= GUEST_IP_DAILY_LIMIT) {
      return errorResponse(
        429,
        "GUEST_LIMIT_REACHED",
        "You've used all 3 free guest analyses for today. Sign in with Google to continue.",
        responseHeaders
      );
    }
  } else {
    const { data: existingUsageRows, error: usageSelectError } = await supabase
      .from("ai_usage")
      .select("*")
      .eq("user_id", authUserId!)
      .eq("usage_date", usageDate);

    if (usageSelectError) {
      return errorResponse(
        502,
        "UPSTREAM_ERROR",
        "Failed to check daily AI usage limit"
      );
    }

    existingAuthRow =
      existingUsageRows && existingUsageRows.length > 0
        ? existingUsageRows[0]
        : null;
    authCurrentCount = existingAuthRow ? Number(existingAuthRow.count) : 0;

    if (authCurrentCount >= AUTHENTICATED_DAILY_LIMIT) {
      return errorResponse(
        429,
        "RATE_LIMITED",
        `Daily AI analysis limit of ${AUTHENTICATED_DAILY_LIMIT} reached`
      );
    }
  }

  function executeUsageIncrement() {
    if (isGuest) {
      const operations: PromiseLike<unknown>[] = [];
      if (guestCount > 0) {
        operations.push(
          supabase
            .from("ai_usage")
            .update({ count: guestCount + 1 })
            .eq("user_id", guestUserId!)
            .eq("usage_date", usageDate)
        );
      } else {
        operations.push(
          supabase.from("ai_usage").insert({
            user_id: guestUserId!,
            usage_date: usageDate,
            count: 1,
          })
        );
      }

      if (ipCount > 0) {
        operations.push(
          supabase
            .from("ai_usage")
            .update({ count: ipCount + 1 })
            .eq("user_id", ipUserId!)
            .eq("usage_date", usageDate)
        );
      } else {
        operations.push(
          supabase.from("ai_usage").insert({
            user_id: ipUserId!,
            usage_date: usageDate,
            count: 1,
          })
        );
      }

      return Promise.all(operations).then((results) => {
        const errorResult = results.find(
          (r) => r && typeof r === "object" && "error" in r && Boolean((r as { error: unknown }).error)
        );
        return { error: errorResult ? (errorResult as { error: unknown }).error : null };
      });
    } else {
      return existingAuthRow
        ? supabase
            .from("ai_usage")
            .update({ count: authCurrentCount + 1 })
            .eq("user_id", authUserId!)
            .eq("usage_date", usageDate)
        : supabase.from("ai_usage").insert({
            user_id: authUserId!,
            usage_date: usageDate,
            count: 1,
          });
    }
  }

  const wantsSse = Boolean(
    request.headers.get("accept")?.includes("text/event-stream")
  );

  // Step 1.5: Cache-first resolution (0 Gemini calls when clean segments match)
  const cachedItems = await tryResolveMealTextFromCache(
    parsedInput.data.text,
    supabase,
    foodDbClient
  );
  if (cachedItems && cachedItems.length > 0) {
    if (isGuest) {
      // Guests count all successful analyses against their 3/day quota
      await executeUsageIncrement();
    }

    if (wantsSse) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              `event: start\ndata: ${JSON.stringify({ total: cachedItems.length })}\n\n`
            )
          );
          for (const item of cachedItems) {
            controller.enqueue(
              encoder.encode(`event: item\ndata: ${JSON.stringify(item)}\n\n`)
            );
          }
          controller.enqueue(
            encoder.encode(
              `event: done\ndata: ${JSON.stringify({ items: cachedItems })}\n\n`
            )
          );
          controller.close();
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          ...responseHeaders,
        },
      });
    }
    return NextResponse.json(
      { items: cachedItems },
      { status: 200, headers: responseHeaders }
    );
  }

  let aiProvider: AIProvider;
  try {
    aiProvider = deps?.aiProvider ?? new GeminiProvider();
  } catch {
    return errorResponse(
      502,
      "UPSTREAM_ERROR",
      "AI provider is misconfigured or unavailable",
      responseHeaders
    );
  }

  // Step 2: Parse meal text via Gemini before burning the daily `ai_usage` quota
  let parsedItems: Awaited<ReturnType<AIProvider["parseMealText"]>>;
  try {
    parsedItems = await aiProvider.parseMealText(parsedInput.data.text);
  } catch (error) {
    if (error instanceof UnparseableMealError) {
      return errorResponse(
        422,
        "UNPROCESSABLE_ENTITY",
        "Could not parse the input text into food items",
        responseHeaders
      );
    }
    return errorResponse(
      502,
      "UPSTREAM_ERROR",
      "Upstream AI meal parsing failed",
      responseHeaders
    );
  }

  if (!parsedItems || parsedItems.length === 0) {
    return errorResponse(
      422,
      "UNPROCESSABLE_ENTITY",
      "Could not parse the input text into food items",
      responseHeaders
    );
  }

  // Step 3: Increment `ai_usage` concurrently with resolving items
  const usageWritePromise = executeUsageIncrement();

  const inFlightFoods = new Map<
    string,
    Promise<{ food: ResolvedFoodNutrientRow; fromCache: boolean }>
  >();

  // If client requested SSE streaming, stream items card-by-card as they resolve
  if (wantsSse) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        controller.enqueue(
          encoder.encode(
            `event: start\ndata: ${JSON.stringify({ total: parsedItems.length })}\n\n`
          )
        );

        const resolvedItems: ResolvedMealItem[] = [];
        try {
          await Promise.all([
            usageWritePromise,
            Promise.all(
              parsedItems.map(async (item) => {
                const resolved = await resolveFoodItem(item, {
                  supabase,
                  foodDbClient,
                  aiProvider,
                  inFlightFoods,
                });
                resolvedItems.push(resolved);
                controller.enqueue(
                  encoder.encode(
                    `event: item\ndata: ${JSON.stringify(resolved)}\n\n`
                  )
                );
              })
            ),
          ]);

          controller.enqueue(
            encoder.encode(
              `event: done\ndata: ${JSON.stringify({ items: resolvedItems })}\n\n`
            )
          );
        } catch {
          controller.enqueue(
            encoder.encode(
              `event: error\ndata: ${JSON.stringify({ message: "Upstream nutrition lookup failed" })}\n\n`
            )
          );
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        ...responseHeaders,
      },
    });
  }

  // Standard JSON response fallback
  let resolvedItems: ResolvedMealItem[];
  let usageWriteResult: { error: unknown | null };
  try {
    const [usageRes, resolved] = await Promise.all([
      usageWritePromise,
      Promise.all(
        parsedItems.map((item) =>
          resolveFoodItem(item, {
            supabase,
            foodDbClient,
            aiProvider,
            inFlightFoods,
          })
        )
      ),
    ]);
    usageWriteResult = usageRes as { error: unknown | null };
    resolvedItems = resolved;
  } catch (error) {
    if (error instanceof UnparseableMealError) {
      return errorResponse(
        422,
        "UNPROCESSABLE_ENTITY",
        "Could not parse the input text into food items",
        responseHeaders
      );
    }
    return errorResponse(
      502,
      "UPSTREAM_ERROR",
      "Upstream nutrition lookup failed",
      responseHeaders
    );
  }

  if (usageWriteResult.error) {
    return errorResponse(
      502,
      "UPSTREAM_ERROR",
      isGuest
        ? "Failed to update daily guest usage counter"
        : existingAuthRow
        ? "Failed to update daily AI usage counter"
        : "Failed to record daily AI usage counter",
      responseHeaders
    );
  }

  return NextResponse.json(
    { items: resolvedItems },
    { status: 200, headers: responseHeaders }
  );
}

export async function POST(request: Request): Promise<Response> {
  return handleAnalyzePost(request);
}
