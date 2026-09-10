import { getDb } from "@/lib/db";
import {
  countGameImports,
  recordGameImport,
  reconcileGameWarehouse,
  syncGameCashflow,
  type GameCashflowRow,
  type GameSyncResult,
  type GameWarehouseEntry,
} from "@/lib/data";

export const dynamic = "force-dynamic";

/** Desetinný parser pro hodnoty ze hry ("5.07", 5.07, "0.0" → number). */
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Parsing cashflow řádku (formát z reálného dumpu):
 *   { id, datetime, money, category, description, descriptionKey, details }
 *
 * Napojení na pozice (dle descriptionKey 'marketbuy-{id}' / 'retail-{id}'):
 * – 'm' marketbuy → kind 'market_buy': item z klíče, quantity = details.amount,
 *   unit_price = details.price (reálná burzovní cena; je-li chybí, null)
 * – 's' retail    → kind 'retail_sale': item z klíče, quality = details.quality,
 *   unit_price = details.price (prodejní cena; ks = |money| / price)
 * – ostatní ('p' produkce, 'g' mimořádné…) → kind 'other' (jen audit)
 */
function parseCashflowRow(raw: unknown): GameCashflowRow | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as {
    id?: unknown;
    datetime?: unknown;
    category?: unknown;
    description?: unknown;
    descriptionKey?: unknown;
    money?: unknown;
    details?: unknown;
  };

  const id = Number(row.id);
  if (!Number.isFinite(id) || id <= 0) return null;
  const datetime =
    typeof row.datetime === "string" && !Number.isNaN(Date.parse(row.datetime))
      ? row.datetime
      : null;
  if (datetime === null) return null;

  const category = typeof row.category === "string" ? row.category : "?";
  const description =
    typeof row.description === "string" ? row.description : null;
  const descriptionKey =
    typeof row.descriptionKey === "string" ? row.descriptionKey : null;
  const money = num(row.money);
  const details = (row.details && typeof row.details === "object"
    ? row.details
    : {}) as unknown as GameCashflowRow["details"];

  // odvození itemu z descriptionKey: 'marketbuy-3' / 'retail-66' → id 3 / 66
  let itemId: number | null = null;
  const keyMatch = descriptionKey?.match(/-(\d+)$/);
  if (keyMatch) itemId = Number(keyMatch[1]);

  let kind: GameCashflowRow["kind"] = "other";
  let quality = 0;
  let quantity: number | null = null;
  let unitPrice: number | null = null;

  if (category === "m" && itemId !== null) {
    // nákup na burze – details.amount × details.price
    kind = "market_buy";
    const amount = num(details.amount);
    const price = num(details.price);
    if (amount > 0 && price > 0) {
      quantity = Math.round(amount);
      unitPrice = price;
    } else {
      itemId = null; // nekompletní → jen audit
      kind = "other";
    }
  } else if (category === "s" && itemId !== null && description) {
    // maloobchodní prodej – details.price za ks; ks dopočteme z money
    kind = "retail_sale";
    const price = num(details.price);
    const q = Number(details.quality ?? 0);
    quality = Number.isInteger(q) && q >= 0 && q <= 7 ? q : 0;
    if (price > 0 && money > 0) {
      unitPrice = price;
      quantity = Math.round(money / price);
    } else {
      itemId = null;
      kind = "other";
    }
  }

  const unitsUnapplied =
    kind === "market_buy" || kind === "retail_sale"
      ? (quantity ?? 0)
      : null;

  return {
    id,
    datetime,
    category,
    description,
    description_key: descriptionKey,
    money,
    details,
    kind,
    item_id: itemId,
    quality,
    quantity,
    unit_price: unitPrice,
    units_unapplied: unitsUnapplied,
  };
}

/**
 * Import dat ze hry (userscript v prohlížeči).
 *
 * POST /api/import/sync
 *   Authorization: Bearer GAME_SYNC_SECRET (env)
 *   Content-Type: application/json
 *
 * Zdroje (dle reálného dumpu 2026-09-09):
 * – source "warehouse": entries = šarže z GET /api/v3/resources/{companyId}/
 *   → snapshot + reconcile portfolia (ceny: unit_cost šarže → cashflow → tick)
 * – source "cashflow": data = pole z GET /api/v2/companies/me/cashflow/recent/
 *   → reálné ceny transakcí (dedupe dle ID), k dispozici pro reconcile
 * – ostatní → jen raw audit do game_imports
 *
 * Doporučené pořadí ze skriptu: nejdřív cashflow, pak warehouse
 * (reconcile tak hned použije čerstvé reálné ceny).
 */
