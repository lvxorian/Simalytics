import { getDb } from "@/lib/db";
import {
  countGameImports,
  recordGameImport,
  reconcileGameWarehouse,
  type GameSyncResult,
  type GameWarehouseEntry,
} from "@/lib/data";

export const dynamic = "force-dynamic";

/**
 * Import dat ze hry (userscript v prohlížeči).
 *
 * POST /api/import/sync
 *   Authorization: Bearer GAME_SYNC_SECRET (env)
 *   Content-Type: application/json
 *
 * Známé zdroje (dle reálného dumpu 2026-09-09):
 * – source "warehouse": entries = pole šarží z GET /api/v3/resources/{companyId}/
 *       [{ id, amount, quality, kind, blocked, cost: {workers, admin,
 *          material1..5, market}, datetime, materials }]
 *   kind = ID komodity; unit_cost se počítá jako Σ cost.* / amount
 *   (skutečná pořizovací cena šarže). Poté proběhne reconcile portfolia.
 * – ostatní zdroje (cashflow, balance-sheet, …) se zatím jen ukládají
 *   jako raw do game_imports (audit / budoucí stránka financí).
 *
 * Limity: max 500 šarží / 1 MB payload.
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

  const { source, entries } = (body ?? {}) as {
    source?: string;
    entries?: unknown;
  };

  if (!source || typeof source !== "string" || source.length > 40) {
    return Response.json(
      { error: "Chybí 'source' (např. 'warehouse')." },
      { status: 400 }
    );
  }

  // Raw payload vždy uložíme (audit) – i kdyby parsing selhal
  try {
    await recordGameImport(source, body);
  } catch {
    // audit nesmí zablokovat sync
  }

  if (source !== "warehouse") {
    return Response.json({
      ok: true,
      stored: "raw",
      total_imports: await countGameImports(),
    });
  }

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

  /**
   * Mapování herní šarže → náš formát:
   *   kind → item_id, quality → quality, amount → quantity,
   *   unit_cost = (workers + admin + material1..5 + market) / amount
   * Blokované šarže (blocked=true) počítáme taky – jsou ve skladu.
   */
  const parsed: GameWarehouseEntry[] = [];
  let skipped = 0;
  for (const raw of entries) {
    const batch = raw as {
      id?: unknown;
      kind?: unknown;
      quality?: unknown;
      amount?: unknown;
      blocked?: unknown;
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
