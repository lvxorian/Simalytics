import type { Metadata } from "next";

import { NewPositionForm } from "@/components/position-form";
import { getLatestPrices } from "@/lib/data";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Přidat aktivum",
};

export default async function NewPositionPage() {
  let items: { id: number; name: string; price: number }[] = [];
  let dbError: string | null = null;

  try {
    items = (await getLatestPrices(0)).map((r) => ({
      id: r.item_id,
      name: r.name,
      price: r.price,
    }));
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Přidat aktivum</h1>
        <p className="text-sm text-muted-foreground">
          Zapiš nákup – co jsi koupil, v jakém množství a za jakou cenu.
          Aktivum se hned objeví v přehledu portfolia.
        </p>
      </div>

      {items.length === 0 && (
        <div className="rounded-lg border border-dashed border-border bg-card p-4 text-sm text-muted-foreground">
          {dbError ? (
            <>
              Nepodařilo se načíst položky:{" "}
              <code className="font-mono text-xs text-foreground">{dbError}</code>
            </>
          ) : (
            <>
              V databázi nejsou žádné ceny – spusť{" "}
              <code className="font-mono text-xs text-foreground">
                npm run fetch:market
              </code>{" "}
              nebo počkej na cron. Aktivum můžeš i tak zadat ručně, ale položky
              v nabídce chybí.
            </>
          )}
        </div>
      )}

      <NewPositionForm items={items} />
    </div>
  );
}
