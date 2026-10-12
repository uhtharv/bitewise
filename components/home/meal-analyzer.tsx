"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2Icon, SparklesIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import type { PreparationState } from "@/lib/ai/provider";
import {
  analyzeMeal,
  ApiClientError,
  createEntries,
  getUserSettings,
  mapStatusToUserMessage,
} from "@/lib/api/client";
import {
  getDefaultMealType,
  getTodayInTimezone,
  resolveActiveTimezone,
  type MealType,
} from "@/lib/dates";
import {
  buildCreateEntriesPayload,
  canSubmitAnalyzedItems,
  hasInvalidEditableQuantities,
  removeEditableItem,
  selectEditableItemVariant,
  toEditableAnalyzedItems,
  updateEditableItemQuantity,
  type EditableAnalyzedItem,
} from "@/lib/nutrition/rescale-client";

const MEAL_TYPE_LABELS: Record<MealType, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
};

export interface AnalyzedResultsViewProps {
  items: EditableAnalyzedItem[];
  mealType: MealType;
  todayDate: string;
  isAnalyzing?: boolean;
  isSaving?: boolean;
  analyzeError?: string | null;
  saveError?: string | null;
  onQuantityChange?: (clientId: string, rawValue: string) => void;
  onSelectVariant?: (clientId: string, state: PreparationState) => void;
  onRemoveItem?: (clientId: string) => void;
  onMealTypeChange?: (mealType: MealType) => void;
  onRetryAnalyze?: () => void;
  onSaveEntries?: () => void;
}

