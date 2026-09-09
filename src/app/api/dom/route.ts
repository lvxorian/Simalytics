import { getDomRows } from "@/lib/dom";

export const dynamic = "force-dynamic";

/**
 * DOM index – agregovaná aktivní nabídka celého trhu (jen čtení).
 *
 * Data píše výhradně price-hub (domStep, 4 položky/kolo) do market_offers;
 * tento endpoint slouží DOM tabulce (/dom) pro polling – záměrně NE přes
 * SSE: tabulka 151 položek se řadí/filtruje na clientu a 10 s čerstvosti
 * bohatě stačí (hloubka nabídek není cenově kritická jako poslední obchod).
 *
 * Volání: GET /api/dom
 * Odpověď: { rows: DomRow[], serverTime }
 */
export async function GET() {
  try {
    const rows = await getDomRows();
    return Response.json(
      { rows, serverTime: new Date().toISOString() },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return Response.json(
      { error: "DOM data nedostupná" },
      { status: 503 }
    );
  }
}
