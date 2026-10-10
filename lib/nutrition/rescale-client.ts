import type { CreateEntriesInput } from "@/lib/api/client";
import type { MealType } from "@/lib/dates";
import type { ResolvedMealItem } from "@/lib/nutrition/resolve-food";

export interface EditableAnalyzedItem extends ResolvedMealItem {
  clientId: string;
  rawQuantityInput: string;
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
    };
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
      is_estimated: item.is_estimated,
    })),
  };
}

