import type { Metadata } from "next";
import { Radar } from "lucide-react";

import { ScannerTable, type ScannerRow } from "@/components/scanner-table";
import { getEvents } from "@/lib/simcotools";
import {
  getActiveContests,
  getLatestPrices,
  getLatestVwaps,
  getPricesAround24hAgo,
} from "@/lib/data";
import { computeSignal, type EventSignal } from "@/lib/signals";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Skener příležitostí",
  description:
    "Signal Engine – složené nákupní a prodejní signály napříč celým trhem SimCompanies.",
};

/** Dnešní datum v UTC jako YYYY-MM-DD (eventy/contesty filtrujeme dle data). */
const today = () => new Date().toISOString().slice(0, 10);

export default async function ScannerPage() {
  // ── Data: DB (ceny, VWAP, contesty) + live eventy ze Simco Tools ──
  const [latest, contests] = await Promise.all([
    getLatestPrices(0),
    getActiveContests(),
  ]);

  const ids = latest.map((r) => r.item_id);
  const [dayAgo, vwaps, events] = await Promise.all([
    getPricesAround24hAgo(ids),
    getLatestVwaps(ids),
    // Eventy live z API – když selžou, skener pokračuje bez nich
    getEvents().catch(() => []),
  ]);

  const todayStr = today();
  const activeEvents: EventSignal[] = events
    .filter((e) => e.until.slice(0, 10) >= todayStr)
    .map((e) => ({
      resourceId: e.resource,
      speedModifier: e.speedModifier,
      until: e.until,
    }));

  // Eventy per item (může jich být víc na jednu komoditu)
  const eventsByItem = new Map<number, EventSignal[]>();
  for (const ev of activeEvents) {
    const list = eventsByItem.get(ev.resourceId) ?? [];
    list.push(ev);
    eventsByItem.set(ev.resourceId, list);
  }

  // ── Skórování všech položek ─────────────────────────────────────
  const rows: ScannerRow[] = latest.map((r) => {
    const base = dayAgo.get(r.item_id);
    const change24h =
      base && base > 0 ? ((r.price - base) / base) * 100 : null;

    const signal = computeSignal({
      itemId: r.item_id,
      price: r.price,
      vwap: vwaps.get(r.item_id) ?? null,
      events: eventsByItem.get(r.item_id) ?? [],
      contest: contests.get(r.item_id)
        ? {
            resourceId: r.item_id,
            name: contests.get(r.item_id)!.name,
            endDate: contests.get(r.item_id)!.endDate,
          }
        : null,
      change24h,
    });

    return {
      item_id: r.item_id,
      name: r.name,
      image_url: r.image_url,
      category: r.category,
      price: r.price,
      change24h,
      vwap: vwaps.get(r.item_id) ?? null,
      score: signal.score,
      direction: signal.direction,
      reasons: signal.reasons,
    };
  });

  // Největší |skóre| první – nejzajímavější příležitosti nahoře
  rows.sort((a, b) => Math.abs(b.score) - Math.abs(a.score));

  const buyCount = rows.filter((r) => r.direction === "BUY").length;
  const sellCount = rows.filter((r) => r.direction === "SELL").length;
  const eventsCount = activeEvents.length;

  return (
    <div className="space-y-8">
      {/* ── Hlavička ─────────────────────────────────────────── */}
      <div>
        <p className="mb-2 inline-flex items-center rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.2em] text-primary">
          <Radar className="mr-1.5 size-3" />
          Signal engine
        </p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Skener příležitostí
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Složené signály z eventů (nabídkové šoky), soutěží (poptávkové
          spiky), VWAP divergence a momentu. Skóre −100 až +100 – čím dál
          od nuly, tím silnější signál.
        </p>
      </div>

      {/* ── Souhrn signálů ───────────────────────────────────── */}
      <section className="grid gap-3 sm:grid-cols-3">
        <SummaryCard
          label="Nákupní signály"
          value={String(buyCount)}
          hint="skóre ≥ +25"
          tone="up"
        />
        <SummaryCard
          label="Prodejní signály"
          value={String(sellCount)}
          hint="skóre ≤ −25"
          tone="down"
        />
        <SummaryCard
          label="Aktivní eventy"
          value={String(eventsCount)}
          hint="ovlivňují rychlost výroby"
          tone="neutral"
        />
      </section>

      <ScannerTable rows={rows} />
    </div>
  );
}

function SummaryCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone: "up" | "down" | "neutral";
}) {
  return (
    <div className="rounded-xl border border-border/80 bg-card p-4">
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div
        className={`mt-2 font-mono text-2xl font-semibold tabular-nums ${
          tone === "up" ? "text-up" : tone === "down" ? "text-down" : ""
        }`}
      >
        {value}
      </div>
      <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>
    </div>
  );
}
