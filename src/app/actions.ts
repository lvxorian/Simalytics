"use server";

import { revalidatePath } from "next/cache";

import {
  addConditionNote,
  closePosition,
  openPosition,
} from "@/lib/data";

export type ActionState = { ok: boolean; error?: string };

/** Otevře novou pozici (formulář /positions/new). */
export async function createPositionAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    const item_id = Number(formData.get("item_id"));
    const quality = Number(formData.get("quality") ?? 0);
    const quantity = Number(formData.get("quantity"));
    const buy_price = Number(formData.get("buy_price"));
    const note = String(formData.get("note") ?? "").trim() || null;
    const condition_text = String(formData.get("condition_text") ?? "").trim();
    const trigger_reason =
      String(formData.get("trigger_reason") ?? "").trim() || null;
    const market_price_at_log = Number(
      formData.get("market_price_at_log") ?? buy_price
    );

    if (!Number.isInteger(item_id) || item_id <= 0)
      return { ok: false, error: "Vyber položku." };
    if (!Number.isFinite(quantity) || quantity <= 0)
      return { ok: false, error: "Množství musí být kladné číslo." };
    if (!Number.isFinite(buy_price) || buy_price <= 0)
      return { ok: false, error: "Nákupní cena musí být kladné číslo." };
    if (!condition_text)
      return {
        ok: false,
        error: "Popiš podmínky obchodu – proč pozici otevíráš?",
      };

    await openPosition({
      item_id,
      quality,
      quantity,
      buy_price,
      note,
      condition_text,
      trigger_reason,
      market_price_at_log,
    });

    revalidatePath("/positions");
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Neznámá chyba.",
    };
  }
}

/** Uzavře pozici (prodej) – dialog v tabulce pozic. */
export async function closePositionAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    const position_id = String(formData.get("position_id") ?? "");
    const sell_price = Number(formData.get("sell_price"));
    const condition_text = String(formData.get("condition_text") ?? "").trim();
    const market_price_at_log = Number(
      formData.get("market_price_at_log") ?? sell_price
    );

    if (!position_id) return { ok: false, error: "Chybí identifikátor pozice." };
    if (!Number.isFinite(sell_price) || sell_price <= 0)
      return { ok: false, error: "Prodejní cena musí být kladné číslo." };
    if (!condition_text)
      return { ok: false, error: "Popiš podmínky prodeje – proč právě teď?" };

    await closePosition({
      positionId: position_id,
      sellPrice: sell_price,
      condition_text,
      market_price_at_log,
    });

    revalidatePath("/positions");
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Neznámá chyba.",
    };
  }
}

/** Přidá poznámku do condition logu existující pozice. */
export async function addConditionNoteAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    const position_id = String(formData.get("position_id") ?? "");
    const condition_text = String(formData.get("condition_text") ?? "").trim();
    const market_price_raw = Number(formData.get("market_price_at_log"));
    const market_price_at_log = Number.isFinite(market_price_raw) && market_price_raw > 0
      ? market_price_raw
      : null;

    if (!position_id) return { ok: false, error: "Vyber pozici." };
    if (!condition_text) return { ok: false, error: "Poznámka je prázdná." };

    await addConditionNote({ positionId: position_id, condition_text, market_price_at_log });

    revalidatePath("/positions");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Neznámá chyba.",
    };
  }
}
