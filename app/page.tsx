import { Suspense } from "react";
import {
  MealAnalyzer,
  MealAnalyzerFallback,
} from "@/components/home/meal-analyzer";

export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-8 sm:px-6 sm:py-12">
      <Suspense fallback={<MealAnalyzerFallback />}>
        <MealAnalyzer />
      </Suspense>
    </main>
  );
}
