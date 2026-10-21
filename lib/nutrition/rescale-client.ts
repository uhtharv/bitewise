import type { PreparationState } from "@/lib/ai/provider";
import type { CreateEntriesInput } from "@/lib/api/client";
import type { MealType } from "@/lib/dates";
import type { ResolvedMealItem } from "@/lib/nutrition/resolve-food";

export interface EditableAnalyzedItem extends ResolvedMealItem {
  clientId: string;
  rawQuantityInput: string;
  hasCustomQuantity?: boolean;
}

export function scaleMacroValue(per100g: number, quantityG: number): number {
  if (!Number.isFinite(quantityG) || quantityG <= 0) {
    return 0;
  }
  return Math.round(((per100g * quantityG) / 100) * 10) / 10;
}

/**
 * Proportionally rescales an analyzed meal item's macros on the client
 * (`docs/FRONTEND_PRD.md` §3 S2 & §7: `value_per_100g * quantity_g / 100`).
 */
export function rescaleAnalyzedItem<T extends ResolvedMealItem>(
  item: T,
  newQuantityG: number
): T {
  const safeQuantity =
    Number.isFinite(newQuantityG) && newQuantityG > 0 ? newQuantityG : 0;

  return {
    ...item,
    quantity_g: safeQuantity,
    calories: scaleMacroValue(item.calories_per_100g, safeQuantity),
    protein_g: scaleMacroValue(item.protein_per_100g, safeQuantity),
    carbs_g: scaleMacroValue(item.carbs_per_100g, safeQuantity),
    fat_g: scaleMacroValue(item.fat_per_100g, safeQuantity),
  };
}

export function toEditableAnalyzedItems(
  items: ResolvedMealItem[]
): EditableAnalyzedItem[] {
  return items.map((item, index) => ({
    ...item,
    clientId: `${item.food_id || item.food_name}-${index}`,
    rawQuantityInput: String(item.quantity_g),
    hasCustomQuantity: false,
  }));
}

export function updateEditableItemQuantity(
  items: EditableAnalyzedItem[],
  clientId: string,
  rawInput: string
): EditableAnalyzedItem[] {
  return items.map((item) => {
    if (item.clientId !== clientId) {
      return item;
    }
    const trimmed = rawInput.trim();
    const parsed = trimmed === "" ? Number.NaN : Number(trimmed);
    const nextQuantity =
      Number.isFinite(parsed) && parsed > 0
        ? Math.round(parsed * 100) / 100
        : 0;
    const rescaled = rescaleAnalyzedItem(item, nextQuantity);
    return {
      ...rescaled,
      rawQuantityInput: rawInput,
      hasCustomQuantity: true,
    };
  });
}

/**
 * Switches an analyzed item's active preparation state variant (`dry`/`raw` vs `cooked`).
 * Uses the variant's default `quantity_g` unless the user has manually edited the Grams input
 * (`hasCustomQuantity = true`), in which case their custom `quantity_g` is preserved and rescaled.
 */
export function selectEditableItemVariant(
  items: EditableAnalyzedItem[],
  clientId: string,
  state: PreparationState
): EditableAnalyzedItem[] {
  return items.map((item) => {
    if (item.clientId !== clientId || !item.variants) {
      return item;
    }
    const targetVariant = item.variants.find((v) => v.state === state);
    if (!targetVariant) {
      return item;
    }

    const nextQuantityG = item.hasCustomQuantity
      ? item.quantity_g
      : targetVariant.quantity_g;
    const nextRawQuantityInput = item.hasCustomQuantity
      ? item.rawQuantityInput
      : String(targetVariant.quantity_g);

    const updatedBase: EditableAnalyzedItem = {
      ...item,
      selected_state: targetVariant.state,
      food_id: targetVariant.food_id,
      food_name: targetVariant.food_name,
      calories_per_100g: targetVariant.calories_per_100g,
      protein_per_100g: targetVariant.protein_per_100g,
      carbs_per_100g: targetVariant.carbs_per_100g,
      fat_per_100g: targetVariant.fat_per_100g,
      is_estimated: targetVariant.is_estimated,
      rawQuantityInput: nextRawQuantityInput,
    };

    return rescaleAnalyzedItem(updatedBase, nextQuantityG);
  });
}

export function removeEditableItem(
  items: EditableAnalyzedItem[],
  clientId: string
): EditableAnalyzedItem[] {
  return items.filter((item) => item.clientId !== clientId);
}

export function hasInvalidEditableQuantities(
  items: EditableAnalyzedItem[]
): boolean {
  if (items.length === 0) {
    return false;
  }
  return items.some((item) => {
    const trimmed = item.rawQuantityInput.trim();
    if (trimmed === "") {
      return true;
    }
    const num = Number(trimmed);
    return !Number.isFinite(num) || num <= 0 || item.quantity_g <= 0;
  });
}

export function canSubmitAnalyzedItems(
  items: EditableAnalyzedItem[]
): boolean {
  return items.length > 0 && !hasInvalidEditableQuantities(items);
}

export function buildCreateEntriesPayload(
  items: EditableAnalyzedItem[],
  loggedOn: string,
  mealType: MealType
): CreateEntriesInput | null {
  if (!canSubmitAnalyzedItems(items)) {
    return null;
  }

  return {
    logged_on: loggedOn,
    meal_type: mealType,
    items: items.map((item) => ({
      food_id: item.food_id || null,
      food_name: item.food_name,
      quantity_g: item.quantity_g,
      calories: item.calories,
      protein_g: item.protein_g,
      carbs_g: item.carbs_g,
      fat_g: item.fat_g,
      calories_per_100g: item.calories_per_100g,
      protein_per_100g: item.protein_per_100g,
      carbs_per_100g: item.carbs_per_100g,
      fat_per_100g: item.fat_per_100g,
      is_estimated: item.is_estimated,
    })),
  };
}
