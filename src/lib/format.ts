import type { Quality } from "@/lib/types";

/** Formátování ceny: 1 234,56 $ */
export function formatPrice(value: number | null | undefined): string {
  if (value === null || value === undefined) return "–";
  return new Intl.NumberFormat("cs-CZ", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

/** Formátování velkých čísel: 12,3 tis. / 1,2 mil. */
export function formatCompact(value: number | null | undefined): string {
  if (value === null || value === undefined) return "–";
  return new Intl.NumberFormat("cs-CZ", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

/** Zisk jako +1 234 $ / −567 $ se zelenou/červenou signaturou v UI. */
export function formatSigned(value: number | null | undefined): string {
  if (value === null || value === undefined) return "–";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${formatPrice(Math.abs(value))}`;
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return "–";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(2)} %`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "–";
  return new Intl.DateTimeFormat("cs-CZ", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

export const QUALITY_LABELS: Record<Quality, string> = {
  0: "Q0 (normální)",
  1: "Q1",
  2: "Q2",
  3: "Q3",
  4: "Q4",
  5: "Q5",
  6: "Q6",
  7: "Q7",
};

/** Barva podle zisku – konzistentní napříč celou aplikací. */
export function plColorClass(value: number | null | undefined): string {
  if (value === null || value === undefined) return "text-muted-foreground";
  if (value > 0) return "text-up";
  if (value < 0) return "text-down";
  return "text-muted-foreground";
}

/**
 * Lokální ikony (public/icons → cesty /icons/…) servíruj as-is,
 * relativní cesty z encyklopedie doplň o doménu SimCompanies.
 */
export function itemImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("http") || url.startsWith("/")) return url;
  return `https://www.simcompanies.com${url}`;
}
