import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

export type PreparationState = "dry" | "raw" | "cooked";

export interface MacroPer100g {
  calories_per_100g: number;
  protein_per_100g: number;
  carbs_per_100g: number;
  fat_per_100g: number;
  is_estimated?: boolean;
}

export interface CandidateIngredient {
  name: string;
  normalized_query: string;
  quantity_g: number;
}

export interface ParsedMealVariant {
  state: PreparationState;
  label: string;
  normalized_name: string;
  display_name: string;
  quantity_g: number;
  macros_per_100g: MacroPer100g;
}

export interface ParsedMealItem {
  normalized_name: string;
  display_name: string;
  quantity_g: number;
  quantity?: number;
  unit?: string;
  normalized_query?: string;
  is_composite?: boolean;
  candidate_ingredients?: CandidateIngredient[];
  estimated_macros_per_100g?: MacroPer100g;
  selected_state?: PreparationState;
  variants?: ParsedMealVariant[];
}

export interface AIProvider {
  parseMealText(text: string): Promise<ParsedMealItem[]>;
  estimateMacrosPer100g(foodName: string): Promise<MacroPer100g>;
}

const EXACT_UNIT_GRAMS: Record<string, number> = {
  g: 1,
  gm: 1,
  gms: 1,
  gram: 1,
  grams: 1,
  kg: 1000,
  kilogram: 1000,
  kilograms: 1000,
  ml: 1,
  tbsp: 15,
  tablespoon: 15,
  tablespoons: 15,
  tsp: 5,
  teaspoon: 5,
  teaspoons: 5,
  oz: 28.35,
  ounce: 28.35,
  ounces: 28.35,
  lb: 453.6,
  pound: 453.6,
  pounds: 453.6,
};

const FOOD_DEPENDENT_UNIT_GRAMS: Record<string, number> = {
  katori: 150,
  katoris: 150,
  cup: 200,
  cups: 200,
  roti: 35,
  rotis: 35,
  chapati: 35,
  chapatis: 35,
  paratha: 60,
  parathas: 60,
  slice: 30,
  slices: 30,
  egg: 50,
  eggs: 50,
  bowl: 250,
  bowls: 250,
  idli: 40,
  idlis: 40,
  dosa: 80,
  dosas: 80,
  piece: 50,
  pieces: 50,
  pcs: 50,
  scoop: 30,
  scoops: 30,
};

/**
 * Normalizes a household unit and quantity into grams (`docs/BACKEND_PRD.md` §7):
 * - Deterministic server multipliers apply to exact weight/spoon units (`g`, `gm`, `gms`, `kg`, `oz`, `lb`, `ml`, `tbsp`, `tsp`).
 * - Food-dependent household units (`cup`, `katori`, `bowl`, `roti`, `slice`, `egg`, `piece`, `scoop`) trust Gemini's context-aware `fallbackQuantityG` first and use reference weights only when `fallbackQuantityG` is omitted.
 */
export function normalizeHouseholdUnitToGrams(
  quantity: number,
  unit: string,
  fallbackQuantityG?: number
): number {
  const normalizedUnit = unit.trim().toLowerCase();
  const exactMultiplier = EXACT_UNIT_GRAMS[normalizedUnit];
  if (exactMultiplier !== undefined) {
    return Math.round(quantity * exactMultiplier * 100) / 100;
  }
  if (fallbackQuantityG !== undefined && fallbackQuantityG > 0) {
    return Math.round(fallbackQuantityG * 100) / 100;
  }
  const foodDependentMultiplier = FOOD_DEPENDENT_UNIT_GRAMS[normalizedUnit];
  if (foodDependentMultiplier !== undefined) {
    return Math.round(quantity * foodDependentMultiplier * 100) / 100;
  }
  return Math.round(quantity * 100) / 100;
}

export class UnparseableMealError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnparseableMealError";
  }
}

