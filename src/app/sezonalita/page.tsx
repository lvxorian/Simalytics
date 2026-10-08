import type { Metadata } from "next";
import Link from "next/link";

import { AutoRefresh } from "@/components/auto-refresh";
import { ItemIcon } from "@/components/item-icon";
import {
  SeasonalityPicker,
  SeasonalityQualityTabs,
} from "@/components/seasonality-picker";
import { SeasonalityHeatmap } from "@/components/seasonality-heatmap";
import { SeasonalityDow } from "@/components/seasonality-dow";
import { getDailyCandles, getMarketInstruments, getMonthlyCloses } from "@/lib/data";
import { computeDowSeasonality } from "@/lib/seasonality";
import { getPhaseRanges } from "@/lib/simcotools";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sezonalita",
};

const FALLBACK_PRICE = 0;

export default async function SezonalitaPage({
  searchParams,
}: {
  searchParams: Promise<{ item?: string; q?: string }>;
}) {
  const params = await searchParams;
  const items = await getMarketInstruments().catch((err) => {
    console.error("getMarketInstruments failed", err);
    return [];
  });

  const itemId = Number(params.item) || 0;
  const selected = items.find((i) => i.id === itemId) ?? null;
  const quality = Number(params.q) || 0;

  // Historie se dotazuje jen pro vybrané aktivum (SQL per kvalita).
  const closes = selected
    ? await getMonthlyCloses(selected.id, quality).catch((err) => {
        console.error("getMonthlyCloses failed", err);
        return [];
      })
    : [];

  // Denní svíčky pro day-of-week pohled (backfill ~365 dní).
  const dailyCandles = selected
    ? await getDailyCandles(selected.id, quality).catch((err) => {
        console.error("getDailyCandles failed", err);
        return [];
      })
    : [];
  const dowStats = computeDowSeasonality(
    dailyCandles.map((c) => ({ day: c.day, close: c.close }))
  );

  // Herní fáze pro overlay heatmapy (cache 15 min na API).
  const phaseRanges = selected
    ? await getPhaseRanges().catch((err) => {
        console.error("getPhaseRanges failed", err);
        return [];
      })
    : [];

  const pickerItems = items.map((i) => ({
    id: i.id,
    name: i.name,
    price: i.prices["0"] ?? Object.values(i.prices).find((p) => p) ?? FALLBACK_PRICE,
  }));

  // Kvality s daty pro aktuální položku (pro tabs).
  const qualities = selected
    ? Object.keys(selected.prices)
        .map(Number)
        .filter((q) => Number.isInteger(q) && selected.prices[String(q)] !== null)
        .sort((a, b) => a - b)
    : [];

  return (
    <div className="space-y-8">
      <AutoRefresh intervalMs={300_000} />

      <div>
        <p className="mb-2 inline-flex items-center rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.2em] text-primary">
          Sezonalita
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">
          Sezonalita aktiv
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Heatmapa měsíčních výnosů à la TradingView / Seasonax – jak si
          aktivum historicky vedlo v konkrétních měsících. Data z
          měsíčních svíček Simco Tools (archiv od 2022-02, čerstvý měsíc
          z denních dat). Vyber aktivum:
        </p>
      </div>

      <SeasonalityPicker
        items={pickerItems}
        selectedId={selected?.id ?? null}
      />

      {selected && (
        <>
          <div className="flex items-center gap-3">
            <ItemIcon
              url={`/icons/${selected.id}.png`}
              name={selected.name}
              size={34}
            />
            <div>
              <div className="font-medium">{selected.name}</div>
              <div className="font-mono text-xs text-muted-foreground">
                {selected.category ? selected.category.toLowerCase() : ""} ·
                měsíční uzávěry
              </div>
            </div>
          </div>

          {qualities.length > 1 && (
            <SeasonalityQualityTabs
              qualities={qualities}
              itemId={selected.id}
              activeQuality={quality}
            />
          )}

          <SeasonalityHeatmap closes={closes} phaseRanges={phaseRanges} />

          <SeasonalityDow stats={dowStats} />

          <p className="text-xs text-muted-foreground">
            Chceš vidět vývoj ceny v čase? Otevři{" "}
            <Link
              href={`/market/${selected.id}`}
              className="text-primary hover:underline"
            >
              graf aktiva
            </Link>{" "}
            s přepínačem 1M.
          </p>
        </>
      )}
    </div>
  );
}
