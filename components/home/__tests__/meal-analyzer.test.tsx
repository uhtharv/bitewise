import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  AnalyzedResultsView,
  MealAnalyzerFallback,
} from "@/components/home/meal-analyzer";
import { mapStatusToUserMessage } from "@/lib/api/client";
import {
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

describe("AnalyzedResultsView (Home S2)", () => {
  it("renders a deterministic static shell in MealAnalyzerFallback", () => {
    const html = renderToStaticMarkup(<MealAnalyzerFallback />);
    expect(html).toContain("What did you eat?");
    expect(html).toContain("Meal description");
  });

  it("renders the Estimated badge only for is_estimated: true items and displays rescaled macros", () => {
    const editable = toEditableAnalyzedItems(SAMPLE_ITEMS);
    const html = renderToStaticMarkup(
      <AnalyzedResultsView
        items={editable}
        mealType="lunch"
        todayDate="2026-10-10"
      />
    );

    expect(html).toContain("Dal Tadka");
    expect(html).toContain("Boiled Egg");
    // Only Dal Tadka has is_estimated: true -> 1 Estimated badge
    const badgeMatches = html.match(/>Estimated</g) ?? [];
    expect(badgeMatches).toHaveLength(1);
    expect(html).toContain("330 kcal");
    expect(html).toContain("Add to today&#x27;s log");
  });

  it("disables Add to today's log and renders an inline hint when any item has quantity_g <= 0", () => {
    const editable = updateEditableItemQuantity(
      toEditableAnalyzedItems(SAMPLE_ITEMS),
      "11111111-1111-4111-8111-111111111111-0",
      "0"
    );

    const html = renderToStaticMarkup(
      <AnalyzedResultsView
        items={editable}
        mealType="lunch"
        todayDate="2026-10-10"
      />
    );

    expect(html).toContain(
      "Enter a quantity greater than 0 g for each item (or remove unwanted items) before saving."
    );
  });

  it("renders mapped inline error messages for 422, 429, and 502 with a retry action", () => {
    for (const status of [422, 429, 502] as const) {
      const expectedCopy = mapStatusToUserMessage(status);
      const html = renderToStaticMarkup(
        <AnalyzedResultsView
          items={[]}
          mealType="lunch"
          todayDate="2026-10-10"
          analyzeError={expectedCopy}
        />
      );
      const unescapedHtml = html.replaceAll("&#x27;", "'");
      expect(unescapedHtml).toContain(expectedCopy);
      expect(unescapedHtml).toContain("Try again");
    }
  });

  it("renders loading skeletons when isAnalyzing is true", () => {
    const html = renderToStaticMarkup(
      <AnalyzedResultsView
        items={[]}
        mealType="lunch"
        todayDate="2026-10-10"
        isAnalyzing={true}
      />
    );
    expect(html).toContain("Analyzing meal...");
  });

  it("renders inline Dry / Cooked Button pill toggle only for items with ambiguous preparation variants", () => {
    const itemsWithAndWithoutVariants: ResolvedMealItem[] = [
      {
        food_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        food_name: "Oats (Dry)",
        quantity_g: 300,
        calories: 1137,
        protein_g: 39.6,
        carbs_g: 203.1,
        fat_g: 19.5,
        calories_per_100g: 379,
        protein_per_100g: 13.2,
        carbs_per_100g: 67.7,
        fat_per_100g: 6.5,
        is_estimated: false,
        selected_state: "dry",
        variants: [
          {
            state: "dry",
            label: "Dry",
            food_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            food_name: "Oats (Dry)",
            quantity_g: 300,
            calories: 1137,
            protein_g: 39.6,
            carbs_g: 203.1,
            fat_g: 19.5,
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
      },
      ...SAMPLE_ITEMS,
    ];

    const editable = toEditableAnalyzedItems(itemsWithAndWithoutVariants);
    const html = renderToStaticMarkup(
      <AnalyzedResultsView
        items={editable}
        mealType="dinner"
        todayDate="2026-10-12"
      />
    );

    expect(html).toContain('aria-label="Preparation state for Oats (Dry)"');
    expect(html).toContain(">Dry<");
    expect(html).toContain(">Cooked<");
    expect(html).not.toContain('aria-label="Preparation state for Dal Tadka"');
  });
});

