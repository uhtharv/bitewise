"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "cn";
import { Loader2Icon, PencilIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { EditEntryDialog } from "@/components/today/edit-entry-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ApiClientError,
  deleteEntry,
  getDailySummary,
  getUserSettings,
  mapStatusToUserMessage,
  updateEntryQuantity,
  type DailySummaryResponse,
} from "@/lib/api/client";
import { getTodayInTimezone, resolveActiveTimezone } from "@/lib/dates";
import type { MealEntryRow } from "@/lib/supabase/user";
import {
  buildMacroMetrics,
  groupNonEmptyMealEntries,
} from "@/lib/tracker/view-model";

export interface DailyTrackerViewProps {
  summary: DailySummaryResponse | null;
  todayDate: string;
  isLoading?: boolean;
  errorMessage?: string | null;
  deletingEntryId?: string | null;
  onRetry?: () => void;
  onEditEntry?: (entry: MealEntryRow) => void;
  onDeleteEntry?: (entryId: string) => void;
}

export function DailyTrackerView({
  summary,
  todayDate,
  isLoading = false,
  errorMessage = null,
  deletingEntryId = null,
  onRetry,
  onEditEntry,
  onDeleteEntry,
}: DailyTrackerViewProps) {
  if (isLoading) {
    return (
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading today's tracker"
        className="flex flex-col gap-6"
      >
        <Card>
          <CardHeader>
            <Skeleton className="h-8 w-48 rounded-md bg-canvas-soft" />
            <Skeleton className="h-4 w-32 rounded-md bg-canvas-soft" />
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Skeleton className="h-24 w-full rounded-xl bg-canvas-soft" />
            <Skeleton className="h-24 w-full rounded-xl bg-canvas-soft" />
            <Skeleton className="h-24 w-full rounded-xl bg-canvas-soft" />
            <Skeleton className="h-24 w-full rounded-xl bg-canvas-soft" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-36 rounded-md bg-canvas-soft" />
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Skeleton className="h-20 w-full rounded-xl bg-canvas-soft" />
            <Skeleton className="h-20 w-full rounded-xl bg-canvas-soft" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (errorMessage || !summary) {
    return (
      <Card
        role="alert"
        className="border border-negative/40 bg-canvas text-ink"
      >
        <CardHeader>
          <CardTitle>Couldn&apos;t load today&apos;s log</CardTitle>
          <CardDescription>
            {errorMessage ?? mapStatusToUserMessage(502)}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button type="button" variant="outline" onClick={onRetry}>
            Try again
          </Button>
        </CardContent>
      </Card>
    );
  }

  const metrics = buildMacroMetrics(summary.totals, summary.goals);
  const mealGroups = groupNonEmptyMealEntries(summary.entries);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <CardTitle className="text-2xl font-black tracking-tight sm:text-3xl">
                Today&apos;s log
              </CardTitle>
              <CardDescription>Date: {todayDate}</CardDescription>
            </div>
            <Link
              href="/settings"
              className="inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-ink underline-offset-4 hover:bg-canvas-soft hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ink/25"
            >
              Manage goals
            </Link>
          </div>
        </CardHeader>

        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {metrics.map((metric) => {
            const hasGoal =
              metric.goal !== null && metric.progressPercent !== null;

            return (
              <div
                key={metric.key}
                data-over-goal={metric.isOverGoal ? "true" : "false"}
                className={cn(
                  "flex flex-col gap-2.5 rounded-xl p-4",
                  metric.isOverGoal
                    ? "border border-warning-deep/40 bg-warning/15"
                    : "bg-canvas-soft/60"
                )}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold text-body">
                    {metric.label}
                  </span>
                  <span
                    className={cn(
                      "text-lg font-black tabular-nums",
                      metric.isOverGoal ? "text-warning-deep" : "text-ink"
                    )}
                  >
                    {hasGoal
                      ? `${metric.total} / ${metric.goal} ${metric.unit}`
                      : `${metric.total} ${metric.unit}`}
                  </span>
                </div>

                {hasGoal && metric.progressPercent !== null && (
                  <Progress
                    aria-label={`${metric.label} progress`}
                    value={metric.progressPercent}
                    indicatorClassName={
                      metric.isOverGoal ? "bg-warning-deep" : "bg-positive"
                    }
                  />
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {mealGroups.length === 0 ? (
        <Card className="bg-canvas text-center">
          <CardContent className="flex flex-col items-center gap-4 py-12">
            <p className="text-base font-semibold text-ink">
              Nothing is logged for today ({todayDate}) yet.
            </p>
            <p className="max-w-sm text-sm text-body">
              Head to the home screen, type what you ate, and add it to your
              daily tracker.
            </p>
            <Link
              href="/"
              className="inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-6 py-3 text-base font-semibold text-on-primary transition-colors hover:bg-primary-active focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ink/25"
            >
              Log a meal
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-6">
          {mealGroups.map((group) => (
            <Card key={group.mealType}>
              <CardHeader>
                <CardTitle>{group.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <ul
                  aria-label={`${group.title} entries`}
                  className="flex flex-col gap-3"
                >
                  {group.entries.map((entry) => {
                    const isDeleting = deletingEntryId === entry.id;

                    return (
                      <li
                        key={entry.id}
                        className="flex flex-col gap-3 rounded-xl bg-canvas-soft/60 p-4 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="flex flex-col gap-1.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-base font-semibold text-ink">
                              {entry.food_name}
                            </span>
                            <span className="text-sm text-body tabular-nums">
                              ({Number(entry.quantity_g)}g)
                            </span>
                            {entry.is_estimated && (
                              <Badge variant="estimated">Estimated</Badge>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-body tabular-nums">
                            <span className="font-semibold text-ink">
                              {Number(entry.calories)} kcal
                            </span>
                            <span>Protein {Number(entry.protein_g)}g</span>
                            <span>Carbs {Number(entry.carbs_g)}g</span>
                            <span>Fat {Number(entry.fat_g)}g</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 sm:shrink-0">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            aria-label={`Edit quantity for ${entry.food_name}`}
                            disabled={isDeleting}
                            onClick={() => onEditEntry?.(entry)}
                          >
                            <PencilIcon className="size-4" />
                            <span>Edit</span>
                          </Button>

                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-label={`Delete ${entry.food_name}`}
                            disabled={isDeleting}
                            onClick={() => onDeleteEntry?.(entry.id)}
                            className="text-body hover:text-negative"
                          >
                            {isDeleting ? (
                              <Loader2Icon className="size-4 animate-spin" />
                            ) : (
                              <Trash2Icon className="size-4" />
                            )}
                            <span>Delete</span>
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export function DailyTrackerFallback() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading today's tracker"
      className="flex flex-col gap-6"
    >
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="flex flex-col gap-1.5">
              <CardTitle className="text-2xl font-black tracking-tight sm:text-3xl">
                Today&apos;s log
              </CardTitle>
              <Skeleton className="h-4 w-32 rounded-md bg-canvas-soft" />
            </div>
            <Link
              href="/settings"
              className="inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-ink underline-offset-4 hover:bg-canvas-soft hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ink/25"
            >
              Manage goals
            </Link>
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Skeleton className="h-24 w-full rounded-xl bg-canvas-soft" />
          <Skeleton className="h-24 w-full rounded-xl bg-canvas-soft" />
          <Skeleton className="h-24 w-full rounded-xl bg-canvas-soft" />
          <Skeleton className="h-24 w-full rounded-xl bg-canvas-soft" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-36 rounded-md bg-canvas-soft" />
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Skeleton className="h-20 w-full rounded-xl bg-canvas-soft" />
          <Skeleton className="h-20 w-full rounded-xl bg-canvas-soft" />
        </CardContent>
      </Card>
    </div>
  );
}

export function DailyTracker() {
  const queryClient = useQueryClient();
  const [now] = useState(() => new Date());

  const { data: settingsData } = useQuery({
    queryKey: ["settings"],
    queryFn: () => getUserSettings(),
  });

  const activeTimezone = resolveActiveTimezone(settingsData?.settings);
  const todayDate = getTodayInTimezone(activeTimezone, now);

  const summaryQuery = useQuery({
    queryKey: ["summary", todayDate],
    queryFn: () => getDailySummary(todayDate),
  });

  const [editingEntry, setEditingEntry] = useState<MealEntryRow | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const editMutation = useMutation({
    mutationFn: ({
      entryId,
      quantityG,
    }: {
      entryId: string;
      quantityG: number;
    }) => updateEntryQuantity(entryId, quantityG),
    onSuccess: () => {
      setEditingEntry(null);
      setActionError(null);
      void queryClient.invalidateQueries({ queryKey: ["summary", todayDate] });
      void queryClient.invalidateQueries({ queryKey: ["summary"] });
      toast.success("Quantity updated");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (entryId: string) => {
      setDeletingId(entryId);
      setActionError(null);
      return deleteEntry(entryId);
    },
    onSuccess: () => {
      setDeletingId(null);
      void queryClient.invalidateQueries({ queryKey: ["summary", todayDate] });
      void queryClient.invalidateQueries({ queryKey: ["summary"] });
      toast.success("Entry deleted");
    },
    onError: (err) => {
      setDeletingId(null);
      const message =
        err instanceof ApiClientError
          ? err.userMessage
          : mapStatusToUserMessage(502);
      setActionError(message);
    },
  });

  const queryErrorMessage = summaryQuery.error
    ? summaryQuery.error instanceof ApiClientError
      ? summaryQuery.error.userMessage
      : mapStatusToUserMessage(502)
    : null;

  const editErrorMessage = editMutation.error
    ? editMutation.error instanceof ApiClientError
      ? editMutation.error.userMessage
      : mapStatusToUserMessage(502)
    : null;

  return (
    <div className="flex flex-col gap-4">
      {actionError && (
        <Card
          role="alert"
          className="border border-negative/40 bg-canvas text-ink"
        >
          <CardContent className="flex items-center justify-between gap-3 pt-6">
            <p className="text-sm font-semibold text-negative">{actionError}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setActionError(null)}
            >
              Dismiss
            </Button>
          </CardContent>
        </Card>
      )}

      <DailyTrackerView
        summary={summaryQuery.data ?? null}
        todayDate={todayDate}
        isLoading={summaryQuery.isPending}
        errorMessage={queryErrorMessage}
        deletingEntryId={deletingId}
        onRetry={() => {
          void summaryQuery.refetch();
        }}
        onEditEntry={(entry) => {
          editMutation.reset();
          setEditingEntry(entry);
        }}
        onDeleteEntry={(entryId) => {
          deleteMutation.mutate(entryId);
        }}
      />

      <EditEntryDialog
        key={editingEntry?.id ?? "closed"}
        entry={editingEntry}
        open={editingEntry !== null}
        isSaving={editMutation.isPending}
        errorMessage={editErrorMessage}
        onOpenChange={(open) => {
          if (!open) {
            setEditingEntry(null);
          }
        }}
        onSaveQuantity={(entryId, newQuantityG) => {
          editMutation.mutate({ entryId, quantityG: newQuantityG });
        }}
      />
    </div>
  );
}