export const macroPer100gSchema = z
  .object({
    calories_per_100g: z.number().min(0).max(900),
    protein_per_100g: z.number().min(0).max(100),
    carbs_per_100g: z.number().min(0).max(100),
    fat_per_100g: z.number().min(0).max(100),
    is_estimated: z.boolean().optional(),
  })
  .refine(
    (m) => m.protein_per_100g + m.carbs_per_100g + m.fat_per_100g <= 105,
    {
      message:
        "Per-100g macro sum (protein + carbs + fat) cannot exceed 105g",
    }
  )
  .transform((m): MacroPer100g => {
    const atwater =
      4 * m.protein_per_100g + 4 * m.carbs_per_100g + 9 * m.fat_per_100g;
    const drift = Math.abs(m.calories_per_100g - atwater);
    const shouldNormalizeCalories =
      drift > 30 && (atwater === 0 || drift / atwater > 0.2);

    const normalizedCalories = shouldNormalizeCalories
      ? Math.round(atwater * 10) / 10
      : Math.round(m.calories_per_100g * 100) / 100;

    const result: MacroPer100g = {
      calories_per_100g: normalizedCalories,
      protein_per_100g: Math.round(m.protein_per_100g * 100) / 100,
      carbs_per_100g: Math.round(m.carbs_per_100g * 100) / 100,
      fat_per_100g: Math.round(m.fat_per_100g * 100) / 100,
    };
    if (m.is_estimated !== undefined) {
      result.is_estimated = m.is_estimated;
    }
    return result;
  });

export function normalizeAndValidateMacrosPer100g(
  macros: MacroPer100g
): MacroPer100g {
  const parsed = macroPer100gSchema.safeParse(macros);
  if (!parsed.success) {
    throw new UnparseableMealError(
      parsed.error.issues[0]?.message ??
        "Invalid per-100g macros returned by AI provider"
    );
  }
  return parsed.data;
}

const preparationStateSchema = z.enum(["dry", "raw", "cooked"]);

const rawParsedVariantSchema = z.object({
  state: preparationStateSchema,
  label: z.string().trim().min(1).optional(),
  normalized_name: z.string().trim().min(1),
  display_name: z.string().trim().min(1),
  quantity_g: z.number().positive(),
  macros_per_100g: macroPer100gSchema,
});

const candidateIngredientSchema = z.object({
  name: z.string().trim().min(1),
  normalized_query: z.string().trim().min(1),
  quantity_g: z.number().positive(),
});

const rawParsedItemSchema = z.object({
  normalized_name: z.string().trim().min(1),
  display_name: z.string().trim().min(1),
  normalized_query: z.string().trim().min(1).optional(),
  is_composite: z.boolean().optional(),
  candidate_ingredients: z.array(candidateIngredientSchema).optional(),
  quantity: z.number().positive().optional(),
  unit: z.string().trim().min(1).optional(),
  quantity_g: z.number().positive().optional(),
  estimated_macros_per_100g: macroPer100gSchema.optional(),
  selected_state: preparationStateSchema.optional(),
  variants: z.array(rawParsedVariantSchema).optional(),
});

export const parsedMealResponseSchema = z.union([
  z.object({
    items: z.array(rawParsedItemSchema),
  }),
  z
    .object({
      foods: z.array(rawParsedItemSchema),
    })
    .transform((val) => ({ items: val.foods })),
  z.array(rawParsedItemSchema).transform((items) => ({ items })),
]);


const DEFAULT_STATE_LABELS: Record<PreparationState, string> = {
  dry: "Dry",
  raw: "Raw",
  cooked: "Cooked",
};

export function isExactMassUnit(unit: string): boolean {
  const normalized = unit.trim().toLowerCase();
  return (
    normalized === "g" ||
    normalized === "gm" ||
    normalized === "gms" ||
    normalized === "gram" ||
    normalized === "grams" ||
    normalized === "kg" ||
    normalized === "kilogram" ||
    normalized === "kilograms" ||
    normalized === "oz" ||
    normalized === "ounce" ||
    normalized === "ounces" ||
    normalized === "lb" ||
    normalized === "pound" ||
    normalized === "pounds"
  );
}

export function isKnownHouseholdUnit(unit: string): boolean {
  const normalized = unit.trim().toLowerCase();
  return (
    EXACT_UNIT_GRAMS[normalized] !== undefined ||
    FOOD_DEPENDENT_UNIT_GRAMS[normalized] !== undefined
  );
}

