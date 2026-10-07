import type { Metadata } from "next";

import { AutoRefresh } from "@/components/auto-refresh";
import { ProfitCalculator } from "@/components/profit-calculator";
import {
  getMarketInstruments,
  getTransportInputs,
} from "@/lib/data";
import { getGameWarehouse } from "@/lib/data";
import type { WarehouseRow } from "@/components/profit-calculator";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Profit kalkulačka",
};

export default async function ProfitPage() {
  const [items, warehouse, transport] = await Promise.all([
    getMarketInstruments().catch((err) => {
      console.error("getMarketInstruments failed", err);
      return [];
    }),
    getGameWarehouse().catch((err) => {
      console.error("getGameWarehouse failed", err);
      return [];
    }),
    getTransportInputs().catch((err) => {
      console.error("getTransportInputs failed", err);
      return { ratios: {}, transportUnitCost: null };
    }),
  ]);

  // Do client komponenty posíláme jen nahuštěné řádky skladu (položka +
  // kvalita → unit cost / ks a množství). Updated_at pro „před X min“.
  const rows: WarehouseRow[] = warehouse.map((w) => ({
    item_id: w.item_id,
    quality: w.quality,
    quantity: w.quantity,
    unit_cost: w.unit_cost,
    updated_at: w.updated_at,
  }));

  return (
    <div className="space-y-8">
      <AutoRefresh intervalMs={60_000} />

      <div>
        <p className="mb-2 inline-flex items-center rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.2em] text-primary">
          Kalkulačky
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">
          Profit kalkulačka
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Kolik čistého zisku ti zbyde z prodeje: zadej pořizovací cenu,
          kusy a cenu prodejne (nebo −% MP z trhu). Mechanika dle hry –
          maloobchod a kontrakt mají ŽÁDNÝ poplatek (kontrakt spotřebuje
          polovinu přepravy), burza účtuje 4 % z tržby. Přeprava ze
          skutečného poměru položky a ceny Přepravy na skladu.
        </p>
      </div>

      <ProfitCalculator
        items={items}
        warehouse={rows}
        transportInputs={{
          ratios: transport.ratios,
          transportUnitCost: transport.transportUnitCost,
        }}
      />
    </div>
  );
}
