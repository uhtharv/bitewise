import { Suspense } from "react";
import {
  DailyTracker,
  DailyTrackerFallback,
} from "@/components/today/daily-tracker";

export default function TodayPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-8 sm:px-6 sm:py-12">
      <Suspense fallback={<DailyTrackerFallback />}>
        <DailyTracker />
      </Suspense>
    </main>
  );
}

