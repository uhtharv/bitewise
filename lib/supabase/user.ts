import { auth } from "@clerk/nextjs/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

export type MealType = "breakfast" | "lunch" | "dinner" | "snack";
export type FoodSource = "usda" | "gemini";

export type FoodRow = {
  id: string;
  normalized_name: string;
  display_name: string;
  calories_per_100g: number;
  protein_per_100g: number;
  carbs_per_100g: number;
  fat_per_100g: number;
  source: FoodSource;
  external_id: string | null;
  is_estimated: boolean;
  created_at: string;
};

export type MealEntryRow = {
  id: string;
  user_id: string;
  logged_on: string;
  meal_type: MealType;
  food_id: string | null;
  food_name: string;
  quantity_g: number;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  is_estimated: boolean;
  created_at: string;
};

export type UserSettingsRow = {
  user_id: string;
  calorie_goal: number | null;
  protein_goal_g: number | null;
  carbs_goal_g: number | null;
  fat_goal_g: number | null;
  timezone: string;
  updated_at: string;
};

export type AiUsageRow = {
  user_id: string;
  usage_date: string;
  count: number;
};

export type Database = {
  public: {
    Tables: {
      foods: {
        Row: FoodRow;
        Insert: {
          id?: string;
          normalized_name: string;
          display_name: string;
          calories_per_100g: number;
          protein_per_100g: number;
          carbs_per_100g: number;
          fat_per_100g: number;
          source: FoodSource;
          external_id?: string | null;
          is_estimated?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          normalized_name?: string;
          display_name?: string;
          calories_per_100g?: number;
          protein_per_100g?: number;
          carbs_per_100g?: number;
          fat_per_100g?: number;
          source?: FoodSource;
          external_id?: string | null;
          is_estimated?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      meal_entries: {
        Row: MealEntryRow;
        Insert: {
          id?: string;
          user_id?: string;
          logged_on: string;
          meal_type: MealType;
          food_id?: string | null;
          food_name: string;
          quantity_g: number;
          calories: number;
          protein_g: number;
          carbs_g: number;
          fat_g: number;
          is_estimated?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          logged_on?: string;
          meal_type?: MealType;
          food_id?: string | null;
          food_name?: string;
          quantity_g?: number;
          calories?: number;
          protein_g?: number;
          carbs_g?: number;
          fat_g?: number;
          is_estimated?: boolean;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "meal_entries_food_id_fkey";
            columns: ["food_id"];
            referencedRelation: "foods";
            referencedColumns: ["id"];
          },
        ];
      };
      user_settings: {
        Row: UserSettingsRow;
        Insert: {
          user_id?: string;
          calorie_goal?: number | null;
          protein_goal_g?: number | null;
          carbs_goal_g?: number | null;
          fat_goal_g?: number | null;
          timezone?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          calorie_goal?: number | null;
          protein_goal_g?: number | null;
          carbs_goal_g?: number | null;
          fat_goal_g?: number | null;
          timezone?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      ai_usage: {
        Row: AiUsageRow;
        Insert: {
          user_id: string;
          usage_date: string;
          count?: number;
        };
        Update: {
          user_id?: string;
          usage_date?: string;
          count?: number;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
};

export interface UserSupabaseClientOptions {
  accessToken?: () => Promise<string | null>;
  fetch?: typeof fetch;
}

/**
 * Creates a user-scoped Supabase client using NEXT_PUBLIC_SUPABASE_ANON_KEY
 * and the current Clerk session token via `accessToken` so Postgres RLS
 * policies evaluate `(auth.jwt() ->> 'sub')`.
 */
export function createUserSupabaseClient(
  options?: UserSupabaseClientOptions
): SupabaseClient<Database> {
  return createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      accessToken:
        options?.accessToken ??
        (async () => {
          const session = await auth();
          return session.getToken();
        }),
      global: options?.fetch ? { fetch: options.fetch } : undefined,
    }
  );
}