export async function POST(req: Request) {
  const auth = req.headers.get("authorization");
  const secret = process.env.GAME_SYNC_SECRET;

  if (!secret || auth !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Neplatný JSON." }, { status: 400 });
  }

  const { source, entries, data } = (body ?? {}) as {
    source?: string;
    entries?: unknown;
    data?: unknown;
  };

  if (!source || typeof source !== "string" || source.length > 40) {
    return Response.json(
      { error: "Chybí 'source' (např. 'warehouse' nebo 'cashflow')." },
      { status: 400 }
    );
  }

  // Raw payload vždy uložíme (audit) – i kdyby parsing selhal
  try {
    await recordGameImport(source, body);
  } catch {
    // audit nesmí zablokovat sync
  }

  // ── CASHFLOW: reálné ceny transakcí ─────────────────────────────
  if (source === "cashflow") {
    const list = Array.isArray(data) ? data : Array.isArray(entries) ? entries : [];
    if (list.length === 0) {
      return Response.json({ error: "'data' musí být neprázdné pole." }, { status: 400 });
    }
    if (list.length > 2000) {
      return Response.json(
        { error: "Příliš mnoho řádků (max 2000)." },
        { status: 413 }
      );
    }

    const parsed: GameCashflowRow[] = [];
    let skipped = 0;
    for (const raw of list) {
      const row = parseCashflowRow(raw);
      if (row === null) {
        skipped++;
        continue;
      }
      parsed.push(row);
    }

    if (parsed.length === 0) {
      return Response.json(
        { error: "Žádný platný řádek cashflow.", skipped },
        { status: 400 }
      );
    }

    try {
      const inserted = await syncGameCashflow(parsed);
      return Response.json({
        ok: true,
        stored: "cashflow",
        inserted,
        skipped,
        total_imports: await countGameImports(),
      });
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : "Unknown error" },
        { status: 500 }
      );
    }
  }

  // ── WAREHOUSE: snapshot + reconcile portfolia ───────────────────
  if (source === "warehouse") {
    if (!Array.isArray(entries) || entries.length === 0) {
      return Response.json(
        { error: "'entries' musí být neprázdné pole šarží." },
        { status: 400 }
      );
    }
    if (entries.length > 500) {
      return Response.json(
        { error: "Příliš mnoho položek (max 500)." },
        { status: 413 }
      );
    }

    const parsed: GameWarehouseEntry[] = [];
    let skipped = 0;
    for (const raw of entries) {
      const batch = raw as {
        id?: unknown;
        kind?: unknown;
        quality?: unknown;
        amount?: unknown;
        cost?: Record<string, unknown> | null;
      };

      const itemId = Number(batch.kind);
      const quality = Number(batch.quality ?? 0);
      const amount = Number(batch.amount);

      if (!Number.isInteger(itemId) || itemId <= 0) {
        skipped++;
        continue;
      }
      if (!Number.isInteger(quality) || quality < 0 || quality > 7) {
        skipped++;
        continue;
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        skipped++;
        continue;
      }

      let unitCost: number | null = null;
      if (batch.cost && typeof batch.cost === "object") {
        const values = Object.values(batch.cost).map((v) =>
          Number.isFinite(Number(v)) ? Number(v) : 0
        );
        const sum = values.reduce<number>((acc, v) => acc + v, 0);
        if (sum > 0) unitCost = sum / amount;
      }

      parsed.push({
        item_id: itemId,
        quality,
        quantity: Math.round(amount),
        unit_cost: unitCost,
      });
    }

    if (parsed.length === 0) {
      return Response.json(
        {
          error:
            "Žádná platná šarže (očekávám formát /api/v3/resources/{companyId}/: { kind, quality, amount, cost }).",
          skipped,
        },
        { status: 400 }
      );
    }

    try {
      const result: GameSyncResult = await reconcileGameWarehouse(parsed);
      return Response.json({ ok: true, skipped, ...result });
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : "Unknown error" },
        { status: 500 }
      );
    }
  }

  // ── Ostatní zdroje: jen raw audit ───────────────────────────────
  return Response.json({
    ok: true,
    stored: "raw",
    total_imports: await countGameImports(),
  });
}
