import { describe, expect, it } from "vitest";
import { normalizeIfctFood } from "@/scripts/etl/sources/ifct";
import {
  isIndianMarketProduct,
  normalizeOpenFoodFactsProduct,
} from "@/scripts/etl/sources/openfoodfacts";
import { normalizeUsdaFood } from "@/scripts/etl/sources/usda";

describe("ETL Normalizers Suite (scripts/etl)", () => {
  describe("USDA normalizer", () => {
    it("maps nutrient IDs to standard macro schema and canonicalizes names", () => {
      const rawUsda = {
        fdcId: 170567,
        description: "Oats, rolled, raw",
        foodCategory: "Cereal Grains and Pastas",
        foodNutrients: [
          { nutrientId: 1008, value: 379 },
          { nutrientId: 1003, value: 13.15 },
          { nutrientId: 1005, value: 67.7 },
          { nutrientId: 1004, value: 6.52 },
          { nutrientId: 1079, value: 10.1 },
        ],
      };

      const normalized = normalizeUsdaFood(rawUsda);
      expect(normalized).not.toBeNull();
      expect(normalized?.source).toBe("usda");
      expect(normalized?.calories_per_100g).toBe(379);
      expect(normalized?.protein_per_100g).toBe(13.2);
      expect(normalized?.carbs_per_100g).toBe(67.7);
      expect(normalized?.fat_per_100g).toBe(6.5);
      expect(normalized?.fiber_per_100g).toBe(10.1);
      expect(normalized?.is_estimated).toBe(false);
    });

    it("rejects USDA entries with impossible physical macro sums > 105g", () => {
      const badUsda = {
        fdcId: 9999,
        description: "Impossible Powder",
        foodNutrients: [
          { nutrientId: 1003, value: 60 },
          { nutrientId: 1005, value: 50 },
          { nutrientId: 1004, value: 20 }, // 60 + 50 + 20 = 130g
        ],
      };
      expect(normalizeUsdaFood(badUsda)).toBeNull();
    });
  });

  describe("ICMR-NIN IFCT normalizer", () => {
    it("normalizes Indian staples and preserves regional aliases", () => {
      const rawIfct = {
        code: "B001",
        name: "Bengal gram, dal",
        group: "Pulses and legumes",
        energyKcal: 372,
        proteinG: 20.8,
        carbsG: 59.8,
        fatG: 5.6,
        fiberG: 15.3,
        regionalNames: ["Chana dal", "Kadale bele"],
        aliases: ["Split chickpea"],
      };

      const normalized = normalizeIfctFood(rawIfct);
      expect(normalized).not.toBeNull();
      expect(normalized?.source).toBe("ifct");
      expect(normalized?.display_name).toBe("Bengal gram, dal");
      expect(normalized?.calories_per_100g).toBe(372);
      expect(normalized?.search_aliases).toContain("chana dal");
      expect(normalized?.search_aliases).toContain("split chickpea");
      expect(normalized?.is_estimated).toBe(false);
    });
  });

  describe("Open Food Facts Indian market normalizer", () => {
    it("identifies Indian products by 890 barcode or india country tag", () => {
      expect(isIndianMarketProduct({ code: "8901234567890" })).toBe(true);
      expect(
        isIndianMarketProduct({
          code: "123456",
          countries_tags: ["en:india", "en:world"],
        })
      ).toBe(true);
      expect(
        isIndianMarketProduct({
          code: "3017620422003",
          countries_tags: ["en:france"],
        })
      ).toBe(false);
    });

    it("normalizes packaged products with brands and nutriments", () => {
      const rawProduct = {
        code: "8901058852393",
        product_name: "Maggi 2-Minute Noodles",
        brands: "Nestle",
        countries_tags: ["en:india"],
        nutriments: {
          "energy-kcal_100g": 427,
          proteins_100g: 8,
          carbohydrates_100g: 63.5,
          fat_100g: 15.7,
          fiber_100g: 3.5,
        },
      };

      const normalized = normalizeOpenFoodFactsProduct(rawProduct);
      expect(normalized).not.toBeNull();
      expect(normalized?.brand).toBe("Nestle");
      expect(normalized?.display_name).toBe("Nestle - Maggi 2-Minute Noodles");
      expect(normalized?.calories_per_100g).toBe(427);
      expect(normalized?.protein_per_100g).toBe(8);
      expect(normalized?.is_estimated).toBe(false);
    });
  });
});

