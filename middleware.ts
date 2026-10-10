import {
  clerkMiddleware,
  type ClerkMiddlewareAuth,
} from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";

function isPublicSignInPath(pathname: string): boolean {
  return pathname === "/sign-in" || pathname.startsWith("/sign-in/");
}

function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

export async function handleMiddlewareAuth(
  auth: ClerkMiddlewareAuth,
  request: NextRequest
) {
  const { pathname } = request.nextUrl;

  if (isPublicSignInPath(pathname) || isApiPath(pathname)) {
    return NextResponse.next();
  }

  const { userId, redirectToSignIn } = await auth();

  if (!userId) {
    return redirectToSignIn({ returnBackUrl: request.url });
  }

  return NextResponse.next();
}

export default clerkMiddleware((auth, request) =>
  handleMiddlewareAuth(auth, request)
);

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};

