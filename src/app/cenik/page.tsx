import type { Metadata } from "next";

import { AutoRefresh } from "@/components/auto-refresh";
import { CenikBuilder } from "@/components/cenik-builder";
import { getMarketInstruments } from "@/lib/data";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Ceník",
};

export default async function CenikPage() {
  const items = await getMarketInstruments().catch((err) => {
    console.error("getMarketInstruments failed", err);
    return [];
  });

  return (
    <div className="space-y-8">
      <AutoRefresh intervalMs={60_000} />

      <div>
        <p className="mb-2 inline-flex items-center rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.2em] text-primary">
          Ceník
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">
          Generátor ceníku
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Ceník VŠECH kvalit aktiva pro herní chat. Zadej slevu/přirážku
          v % MP a zkopíruj výstup – ceny dle nejnižší nabídky burzy per
          kvalita (fallback poslední obchod). Kvality, které nechceš
          vypsat, prostě odškrtni.
        </p>
      </div>

      <CenikBuilder items={items} />
    </div>
  );
}
