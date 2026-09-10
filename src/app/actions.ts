"use server";

import { revalidatePath } from "next/cache";

import {
  addConditionNote,
  addToGameSyncIgnore,
  closePosition,
  createAlert,
  createPortfolioHolding,
  deleteAlert,
  deleteLimitSellAlert,
  deletePortfolioHolding,
  deletePositionLot,
  markAlertsSeen,
  openPosition,
  removeFromGameSyncIgnore,
  sellPortfolioAsset,
  setLimitSellNote,
  toggleAlert,
  toggleWatchlist,
  updateAlertRule,
  updateAlertThreshold,
  updatePositionLot,
  upsertLimitSellAlert,
} from "@/lib/data";

export type ActionState = { ok: boolean; error?: string };

/** Otevře novou pozici (formulář /portfolio/new). */
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
    const condition_text =
      String(formData.get("condition_text") ?? "").trim() ||
      "Nákup zaznamenán bez poznámky.";
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

    revalidatePath("/portfolio");
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
    const condition_text =
      String(formData.get("condition_text") ?? "").trim() ||
      "Prodej zaznamenán bez poznámky.";
    const market_price_at_log = Number(
      formData.get("market_price_at_log") ?? sell_price
    );

    if (!position_id) return { ok: false, error: "Chybí identifikátor pozice." };
    if (!Number.isFinite(sell_price) || sell_price <= 0)
      return { ok: false, error: "Prodejní cena musí být kladné číslo." };

    await closePosition({
      positionId: position_id,
      sellPrice: sell_price,
      condition_text,
      market_price_at_log,
    });

    revalidatePath("/portfolio");
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Neznámá chyba.",
    };
  }
}

/** Přidá/odebere položku z watchlistu (hvězdička). */
export async function toggleWatchlistAction(itemId: number): Promise<boolean> {
  const watched = await toggleWatchlist(itemId);
  revalidatePath("/watchlist");
  revalidatePath("/");
  revalidatePath(`/market/${itemId}`);
  return watched;
}

/** Vytvoří alert (cenový nebo signálový). */
export async function createAlertAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    const item_id = Number(formData.get("item_id"));
    const quality = Number(formData.get("quality") ?? 0);
    const kind = String(formData.get("kind") ?? "price");
    const direction = String(formData.get("direction") ?? "above");
    const threshold = Number(formData.get("threshold"));
    const oneShot = formData.get("one_shot") === "1";
    const note = String(formData.get("note") ?? "").trim() || null;

    if (!Number.isInteger(item_id) || item_id <= 0)
      return { ok: false, error: "Chybí položka alertu." };
    if (kind !== "price" && kind !== "score")
      return { ok: false, error: "Neznámý typ alertu." };
    if (direction !== "above" && direction !== "below" && direction !== "cross")
      return { ok: false, error: "Neznámý směr alertu." };
    if (direction === "cross" && kind !== "price")
      return { ok: false, error: "Crossover dává smysl jen u cenového alertu." };
    if (!Number.isFinite(threshold))
      return { ok: false, error: "Práh musí být číslo." };
    if (kind === "score" && (threshold < -100 || threshold > 100))
      return { ok: false, error: "Skóre musí být v rozsahu −100 až +100." };

    await createAlert({
      item_id,
      quality,
      kind,
      direction,
      threshold,
      oneShot,
      note,
    });

    revalidatePath("/alerts");
    revalidatePath(`/market/${item_id}`);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Neznámá chyba.",
    };
  }
}

/** Zapne/vypne alert (přepínač v tabulce). */
export async function toggleAlertAction(id: string): Promise<boolean> {
  const active = await toggleAlert(id);
  revalidatePath("/alerts");
  return active;
}

/**
 * Označí spuštěné alerty jako prohlédnuté (klik na zvonek).
 * Revaliduje layout, aby badge v hlavičce zmizel hned.
 */
export async function markAlertsSeenAction(): Promise<void> {
  await markAlertsSeen();
  revalidatePath("/", "layout");
}

/** Smaže alert. */
export async function deleteAlertAction(id: string): Promise<void> {
  await deleteAlert(id);
  revalidatePath("/alerts");
}

/** Přidá držbu do portfolia (ruční záznam vlastnictví). */
export async function addToPortfolioAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    const item_id = Number(formData.get("item_id"));
    const quantity = Number(formData.get("quantity"));
    const buy_price = Number(formData.get("buy_price"));
    const note = String(formData.get("note") ?? "").trim() || null;
    const revalidatePortfolio = formData.get("revalidate_portfolio") === "1";

    if (!Number.isInteger(item_id) || item_id <= 0)
      return { ok: false, error: "Chybí položka." };
    if (!Number.isFinite(quantity) || quantity <= 0)
      return { ok: false, error: "Množství musí být kladné číslo." };
    if (!Number.isFinite(buy_price) || buy_price <= 0)
      return { ok: false, error: "Pořizovací cena musí být kladné číslo." };

    // Kvality se v portfoliu nerozlišují – pozice se zakládá s quality 0
    await createPortfolioHolding({
      item_id,
      quality: 0,
      quantity,
      buy_price,
      note,
    });

    revalidatePath("/portfolio");
    if (revalidatePortfolio) revalidatePath(`/market/${item_id}`);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Neznámá chyba.",
    };
  }
}