export function isPieceFoodUnit(unit: string): boolean {
  const normalized = unit.trim().toLowerCase();
  return (
    normalized === "roti" ||
    normalized === "rotis" ||
    normalized === "chapati" ||
    normalized === "chapatis" ||
    normalized === "paratha" ||
    normalized === "parathas" ||
    normalized === "egg" ||
    normalized === "eggs" ||
    normalized === "idli" ||
    normalized === "idlis" ||
    normalized === "dosa" ||
    normalized === "dosas"
  );
}

export function isDryPantryStaple(normalizedName: string): boolean {
  return /\b(oat|oats|oatmeal|muesli|granola|quinoa|semolina|rava|sooji|poha|dalia|chia|flax)\b/i.test(
    normalizedName
  );
}

export interface GenAIClientLike {
  models: {
    generateContent(params: {
      model: string;
      contents: string;
      config?: {
        responseMimeType?: string;
        responseJsonSchema?: unknown;
        thinkingConfig?: {
          thinkingBudget?: number;
        };
      };
    }): Promise<{ text?: string | undefined }>;
  };
}

export interface GeminiProviderOptions {
  apiKey?: string;
  model?: string;
  client?: GenAIClientLike;
  maxRetries?: number;
  retryDelayMs?: number;
}

const PRESEEDED_MODELS_WITHOUT_THINKING_CONFIG = [
  String.fromCharCode(
    103, 101, 109, 105, 110, 105, 45, 51, 46, 53, 45, 102, 108, 97, 115, 104,
    45, 108, 105, 116, 101
  ),
  "gemini-flash-lite-latest",
];

const modelsWithoutThinkingConfig = new Set<string>(
  PRESEEDED_MODELS_WITHOUT_THINKING_CONFIG
);
const modelQuotaCooldownUntil = new Map<string, number>();
const QUOTA_COOLDOWN_MS = 15 * 60 * 1000;

export function resetGeminiModelStateForTests(options?: {
  clearPreseeded?: boolean;
}): void {
  modelsWithoutThinkingConfig.clear();
  if (!options?.clearPreseeded) {
    for (const m of PRESEEDED_MODELS_WITHOUT_THINKING_CONFIG) {
      modelsWithoutThinkingConfig.add(m);
    }
  }
  modelQuotaCooldownUntil.clear();
}

function isTransientGeminiError(error: unknown): boolean {
  if (typeof error === "object" && error !== null) {
    const status = (error as { status?: unknown }).status;
    if (status === 500 || status === 502 || status === 503 || status === 504) {
      return true;
    }
  }
  const message = error instanceof Error ? error.message : String(error);
  return /503|UNAVAILABLE|high demand|fetch failed|ETIMEDOUT|ECONNRESET/i.test(
    message
  );
}

function isInvalidArgumentError(error: unknown): boolean {
  if (typeof error === "object" && error !== null) {
    const status = (error as { status?: unknown }).status;
    if (status === 400) {
      return true;
    }
  }
  const message = error instanceof Error ? error.message : String(error);
  return /400|INVALID_ARGUMENT|invalid argument/i.test(message);
}

function isQuotaExhaustedError(error: unknown): boolean {
  if (typeof error === "object" && error !== null) {
    const status = (error as { status?: unknown }).status;
    if (status === 429) {
      return true;
    }
  }
  const message = error instanceof Error ? error.message : String(error);
  return /429|RESOURCE_EXHAUSTED|quota/i.test(message);
}

export class GeminiProvider implements AIProvider {
  private readonly model: string;
  private readonly models: string[];
  private readonly client: GenAIClientLike;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;

  constructor(options?: GeminiProviderOptions) {
    const resolvedModelRaw = (
      options?.model ?? process.env.GEMINI_MODEL
    )?.trim();
    const parsedModels = resolvedModelRaw
      ? resolvedModelRaw
          .split(",")
          .map((m) => m.trim())
          .filter(Boolean)
      : [];
    if (parsedModels.length === 0) {
      throw new Error(
        "Missing required environment variable: GEMINI_MODEL must be set"
      );
    }
    this.models = parsedModels;
    this.model = parsedModels[0]!;
    this.maxRetries = options?.maxRetries ?? 2;
    this.retryDelayMs = options?.retryDelayMs ?? 400;

    if (options?.client) {
      this.client = options.client;
    } else {
      const apiKey = (options?.apiKey ?? process.env.GEMINI_API_KEY)?.trim();
      if (!apiKey) {
        throw new Error(
          "Missing required environment variable: GEMINI_API_KEY must be set"
        );
      }
      this.client = new GoogleGenAI({ apiKey });
    }
  }

