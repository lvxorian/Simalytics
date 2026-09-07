import { ArrowDownRight, ArrowUpRight, Database, LineChart } from "lucide-react";
import Link from "next/link";

import { AutoRefresh } from "@/components/auto-refresh";
import { MarketTable, type MarketRow } from "@/components/market-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getLatestPrices, getPricesAround24hAgo } from "@/lib/data";
import { formatPercent, formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  let rows: MarketRow[] = [];
  let dbError: string | null = null;

  try {
    const latest = await getLatestPrices(0);
    const dayAgo = await getPricesAround24hAgo(latest.map((r) => r.item_id));
    rows = latest.map((r) => {
      const base = dayAgo.get(r.item_id);
      const change24h =
        base && base > 0 ? ((r.price - base) / base) * 100 : null;
      return { ...r, change24h };
    });
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
  }

  // Statistiky do karet nad tabulkou
  const sorted = [...rows].sort(
    (a, b) => (b.change24h ?? -Infinity) - (a.change24h ?? -Infinity)
  );
  const topGainer = sorted[0];
  const topLoser = sorted[sorted.length - 1];

  if (dbError || rows.length === 0) {
    return (
      <SetupNotice error={dbError} />
    );
  }

  return (
    <div className="space-y-6">
      <AutoRefresh intervalMs={60_000} />

      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Přehled trhu</h1>
          <p className="text-sm text-muted-foreground">
            Nejnovější ceny komodit (kvalita 0) ze simulátoru SimCompanies.
          </p>
        </div>
        <Button asChild variant="outline" size="sm" className="gap-2">
          <Link href="/positions">
            <LineChart className="size-4" />
            Mé pozice
          </Link>
        </Button>
      </div>

      {/* Statistické karty */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Sledované položky"
          value={String(rows.length)}
          hint="kvalita 0"
        />
        <StatCard
          label="Největší 24h růst"
          value={topGainer ? formatPercent(topGainer.change24h) : "–"}
          hint={topGainer?.name}
          tone={(topGainer?.change24h ?? 0) > 0 ? "up" : "neutral"}
          icon={<ArrowUpRight className="size-4" />}
        />
        <StatCard
          label="Největší 24h pád"
          value={topLoser ? formatPercent(topLoser.change24h) : "–"}
          hint={topLoser?.name}
          tone={(topLoser?.change24h ?? 0) < 0 ? "down" : "neutral"}
          icon={<ArrowDownRight className="size-4" />}
        />
      </div>

      <MarketTable rows={rows} />
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
  tone = "neutral",
  icon,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "up" | "down" | "neutral";
  icon?: React.ReactNode;
}) {
  return (
    <Card className="gap-2 py-4">
      <CardHeader className="px-4">
        <CardTitle className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {icon}
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4">
        <div
          className={cn(
            "font-mono text-2xl font-semibold",
            tone === "up" && "text-emerald-400",
            tone === "down" && "text-red-400"
          )}
        >
          {value}
        </div>
        {hint && (
          <div className="truncate text-xs text-muted-foreground">{hint}</div>
        )}
      </CardContent>
    </Card>
  );
}

function SetupNotice({ error }: { error: string | null }) {
  return (
    <Card className="mx-auto mt-16 max-w-2xl border-dashed">
      <CardHeader className="items-center text-center">
        <Database className="mx-auto mb-2 size-10 text-muted-foreground" />
        <CardTitle className="text-lg">Zatím žádná data</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-center text-sm text-muted-foreground">
        <p>
          Tabulky jsou prázdné nebo není nastavené připojení k Supabase.
          Zkontroluj <code className="font-mono text-foreground">.env.local</code>{" "}
          a spusť cron skript:
        </p>
        <pre className="mx-auto w-fit rounded bg-muted px-4 py-2 font-mono text-xs text-foreground">
          npm run fetch:market
        </pre>
        {error && (
          <p className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-left font-mono text-xs text-red-300">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
