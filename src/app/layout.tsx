import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Simalytics – trhy SimCompanies",
    template: "%s · Simalytics",
  },
  description:
    "Analytický dashboard a tracker pozic pro virtuální ekonomiku SimCompanies. Ceny, grafy, Buy Low / Sell High.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="cs" className="dark">
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <SiteHeader />
        <main className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6">
          {children}
        </main>
      </body>
    </html>
  );
}
