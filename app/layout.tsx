import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { AppHeader } from "@/components/layout/app-header";
import { QueryProvider } from "@/components/providers/query-provider";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "600", "900"],
});

export const metadata: Metadata = {
  title: "Bitewise",
  description: "Calorie and macro tracker",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <ClerkProvider>
      <html lang="en" className={`${inter.variable} h-full antialiased`}>
        <body className="flex min-h-full flex-col bg-canvas-soft text-ink">
          <QueryProvider>
            <AppHeader />
            <div className="flex flex-1 flex-col">{children}</div>
          </QueryProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
