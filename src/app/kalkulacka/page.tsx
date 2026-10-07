import type { Metadata } from "next";

import { AutoRefresh } from "@/components/auto-refresh";
import { ContractCalculator } from "@/components/contract-calculator";
import { getMarketInstruments } from "@/lib/data";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Kalkulačka kontraktů",
};

export default async function KalkulackaPage() {
  const items = await getMarketInstruments().catch((err) => {
    console.error("getMarketInstruments failed", err);
    return [];
  });

  return (
    <div className="space-y-8">
      <AutoRefresh intervalMs={60_000} />

      <div>
        <p className="mb-2 inline-flex items-center rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.2em] text-primary">
          Kontrakty
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">
          Kalkulačka kontraktů
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Převod „X % MP“ ↔ cena kontraktu. MP = poslední obchodovaná cena
          na burze (tick Q0). Funguje obousměrně: spočítáš cenu pro
          domluvenou slevu i zkontroluješ, jestli cena v kontraktu od
          protistrany odpovídá procentu, které domluvil.
        </p>
      </div>

      <ContractCalculator items={items} />
    </div>
  );
}
