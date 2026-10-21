import { describe, expect, it } from "vitest";
import {
  buildCreateEntriesPayload,
  canSubmitAnalyzedItems,
  hasInvalidEditableQuantities,
  removeEditableItem,
  rescaleAnalyzedItem,
  selectEditableItemVariant,
  toEditableAnalyzedItems,
  updateEditableItemQuantity,
} from "@/lib/nutrition/rescale-client";
import type { ResolvedMealItem } from "@/lib/nutrition/resolve-food";

const SAMPLE_ITEMS: ResolvedMealItem[] = [
  {
    food_id: "11111111-1111-4111-8111-111111111111",
    food_name: "Dal Tadka",
    quantity_g: 300,
    calories: 330,
    protein_g: 16.5,
    carbs_g: 42,
    fat_g: 10.5,
    calories_per_100g: 110,
    protein_per_100g: 5.5,
    carbs_per_100g: 14,
    fat_per_100g: 3.5,
    is_estimated: true,
  },
  {
    food_id: "22222222-2222-4222-8222-222222222222",
    food_name: "Boiled Egg",
    quantity_g: 100,
    calories: 155,
    protein_g: 12.6,
    carbs_g: 1.1,
    fat_g: 10.6,
    calories_per_100g: 155,
    protein_per_100g: 12.6,
    carbs_per_100g: 1.1,
    fat_per_100g: 10.6,
    is_estimated: false,
  },
];

const VARIANT_CUP_OATS_ITEM: ResolvedMealItem = {
  food_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  food_name: "Oats (Cooked)",
  quantity_g: 200,
  calories: 142,
  protein_g: 5,
  carbs_g: 24,
  fat_g: 2.8,
  calories_per_100g: 71,
  protein_per_100g: 2.5,
  carbs_per_100g: 12,
  fat_per_100g: 1.4,
  is_estimated: false,
  selected_state: "cooked",
  variants: [
    {
      state: "dry",
      label: "Dry",
      food_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      food_name: "Oats (Dry)",
      quantity_g: 85,
      calories: 322.2,
      protein_g: 11.2,
      carbs_g: 57.5,
      fat_g: 5.5,
      calories_per_100g: 379,
      protein_per_100g: 13.2,
      carbs_per_100g: 67.7,
      fat_per_100g: 6.5,
      is_estimated: false,
    },
    {
      state: "cooked",
      label: "Cooked",
      food_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      food_name: "Oats (Cooked)",
      quantity_g: 200,
      calories: 142,
      protein_g: 5,
      carbs_g: 24,
      fat_g: 2.8,
      calories_per_100g: 71,
      protein_per_100g: 2.5,
      carbs_per_100g: 12,
      fat_per_100g: 1.4,
      is_estimated: false,
    },
  ],
};

