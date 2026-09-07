import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";

import { SiteHeader } from "@/components/site-header";
import { TickerTape } from "@/components/ticker-tape";
import "./globals.css";

const ibmPlexSans = IBM_Plex_Sans({
  variable: "--font-ibm-plex-sans",
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700"],
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600"],
});

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
    <html
      lang="cs"
      className={`dark ${ibmPlexSans.variable} ${ibmPlexMono.variable}`}
    >
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <div className="bg-mesh pointer-events-none fixed inset-0 -z-10" />
        <SiteHeader />
        <TickerTape />
        <main className="mx-auto w-full max-w-7xl px-4 pb-20 pt-8">
          {children}
        </main>
      </body>
    </html>
  );
}
