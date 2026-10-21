import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

/**
 * Verifies the caller's Clerk session (`docs/BACKEND_PRD.md` §3 & §6).
 * Returns the authenticated `userId` string, or a `401 UNAUTHORIZED` JSON response.
 */
export async function requireAuth(): Promise<string | NextResponse> {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json(
      {
        error: {
          code: "UNAUTHORIZED",
          message: "Authentication required",
        },
      },
      { status: 401 }
    );
  }

  return userId;
}

/**
 * Resolves the authenticated `userId` string, or `null` if unauthenticated/guest.
 */
export async function getAuthUserId(): Promise<string | null> {
  const result = await requireAuth();
  if (result instanceof NextResponse) {
    return null;
  }
  return result;
}

