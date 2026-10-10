"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
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
import {
  ApiClientError,
  getUserSettings,
  mapStatusToUserMessage,
  updateUserSettings,
  type UserSettings,
} from "@/lib/api/client";
import { getBrowserTimezone, getTimezoneOptions } from "@/lib/dates";
import {
  toSettingsFormValues,
  validateAndParseSettingsForm,
  type SettingsFieldErrors,
  type SettingsFormValues,
} from "@/lib/settings/view-model";

export interface SettingsFormViewProps {
  values: SettingsFormValues;
  timezoneOptions: string[];
  fieldErrors?: SettingsFieldErrors;
  isLoading?: boolean;
  isSaving?: boolean;
  loadError?: string | null;
  saveError?: string | null;
  onFieldChange?: (field: keyof SettingsFormValues, value: string) => void;
  onClearGoals?: () => void;
  onRetryLoad?: () => void;
  onSubmit?: (e?: React.FormEvent) => void;
}

export function SettingsFormView({
  values,
  timezoneOptions,
  fieldErrors = {},
  isLoading = false,
  isSaving = false,
  loadError = null,
  saveError = null,
  onFieldChange,
  onClearGoals,
  onRetryLoad,
  onSubmit,
}: SettingsFormViewProps) {
  if (isLoading) {
    return (
      <Card
        role="status"
        aria-busy="true"
        aria-label="Loading settings"
      >
        <CardHeader>
          <Skeleton className="h-8 w-48 rounded-md bg-canvas-soft" />
          <Skeleton className="h-4 w-64 rounded-md bg-canvas-soft" />
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Skeleton className="h-14 w-full rounded-xl bg-canvas-soft" />
          <Skeleton className="h-14 w-full rounded-xl bg-canvas-soft" />
          <Skeleton className="h-14 w-full rounded-xl bg-canvas-soft" />
          <Skeleton className="h-14 w-full rounded-xl bg-canvas-soft" />
          <Skeleton className="h-14 w-full rounded-xl bg-canvas-soft" />
        </CardContent>
      </Card>
    );
  }

  if (loadError) {
    return (
      <Card
        role="alert"
        className="border border-negative/40 bg-canvas text-ink"
      >
        <CardHeader>
          <CardTitle>Couldn&apos;t load settings</CardTitle>
          <CardDescription>{loadError}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button type="button" variant="outline" onClick={onRetryLoad}>
            Try again
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl font-black tracking-tight sm:text-3xl">
          Goals &amp; settings
        </CardTitle>
        <CardDescription>
          Set your daily calorie and macro targets. Leave any goal blank to hide
          its progress bar on your daily tracker.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit?.(e);
          }}
          className="flex flex-col gap-5"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="setting-calorie-goal"
                className="text-sm font-semibold text-ink"
              >
                Daily calorie goal (kcal)
              </label>
              <Input
                id="setting-calorie-goal"
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                placeholder="Unset (e.g., 2000)"
                value={values.calorieGoal}
                disabled={isSaving}
                aria-invalid={Boolean(fieldErrors.calorieGoal)}
                onChange={(e) => onFieldChange?.("calorieGoal", e.target.value)}
              />
              {fieldErrors.calorieGoal && (
                <p role="alert" className="text-xs font-semibold text-negative">
                  {fieldErrors.calorieGoal}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="setting-protein-goal"
                className="text-sm font-semibold text-ink"
              >
                Protein goal (g)
              </label>
              <Input
                id="setting-protein-goal"
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                placeholder="Unset (e.g., 140)"
                value={values.proteinGoalG}
                disabled={isSaving}
                aria-invalid={Boolean(fieldErrors.proteinGoalG)}
                onChange={(e) =>
                  onFieldChange?.("proteinGoalG", e.target.value)
                }
              />
              {fieldErrors.proteinGoalG && (
                <p role="alert" className="text-xs font-semibold text-negative">
                  {fieldErrors.proteinGoalG}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="setting-carbs-goal"
                className="text-sm font-semibold text-ink"
              >
                Carbs goal (g)
              </label>
              <Input
                id="setting-carbs-goal"
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                placeholder="Unset (e.g., 220)"
                value={values.carbsGoalG}
                disabled={isSaving}
                aria-invalid={Boolean(fieldErrors.carbsGoalG)}
                onChange={(e) => onFieldChange?.("carbsGoalG", e.target.value)}
              />
              {fieldErrors.carbsGoalG && (
                <p role="alert" className="text-xs font-semibold text-negative">
                  {fieldErrors.carbsGoalG}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="setting-fat-goal"
                className="text-sm font-semibold text-ink"
              >
                Fat goal (g)
              </label>
              <Input
                id="setting-fat-goal"
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                placeholder="Unset (e.g., 65)"
                value={values.fatGoalG}
                disabled={isSaving}
                aria-invalid={Boolean(fieldErrors.fatGoalG)}
                onChange={(e) => onFieldChange?.("fatGoalG", e.target.value)}
              />
              {fieldErrors.fatGoalG && (
                <p role="alert" className="text-xs font-semibold text-negative">
                  {fieldErrors.fatGoalG}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="setting-timezone-select"
              className="text-sm font-semibold text-ink"
            >
              Timezone
            </label>
            <Select
              value={values.timezone}
              disabled={isSaving}
              onValueChange={(val) => {
                if (typeof val === "string" && val.length > 0) {
                  onFieldChange?.("timezone", val);
                }
              }}
            >
              <SelectTrigger
                id="setting-timezone-select"
                aria-label="Timezone"
                className="w-full"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {timezoneOptions.map((tz) => (
                  <SelectItem key={tz} value={tz}>
                    {tz}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-mute">
              Used to automatically determine today&apos;s date for meal
              logging.
            </p>
            {fieldErrors.timezone && (
              <p role="alert" className="text-xs font-semibold text-negative">
                {fieldErrors.timezone}
              </p>
            )}
          </div>

          {saveError && (
            <div
              role="alert"
              className="flex flex-col gap-3 rounded-xl border border-negative/40 bg-canvas p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <p className="text-sm font-semibold text-negative">{saveError}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isSaving}
                onClick={() => onSubmit?.()}
              >
                Retry save
              </Button>
            </div>
          )}

          <div className="flex flex-col-reverse gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
            <Button
              type="button"
              variant="secondary"
              disabled={isSaving}
              onClick={onClearGoals}
            >
              Clear all goals
            </Button>

            <Button type="submit" size="lg" disabled={isSaving}>
              {isSaving && <Loader2Icon className="size-4 animate-spin" />}
              <span>Save settings</span>
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function LoadedSettingsForm({
  initialSettings,
}: {
  initialSettings: UserSettings;
}) {
  const queryClient = useQueryClient();
  const browserTimezone = getBrowserTimezone();

  const [values, setValues] = useState<SettingsFormValues>(() =>
    toSettingsFormValues(initialSettings, browserTimezone)
  );
  const [fieldErrors, setFieldErrors] = useState<SettingsFieldErrors>({});

  const timezoneOptions = getTimezoneOptions(
    browserTimezone,
    initialSettings.timezone
  );

  const saveMutation = useMutation({
    mutationFn: (payload: UserSettings) => updateUserSettings(payload),
    onSuccess: (response) => {
      setValues(toSettingsFormValues(response.settings, browserTimezone));
      setFieldErrors({});
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
      void queryClient.invalidateQueries({ queryKey: ["summary"] });
      toast.success("Settings saved");
    },
  });

  const saveErrorMessage = saveMutation.error
    ? saveMutation.error instanceof ApiClientError
      ? saveMutation.error.userMessage
      : mapStatusToUserMessage(502)
    : null;

  function handleSubmit() {
    const validation = validateAndParseSettingsForm(values);
    if (!validation.ok) {
      setFieldErrors(validation.fieldErrors);
      return;
    }
    setFieldErrors({});
    saveMutation.mutate(validation.payload);
  }

  return (
    <SettingsFormView
      values={values}
      timezoneOptions={timezoneOptions}
      fieldErrors={fieldErrors}
      isSaving={saveMutation.isPending}
      saveError={saveErrorMessage}
      onFieldChange={(field, value) => {
        saveMutation.reset();
        setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
        setValues((prev) => ({ ...prev, [field]: value }));
      }}
      onClearGoals={() => {
        saveMutation.reset();
        setFieldErrors({});
        setValues((prev) => ({
          ...prev,
          calorieGoal: "",
          proteinGoalG: "",
          carbsGoalG: "",
          fatGoalG: "",
        }));
      }}
      onSubmit={handleSubmit}
    />
  );
}

export function SettingsForm() {
  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => getUserSettings(),
  });

  const loadErrorMessage = settingsQuery.error
    ? settingsQuery.error instanceof ApiClientError
      ? settingsQuery.error.userMessage
      : mapStatusToUserMessage(502)
    : null;

  if (settingsQuery.isPending || loadErrorMessage || !settingsQuery.data) {
    return (
      <SettingsFormView
        values={toSettingsFormValues(null)}
        timezoneOptions={getTimezoneOptions()}
        isLoading={settingsQuery.isPending}
        loadError={loadErrorMessage}
        onRetryLoad={() => {
          void settingsQuery.refetch();
        }}
      />
    );
  }

  return (
    <LoadedSettingsForm
      key={JSON.stringify(settingsQuery.data.settings)}
      initialSettings={settingsQuery.data.settings}
    />
  );
}

