import type { Metadata } from "next";
import { Layers } from "lucide-react";

import { DomTable } from "@/components/dom-table";
import { getDomRows } from "@/lib/dom";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "DOM – hloubka trhu",
  description:
    "Depth of Market: aktivní nabídky celé burzy SimCompanies – kolik kusů stojí na trhu, za kolik a jak hluboký je orderbook každé komodity.",
};

export default async function DomPage() {
  const rows = await getDomRows();

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8">
      {/* ── Hero ─────────────────────────────────────────────────── */}
      <div className="mb-6">
        <div className="mb-1 flex items-center gap-2">
          <Layers className="size-4 text-primary" />
          <h1 className="font-mono text-sm font-bold tracking-[0.22em]">
            DOM – HLUBOKA TRHU
          </h1>
        </div>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Aktivní nabídky celé burzy: kolik kusů které komodity stojí na trhu
          a za kolik. Data průměruje sken orderbooků (ofiko API, celý trh
          ~1× za minutu) – poslední obchod žije přes SSE jako všude jinde.
        </p>
      </div>

      <DomTable initialRows={rows} />
    </main>
  );
}