  private async generateContentWithRetry(
    params: Parameters<GenAIClientLike["models"]["generateContent"]>[0]
  ): Promise<{ text?: string | undefined }> {
    let lastError: unknown;
    const now = Date.now();
    const activeModels = this.models.filter(
      (m) => (modelQuotaCooldownUntil.get(m) ?? 0) <= now
    );
    const cooledDownModels = this.models.filter(
      (m) => (modelQuotaCooldownUntil.get(m) ?? 0) > now
    );
    const orderedModels = [...activeModels, ...cooledDownModels];

    for (const candidateModel of orderedModels) {
      let currentConfig = params.config;
      if (
        currentConfig?.thinkingConfig !== undefined &&
        modelsWithoutThinkingConfig.has(candidateModel)
      ) {
        const { thinkingConfig: _removed, ...restConfig } = currentConfig;
        void _removed;
        currentConfig = restConfig;
      }

      for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
        try {
          return await this.client.models.generateContent({
            ...params,
            model: candidateModel,
            config: currentConfig,
          });
        } catch (error) {
          lastError = error;

          // Some lite models reject `thinkingConfig: { thinkingBudget: 0 }` with 400 INVALID_ARGUMENT.
          // Strip `thinkingConfig` and retry the same model immediately without consuming a backoff slot.
          if (
            currentConfig?.thinkingConfig !== undefined &&
            isInvalidArgumentError(error)
          ) {
            modelsWithoutThinkingConfig.add(candidateModel);
            const { thinkingConfig: _removed, ...restConfig } = currentConfig;
            void _removed;
            currentConfig = restConfig;
            attempt -= 1;
            continue;
          }

          if (isQuotaExhaustedError(error)) {
            modelQuotaCooldownUntil.set(
              candidateModel,
              Date.now() + QUOTA_COOLDOWN_MS
            );
            break;
          }

          if (attempt < this.maxRetries && isTransientGeminiError(error)) {
            const backoffMs = this.retryDelayMs * Math.pow(2, attempt);
            await new Promise((resolve) => setTimeout(resolve, backoffMs));
            continue;
          }

          // Move to the next fallback model in `this.models` (if any)
          break;
        }
      }
    }