describe("lib/nutrition/rescale-client", () => {
  it("rescales calories, protein_g, carbs_g, and fat_g proportionally from per-100g values", () => {
    const rescaled = rescaleAnalyzedItem(SAMPLE_ITEMS[0], 150);
    expect(rescaled.quantity_g).toBe(150);
    expect(rescaled.calories).toBe(165);
    expect(rescaled.protein_g).toBe(8.3);
    expect(rescaled.carbs_g).toBe(21);
    expect(rescaled.fat_g).toBe(5.3);
    expect(rescaled.is_estimated).toBe(true);
  });

  it("updates editable item quantity, flags invalid (<= 0 or empty) quantities, and builds POST /api/entries payload", () => {
    let editable = toEditableAnalyzedItems(SAMPLE_ITEMS);
    expect(canSubmitAnalyzedItems(editable)).toBe(true);

    // Edit first item from 300g to 200g
    editable = updateEditableItemQuantity(editable, editable[0].clientId, "200");
    expect(editable[0].quantity_g).toBe(200);
    expect(editable[0].calories).toBe(220);
    expect(editable[0].protein_g).toBe(11);
    expect(editable[0].carbs_g).toBe(28);
    expect(editable[0].fat_g).toBe(7);

    // Set invalid quantity "0" -> disables submission and sets invalid flag
    const invalidZero = updateEditableItemQuantity(
      editable,
      editable[0].clientId,
      "0"
    );
    expect(hasInvalidEditableQuantities(invalidZero)).toBe(true);
    expect(canSubmitAnalyzedItems(invalidZero)).toBe(false);
    expect(
      buildCreateEntriesPayload(invalidZero, "2026-10-10", "lunch")
    ).toBeNull();

    // Set blank quantity "" -> disables submission
    const invalidEmpty = updateEditableItemQuantity(
      editable,
      editable[0].clientId,
      "   "
    );
    expect(hasInvalidEditableQuantities(invalidEmpty)).toBe(true);
    expect(canSubmitAnalyzedItems(invalidEmpty)).toBe(false);

    // Remove second item and build payload
    const single = removeEditableItem(editable, editable[1].clientId);
    expect(single).toHaveLength(1);
    const payload = buildCreateEntriesPayload(single, "2026-10-10", "lunch");
    expect(payload).toEqual({
      logged_on: "2026-10-10",
      meal_type: "lunch",
      items: [
        {
          food_id: "11111111-1111-4111-8111-111111111111",
          food_name: "Dal Tadka",
          quantity_g: 200,
          calories: 220,
          protein_g: 11,
          carbs_g: 28,
          fat_g: 7,
          calories_per_100g: 110,
          protein_per_100g: 5.5,
          carbs_per_100g: 14,
          fat_per_100g: 3.5,
          is_estimated: true,
        },
      ],
    });
  });

  it("switches between Dry and Cooked variants using variant default quantity_g before manual edit, and preserves custom quantity_g after manual edit", () => {
    let editable = toEditableAnalyzedItems([VARIANT_CUP_OATS_ITEM]);
    const clientId = editable[0].clientId;

    // 1. Before manual edit: switching "1 cup oats" from Cooked (200g) to Dry switches quantity_g to 85g
    editable = selectEditableItemVariant(editable, clientId, "dry");
    expect(editable[0].selected_state).toBe("dry");
    expect(editable[0].food_id).toBe("dddddddd-dddd-4ddd-8ddd-dddddddddddd");
    expect(editable[0].food_name).toBe("Oats (Dry)");
    expect(editable[0].quantity_g).toBe(85);
    expect(editable[0].rawQuantityInput).toBe("85");
    expect(editable[0].calories).toBe(322.2);

    // 2. User manually types "300" into Grams input while on Dry (300g -> 1137 kcal)
    editable = updateEditableItemQuantity(editable, clientId, "300");
    expect(editable[0].quantity_g).toBe(300);
    expect(editable[0].calories).toBe(1137);

    // 3. After manual edit: switching from Dry to Cooked preserves custom 300g and rescales to Cooked macros (213 kcal)
    editable = selectEditableItemVariant(editable, clientId, "cooked");
    expect(editable[0].selected_state).toBe("cooked");
    expect(editable[0].food_id).toBe("cccccccc-cccc-4ccc-8ccc-cccccccccccc");
    expect(editable[0].food_name).toBe("Oats (Cooked)");
    expect(editable[0].quantity_g).toBe(300);
    expect(editable[0].rawQuantityInput).toBe("300");
    expect(editable[0].calories).toBe(213);
    expect(editable[0].protein_g).toBe(7.5);
    expect(editable[0].carbs_g).toBe(36);
    expect(editable[0].fat_g).toBe(4.2);

    // 4. Payload sends the selected variant's fields
    const payload = buildCreateEntriesPayload(editable, "2026-10-12", "dinner");
    expect(payload).toEqual({
      logged_on: "2026-10-12",
      meal_type: "dinner",
      items: [
        {
          food_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          food_name: "Oats (Cooked)",
          quantity_g: 300,
          calories: 213,
          protein_g: 7.5,
          carbs_g: 36,
          fat_g: 4.2,
          calories_per_100g: 71,
          protein_per_100g: 2.5,
          carbs_per_100g: 12,
          fat_per_100g: 1.4,
          is_estimated: false,
        },
      ],
    });
  });
});
