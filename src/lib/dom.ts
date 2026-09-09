import { getDb } from "@/lib/db";
import { getOfficialOrders } from "@/lib/simco-official";

/**
 * DOM index (Depth of Market) – trvalý obraz aktivních nabídek burzy.
 *
 * Writer: výhradně price-hub (domStep, 4 položky/kolo, round-robin dle
 * nejstaršího pokrytí). API routy jen čtou.
 *
 * Co index dává:
 *   - aktivní hloubka trhu per položka (kolik kusů stojí na burze a za kolik),
 *   - průnik k upstreamu: nový order_id = čerstvá nabídka (vložená teď),
 *     zmizelý order_id = někdo ho koupil nebo stáhl → „co se prodávalo",
 *   - NPC vs. hráč (NPC nabídky nejsou skutečný zájem trhu).
 *
 * KVANTITA: jeden ofiko request = ~96–97 nabídek (plný orderbook), takže
 * 4 položky/kolo ≈ 380 upsertů / ~8 s – zanedbatelné pro Neon.
 *
 * Pozn. ke kvalitě: celá appka funguje na Q0 (kvalita 0) – stejně tak DOM.
 */

/** Nabídka z orderbooku připravená k upsertu. */
export type DomOfferUpsert = {
  offerId: number;
  itemId: number;
  price: number;
  quantity: number;
  npc: boolean;
  sellerName: string | null;
  postedAt: string | null;
};

/** Stáhne plný orderbook položky a vrátí nabídky připravené k upsertu. */
export async function fetchDomOffers(
  itemId: number,
  quality = 0
): Promise<DomOfferUpsert[]> {
  const orders = await getOfficialOrders(itemId, quality);
  return orders.map((o) => ({
    offerId: o.orderId,
    itemId,
    price: o.price,
    quantity: o.quantity,
    npc: o.seller?.npc ?? false,
    sellerName: o.seller?.company ?? null,
    postedAt: o.posted || null,
  }));
}

/**
 * Upsert nabídek do market_offers.last_seen_at = now() znamená „stále
 * visí na burze". Řádky bez update v cyklu = zmizely (koupil/stáhl).
 */
export async function upsertDomOffers(offers: DomOfferUpsert[]): Promise<void> {
  const valid = offers.filter((o) => o.offerId > 0 && o.quantity > 0 && o.price > 0);
  if (valid.length === 0) return;
  const db = getDb();
  const rows = valid.map((o) => ({
    offer_id: o.offerId,
    item_id: o.itemId,
    quality: 0,
    price: o.price,
    quantity: o.quantity,
    npc: o.npc,
    seller_name: o.sellerName,
    posted_at: o.postedAt,
  }));
  await db`
    insert into market_offers ${db(rows, "offer_id", "item_id", "quality", "price", "quantity", "npc", "seller_name", "posted_at")}
    on conflict (offer_id) do update set
      price = excluded.price,
      quantity = excluded.quantity,
      npc = excluded.npc,
      seller_name = excluded.seller_name,
      posted_at = excluded.posted_at,
      last_seen_at = now()
  `;
}

/** Označí položku jako právě skenovanou (round-robin dle nejstaršího pokrytí). */
export async function touchDomCovered(itemId: number): Promise<void> {
  const db = getDb();
  await db`update items set dom_covered_at = now() where id = ${itemId}`;
}

// ── Čtecí vrstva (API routy) ─────────────────────────────────────────

export type DomRow = {
  item_id: number;
  name: string;
  image_url: string | null;
  /** Počet aktivních nabídek (orderů) na burze. */
  offers: number;
  /** Celkový objem aktivních nabídek (ks) – „kolik se prodává". */
  depth: number;
  /** Nejlevnější nabídka (nejnižší ask). */
  best_ask: number | null;
  /** Objemově vážená průměrná cena aktivních nabídek. */
  vwap_ask: number | null;
  /** 24h objem obchodů ze Simco Tools (kolik se reálně obchodovalo). */
  volume24h: number | null;
  /** Poslední obchodní cena (SSR seed pro živou cenu v tabulce). */
  last_price: number | null;
  /** Kdy položku naposledy viděl DOM sken. */
  scanned_at: string | null;
};

/**
 * DOM tabulka: per položka agregovaná aktivní nabídka + 24h objem.
 * Zahrnuje jen položky, které sken už někdy viděl (dom_covered_at not null).
 */
export async function getDomRows(): Promise<DomRow[]> {
  const db = getDb();
  const rows = (await db`
    select i.id, i.name, i.image_url,
           count(o.offer_id)::int                          as offers,
           coalesce(sum(o.quantity), 0)::int               as depth,
           min(o.price)                                    as best_ask,
           (sum(o.price * o.quantity) / nullif(sum(o.quantity), 0)) as vwap_ask,
           f.volume_24h,
           lp.last_price,
           i.dom_covered_at
    from items i
    join market_offers o on o.item_id = i.id and o.quality = 0
    left join lateral (
      select coalesce(sum(p.volume), 0)::float8 as volume_24h
      from price_history p
      where p.item_id = i.id and p.quality = 0
        and p.recorded_at > now() - interval '24 hours'
        and p.volume is not null
    ) f on true
    left join lateral (
      select p.price as last_price
      from price_history p
      where p.item_id = i.id and p.quality = 0
      order by p.recorded_at desc
      limit 1
    ) lp on true
    where i.dom_covered_at is not null
    group by i.id, i.name, i.image_url, f.volume_24h, lp.last_price, i.dom_covered_at
    order by depth desc
  `) as unknown as {
    id: number;
    name: string;
    image_url: string | null;
    offers: number;
    depth: number;
    best_ask: string | null;
    vwap_ask: string | null;
    volume_24h: number | null;
    last_price: string | null;
    dom_covered_at: string | null;
  }[];

  return rows.map((r) => ({
    item_id: r.id,
    name: r.name,
    image_url: r.image_url,
    offers: Number(r.offers),
    depth: Number(r.depth),
    best_ask: r.best_ask !== null ? Number(r.best_ask) : null,
    vwap_ask: r.vwap_ask !== null ? Number(r.vwap_ask) : null,
    volume24h: r.volume_24h !== null && r.volume_24h !== undefined ? Number(r.volume_24h) : null,
    last_price: r.last_price !== null ? Number(r.last_price) : null,
    scanned_at: r.dom_covered_at,
  }));
}

/** Detail jedné položky: všechny její aktivní nabídky (vzestupně dle ceny). */
export async function getDomOffersForItem(
  itemId: number,
  limit = 60
): Promise<
  {
    price: number;
    quantity: number;
    npc: boolean;
    sellerName: string | null;
    postedAt: string | null;
    ageMinutes: number | null;
  }[]
> {
  const db = getDb();
  const rows = (await db`
    select price, quantity, npc, seller_name, posted_at,
           extract(epoch from (now() - posted_at)) / 60 as age_minutes
    from market_offers
    where item_id = ${itemId} and quality = 0
    order by price asc, quantity desc
    limit ${limit}
  `) as unknown as {
    price: string;
    quantity: number;
    npc: boolean;
    seller_name: string | null;
    posted_at: string | null;
    age_minutes: string | null;
  }[];

  return rows.map((r) => ({
    price: Number(r.price),
    quantity: Number(r.quantity),
    npc: r.npc,
    sellerName: r.seller_name,
    postedAt: r.posted_at,
    ageMinutes: r.age_minutes !== null ? Number(r.age_minutes) : null,
  }));
}