/** Smaže držbu z portfolia (všechny otevřené pozice dané položky). */
export async function deletePortfolioHoldingAction(
  itemId: number
): Promise<void> {
  await deletePortfolioHolding(itemId);
  await deleteLimitSellAlert(itemId);
  revalidatePath("/portfolio");
}

/**
 * Vyloučí položku z portfolia, ale NECHÁ ji na skladu ve hře (palivo/
 * výroba – nesouvisí s investicemi/flipy). Otevřené pozice se zahodí
 * bez P/L a sync už ji do portfolia nenahrá.
 */
export async function ignoreGameSyncItemAction(
  itemId: number,
  reason: string | null = null
): Promise<void> {
  await addToGameSyncIgnore(itemId, reason);
  revalidatePath("/portfolio");
}

/** Vrátí položku z ignore-listu – příští sync ji znovu nahraje. */
export async function unignoreGameSyncItemAction(
  itemId: number
): Promise<void> {
  await removeFromGameSyncIgnore(itemId);
  revalidatePath("/portfolio");
}

/**
 * Odklepne prodej aktiva (celý nebo část) – uzavře lots FIFO, zaznamená
 * realized P/L do historie. Volá se z dialogu Prodat v portfoliu.
 */
export async function sellPortfolioAssetAction(input: {
  itemId: number;
  quantity: number;
  sellPrice: number;
}): Promise<{ ok: boolean; error?: string; realizedPl?: number }> {
  try {
    const res = await sellPortfolioAsset(input);
    // Hlídka limitu už není potřeba – prodej je odklepnutý (ať to byl
    // celý aktivum, nebo jen část).
    await deleteLimitSellAlert(input.itemId);
    revalidatePath("/portfolio");
    revalidatePath("/");
    return { ok: true, realizedPl: res.realizedPl };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Neznámá chyba.",
    };
  }
}

/**
 * Zadá limitní prodej – poznámka v UI (badge „limit X“ u aktiva) plus
 * hlídka v alerts (kind='limit_sell'): poller hlídá cenu a při dosažení
 * limitu notifikuje (zvonek + zvuk + webhook/e-mail). Finance se nezmění,
 * dokud uživatel prodej neodklepne dialogem Prodat.
 */
export async function setLimitSellAction(input: {
  itemId: number;
  limitPrice: number;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    if (!Number.isFinite(input.limitPrice) || input.limitPrice <= 0)
      return { ok: false, error: "Limitní cena musí být kladné číslo." };
    await setLimitSellNote(input.itemId, input.limitPrice);
    await upsertLimitSellAlert(input.itemId, input.limitPrice);
    revalidatePath("/portfolio");
    revalidatePath("/alerts");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Neznámá chyba.",
    };
  }
}

/**
 * Uloží úpravy aktiv v dialogu portfolia: upraví množství/cenu každého
 * nákupu (lotu) a smaže loty označené k odstranění. Vše v jedné akci,
 * ať je editace atomická z pohledu UI. Vrací chybovou zprávu nebo null.
 */
export async function updatePortfolioLotsAction(input: {
  updates: { positionId: string; quantity: number; buyPrice: number }[];
  deletes: string[];
}): Promise<{ ok: boolean; error?: string }> {
  try {
    for (const u of input.updates) {
      if (!Number.isFinite(u.quantity) || u.quantity <= 0 || !Number.isInteger(u.quantity))
        return { ok: false, error: "Množství musí být kladné celé číslo." };
      if (!Number.isFinite(u.buyPrice) || u.buyPrice <= 0)
        return { ok: false, error: "Pořizovací cena musí být kladné číslo." };
    }

    for (const d of input.deletes) {
      await deletePositionLot(d);
    }
    for (const u of input.updates) {
      await updatePositionLot(u);
    }

    revalidatePath("/portfolio");
    revalidatePath("/portfolio");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Neznámá chyba.",
    };
  }
}

/** Změní práh alertu (přetažení linky v grafu). */
export async function updateAlertThresholdAction(
  id: string,
  threshold: number
): Promise<void> {
  await updateAlertThreshold(id, threshold);
  revalidatePath("/alerts");
}

/**
 * Upraví cenový alert (práh + směr nad/pod) – tužka v tabulkách i
 * dvouklik na cenu v boxu alert linie v grafu. Vrací chybu pro UI,
 * revaliduje obě tabulky i market page (alert linie se překreslí).
 */
export async function updateAlertRuleAction(
  id: string,
  threshold: number,
  direction: "above" | "below" | "cross",
  oneShot = false
): Promise<{ ok: boolean; error?: string }> {
  const error = await updateAlertRule(id, {
    threshold,
    direction,
    oneShot,
  });
  if (error) return { ok: false, error };
  revalidatePath("/alerts");
  return { ok: true };
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

    revalidatePath("/portfolio");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Neznámá chyba.",
    };
  }
}