export function AnalyzedResultsView({
  items,
  mealType,
  todayDate,
  isAnalyzing = false,
  isSaving = false,
  analyzeError = null,
  saveError = null,
  onQuantityChange,
  onSelectVariant,
  onRemoveItem,
  onMealTypeChange,
  onRetryAnalyze,
  onSaveEntries,
}: AnalyzedResultsViewProps) {
  const hasInvalidQuantity = hasInvalidEditableQuantities(items);
  const canSave = canSubmitAnalyzedItems(items) && !isSaving;

  if (isAnalyzing) {
    return (
      <Card aria-busy="true" aria-label="Analyzing your meal">
        <CardHeader>
          <CardTitle>Analyzing meal...</CardTitle>
          <CardDescription>
            Looking up nutrition data and calculating macros.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Skeleton className="h-20 w-full rounded-xl bg-canvas-soft" />
          <Skeleton className="h-20 w-full rounded-xl bg-canvas-soft" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {analyzeError && (
        <Card
          role="alert"
          className="border border-negative/40 bg-canvas text-ink"
        >
          <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-semibold text-negative">
              {analyzeError}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onRetryAnalyze}
            >
              Try again
            </Button>
          </CardContent>
        </Card>
      )}

      {items.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle>Analyzed items</CardTitle>
                <CardDescription>
                  Adjust quantities in grams before adding to today&apos;s log (
                  {todayDate}).
                </CardDescription>
              </div>
            </div>
          </CardHeader>

          <CardContent className="flex flex-col gap-4">
            <ul className="flex flex-col gap-3" aria-label="Analyzed food items">
              {items.map((item) => {
                const inputId = `quantity-${item.clientId}`;
                const trimmed = item.rawQuantityInput.trim();
                const parsedQty = trimmed === "" ? Number.NaN : Number(trimmed);
                const isItemInvalid =
                  !Number.isFinite(parsedQty) || parsedQty <= 0;
                const hasVariants =
                  item.variants !== undefined && item.variants.length >= 2;

                return (
                  <li
                    key={item.clientId}
                    className="flex flex-col gap-3 rounded-xl bg-canvas-soft/60 p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex flex-col gap-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-base font-semibold text-ink">
                          {item.food_name}
                        </span>
                        {item.is_estimated && (
                          <Badge variant="estimated">Estimated</Badge>
                        )}
                        {hasVariants && (
                          <div
                            role="group"
                            aria-label={`Preparation state for ${item.food_name}`}
                            className="inline-flex items-center gap-1 rounded-full bg-canvas p-0.5 border border-border"
                          >
                            {item.variants?.map((variant) => {
                              const isSelected =
                                (item.selected_state ??
                                  item.variants?.[0]?.state) === variant.state;
                              return (
                                <Button
                                  key={variant.state}
                                  type="button"
                                  size="xs"
                                  variant={isSelected ? "default" : "ghost"}
                                  aria-pressed={isSelected}
                                  onClick={() =>
                                    onSelectVariant?.(
                                      item.clientId,
                                      variant.state
                                    )
                                  }
                                  className="rounded-full px-2.5"
                                >
                                  {variant.label}
                                </Button>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-body tabular-nums">
                        <span className="font-semibold text-ink">
                          {item.calories} kcal
                        </span>
                        <span>Protein {item.protein_g}g</span>
                        <span>Carbs {item.carbs_g}g</span>
                        <span>Fat {item.fat_g}g</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 sm:shrink-0">
                      <div className="flex items-center gap-1.5">
                        <label
                          htmlFor={inputId}
                          className="text-xs font-semibold text-body"
                        >
                          Grams
                        </label>
                        <Input
                          id={inputId}
                          type="number"
                          inputMode="decimal"
                          min={1}
                          step="any"
                          aria-label={`Quantity in grams for ${item.food_name}`}
                          aria-invalid={isItemInvalid}
                          value={item.rawQuantityInput}
                          onChange={(e) =>
                            onQuantityChange?.(item.clientId, e.target.value)
                          }
                          className="w-24 text-right tabular-nums"
                        />
                        <span className="text-sm text-body">g</span>
                      </div>

                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={`Remove ${item.food_name}`}
                        onClick={() => onRemoveItem?.(item.clientId)}
                        className="text-body hover:text-negative"
                      >
                        <Trash2Icon className="size-4" />
                        <span>Remove</span>
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>

            {hasInvalidQuantity && (
              <p role="alert" className="text-sm font-semibold text-negative">
                Enter a quantity greater than 0 g for each item (or remove
                unwanted items) before saving.
              </p>
            )}

            {saveError && (
              <div
                role="alert"
                className="flex flex-col gap-3 rounded-xl border border-negative/40 bg-canvas p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <p className="text-sm font-semibold text-negative">
                  {saveError}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!canSave}
                  onClick={onSaveEntries}
                >
                  Retry save
                </Button>
              </div>
            )}

            <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex flex-col gap-1.5 sm:w-56">
                <label
                  htmlFor="meal-type-select"
                  className="text-sm font-semibold text-ink"
                >
                  Meal type
                </label>
                <Select
                  value={mealType}
                  onValueChange={(val) => {
                    if (
                      val === "breakfast" ||
                      val === "lunch" ||
                      val === "dinner" ||
                      val === "snack"
                    ) {
                      onMealTypeChange?.(val);
                    }
                  }}
                >
                  <SelectTrigger
                    id="meal-type-select"
                    aria-label="Meal type"
                    className="w-full"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(MEAL_TYPE_LABELS) as MealType[]).map(
                      (type) => (
                        <SelectItem key={type} value={type}>
                          {MEAL_TYPE_LABELS[type]}
                        </SelectItem>
                      )
                    )}
                  </SelectContent>
                </Select>
              </div>

              <Button
                type="button"
                size="lg"
                disabled={!canSave}
                onClick={onSaveEntries}
                className="w-full sm:w-auto"
              >
                {isSaving && <Loader2Icon className="size-4 animate-spin" />}
                <span>Add to today&apos;s log</span>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export function MealAnalyzerFallback() {
  return (
    <div className="flex flex-col gap-6">
      <Card aria-busy="true">
        <CardHeader>
          <CardTitle className="text-2xl font-black tracking-tight sm:text-3xl">
            What did you eat?
          </CardTitle>
          <CardDescription>
            Describe your meal in plain English, Indian dish names, or Hinglish
            (e.g., &ldquo;2 katori dal tadka and 2 rotis&rdquo;).
          </CardDescription>
        </CardHeader>

        <CardContent>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <span className="text-sm font-semibold text-ink">
                Meal description
              </span>
              <Skeleton className="min-h-28 w-full rounded-xl bg-canvas-soft" />
              <p className="text-xs text-mute">
                Meal text is sent to a third-party AI (Google Gemini) to parse
                items and calculate macros.
              </p>
            </div>

            <div className="flex justify-end">
              <Skeleton className="h-11 w-full rounded-xl bg-canvas-soft sm:w-28" />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function MealAnalyzer() {
  const queryClient = useQueryClient();
  const [now] = useState(() => new Date());

  const { data: settingsData } = useQuery({
    queryKey: ["settings"],
    queryFn: () => getUserSettings(),
  });

  const activeTimezone = resolveActiveTimezone(settingsData?.settings);
  const todayDate = getTodayInTimezone(activeTimezone, now);

  const [mealText, setMealText] = useState("");
  const [items, setItems] = useState<EditableAnalyzedItem[]>([]);
  const [mealType, setMealType] = useState<MealType>(() =>
    getDefaultMealType(activeTimezone, now)
  );
  const [hasCustomMealType, setHasCustomMealType] = useState(false);

  const effectiveMealType = hasCustomMealType
    ? mealType
    : getDefaultMealType(activeTimezone, now);

  const analyzeMutation = useMutation({
    mutationFn: (text: string) => analyzeMeal(text),
    onSuccess: (response) => {
      setItems(toEditableAnalyzedItems(response.items));
      if (!hasCustomMealType) {
        setMealType(getDefaultMealType(activeTimezone, new Date()));
      }
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = buildCreateEntriesPayload(
        items,
        todayDate,
        effectiveMealType
      );
      if (!payload) {
        throw new ApiClientError(400);
      }
      return createEntries(payload);
    },
    onSuccess: () => {
      setItems([]);
      setMealText("");
      setHasCustomMealType(false);
      void queryClient.invalidateQueries({ queryKey: ["summary", todayDate] });
      void queryClient.invalidateQueries({ queryKey: ["summary"] });
      toast.success("Added to today's log");
    },
  });

  const analyzeErrorMessage = analyzeMutation.error
    ? analyzeMutation.error instanceof ApiClientError
      ? analyzeMutation.error.userMessage
      : mapStatusToUserMessage(502)
    : null;

  const saveErrorMessage = saveMutation.error
    ? saveMutation.error instanceof ApiClientError
      ? saveMutation.error.userMessage
      : mapStatusToUserMessage(502)
    : null;

  const isInputBlank = mealText.trim().length === 0;
  const isAnalyzeDisabled = isInputBlank || analyzeMutation.isPending;

  function handleAnalyzeSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    if (isAnalyzeDisabled) {
      return;
    }
    saveMutation.reset();
    analyzeMutation.mutate(mealText.trim());
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl font-black tracking-tight sm:text-3xl">
            What did you eat?
          </CardTitle>
          <CardDescription>
            Describe your meal in plain English, Indian dish names, or Hinglish
            (e.g., &ldquo;2 katori dal tadka and 2 rotis&rdquo;).
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleAnalyzeSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <label
                htmlFor="meal-description-input"
                className="text-sm font-semibold text-ink"
              >
                Meal description
              </label>
              <Textarea
                id="meal-description-input"
                name="mealText"
                placeholder="What did you eat? (e.g., 2 katori dal tadka and 2 rotis)"
                maxLength={500}
                value={mealText}
                disabled={analyzeMutation.isPending}
                onChange={(e) => setMealText(e.target.value)}
              />
              <p className="text-xs text-mute">
                Meal text is sent to a third-party AI (Google Gemini) to parse
                items and calculate macros.
              </p>
            </div>

            <div className="flex justify-end">
              <Button
                type="submit"
                size="lg"
                disabled={isAnalyzeDisabled}
                className="w-full sm:w-auto"
              >
                {analyzeMutation.isPending ? (
                  <Loader2Icon className="size-4 animate-spin" />
                ) : (
                  <SparklesIcon className="size-4" />
                )}
                <span>Analyze</span>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <AnalyzedResultsView
        items={items}
        mealType={effectiveMealType}
        todayDate={todayDate}
        isAnalyzing={analyzeMutation.isPending}
        isSaving={saveMutation.isPending}
        analyzeError={analyzeErrorMessage}
        saveError={saveErrorMessage}
        onQuantityChange={(clientId, rawValue) => {
          saveMutation.reset();
          setItems((prev) =>
            updateEditableItemQuantity(prev, clientId, rawValue)
          );
        }}
        onSelectVariant={(clientId, state) => {
          saveMutation.reset();
          setItems((prev) => selectEditableItemVariant(prev, clientId, state));
        }}
        onRemoveItem={(clientId) => {
          saveMutation.reset();
          setItems((prev) => removeEditableItem(prev, clientId));
        }}
        onMealTypeChange={(nextMealType) => {
          setHasCustomMealType(true);
          setMealType(nextMealType);
        }}
        onRetryAnalyze={() => {
          if (!isInputBlank) {
            analyzeMutation.mutate(mealText.trim());
          }
        }}
        onSaveEntries={() => {
          if (canSubmitAnalyzedItems(items) && !saveMutation.isPending) {
            saveMutation.mutate();
          }
        }}
      />
    </div>
  );
}
