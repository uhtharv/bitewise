import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

export interface ParsedMealItem {
  normalized_name: string;
  display_name: string;
  quantity_g: number;
  quantity?: number;
  unit?: string;
  estimated_macros_per_100g?: MacroPer100g;
}

export interface MacroPer100g {
  calories_per_100g: number;
  protein_per_100g: number;
  carbs_per_100g: number;
  fat_per_100g: number;
  is_estimated?: boolean;
}

export interface AIProvider {
  parseMealText(text: string): Promise<ParsedMealItem[]>;
  estimateMacrosPer100g(foodName: string): Promise<MacroPer100g>;
}

const HOUSEHOLD_UNIT_GRAMS: Record<string, number> = {
  g: 1,
  gram: 1,
  grams: 1,
  kg: 1000,
  kilogram: 1000,
  kilograms: 1000,
  ml: 1,
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
  tbsp: 15,
  tablespoon: 15,
  tablespoons: 15,
  tsp: 5,
  teaspoon: 5,
  teaspoons: 5,
  bowl: 250,
  bowls: 250,
  idli: 40,
  idlis: 40,
  dosa: 80,
  dosas: 80,
  oz: 28.35,
  ounce: 28.35,
  ounces: 28.35,
  lb: 453.6,
  pound: 453.6,
  pounds: 453.6,
};

/**
 * Normalizes a household unit and quantity into grams using the reference weights
 * specified in `docs/BACKEND_PRD.md` §7.
 */
export function normalizeHouseholdUnitToGrams(
  quantity: number,
  unit: string,
  fallbackQuantityG?: number
): number {
  const normalizedUnit = unit.trim().toLowerCase();
  const multiplier = HOUSEHOLD_UNIT_GRAMS[normalizedUnit];
  if (multiplier !== undefined) {
    return Math.round(quantity * multiplier * 100) / 100;
  }
  if (fallbackQuantityG !== undefined && fallbackQuantityG > 0) {
    return Math.round(fallbackQuantityG * 100) / 100;
  }
  return Math.round(quantity * 100) / 100;
}

export const macroPer100gSchema = z.object({
  calories_per_100g: z.number().min(0),
  protein_per_100g: z.number().min(0),
  carbs_per_100g: z.number().min(0),
  fat_per_100g: z.number().min(0),
});

const rawParsedItemSchema = z.object({
  normalized_name: z.string().trim().min(1),
  display_name: z.string().trim().min(1),
  quantity: z.number().positive().optional(),
  unit: z.string().trim().min(1).optional(),
  quantity_g: z.number().positive().optional(),
  estimated_macros_per_100g: macroPer100gSchema.optional(),
});

export const parsedMealResponseSchema = z.object({
  items: z.array(rawParsedItemSchema),
});

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
}

export class UnparseableMealError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnparseableMealError";
  }
}

export class GeminiProvider implements AIProvider {
  private readonly model: string;
  private readonly client: GenAIClientLike;

  constructor(options?: GeminiProviderOptions) {
    const resolvedModel = (
      options?.model ?? process.env.GEMINI_MODEL
    )?.trim();
    if (!resolvedModel) {
      throw new Error(
        "Missing required environment variable: GEMINI_MODEL must be set"
      );
    }
    this.model = resolvedModel;

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

  async parseMealText(text: string): Promise<ParsedMealItem[]> {
    const prompt = [
      "Parse the following meal description (English, Indian/regional dish names, or Hinglish) into individual food items.",
      "Normalize quantities to grams (quantity_g) using these standard household reference weights:",
      "- 1 medium katori = 150g",
      "- 1 cup cooked = 200g",
      "- 1 roti or chapati = 35g",
      "- 1 slice bread = 30g",
      "- 1 large egg = 50g",
      "- 1 tbsp = 15g",
      "- 1 tsp = 5g",
      "Also include estimated_macros_per_100g (calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g) for each item as a fallback in case it is not found in USDA.",
      'Return JSON matching: { "items": [{ "normalized_name": string, "display_name": string, "quantity": number, "unit": string, "quantity_g": number, "estimated_macros_per_100g": { "calories_per_100g": number, "protein_per_100g": number, "carbs_per_100g": number, "fat_per_100g": number } }] }.',
      `Meal text: ${text}`,
    ].join("\n");

    const response = await this.client.models.generateContent({
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

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(response.text);
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
      if (item.estimated_macros_per_100g) {
        parsedItem.estimated_macros_per_100g = item.estimated_macros_per_100g;
      }
      return parsedItem;
    });
  }

  async estimateMacrosPer100g(foodName: string): Promise<MacroPer100g> {
    const prompt = [
      `Estimate the nutritional macros per 100g for the food item: "${foodName}".`,
      'Return JSON matching: { "calories_per_100g": number, "protein_per_100g": number, "carbs_per_100g": number, "fat_per_100g": number }.',
    ].join("\n");

    const response = await this.client.models.generateContent({
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

    const parsedJson: unknown = JSON.parse(response.text);
    const validated = macroPer100gSchema.parse(parsedJson);

    return {
      calories_per_100g: validated.calories_per_100g,
      protein_per_100g: validated.protein_per_100g,
      carbs_per_100g: validated.carbs_per_100g,
      fat_per_100g: validated.fat_per_100g,
      is_estimated: true,
    };
  }
}

