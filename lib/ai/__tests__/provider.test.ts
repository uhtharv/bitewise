import { describe, expect, it, vi } from "vitest";
import {
  GeminiProvider,
  parsedMealResponseSchema,
} from "@/lib/ai/provider";

const VALID_ENV = {
  GEMINI_API_KEY: "test-gemini-key",
  GEMINI_MODEL: "gemini-2.5-flash",
  FOOD_DATABASE_URL: "https://food-ref.supabase.co",
  FOOD_DATABASE_ANON_KEY: "food-ref-anon-key",
};

describe("AI Provider Schema and Response Parsing (FR-2, FR-7)", () => {
  it("parses standard object response with { items: [...] }", () => {
    const raw = {
      items: [
        {
          normalized_name: "white rice, cooked",
          display_name: "White Rice (Cooked)",
          quantity_g: 200,
        },
      ],
    };

    const parsed = parsedMealResponseSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.items).toHaveLength(1);
      expect(parsed.data.items[0]?.normalized_name).toBe("white rice, cooked");
    }
  });

  it("regression: parses top-level array [...] directly without throwing 422 UnparseableMealError", () => {
    const rawArray = [
      {
        normalized_name: "white rice, cooked",
        display_name: "White Rice (Cooked)",
        quantity_g: 200,
      },
      {
        normalized_name: "dal tadka",
        display_name: "Dal Tadka",
        quantity_g: 150,
      },
    ];

    const parsed = parsedMealResponseSchema.safeParse(rawArray);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.items).toHaveLength(2);
      expect(parsed.data.items[0]?.normalized_name).toBe("white rice, cooked");
      expect(parsed.data.items[1]?.normalized_name).toBe("dal tadka");
    }
  });

  it("GeminiProvider strips markdown code fences when parsing meal text", async () => {
    process.env = { ...process.env, ...VALID_ENV };

    const mockClient = {
      models: {
        generateContent: vi.fn().mockResolvedValue({
          text: '```json\n[\n  {\n    "normalized_name": "rolled oats, raw",\n    "display_name": "Rolled Oats",\n    "quantity_g": 100\n  }\n]\n```',
        }),
      },
    };

    const provider = new GeminiProvider({ client: mockClient });
    const items = await provider.parseMealText("100g oats");

    expect(items).toHaveLength(1);
    expect(items[0]?.normalized_name).toBe("rolled oats, raw");
    expect(items[0]?.quantity_g).toBe(100);
  });
});
