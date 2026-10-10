import { z } from "zod";

const requiredEnvString = (name: string) =>
  z
    .string({
      error: `Missing or invalid required environment variable: ${name}`,
    })
    .trim()
    .min(1, `Environment variable ${name} must not be empty`);

export const envSchema = z.object({
  GEMINI_API_KEY: requiredEnvString("GEMINI_API_KEY"),
  GEMINI_MODEL: requiredEnvString("GEMINI_MODEL"),
  USDA_API_KEY: requiredEnvString("USDA_API_KEY"),
  SUPABASE_SERVICE_ROLE_KEY: requiredEnvString("SUPABASE_SERVICE_ROLE_KEY"),
  NEXT_PUBLIC_SUPABASE_URL: requiredEnvString("NEXT_PUBLIC_SUPABASE_URL"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: requiredEnvString(
    "NEXT_PUBLIC_SUPABASE_ANON_KEY"
  ),
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: requiredEnvString(
    "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"
  ),
  CLERK_SECRET_KEY: requiredEnvString("CLERK_SECRET_KEY"),
  NEXT_PUBLIC_CLERK_SIGN_IN_URL: requiredEnvString(
    "NEXT_PUBLIC_CLERK_SIGN_IN_URL"
  ),
});

export type Env = z.infer<typeof envSchema>;

export const env: Env = envSchema.parse(process.env);