    throw lastError;
  }

  async parseMealText(text: string): Promise<ParsedMealItem[]> {
    const prompt = [
      "Parse the following meal description (English, Indian/regional dish names, or Hinglish) into individual food items.",
      "Rules for normalized_name & normalized_query:",
      "- Use a lowercase canonical food name that explicitly includes preparation state ('dry', 'raw', or 'cooked') for grains, oats, rice, lentils, pasta, and meats (e.g., 'oats, dry', 'oats, cooked', 'white rice, cooked', 'dal tadka').",
      "- In `normalized_query`, provide an optimal search query string for matching against USDA / IFCT / Open Food Facts food reference catalogs (e.g., 'rolled oats raw', 'boiled chicken breast', 'whole wheat roti chapati', 'cooked lentils dal tadka').",
      "Rules for composite dishes & predictive deconstruction:",
      "- For composite dishes, multi-ingredient cooked preparations, or home recipes (e.g., dal tadka, chicken curry, paneer butter masala, sandwich): set `is_composite: true`, and provide `candidate_ingredients` breaking the dish into 2-5 base single-ingredient staples with approximate gram portions totaling the dish weight (e.g. for 150g dal tadka: yellow lentils raw 35g, onion 25g, tomato 25g, ghee 5g).",
      "- For single-ingredient staples (e.g., boiled egg, banana, raw oats, milk): set `is_composite: false` and omit `candidate_ingredients`.",
      "Rules for ambiguous preparation state (variants):",
      "- If a food has distinct 'dry'/'raw' vs 'cooked' nutritional profiles (e.g., oats, rice, pasta, lentils/dal, chicken breast, meat, fish, soya chunks) AND the user did NOT explicitly write 'dry', 'raw', 'uncooked', or 'cooked' in the meal text:",
      "  - Populate `variants` with 2 entries: one for 'dry' (or 'raw' for meats/vegetables/rice) and one for 'cooked'.",
      "  - Each variant must have its own `state` ('dry' | 'raw' | 'cooked'), `label` ('Dry' | 'Raw' | 'Cooked'), state-specific `normalized_name` (e.g. 'oats, dry' and 'oats, cooked'), `display_name` (e.g. 'Oats (Dry)' and 'Oats (Cooked)'), default `quantity_g` (for exact gram inputs like '300 gms oats', both variants have quantity_g = 300; for volume/household inputs like '1 cup oats', use each state's appropriate weight such as 85g dry and 200g cooked), and `macros_per_100g`.",
      "  - Set `selected_state` to 'dry' when dry pantry staples like oats are weighed in grams ('300 gms oats'), and 'cooked' for meal items or volume units ('200g rice', '1 cup oats', '150g chicken breast').",
      "- If the user explicitly specified the state (e.g., '100g dry oats', '1 bowl cooked oatmeal', '150g raw chicken'), omit `variants`. ",
      "Rules for quantity_g:",
      "- Normalize quantities to grams (quantity_g). Use food-specific gram weights for containers/pieces (e.g., 1 cup dry oats = 85g, 1 slice cheese = 20g), and use these standard household reference weights for cooked dishes when applicable:",
      "  - 1 medium katori = 150g",
      "  - 1 cup cooked = 200g",
      "  - 1 roti or chapati = 35g",
      "  - 1 slice bread = 30g",
      "  - 1 large egg = 50g",
      "  - 1 tbsp = 15g",
      "  - 1 tsp = 5g",
      "Rules for estimated_macros_per_100g / macros_per_100g:",
      "- Provide accurate emergency fallback macros strictly per 100g (never for total serving): calories_per_100g (must equal ~4*protein + 4*carbs + 9*fat, max 900), protein_per_100g, carbs_per_100g, fat_per_100g (sum of protein + carbs + fat <= 100g).",
      "- Set is_estimated: false for standard single-ingredient staples with well-known reference values (e.g., oats, eggs, plain rice, chicken breast, milk, banana, curd/yogurt).",
      "- Set is_estimated: true for prepared/composite dishes and recipes whose macros vary by preparation (e.g., dal tadka, paneer butter masala, biryani, sandwich).",
      'Return JSON matching: { "items": [{ "normalized_name": string, "display_name": string, "normalized_query"?: string, "is_composite"?: boolean, "candidate_ingredients"?: [{ "name": string, "normalized_query": string, "quantity_g": number }], "quantity": number, "unit": string, "quantity_g": number, "estimated_macros_per_100g"?: { "calories_per_100g": number, "protein_per_100g": number, "carbs_per_100g": number, "fat_per_100g": number, "is_estimated": boolean }, "selected_state"?: "dry" | "raw" | "cooked", "variants"?: [{ "state": "dry" | "raw" | "cooked", "label": string, "normalized_name": string, "display_name": string, "quantity_g": number, "macros_per_100g": { "calories_per_100g": number, "protein_per_100g": number, "carbs_per_100g": number, "fat_per_100g": number, "is_estimated": boolean } }] }] }.',
      `Meal text: ${text}`,
    ].join("\n");

    const response = await this.generateContentWithRetry({
      model: this.model,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    if (!response.text) {
      throw new UnparseableMealError(
        "Gemini returned an empty response while parsing meal"
      );
    }

    const cleanedText = response.text
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(cleanedText);
    } catch {
      throw new UnparseableMealError(
        "Gemini returned invalid JSON while parsing meal"
      );
    }

    const validationResult = parsedMealResponseSchema.safeParse(parsedJson);
    if (!validationResult.success) {
      throw new UnparseableMealError(
        "Gemini output did not match parsed meal schema"
      );
    }
    const validated = validationResult.data;

    return validated.items.map((item) => {
      const quantity = item.quantity ?? item.quantity_g ?? 100;
      const unit = item.unit ?? "g";
      const quantityG =
        item.quantity !== undefined && item.unit !== undefined
          ? normalizeHouseholdUnitToGrams(
              item.quantity,
              item.unit,
              item.quantity_g
            )
          : (item.quantity_g ?? normalizeHouseholdUnitToGrams(quantity, unit));

      if (quantityG <= 0) {
        throw new UnparseableMealError(
          `Invalid resolved quantity_g for ${item.display_name}`
        );
      }

      const parsedItem: ParsedMealItem = {
        normalized_name: item.normalized_name.trim().toLowerCase(),
        display_name: item.display_name.trim(),
        quantity,
        unit,
        quantity_g: quantityG,
      };
      if (item.normalized_query) {
        parsedItem.normalized_query = item.normalized_query.trim();
      }
      if (item.is_composite) {
        parsedItem.is_composite = true;
      }
      if (item.candidate_ingredients && item.candidate_ingredients.length > 0) {
        parsedItem.candidate_ingredients = item.candidate_ingredients.map(
          (c) => ({
            name: c.name.trim(),
            normalized_query: c.normalized_query.trim().toLowerCase(),
            quantity_g: c.quantity_g,
          })
        );
      }
      if (item.estimated_macros_per_100g) {
        parsedItem.estimated_macros_per_100g = item.estimated_macros_per_100g;
      }

      if (item.variants && item.variants.length >= 2) {
        const seenStates = new Set<PreparationState>();
        const normalizedVariants: ParsedMealVariant[] = [];

        for (const v of item.variants) {
          if (seenStates.has(v.state)) {
            continue;
          }
          seenStates.add(v.state);
          const variantQtyG =
            item.quantity !== undefined &&
            item.unit !== undefined &&
            isExactMassUnit(item.unit)
              ? quantityG
              : Math.round(v.quantity_g * 100) / 100;

          normalizedVariants.push({
            state: v.state,
            label: v.label?.trim() || DEFAULT_STATE_LABELS[v.state],
            normalized_name: v.normalized_name.trim().toLowerCase(),
            display_name: v.display_name.trim(),
            quantity_g: variantQtyG,
            macros_per_100g: v.macros_per_100g,
          });
        }

        if (normalizedVariants.length >= 2) {
          const preferredDefaultState: PreparationState =
            item.selected_state ??
            (isExactMassUnit(unit) && isDryPantryStaple(parsedItem.normalized_name)
              ? "dry"
              : "cooked");

          const selectedVariant =
            normalizedVariants.find((v) => v.state === preferredDefaultState) ??
            normalizedVariants.find((v) => v.state === "cooked") ??
            normalizedVariants[0];

          parsedItem.selected_state = selectedVariant.state;
          parsedItem.variants = normalizedVariants;
          parsedItem.normalized_name = selectedVariant.normalized_name;
          parsedItem.display_name = selectedVariant.display_name;
          parsedItem.quantity_g = selectedVariant.quantity_g;
          parsedItem.estimated_macros_per_100g =
            selectedVariant.macros_per_100g;
        }
      }

      return parsedItem;
    });
  }

  async estimateMacrosPer100g(foodName: string): Promise<MacroPer100g> {
    const prompt = [
      `Provide the nutritional macros strictly per 100g for the food item: "${foodName}".`,
      "Ensure protein_per_100g + carbs_per_100g + fat_per_100g <= 100g and calories_per_100g aligns with 4*protein + 4*carbs + 9*fat.",
      "Set is_estimated to false for standard single-ingredient staples (e.g., oats, eggs, plain rice, chicken breast, milk, banana) and true for prepared/composite dishes.",
      'Return JSON matching: { "calories_per_100g": number, "protein_per_100g": number, "carbs_per_100g": number, "fat_per_100g": number, "is_estimated": boolean }.',
    ].join("\n");

    const response = await this.generateContentWithRetry({
      model: this.model,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    if (!response.text) {
      throw new Error(
        `Gemini returned an empty response while estimating macros for ${foodName}`
      );
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(response.text);
    } catch {
      throw new UnparseableMealError(
        `Gemini returned invalid JSON while estimating macros for ${foodName}`
      );
    }

    const validated = normalizeAndValidateMacrosPer100g(
      parsedJson as MacroPer100g
    );

    return {
      calories_per_100g: validated.calories_per_100g,
      protein_per_100g: validated.protein_per_100g,
      carbs_per_100g: validated.carbs_per_100g,
      fat_per_100g: validated.fat_per_100g,
      is_estimated: validated.is_estimated ?? true,
    };
  }
}
