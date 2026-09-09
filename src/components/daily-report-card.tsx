import Link from "next/link";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Briefcase,
  FileText,
  Lightbulb,
} from "lucide-react";

import { ItemIcon } from "@/components/item-icon";
import { ChangeBadge } from "@/components/change-badge";
import { cn } from "@/lib/utils";
import { formatPrice } from "@/lib/format";
import { scoreColorClass } from "@/lib/signals";
import type { DailyReport } from "@/lib/daily-report";

/**
 * „Denní report“ – rule-based investorský souhrn trhu (bez AI).
 * Všechna logika sedí v lib/daily-report.ts, tady je jen prezentace:
 * souhrn dne, největší pohyby s kontextem, doporučení BUY/SELL, rizika
 * a akce k vlastním otevřeným pozicím.
 */
export function DailyReportCard({ report }: { report: DailyReport }) {
  const b = report.breadth;
  const d = new Date(report.generatedAt);

  return (
    <section className="overflow-hidden rounded-xl border border-border/80 bg-card">
      {/* ── Hlavička reportu ─────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <FileText className="size-4 text-primary" />
          Denní report
          <span
            className={cn(
              "ml-1 rounded-full border px-2 py-0.5 font-mono text-[11px]",
              report.tone === "up" && "border-up/25 bg-up/10 text-up",
              report.tone === "down" && "border-down/25 bg-down/10 text-down",
              report.tone === "flat" &&
                "border-border bg-muted text-muted-foreground"
            )}
          >
            {report.headline}
          </span>
        </h2>
        <span className="font-mono text-[11px] text-muted-foreground">
          {d.toLocaleDateString("cs-CZ", {
            day: "numeric",
            month: "numeric",
            year: "numeric",
          })}{" "}
          {d.toLocaleTimeString("cs-CZ", {
            hour: "2-digit",
            minute: "2-digit",
          })}{" "}
          · automatický souhrn z dat Simalytics
        </span>
      </div>

      <div className="grid gap-0 lg:grid-cols-5">
        {/* ── Souhrn + pohyby (širší sloupec) ─────────────────── */}
        <div className="space-y-4 px-4 py-4 lg:col-span-3">
          <div>
            <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Co se dělo za 24 h
            </div>
            <p className="text-sm leading-relaxed text-foreground/90">
              {report.summary}
            </p>
            <p className="mt-1.5 font-mono text-[11px] text-muted-foreground">
              {b.gainers}▲ / {b.losers}▼ / {b.flat} bez změny z {b.total} ·
              medián {fmt(b.medianChange)}
            </p>
          </div>

          {report.movers.length > 0 && (
            <div>
              <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Největší pohyby
              </div>
              <ul className="space-y-1.5">
                {report.movers.map((m) => (
                  <li key={m.itemId}>
                    <Link
                      href={`/market/${m.itemId}`}
                      className="group flex items-start gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent/40"
                    >
                      <ItemIcon
                        url={m.imageUrl}
                        name={m.name}
                        size={28}
                        className="mt-0.5"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          <span className="text-sm font-medium group-hover:text-primary">
                            {m.name}
                          </span>
                          <span className="font-mono text-xs text-muted-foreground">
                            {formatPrice(m.price)}
                          </span>
                          <ChangeBadge value={m.change24h} size="sm" />
                        </div>
                        {m.context && (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {m.context}
                          </p>
                        )}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* ── Doporučení + rizika (užší sloupec) ──────────────── */}
        <div className="space-y-4 border-t border-border/60 px-4 py-4 lg:col-span-2 lg:border-l lg:border-t-0">
          <div>
            <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              <Lightbulb className="size-3.5" />
              Investiční doporučení
            </div>
            {report.picks.length > 0 ? (
              <ul className="space-y-2">
                {report.picks.map((p) => (
                  <li
                    key={p.itemId}
                    className="rounded-lg border border-border/60 bg-background/40 px-2.5 py-2"
                  >
                    <Link
                      href={`/market/${p.itemId}`}
                      className="group flex items-center gap-2"
                    >
                      <ItemIcon url={p.imageUrl} name={p.name} size={24} />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium group-hover:text-primary">
                        {p.name}
                      </span>
                      <span
                        className={cn(
                          "font-mono text-xs font-semibold tabular-nums",
                          scoreColorClass(p.score)
                        )}
                      >
                        {p.score > 0 ? "+" : ""}
                        {p.score}
                      </span>
                      {p.direction === "BUY" ? (
                        <ArrowUpRight className="size-3.5 text-up" />
                      ) : (
                        <ArrowDownRight className="size-3.5 text-down" />
                      )}
                    </Link>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {p.action}
                    </p>
                    {p.reasons.length > 0 && (
                      <ul className="mt-1 space-y-0.5">
                        {p.reasons.slice(0, 3).map((r, i) => (
                          <li
                            key={i}
                            className="flex items-baseline gap-1.5 text-[11px] text-muted-foreground"
                          >
                            <span
                              className={cn(
                                "font-mono font-semibold tabular-nums",
                                r.points > 0 ? "text-up" : "text-down"
                              )}
                            >
                              {r.points > 0 ? "+" : ""}
                              {r.points}
                            </span>
                            {r.label}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">
                Žádné silné signály (|skóre| ≥ 25) – trh čeká na katalyzátor.
                Doba bez jasného směru je dobrá na plánování, ne na
                spekulace.
              </p>
            )}
          </div>

          {report.risks.length > 0 && (
            <div>
              <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                <AlertTriangle className="size-3.5 text-[#d4a72c]" />
                Na co si dát pozor
              </div>
              <ul className="space-y-1.5">
                {report.risks.map((r) => (
                  <li key={`${r.itemId}-${r.reason}`} className="text-xs">
                    <Link
                      href={`/market/${r.itemId}`}
                      className="font-medium text-foreground hover:text-primary"
                    >
                      {r.name}
                    </Link>
                    <span className="text-muted-foreground">
                      {" "}
                      – {r.reason}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {report.positionsNote && (
            <div>
              <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                <Briefcase className="size-3.5" />
                Tvoje pozice ({report.positionsNote.openCount})
              </div>
              <ul className="space-y-1.5">
                {report.positionsNote.items.map((p) => (
                  <li
                    key={p.itemId}
                    className="flex flex-wrap items-baseline gap-x-2 text-xs"
                  >
                    <Link
                      href={`/market/${p.itemId}`}
                      className="font-medium text-foreground hover:text-primary"
                    >
                      {p.name}
                    </Link>
                    <span
                      className={cn(
                        "font-mono tabular-nums",
                        (p.plPct ?? 0) > 0
                          ? "text-up"
                          : (p.plPct ?? 0) < 0
                            ? "text-down"
                            : "text-muted-foreground"
                      )}
                    >
                      {p.plPct === null
                        ? "–"
                        : `${p.plPct > 0 ? "+" : ""}${p.plPct.toFixed(1)} %`}
                    </span>
                    <span className="w-full text-muted-foreground">
                      {p.action}
                    </span>
                  </li>
                ))}
              </ul>
              <Link
                href="/portfolio"
                className="mt-2 inline-block text-xs text-muted-foreground transition-colors hover:text-primary"
              >
                Spravovat pozice →
              </Link>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function fmt(v: number | null): string {
  if (v === null) return "–";
  return `${v > 0 ? "+" : ""}${v.toFixed(2)} %`;
}
