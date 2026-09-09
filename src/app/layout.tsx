import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";

import { SiteHeader } from "@/components/site-header";
import { TickerTape } from "@/components/ticker-tape";
import { LiveAlertToaster } from "@/components/live-alert-toaster";
import { getAlertsWithItems, type AlertWithItem } from "@/lib/data";
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

/**
 * Prevence blikání (FOUC) při načtení: localStorage se aplikuje na
 * <html class> PŘED prvním renderem – synchronní skript v head.
 * Default zůstává dark (server renderuje dark).
 */
const themeInitScript = `
try {
  if (localStorage.getItem("simalytics-theme") === "light") {
    document.documentElement.classList.add("light");
  }
} catch (e) {}
`;

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Alerty pro zvonek v hlavičce – selhání DB nesmí shodit celou appku
  // (jen se zvonek ukáže prázdný).
  let alerts: AlertWithItem[] = [];
  try {
    alerts = await getAlertsWithItems();
  } catch {
    alerts = [];
  }
  const headerAlerts = alerts.map((a) => ({
    id: a.id,
    item_id: a.item_id,
    item_name: a.item_name,
    image_url: a.image_url,
    kind: a.kind,
    direction: a.direction,
    threshold: a.threshold,
    active: a.active,
    last_triggered_at: a.last_triggered_at,
    seen_at: a.seen_at,
    current_price: a.current_price,
  }));

  return (
    <html
      lang="cs"
      className={`dark ${ibmPlexSans.variable} ${ibmPlexMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <div className="bg-mesh pointer-events-none fixed inset-0 -z-10" />
        <SiteHeader alerts={headerAlerts} />
        <TickerTape />
        <main className="mx-auto w-full max-w-7xl px-4 pb-20 pt-8">
          {children}
        </main>
        {/* Live alert toaster – global (Fáze 2): spouští /api/live poller,
            když je appka otevřená; cron 5 min zůstává jako fallback */}
        <LiveAlertToaster />
      </body>
    </html>
  );
}
