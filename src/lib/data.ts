import postgres, { type JSONValue } from "postgres";
import { getDb } from "@/lib/db";import type { SimcoCertificateKind, SimcoContest, SimcoVwap } from "@/lib/simcotools";
import type {
  ConditionLogEntry,
  Item,
  LatestPriceRow,
  Position,
  PositionWithPnl,
} from "@/lib/types";

/**
 * Datová vrstva – všechny dotazy do PostgreSQL (Neon) na jednom místě.
 * postgres.js: numeric přichází jako string, timestamptz jako Date ⇒
 * na hraně vždy převádíme na čísla a ISO stringy.
 */

// ── Raw typy (odpovídají řádkům z DB před konverzí) ─────────────────
type RawLatest = {
  item_id: number;
  name: string;
  db_letter: string | null;
  category: string | null;
  image_url: string | null;
  price: string;
  quantity: number | null;
  recorded_at: Date;
};

type RawTick = { recorded_at: Date; price: string };

type RawPosition = {
  id: string;
  item_id: number;
  quality: number;
  quantity: number;
  buy_price: string;
  sell_price: string | null;
  opened_at: Date;
  closed_at: Date | null;
  note: string | null;
  created_at: Date;
};

type RawPositionJoined = RawPosition & {
  item_name: string;
  image_url: string | null;
  current_price: string | null;
};

type RawLog = {
  id: string;
  position_id: string;
  event_type: ConditionLogEntry["event_type"];
  market_price_at_log: string | null;
  condition_text: string;
  trigger_reason: string | null;
  created_at: Date;
  item_name: string | null;
};

const iso = (d: Date): string => d.toISOString();

// ── MARKET DASHBOARD ────────────────────────────────────────────────

/** Nejnovější cena každé položky pro danou kvalitu. */
export async function getLatestPrices(quality = 0): Promise<LatestPriceRow[]> {
  const db = getDb();
  const rows = (await db`
    select i.id            as item_id,
           i.name,
           i.db_letter,
           i.category,
           i.image_url,
           ph.price,
           ph.quantity,
           ph.recorded_at
    from items i
    join lateral (
      select price, quantity, recorded_at
      from price_history
      where item_id = i.id and quality = ${quality}
      order by recorded_at desc
      limit 1
    ) ph on true
    order by i.name
  `) as unknown as RawLatest[];

  return rows.map((r) => ({
    item_id: r.item_id,
    name: r.name,
    db_letter: r.db_letter,
    category: r.category,
    image_url: r.image_url,
    price: Number(r.price),
    quantity: r.quantity,
    recorded_at: iso(r.recorded_at),
  }));
}

/** Historie cen jedné položky (pro graf). Volume = reálný 5m objem od 004. */
export async function getPriceHistory(
  itemId: number,
  quality = 0,
  sinceDays = 30
): Promise<{ recorded_at: string; price: number; volume: number | null }[]> {
  const db = getDb();
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);

  const rows = (await db`
    select recorded_at, price, volume
    from price_history
    where item_id = ${itemId} and quality = ${quality}
      and recorded_at >= ${since}
    order by recorded_at asc
    limit 20000
  `) as unknown as { recorded_at: string; price: string; volume: number | null }[];

  return rows.map((r) => ({
    recorded_at: new Date(r.recorded_at).toISOString(),
    price: Number(r.price),
    volume: r.volume === null ? null : Number(r.volume),
  }));
}

// ── POZICE ──────────────────────────────────────────────────────────

export async function getPositions(opts: { open?: boolean } = {}): Promise<Position[]> {
  const db = getDb();
  const where =
    opts.open === true
      ? db`where closed_at is null`
      : opts.open === false
        ? db`where closed_at is not null`
        : db``;

  const rows = (await db`
    select * from positions
    ${where}
    order by opened_at desc
    limit 200
  `) as unknown as RawPosition[];

  return rows.map(mapPosition);
}

function mapPosition(r: RawPosition): Position {
  return {
    id: r.id,
    item_id: r.item_id,
    quality: r.quality,
    quantity: r.quantity,
    buy_price: Number(r.buy_price),
    sell_price: r.sell_price === null ? null : Number(r.sell_price),
    opened_at: iso(r.opened_at),
    closed_at: r.closed_at === null ? null : iso(r.closed_at),
    note: r.note,
    created_at: iso(r.created_at),
  };
}

/**
 * Pozice obohacené o aktuální cenu a P/L – vše v jednom SQL dotazu
 * (lateral join na poslední bod price_history dané položky a kvality).
 */
export async function getPositionsWithPnl(
  opts: { open?: boolean } = {}
): Promise<PositionWithPnl[]> {
  const db = getDb();
  const where =
    opts.open === true
      ? db`where p.closed_at is null`
      : opts.open === false
        ? db`where p.closed_at is not null`
        : db``;

  const rows = (await db`
    select p.*,
           i.name        as item_name,
           i.image_url,
           latest.price  as current_price
    from positions p
    join items i on i.id = p.item_id
    join lateral (
      select price
      from price_history ph
      where ph.item_id = p.item_id and ph.quality = p.quality
      order by ph.recorded_at desc
      limit 1
    ) latest on true
    ${where}
    order by p.opened_at desc
    limit 200
  `) as unknown as RawPositionJoined[];

  return rows.map((r) => {
    const position = mapPosition(r);
    const current = r.current_price === null ? null : Number(r.current_price);

    const isOpen = position.closed_at === null;
    const referencePrice = isOpen ? current : position.sell_price;

    let unrealized_pl: number | null = null;
    let unrealized_pl_pct: number | null = null;
    let realized_pl: number | null = null;

    if (isOpen && referencePrice !== null) {
      unrealized_pl = (referencePrice - position.buy_price) * position.quantity;
      unrealized_pl_pct =
        position.buy_price > 0
          ? ((referencePrice - position.buy_price) / position.buy_price) * 100
          : null;
    }
    if (!isOpen && position.sell_price !== null) {
      realized_pl = (position.sell_price - position.buy_price) * position.quantity;
    }

    return {
      ...position,
      item_name: r.item_name,
      image_url: r.image_url,
      current_price: current,
      unrealized_pl,
      unrealized_pl_pct,
      realized_pl,
    };
  });
}

/** Otevře novou pozici + zapíše úvodní záznam do condition logu (transakce). */
export async function openPosition(input: {
  item_id: number;
  quality: number;
  quantity: number;
  buy_price: number;
  note?: string | null;
  condition_text: string;
  trigger_reason?: string | null;
  market_price_at_log?: number | null;
}): Promise<Position> {
  const db = getDb();

  const raw = await db.begin(async (sql) => {
    const [position] = (await sql`
      insert into positions (item_id, quality, quantity, buy_price, note)
      values (${input.item_id}, ${input.quality}, ${input.quantity},
              ${input.buy_price}, ${input.note ?? null})
      returning *
    `) as unknown as RawPosition[];

    await sql`
      insert into condition_log
        (position_id, event_type, market_price_at_log, condition_text, trigger_reason)
      values
        (${position.id}, 'OPENED', ${input.market_price_at_log ?? null},
         ${input.condition_text}, ${input.trigger_reason ?? null})
    `;

    return position;
  });

  return mapPosition(raw);
}

/** Uzavře pozici (prodej) + log CLOSED (transakce). */
export async function closePosition(input: {
  positionId: string;
  sellPrice: number;
  condition_text: string;
  market_price_at_log?: number | null;
}): Promise<void> {
  const db = getDb();

  await db.begin(async (sql) => {
    const updated = await sql`
      update positions
      set sell_price = ${input.sellPrice}, closed_at = now()
      where id = ${input.positionId} and closed_at is null
    `;
    if (updated.count === 0) {
      throw new Error("Pozice nebyla nalezena nebo už je zavřená.");
    }

    await sql`
      insert into condition_log
        (position_id, event_type, market_price_at_log, condition_text)
      values
        (${input.positionId}, 'CLOSED', ${input.market_price_at_log ?? null},
         ${input.condition_text})
    `;
  });
}

// ── CONDITION LOG ───────────────────────────────────────────────────

export async function getConditionLog(
  limit = 100
): Promise<(ConditionLogEntry & { item_name: string | null })[]> {
  const db = getDb();

  const rows = (await db`
    select cl.id,
           cl.position_id,
           cl.event_type,
           cl.market_price_at_log,
           cl.condition_text,
           cl.trigger_reason,
           cl.created_at,
           i.name as item_name
    from condition_log cl
    join positions p on p.id = cl.position_id
    join items i on i.id = p.item_id
    order by cl.created_at desc
    limit ${limit}
  `) as unknown as RawLog[];

  return rows.map((r) => ({
    id: r.id,
    position_id: r.position_id,
    event_type: r.event_type,
    market_price_at_log:
      r.market_price_at_log === null ? null : Number(r.market_price_at_log),
    condition_text: r.condition_text,
    trigger_reason: r.trigger_reason,
    created_at: iso(r.created_at),
    item_name: r.item_name,
  }));
}

/** Přidá poznámku (NOTE) k existující pozici. */
export async function addConditionNote(input: {
  positionId: string;
  condition_text: string;
  market_price_at_log?: number | null;
}): Promise<void> {
  const db = getDb();
  await db`
    insert into condition_log
      (position_id, event_type, market_price_at_log, condition_text)
    values
      (${input.positionId}, 'NOTE', ${input.market_price_at_log ?? null},
       ${input.condition_text})
  `;
}

// ── PORTFOLIO (agregace otevřených pozic na aktiva) ──────────────────

/** Nákup (lot) – jedna otevřená pozice v rámci aktiva. */
export type EditableLot = {
  id: string;
  quantity: number;
  buy_price: number;
  opened_at: string;
};

export type PortfolioHolding = {
  item_id: number;
  name: string;
  db_letter: string | null;
  image_url: string | null;
  /** Celkem ks napříč pozicemi (všechny kvality dohromady). */
  quantity: number;
  /** Průměrná pořizovací cena (weighted avg napříč kvalitami). */
  avg_buy_price: number;
  /** Poslední tržní cena položky (tick kvality 0). */
  current_price: number | null;
  /** Investováno = avg_buy_price × quantity. */
  invested: number;
  /** Tržní hodnota držby. */
  market_value: number | null;
  /** Nerealizovaný P/L v $. */
  unrealized_pl: number | null;
  /** Nerealizovaný P/L v %. */
  unrealized_pl_pct: number | null;
  /** Kolik otevřených pozic držbu tvoří. */
  position_count: number;
  /** Nejstarší otevření (od kdy držíme). */
  first_opened_at: string;
  /** Okamžik posledního nákupu do držby. */
  last_bought_at: string;
  /** Zadaný limitní prodej (z note otevřených pozic), null bez limitu. */
  limit_price: number | null;
};

/**
 * Přidá držbu do portfolia – založí OPEN pozici v positions (closed_at null).
 * Portfolio i tabulka pozic čtou ze stejné tabulky, takže se držba hned
 * objeví v obou pohledech a jde ji ukončit stávajícím tokem uzavření.
 */
export async function createPortfolioHolding(input: {
  item_id: number;
  quality: number;
  quantity: number;
  buy_price: number;
  note?: string | null;
}): Promise<void> {
  const db = getDb();
  await db`
    insert into positions (item_id, quality, quantity, buy_price, note)
    values (${input.item_id}, ${input.quality}, ${input.quantity},
            ${input.buy_price}, ${input.note ?? null})
  `;
  // držba dává smysl jen s ticky – zapni sběr (stejně jako watchlist)
  await db`update items set track_ticks = true where id = ${input.item_id}`;
}

/**
 * Smaže držbu z portfolia – odstraní otevřené pozice položky (všechny
 * kvality). Hlídka limitního prodeje se čistí v server akci (actions.ts).
 */
export async function deletePortfolioHolding(itemId: number): Promise<void> {
  const db = getDb();
  await db`
    delete from positions
    where item_id = ${itemId} and closed_at is null
  `;
}

/**
 * Jednotlivé nákupy (lots) aktiva jedné položky – pro dialog úpravy.
 * Sbírá otevřené pozice VŠECHNYCH kvalit (portfolio neeviduje kvality).
 */
export async function getPositionLots(
  itemId: number
): Promise<EditableLot[]> {
  const db = getDb();
  const rows = (await db`
    select id, quantity, buy_price, opened_at
    from positions
    where item_id = ${itemId} and closed_at is null
    order by opened_at asc
  `) as unknown as {
    id: string;
    quantity: number;
    buy_price: string;
    opened_at: Date;
  }[];

  return rows.map((r) => ({
    id: r.id,
    quantity: Number(r.quantity),
    buy_price: Number(r.buy_price),
    opened_at: iso(r.opened_at),
  }));
}

/**
 * Aktualizuje jeden nákup (lot) – množství a pořizovací cenu.
 * Slouží dialogu „Upravit aktivum“; upravovat lze jen otevřené pozice.
 */
export async function updatePositionLot(input: {
  positionId: string;
  quantity: number;
  buyPrice: number;
}): Promise<void> {
  const db = getDb();
  const updated = await db`
    update positions
    set quantity = ${input.quantity},
        buy_price = ${input.buyPrice}
    where id = ${input.positionId} and closed_at is null
  `;
  if (updated.count === 0) {
    throw new Error("Nákup nebyl nalezen nebo už je uzavřený.");
  }
}

/**
 * Smaže jeden nákup (lot). Slouží dialogu „Upravit aktivum“ – uživatel
 * tak může z držby odebrat jen vybraný nákup, ne celou držbu.
 */
export async function deletePositionLot(positionId: string): Promise<void> {
  const db = getDb();
  const deleted = await db`
    delete from positions
    where id = ${positionId} and closed_at is null
  `;
  if (deleted.count === 0) {
    throw new Error("Nákup nebyl nalezen nebo už je uzavřený.");
  }
}

/**
 * Prodej z portfolia – uzavře otevřené pozice (lots) daného aktiva.
 *
 * Model: aktivum = otevřené pozice (item, quality). Prodej X ks uzavírá
 * lots FIFO (nejstarší nákupy nejdřív – odpovídá daňové/účetní logice),
 * poslední dotčený lot se při částečném prodeji jen zmenší (update
 * quantity). Vše v transakci – buď se uzavře vše, nebo nic.
 *
 * `limitPrice` (volitelné) = „limitní prodej zadán“ – uloží se do note
 * otevřené pozice (trace v UI, badge „limit X,XXX“), finančně se nic
 * nemění, dokud uživatel prodej neodklepne. Po odklepnutí se volá s
 * sellPrice a limitPrice se ignoruje.
 */
export async function sellPortfolioAsset(input: {
  itemId: number;
  quantity: number;
  sellPrice: number;
}): Promise<{ closedLots: number; partialLot: boolean; realizedPl: number }> {
  const db = getDb();

  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    throw new Error("Množství prodeje musí být kladné číslo.");
  }
  if (!Number.isFinite(input.sellPrice) || input.sellPrice <= 0) {
    throw new Error("Prodejní cena musí být kladné číslo.");
  }

  const available = (await db`
    select coalesce(sum(quantity), 0)::int as qty
    from positions
    where item_id = ${input.itemId}
      and closed_at is null
  `) as unknown as { qty: number }[];

  const openQty = Number(available[0]?.qty ?? 0);
  if (input.quantity > openQty) {
    throw new Error(
      `V portfoliu je jen ${openQty.toLocaleString("cs-CZ")} ks – nelze prodat ${input.quantity.toLocaleString("cs-CZ")} ks.`
    );
  }

  return db.begin(async (sql) => {
    // lots od nejstaršího (FIFO) – napříč všemi kvalitami
    const lots = (await sql`
      select id, quantity, buy_price
      from positions
      where item_id = ${input.itemId}
        and closed_at is null
      order by opened_at asc
      for update
    `) as unknown as { id: string; quantity: number; buy_price: string }[];

    let remaining = input.quantity;
    let closedLots = 0;
    let partialLot = false;
    let costBasis = 0;

    for (const lot of lots) {
      if (remaining <= 0) break;
      const take = Math.min(lot.quantity, remaining);
      const buyPrice = Number(lot.buy_price);
      costBasis += take * buyPrice;

      if (take === lot.quantity) {
        // celý lot uzavřeme
        await sql`
          update positions
          set sell_price = ${input.sellPrice}, closed_at = now()
          where id = ${lot.id}
        `;
        await sql`
          insert into condition_log
            (position_id, event_type, market_price_at_log, condition_text)
          values
            (${lot.id}, 'CLOSED', ${input.sellPrice},
             ${`Prodej ${lot.quantity.toLocaleString("cs-CZ")} ks @ ${input.sellPrice.toFixed(3)} $ (FIFO, hromadný prodej z portfolia).`})
        `;
        closedLots++;
      } else {
        // částečný prodej – lot zmenšíme a založíme „dceřinou“ uzavřenou
        // pozici pro správnou historii realized P/L (originál zůstává otevřený)
        await sql`
          update positions set quantity = quantity - ${take} where id = ${lot.id}
        `;
        const [closedPart] = (await sql`
          insert into positions
            (item_id, quality, quantity, buy_price, sell_price, opened_at, closed_at)
          values
            (${input.itemId}, (select quality from positions where id = ${lot.id}), ${take}, ${buyPrice},
             ${input.sellPrice}, (select opened_at from positions where id = ${lot.id}), now())
          returning id
        `) as unknown as { id: string }[];
        await sql`
          insert into condition_log
            (position_id, event_type, market_price_at_log, condition_text)
          values
            (${closedPart.id}, 'CLOSED', ${input.sellPrice},
             ${`Částečný prodej ${take.toLocaleString("cs-CZ")} ks @ ${input.sellPrice.toFixed(3)} $ (FIFO z novějšího lotu).`})
        `;
        partialLot = true;
      }
      remaining -= take;
    }

    const realizedPl = input.sellPrice * input.quantity - costBasis;
    return { closedLots, partialLot, realizedPl };
  });
}

/**
 * Zaznamená zadaný limitní prodej („čeká na odklepnutí“) – jen poznámka
 * na otevřených pozicích položky (všechny kvality), ať se v tabulce
 * zobrazí badge. Finanční data se nezmění.
 */
export async function setLimitSellNote(
  itemId: number,
  limitPrice: number
): Promise<void> {
  const db = getDb();
  await db`
    update positions
    set note = ${`limit ${limitPrice.toFixed(3)} $`}
    where item_id = ${itemId} and closed_at is null
  `;
}

/**
 * Držby portfolia = otevřené pozice agregované na POLOŽKU (bez rozlišení
 * kvalit) – evidujeme kompletní počet ks napříč Q0/Q1/…, průměrná cena
 * je vážený průměr přes všechny nákupy, aktuální cena = poslední tick
 * kvality 0 (tržní cena položky). Pozice bez dostupné ceny mají P/L null.
 */
export async function getPortfolioHoldings(): Promise<PortfolioHolding[]> {
  const db = getDb();

  const rows = (await db`
    select p.item_id,
           i.name,
           i.db_letter,
           i.image_url,
           sum(p.quantity)::int                 as quantity,
           (sum(p.buy_price * p.quantity) / sum(p.quantity))::float8 as avg_buy_price,
           latest.price                         as current_price,
           count(p.id)::int                     as position_count,
           min(p.opened_at)                     as first_opened_at,
           max(p.opened_at)                     as last_bought_at,
           (array_agg(p.note) filter (where p.note like 'limit %'))[1] as limit_note
    from positions p
    join items i on i.id = p.item_id
    left join lateral (
      select price
      from price_history ph
      where ph.item_id = p.item_id and ph.quality = 0
      order by ph.recorded_at desc
      limit 1
    ) latest on true
    where p.closed_at is null
    group by p.item_id, i.name, i.db_letter, i.image_url, latest.price
    order by (sum(p.buy_price * p.quantity)) desc
    limit 500
  `) as unknown as {
    item_id: number;
    name: string;
    db_letter: string | null;
    image_url: string | null;
    quantity: number;
    avg_buy_price: number;
    current_price: string | null;
    position_count: number;
    first_opened_at: Date;
    last_bought_at: Date;
    limit_note: string | null;
  }[];

  return rows.map((r) => {
    const current = r.current_price === null ? null : Number(r.current_price);
    const invested = r.avg_buy_price * r.quantity;
    const marketValue = current === null ? null : current * r.quantity;
    const pl = marketValue === null ? null : marketValue - invested;

    return {
      item_id: r.item_id,
      name: r.name,
      db_letter: r.db_letter,
      image_url: r.image_url,
      quantity: Number(r.quantity),
      avg_buy_price: Number(r.avg_buy_price),
      current_price: current,
      invested,
      market_value: marketValue,
      unrealized_pl: pl,
      unrealized_pl_pct:
        pl === null || invested <= 0 ? null : (pl / invested) * 100,
      position_count: Number(r.position_count),
      first_opened_at: iso(r.first_opened_at),
      last_bought_at: iso(r.last_bought_at),
      limit_price:
        r.limit_note !== null
          ? Number(r.limit_note.replace("limit ", "").replace(" $", ""))
          : null,
    };
  });
}

/**
 * Historie hodnoty portfolia v čase – rekonstrukce z denních dat.
 *
 * Pro každý den: Σ (množství držby dle stavu positions k tomuto dni)
 *                 × (denní close dané položky a kvality).
 * Množství k dni počítá v SQL (opened_at::date <= den) – držba se do
 * hodnoty započte dnem otevření; prodej (closed_at) už ne. Prázdné dny
 * se doplní plochým krokem (poslední známá hodnota), ať křivka není
 * roztříštěná – stejný princip kontinuity jako u svíček.
 *
 * Zdroj ceny: market_candles_daily (Simco Tools, ~3 měsíce) pro denní
 * close; je-li pro den chybí, použije se cena z price_history (naše
 * ticky) – fallback kryje i dnešek, který v denních svíčkách není.
 */
export async function getPortfolioValueHistory(
  days = 90
): Promise<{ time: number; value: number }[]> {
  const db = getDb();

  // 1) Denní close všech potřebných položek (denní svíčky + fallback ticky)
  const closes = (await db`
    select resource_id, quality, day::text as day, close from market_candles_daily
    where quality = 0 and day >= current_date - ${days}::int
    union all
    select item_id, quality, recorded_at::date::text as day, max(price) as close
    from price_history
    where quality = 0 and recorded_at::date >= current_date - ${days}::int
    group by item_id, quality, recorded_at::date
    having max(price) > 0
  `) as unknown as {
    resource_id: number;
    day: string;
    quality: number;
    close: string;
  }[];

  // 2) Změny množství držby (nákupy i prodeje) po dnech
  const lots = (await db`
    select opened_at::date::text as day,
           item_id,
           quality,
           sum(quantity)::int as qty
    from positions
    where opened_at::date >= current_date - ${days}::int
    group by opened_at::date, item_id, quality
    union all
    select closed_at::date::text as day,
           item_id,
           quality,
           -sum(quantity)::int as qty
    from positions
    where closed_at is not null
      and closed_at::date >= current_date - ${days}::int
    group by closed_at::date, item_id, quality
  `) as unknown as {
    day: string;
    item_id: number;
    quality: number;
    qty: number;
  }[];

  // 3) Denní ceny: mapa `${itemId}-${quality}` → { den → close }.
  // UNION už zajistil dedupe po dnech – ticky i svíčky mají stejné sloupce;
  // nikdy negativní/0 close přeskočíme.
  const priceMap = new Map<string, Map<string, number>>();
  for (const c of closes) {
    const price = Number(c.close);
    if (!(price > 0)) continue;
    const itemKey = `${c.resource_id}-${c.quality}`;
    let byDay = priceMap.get(itemKey);
    if (!byDay) {
      byDay = new Map();
      priceMap.set(itemKey, byDay);
    }
    byDay.set(c.day, price);
  }

  // 4) Per (item,quality) denní změny množství (nákupy +, prodeje −)
  const qtyChanges = new Map<string, Map<string, number>>();
  for (const l of lots) {
    const itemKey = `${l.item_id}-${l.quality}`;
    let byDay = qtyChanges.get(itemKey);
    if (!byDay) {
      byDay = new Map();
      qtyChanges.set(itemKey, byDay);
    }
    byDay.set(l.day, (byDay.get(l.day) ?? 0) + l.qty);
  }

  // 5) Rekonstrukce hodnoty po dnech (kumulativní množství × close)
  const dayKeys: string[] = [];
  {
    const today = new Date();
    for (let i = days; i >= 0; i--) {
      const d = new Date(
        Date.UTC(
          today.getUTCFullYear(),
          today.getUTCMonth(),
          today.getUTCDate() - i
        )
      );
      dayKeys.push(d.toISOString().slice(0, 10));
    }
  }

  const out: { time: number; value: number }[] = [];
  let lastValue: number | null = null;
  // Kumulativní množství držby + poslední známá cena k dni
  const currentQty = new Map<string, number>();
  const lastKnownPrice = new Map<string, number>();

  for (const day of dayKeys) {
    let dayValue = 0;

    for (const [itemKey, byDay] of qtyChanges) {
      // posuň množství o změny tohoto dne
      const delta = byDay.get(day);
      if (delta !== undefined) {
        currentQty.set(itemKey, (currentQty.get(itemKey) ?? 0) + delta);
      }
      const qty = currentQty.get(itemKey) ?? 0;
      if (qty === 0) continue;

      // poslední známá cena k tomuto dni (fallback na starší)
      const price = priceMap.get(itemKey)?.get(day);
      if (price !== undefined) lastKnownPrice.set(itemKey, price);
      const knownPrice = lastKnownPrice.get(itemKey);
      if (knownPrice === undefined) continue; // zatím žádná cena

      dayValue += qty * knownPrice;
    }

    // Kontinuita: den bez dat = plochý krok z předchozí hodnoty.
    // Portfolio prázdné od začátku → bod nezapisujeme (graf začne prvním
    // nákupem); vyprázdnění na 0 → zapisujeme klesnout na nulu.
    if (dayValue > 0) {
      lastValue = dayValue;
      out.push({
        time: Math.floor(new Date(`${day}T00:00:00Z`).getTime() / 1000),
        value: dayValue,
      });
    } else if (lastValue !== null) {
      out.push({
        time: Math.floor(new Date(`${day}T00:00:00Z`).getTime() / 1000),
        value: 0,
      });
      lastValue = null;
    }
  }

  return out;
}

/**
 * Upsertne denní VWAP pro všechny resource+kvality, které známe
 * (1 request do Simco Tools = celý trh). Řádky s neznámým resource
 * nebo kvalitou > 7 se přeskočí (FK na items).
 */
export async function syncVwapDaily(vwaps: SimcoVwap[]): Promise<number> {
  if (vwaps.length === 0) return 0;

  const db = getDb();
  const known = new Set(
    (await db`select id from items`).map((r) => r.id as number)
  );

  const rows = vwaps
    .filter(
      (v) =>
        known.has(v.resourceId) &&
        v.quality >= 0 &&
        v.quality <= 7 &&
        v.vwap > 0
    )
    .map((v) => ({
      resource_id: v.resourceId,
      quality: v.quality,
      day: v.datetime.slice(0, 10),
      vwap: v.vwap,
    }));

  if (rows.length === 0) return 0;

  const result = await db`
    insert into market_vwap_daily ${db(rows, "resource_id", "quality", "day", "vwap")}
    on conflict (resource_id, quality, day) do update set
      vwap = excluded.vwap
  `;
  return result.count;
}

/**
 * Synchronizuje soutěže (contests). Idempotentní upsert dle contest id,
 * is_active se přepočítá podle dne. Vrací počet uložených soutěží.
 */
export async function syncContests(contests: SimcoContest[]): Promise<number> {
  if (contests.length === 0) return 0;

  const db = getDb();
  const known = new Set(
    (await db`select id from items`).map((r) => r.id as number)
  );
  const today = new Date().toISOString().slice(0, 10);

  const rows = contests.map((c) => ({
    id: c.id,
    name: c.name,
    resource_id:
      c.resourceId !== undefined && known.has(c.resourceId)
        ? c.resourceId
        : null,
    building_id: c.buildingId ?? null,
    start_date: c.startDate.slice(0, 10),
    end_date: c.endDate.slice(0, 10),
    is_active: c.startDate.slice(0, 10) <= today && today <= c.endDate.slice(0, 10),
  }));

  const result = await db`
    insert into contests ${db(
      rows,
      "id",
      "name",
      "resource_id",
      "building_id",
      "start_date",
      "end_date",
      "is_active"
    )}
    on conflict (id) do update set
      name = excluded.name,
      resource_id = excluded.resource_id,
      building_id = excluded.building_id,
      start_date = excluded.start_date,
      end_date = excluded.end_date,
      is_active = excluded.is_active,
      synced_at = now()
  `;
  return result.count;
}

/** Synchronizuje druhy certifikátů (referenční data). */
export async function syncCertKinds(
  kinds: SimcoCertificateKind[]
): Promise<number> {
  if (kinds.length === 0) return 0;

  const db = getDb();
  const result = await db`
    insert into cert_kinds ${db(
      kinds.map((k) => ({
        kind: k.kind,
        relevant: k.relevant,
        resource_ids: k.resources ?? [],
      })),
      "kind",
      "relevant",
      "resource_ids"
    )}
    on conflict (kind) do update set
      relevant = excluded.relevant,
      resource_ids = excluded.resource_ids,
      synced_at = now()
  `;
  return result.count;
}

// ── SIGNAL ENGINE: ČTENÍ (fáze 2) ────────────────────────────────

/** Poslední VWAP pro sadu položek (kvalita 0). Klíč = item_id. */
export async function getLatestVwaps(
  itemIds: number[],
  quality = 0
): Promise<Map<number, number>> {
  if (itemIds.length === 0) return new Map();

  const db = getDb();
  const rows = (await db`
    select distinct on (resource_id) resource_id, vwap
    from market_vwap_daily
    where quality = ${quality} and resource_id in ${db(itemIds)}
    order by resource_id, day desc
  `) as unknown as { resource_id: number; vwap: string }[];

  const map = new Map<number, number>();
  for (const r of rows) map.set(r.resource_id, Number(r.vwap));
  return map;
}

/** Aktivní soutěž pro komoditu (z DB). */
export type ActiveContest = {
  contestId: number;
  name: string;
  resourceId: number;
  endDate: string; // YYYY-MM-DD
};

/** Mapa resource_id → aktivní soutěž (is_active z denního syncu). */
export async function getActiveContests(): Promise<Map<number, ActiveContest>> {
  const db = getDb();
  const rows = (await db`
    select id, name, resource_id, end_date::text as end_date
    from contests
    where is_active = true and resource_id is not null
  `) as unknown as {
    id: number;
    name: string;
    resource_id: number;
    end_date: string;
  }[];

  const map = new Map<number, ActiveContest>();
  for (const r of rows) {
    map.set(r.resource_id, {
      contestId: r.id,
      name: r.name,
      resourceId: r.resource_id,
      endDate: r.end_date,
    });
  }
  return map;
}

// ── ALERTY (fáze 4) ────────────────────────────────────────────

export type AlertRow = {
  id: string;
  item_id: number;
  quality: number;
  /** 'limit_sell' = hlídka limitního prodeje z portfolia (notifikace při dosažení). */
  kind: "price" | "score" | "limit_sell";
  /** 'cross' = aktivuje se při Crossoveru prahu (jen kind='price'). */
  direction: "above" | "below" | "cross";
  threshold: number;
  /** true = po první aktivaci se alert automaticky smaže. */
  one_shot: boolean;
  note: string | null;
  active: boolean;
  last_triggered_at: string | null;
  trigger_count: number;
  created_at: string;
  /** Kdy uživatel trigger označil za prohlédnutý (zvonek → seen). */
  seen_at: string | null;
};

export type AlertWithItem = AlertRow & {
  item_name: string;
  image_url: string | null;
  current_price: number | null;
};

type RawAlert = {
  id: string;
  item_id: number;
  quality: number;
  kind: AlertRow["kind"];
  direction: AlertRow["direction"];
  threshold: string;
  one_shot: boolean;
  note: string | null;
  active: boolean;
  last_triggered_at: Date | null;
  trigger_count: number;
  created_at: Date;
  seen_at: Date | null;
};

function mapAlert(r: RawAlert): AlertRow {
  return {
    id: r.id,
    item_id: r.item_id,
    quality: r.quality,
    kind: r.kind,
    direction: r.direction,
    threshold: Number(r.threshold),
    one_shot: r.one_shot,
    note: r.note,
    active: r.active,
    last_triggered_at: r.last_triggered_at === null ? null : iso(r.last_triggered_at),
    trigger_count: r.trigger_count,
    created_at: iso(r.created_at),
    seen_at: r.seen_at === null || r.seen_at === undefined ? null : iso(r.seen_at),
  };
}

/** Všechny alerty včetně názvu položky a aktuální ceny (pro /alerts). */
export async function getAlertsWithItems(): Promise<AlertWithItem[]> {
  const db = getDb();
  const rows = (await db`
    select a.*,
           i.name as item_name,
           i.image_url,
           latest.price as current_price
    from alerts a
    join items i on i.id = a.item_id
    left join lateral (
      select price
      from price_history ph
      where ph.item_id = a.item_id and ph.quality = a.quality
      order by ph.recorded_at desc
      limit 1
    ) latest on true
    order by a.created_at desc
    limit 200
  `) as unknown as (RawAlert & {
    item_name: string;
    image_url: string | null;
    current_price: string | null;
  })[];

  return rows.map((r) => ({
    ...mapAlert(r),
    item_name: r.item_name,
    image_url: r.image_url,
    current_price: r.current_price === null ? null : Number(r.current_price),
  }));
}

/** Alerty jedné komodity (tabulka pod grafem na market page). */
export async function getAlertsForItem(
  itemId: number,
  quality = 0
): Promise<AlertWithItem[]> {
  const db = getDb();
  const rows = (await db`
    select a.*,
           i.name as item_name,
           i.image_url,
           latest.price as current_price
    from alerts a
    join items i on i.id = a.item_id
    left join lateral (
      select price
      from price_history ph
      where ph.item_id = a.item_id and ph.quality = a.quality
      order by ph.recorded_at desc
      limit 1
    ) latest on true
    where a.item_id = ${itemId} and a.quality = ${quality}
    order by a.created_at desc
    limit 50
  `) as unknown as (RawAlert & {
    item_name: string;
    image_url: string | null;
    current_price: string | null;
  })[];

  return rows.map((r) => ({
    ...mapAlert(r),
    item_name: r.item_name,
    image_url: r.image_url,
    current_price: r.current_price === null ? null : Number(r.current_price),
  }));
}

/** Aktivní alerty pro evaluaci (jen aktivní, bez joinů – rychlé). */
export async function getActiveAlerts(): Promise<AlertRow[]> {
  const db = getDb();
  const rows = (await db`
    select * from alerts where active = true order by created_at asc
  `) as unknown as RawAlert[];
  return rows.map(mapAlert);
}

/**
 * Hlídka limitního prodeje – jeden alert kind='limit_sell' na položku
 * (quality 0, portfolio neeviduje kvality). Zadání nového limitu (nebo
 * změna) přepíše práh; po odklepnutí prodeje / smazání aktiva se hlídka
 * odstraní.
 */
export async function upsertLimitSellAlert(
  itemId: number,
  limitPrice: number
): Promise<void> {
  const db = getDb();
  await db`
    insert into alerts
      (item_id, quality, kind, direction, threshold, note)
    values
      (${itemId}, 0, 'limit_sell', 'above', ${limitPrice},
       'Limitní prodej z portfolia')
    on conflict (item_id, quality, kind) do update
      set threshold = ${limitPrice},
          direction = 'above',
          active = true,
          seen_at = null
  `;
}

/** Odstraní hlídku limitního prodeje aktiva (po odklepnutí/smazání). */
export async function deleteLimitSellAlert(itemId: number): Promise<void> {
  const db = getDb();
  await db`
    delete from alerts
    where item_id = ${itemId} and kind = 'limit_sell'
  `;
}

/** Smaže hlídky limitů pro všechna aktiva (helpers pro cron úklid). */
export async function getOpenLimitSellTargets(): Promise<
  { item_id: number; quality: number }[]
> {
  const db = getDb();
  const rows = (await db`
    select distinct item_id, quality
    from positions
    where closed_at is null
  `) as unknown as { item_id: number; quality: number }[];
  return rows;
}

/** Vytvoří alert. */
export async function createAlert(input: {
  item_id: number;
  quality: number;
  kind: "price" | "score";
  direction: "above" | "below" | "cross";
  threshold: number;
  oneShot?: boolean;
  note?: string | null;
}): Promise<void> {
  const db = getDb();
  await db`
    insert into alerts (item_id, quality, kind, direction, threshold, one_shot, note)
    values (${input.item_id}, ${input.quality}, ${input.kind},
            ${input.direction}, ${input.threshold}, ${input.oneShot ?? false}, ${input.note ?? null})
  `;
  // sledovaná položka má smysl jen s ticky – zapni sběr (jako watchlist)
  await db`update items set track_ticks = true where id = ${input.item_id}`;
}

/** Zapne/vypne alert, vrací nový stav. */
export async function toggleAlert(id: string): Promise<boolean> {
  const db = getDb();
  const rows = (await db`
    update alerts set active = not active where id = ${id}
    returning active
  `) as unknown as { active: boolean }[];
  return rows[0]?.active ?? false;
}

/** Smaže alert. */
export async function deleteAlert(id: string): Promise<void> {
  const db = getDb();
  await db`delete from alerts where id = ${id}`;
}

/** Změní práh existujícího alertu (přetažení linky v grafu). */
export async function updateAlertThreshold(
  id: string,
  threshold: number
): Promise<void> {
  const db = getDb();
  await db`
    update alerts set threshold = ${threshold}
    where id = ${id} and kind = 'price'
  `;
}

/**
 * Upraví cenový alert: práh, směr (nad/pod/cross) i one_shot. Jen pro
 * kind='price' – limitní prodeje se řídí z portfolia (setLimitSellAction),
 * skóre generuje Signal Engine. Vrací chybovou zprávu nebo null.
 */
export async function updateAlertRule(
  id: string,
  input: { threshold: number; direction: "above" | "below" | "cross"; oneShot?: boolean }
): Promise<string | null> {
  if (!Number.isFinite(input.threshold) || input.threshold <= 0)
    return "Práh musí být kladné číslo.";
  if (!"above below cross".split(" ").includes(input.direction))
    return "Neznámý směr alertu.";

  const db = getDb();
  const rows = (await db`
    update alerts
    set threshold = ${input.threshold},
        direction = ${input.direction},
        one_shot = ${input.oneShot ?? false}
    where id = ${id} and kind = 'price'
    returning id
  `) as unknown as { id: string }[];
  if (rows.length === 0) return "Alert nenalezen nebo se nedá upravit.";
  return null;
}

/**
 * Označí alert jako spuštěný (cooldown proti spamu).
 * Vrací true, pokud SMÍ notifikovat – tj. uplynul cooldown.
 */
export async function markAlertTriggered(
  id: string,
  cooldownMinutes = 60
): Promise<boolean> {
  const db = getDb();
  const rows = (await db`
    update alerts
    set last_triggered_at = now(),
        trigger_count = trigger_count + 1,
        seen_at = null
    where id = ${id}
      and (last_triggered_at is null
           or last_triggered_at < now() - ${cooldownMinutes} * interval '1 minute')
    returning id
  `) as unknown as { id: string }[];

  return rows.length > 0;
}

/**
 * Označí spuštěné alerty jako prohlédnuté (zvonek v hlavičce → seen).
 * Čistí seen_at jen u alertů s nastaveným last_triggered_at; badge pak
 * zmizí, dokud se alert znovu nespustí (trigger seen_at resetuje).
 */
export async function markAlertsSeen(): Promise<number> {
  const db = getDb();
  const rows = (await db`
    update alerts
    set seen_at = now()
    where last_triggered_at is not null
      and seen_at is null
    returning id
  `) as unknown as { id: string }[];
  return rows.length;
}

// ── KATALOG / POMOCNÉ DOTAZY ────────────────────────────────────────

/** Detail jedné položky z katalogu. */
export async function getItem(itemId: number): Promise<Item | null> {
  const db = getDb();
  const rows = (await db`
    select * from items where id = ${itemId} limit 1
  `) as unknown as (Omit<Item, "created_at"> & { created_at: Date })[];

  const row = rows[0];
  if (!row) return null;
  return { ...row, created_at: iso(row.created_at) };
}

/**
 * Cena ~24 hodin zpět pro sadu položek (pro výpočet 24h změny
 * na dashboardu). Bere nejnovější bod v okně 23–25 h zpět.
 */
export async function getPricesAround24hAgo(
  itemIds: number[],
  quality = 0
): Promise<Map<number, number>> {
  if (itemIds.length === 0) return new Map();

  const db = getDb();
  const from = new Date(Date.now() - 25 * 60 * 60 * 1000);
  const to = new Date(Date.now() - 23 * 60 * 60 * 1000);

  const rows = (await db`
    select item_id, price, recorded_at
    from price_history
    where quality = ${quality}
      and recorded_at >= ${from}
      and recorded_at <= ${to}
      and item_id in ${db(itemIds)}
    order by item_id, recorded_at desc
  `) as unknown as { item_id: number; price: string; recorded_at: Date }[];

  const map = new Map<number, number>();
  for (const row of rows) {
    if (!map.has(row.item_id)) map.set(row.item_id, Number(row.price));
  }
  return map;
}

/**
 * Sparkline body pro sadu položek (posledních `hours` hodin, jeden
 * batch query → downsample na ~`targetPoints` bodů na položku).
 * Klíč mapy = item_id, hodnota = pole cen v časovém pořadí.
 */
export async function getSparklines(
  itemIds: number[],
  quality = 0,
  hours = 24,
  targetPoints = 28
): Promise<Map<number, number[]>> {
  if (itemIds.length === 0) return new Map();

  const db = getDb();
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  const rows = (await db`
    select item_id, price
    from price_history
    where quality = ${quality}
      and recorded_at >= ${since}
      and item_id in ${db(itemIds)}
    order by item_id, recorded_at asc
  `) as unknown as { item_id: number; price: string }[];

  const byItem = new Map<number, number[]>();
  for (const row of rows) {
    let series = byItem.get(row.item_id);
    if (!series) {
      series = [];
      byItem.set(row.item_id, series);
    }
    series.push(Number(row.price));
  }

  // Downsample: rovnoměrný výběr včetně posledního bodu
  const result = new Map<number, number[]>();
  for (const [id, series] of byItem) {
    if (series.length <= targetPoints) {
      result.set(id, series);
      continue;
    }
    const step = (series.length - 1) / (targetPoints - 1);
    const picked: number[] = [];
    for (let i = 0; i < targetPoints; i++) {
      picked.push(series[Math.round(i * step)]);
    }
    result.set(id, picked);
  }
  return result;
}

// ── MARKET METRIKY (batch pro dashboard, vše Q0) ────────────────────

export type MarketMetricRow = {
  /** Annualizovaná volatilita v % (σ log-výnosů denních close), null když málo dat. */
  annualizedPct: number | null;
  /** Obchody za 24 h (distinct recorded_at z ticků), null bez ticků. */
  tradesPerDay: number | null;
  /** Průměrný denní obrat v $ (objem × close denních svíček), null bez objemů. */
  turnover: number | null;
};

/**
 * Volatilita pro celý trh v JEDNOM dotazu: σ log-výnosů close-to-close
 * denních svíček (Simco Tools backfill), annualizace √365 – stejná
 * matematika jako `computeVolatility` v lib/metrics.ts. LATERAL agreguje
 * výnosy per item, takže dashboard netahuje 151 svíčkových historií.
 */
export async function getMarketVolatility(): Promise<Map<number, number>> {
  const db = getDb();
  const rows = (await db`
    select c.resource_id as item_id,
           stddev_samp(ln(c.close / c.prev_close)) * sqrt(365) as ann
    from (
      select resource_id, close,
             lag(close) over (partition by resource_id order by day) as prev_close
      from market_candles_daily
      where quality = 0 and close > 0
    ) c
    where c.prev_close > 0
    group by c.resource_id
    having count(*) >= 3
  `) as unknown as { item_id: number; ann: string | null }[];

  const map = new Map<number, number>();
  for (const r of rows) {
    if (r.ann !== null) map.set(r.item_id, Number(r.ann) * 100);
  }
  return map;
}

/**
 * Likvidita pro celý trh v JEDNOM dotazu: distinct obchody za 24 h z
 * ticků (stejná definice jako tradeFrequencyPerDay) + průměrný denní
 * obrat (objem × close) z denních svíček – dva agregáty spojené full outer.
 */
export async function getMarketLiquidity(): Promise<
  Map<number, { tradesPerDay: number | null; turnover: number | null }>
> {
  const db = getDb();
  const rows = (await db`
    select
      coalesce(t.item_id, c.resource_id) as item_id,
      t.trades,
      c.turnover
    from (
      select item_id, count(distinct recorded_at) as trades
      from price_history
      where quality = 0 and recorded_at >= now() - interval '24 hours'
      group by item_id
    ) t
    full outer join (
      select resource_id,
             sum(volume * close) / nullif(count(*), 0) as turnover
      from market_candles_daily
      where quality = 0 and volume is not null and volume > 0
      group by resource_id
    ) c on c.resource_id = t.item_id
  `) as unknown as {
    item_id: number;
    trades: string | number | null;
    turnover: string | null;
  }[];

  const map = new Map<
    number,
    { tradesPerDay: number | null; turnover: number | null }
  >();
  for (const r of rows) {
    map.set(r.item_id, {
      tradesPerDay: r.trades === null ? null : Number(r.trades),
      turnover: r.turnover === null ? null : Number(r.turnover),
    });
  }
  return map;
}

// ── DENNÍ SVÍČKY (backfill ze Simco Tools) ──────────────────────────

export type DailyCandle = {
  day: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  vwap: number | null;
};

/** Denní svíčky z market_candles_daily (historie ~3 měsíce). */
export async function getDailyCandles(
  itemId: number,
  quality = 0
): Promise<DailyCandle[]> {
  const db = getDb();
  const rows = (await db`
    select day::text as day, open, high, low, close, volume, vwap
    from market_candles_daily
    where resource_id = ${itemId} and quality = ${quality}
    order by day asc
  `) as unknown as {
    day: string;
    open: string;
    high: string;
    low: string;
    close: string;
    volume: string | null;
    vwap: string | null;
  }[];

  return rows.map((r) => ({
    day: r.day,
    open: Number(r.open),
    high: Number(r.high),
    low: Number(r.low),
    close: Number(r.close),
    volume: r.volume === null ? null : Number(r.volume),
    vwap: r.vwap === null ? null : Number(r.vwap),
  }));
}

/** Sbírá poller pro tuto položku intraday ticky? */
export async function isTracked(itemId: number): Promise<boolean> {
  const db = getDb();
  const rows = await db`
    select track_ticks from items where id = ${itemId} limit 1
  ` as unknown as { track_ticks: boolean }[];
  return rows[0]?.track_ticks ?? false;
}

// ── WATCHLIST ───────────────────────────────────────────────────────

export type WatchlistRow = {
  item_id: number;
  name: string;
  image_url: string | null;
  category: string | null;
  price: number | null;
  recorded_at: string | null;
  change24h: number | null;
};

/** Položky ve watchlistu včetně aktuální ceny a 24h změny. */
export async function getWatchlistRows(): Promise<WatchlistRow[]> {
  const db = getDb();

  const rows = (await db`
    select i.id as item_id, i.name, i.image_url, i.category,
           latest.price, latest.recorded_at
    from watchlist w
    join items i on i.id = w.item_id
    join lateral (
      select price, recorded_at
      from price_history ph
      where ph.item_id = w.item_id and ph.quality = w.quality
      order by ph.recorded_at desc
      limit 1
    ) latest on true
    order by w.created_at desc
  `) as unknown as {
    item_id: number;
    name: string;
    image_url: string | null;
    category: string | null;
    price: string;
    recorded_at: Date;
  }[];

  const dayAgo = await getPricesAround24hAgo(rows.map((r) => r.item_id));

  return rows.map((r) => ({
    item_id: r.item_id,
    name: r.name,
    image_url: r.image_url,
    category: r.category,
    price: Number(r.price),
    recorded_at: iso(r.recorded_at),
    change24h: (() => {
      const base = dayAgo.get(r.item_id);
      return base && base > 0 ? (Number(r.price) - base) / base * 100 : null;
    })(),
  }));
}

/** ID položek ve watchlistu (pro hvězdičky). */
export async function getWatchedIds(): Promise<Set<number>> {
  const db = getDb();
  const rows = await db`select item_id from watchlist`;
  return new Set(rows.map((r) => r.item_id as number));
}

/** Přidá/odebere položku z watchlistu, vrací nový stav (true = sleduje). */
export async function toggleWatchlist(
  itemId: number,
  quality = 0
): Promise<boolean> {
  const db = getDb();

  const existing = await db`
    select id from watchlist where item_id = ${itemId} and quality = ${quality} limit 1
  `;

  if (existing.length > 0) {
    await db`delete from watchlist where item_id = ${itemId} and quality = ${quality}`;
    return false;
  }

  await db`
    insert into watchlist (item_id, quality) values (${itemId}, ${quality})
    on conflict (item_id, quality) do nothing
  `;
  // sledovaná položka má smysl jen s ticky – zapni sběr
  await db`update items set track_ticks = true where id = ${itemId}`;
  return true;
}

// ── GAME SYNC (import dat ze hry přes userscript) ───────────────────

export type GameSyncResult = {
  warehouse_rows: number;
  positions_created: number;
  positions_closed: number;
  positions_adjusted: number;
  /** Loty zmenšené spotřebou ve výrobě (bez prodeje, bez P/L). */
  lots_shrunk: number;
};

/** SQL klient v transakci i mimo ni (společná signatura helperů). */
type PostgresSql =
  | postgres.Sql<Record<string, unknown>>
  | postgres.TransactionSql<Record<string, unknown>>;

/**
 * Šarže skladu ze hry (formát z reálného dumpu, upgrade 009):
 * { kind = ID komodity, quality, amount, unit_cost = Σ cost.* / amount }.
 * unit_cost je SKUTEČNÁ pořizovací cena šarže (pracovní + materiál +
 * tržní nákup), ne odhad – díky ní má portfolio reálné buy_price.
 */
export type GameWarehouseEntry = {
  item_id: number;
  quality: number;
  quantity: number;
  unit_cost: number | null;
};

/** Uloží raw payload ze hry (audit / pozdější analýza cashflow). */
export async function recordGameImport(
  source: string,
  payload: unknown
): Promise<void> {
  const db = getDb();
  // sql.json() – postgres.js helper; ruční JSON.stringify() + ::jsonb
  // vytváří dvojitě zakódovaný string scalar (PgBouncer simple protokol)
  await db`
    insert into game_imports (source, payload)
    values (${source}, ${db.json(payload as JSONValue)})
  `;
}

/**
 * Reconcile skladu ze hry proti portfoliu.
 *
 * Model (fáze 2 – cashflow napojeno):
 * – SKLAD = pravda o MNOŽSTVÍ (rozdíl sklad vs. otevřené game pozice
 *   per (položka, kvalita) → nákup nebo FIFO prodej),
 * – CASHFLOW = zdroj REÁLNÝCH CEN (lazy aplikace při reconcile):
 *   prodej → FIFO přes pending retail_sale (vážený průměr details.price),
 *   fallback tržní tick; spotřebované ks se odečtou z units_unapplied
 *   → applied_at, když je vše pokryto. Nákup → unit_cost ze šarže,
 *   bez cost → FIFO přes pending market_buy, fallback tržní tick.
 * Úbytek skladu BEZ odpovídajících prodejů v cashflow = spotřeba ve
 * výrobě / přesun → pozice se jen ZMENŠÍ (žádný falešný prodej/P/L).
 * Manuální pozice (source='manual') se nesahají.
 * Vše v transakci; snapshot s unit_cost se ukládá do game_warehouse.
 */
export async function reconcileGameWarehouse(
  entries: GameWarehouseEntry[]
): Promise<GameSyncResult> {
  const db = getDb();

  const known = new Set(
    (await db`select id from items`).map((r) => r.id as number)
  );

  // 0) Agregace šarží na (položka, kvalita): suma ks + vážený průměr cost
  type Agg = { quantity: number; costSum: number; costQty: number };
  const agg = new Map<string, Agg>();
  for (const e of entries) {
    if (!known.has(e.item_id)) continue;
    if (!Number.isFinite(e.quantity) || e.quantity < 0) continue;
    const key = `${e.item_id}#${e.quality}`;
    const cur = agg.get(key) ?? { quantity: 0, costSum: 0, costQty: 0 };
    cur.quantity += e.quantity;
    if (e.unit_cost !== null && e.unit_cost > 0) {
      cur.costSum += e.unit_cost * e.quantity;
      cur.costQty += e.quantity;
    }
    agg.set(key, cur);
  }

  const valid: GameWarehouseEntry[] = [...agg.entries()].map(
    ([key, a]) => ({
      item_id: Number(key.split("#")[0]),
      quality: Number(key.split("#")[1]),
      quantity: a.quantity,
      unit_cost: a.costQty > 0 ? a.costSum / a.costQty : null,
    })
  );

  // 1) Kompletní prodej: co bylo ve skladu dřív a teď chybí = prodáno vše
  const previous = (await db`
    select item_id, quality from game_warehouse where quantity > 0
  `) as unknown as { item_id: number; quality: number }[];
  const presentKeys = new Set(
    valid.map((e) => `${e.item_id}#${e.quality}`)
  );
  for (const p of previous) {
    const key = `${p.item_id}#${p.quality}`;
    if (!presentKeys.has(key)) {
      valid.push({
        item_id: p.item_id,
        quality: p.quality,
        quantity: 0,
        unit_cost: null,
      });
    }
  }

  let created = 0;
  let closed = 0;
  let adjusted = 0;
  let lotsShrunk = 0; // loty zmenšené smazáním (spotřeba ve výrobě)

  await db.begin(async (sql) => {
    for (const entry of valid) {
      // 1) snapshot skladu (per položka + kvalita, včetně unit_cost)
      await sql`
        insert into game_warehouse (item_id, quality, quantity, unit_cost)
        values (${entry.item_id}, ${entry.quality}, ${Math.round(entry.quantity)},
                ${entry.unit_cost})
        on conflict (item_id, quality) do update
          set quantity = excluded.quantity,
              unit_cost = excluded.unit_cost,
              updated_at = now()
      `;

      // 2) stav otevřených game pozic dané položky A kvality
      const rows = (await sql`
        select coalesce(sum(quantity), 0)::int as qty
        from positions
        where item_id = ${entry.item_id}
          and quality = ${entry.quality}
          and closed_at is null
          and source = 'game'
      `) as unknown as { qty: number }[];
      const currentQty = Number(rows[0]?.qty ?? 0);
      const diff = Math.round(entry.quantity) - currentQty;

      if (diff === 0) continue;

      // poslední tržní cena (tick Q0) – fallback pro ceny
      const priceRows = (await sql`
        select price from price_history
        where item_id = ${entry.item_id} and quality = 0
        order by recorded_at desc limit 1
      `) as unknown as { price: string }[];
      const marketPrice =
        priceRows[0] && Number(priceRows[0].price) > 0
          ? Number(priceRows[0].price)
          : 0;

      if (diff > 0) {
        // ── PŘÍRŮSTEK: nákup detekovaný ze skladu ──────────────────
        // Cena: unit_cost ze šarže → pending market_buy z cashflow
        // (FIFO, reálná cena burzy) → tržní tick → 0,001
        let buyPrice: number | null =
          entry.unit_cost !== null && entry.unit_cost > 0
            ? entry.unit_cost
            : null;
        let priceSource =
          buyPrice !== null ? "unit_cost šarže" : null;

        if (buyPrice === null) {
          const buyMatch = await matchBuyPrice(
            sql,
            entry.item_id,
            entry.quality,
            diff
          );
          if (buyMatch.price !== null) {
            buyPrice = buyMatch.price;
            priceSource = "cashflow (nákup na burze)";
            const pendingNow = await getPendingCashflowFor(
              sql,
              entry.item_id,
              entry.quality
            );
            await applyCashflowUnits(
              sql,
              pendingNow.filter((p) => p.kind === "market_buy"),
              diff
            );
          }
        }
        if (buyPrice === null && marketPrice > 0) {
          buyPrice = marketPrice;
          priceSource = "tržní tick (odhad)";
        }
        if (buyPrice === null) {
          buyPrice = 0.001;
          priceSource = null;
        }

        await sql`
          insert into positions (item_id, quality, quantity, buy_price, source, note)
          values (${entry.item_id}, ${entry.quality}, ${diff}, ${buyPrice},
                  'game', ${
                    priceSource !== null
                      ? `Sync ze hry – cena: ${priceSource}`
                      : "Sync ze hry (sklad)"
                  })
        `;
        await sql`update items set track_ticks = true where id = ${entry.item_id}`;
        created++;
      } else {
        // ── ÚBYTEK: prodej (reálná cena z cashflow) vs. spotřeba ────
        const decrease = -diff;

        const pending = await getPendingCashflowFor(
          sql,
          entry.item_id,
          entry.quality
        );
        const sales = pending.filter((p) => p.kind === "retail_sale");
        const saleUnits = sales.reduce((s, p) => s + p.units_unapplied, 0);
        const coveredBySales = Math.min(decrease, saleUnits);

        const closeLotsFifo = async (
          units: number,
          sellPrice: number | null,
          logText: (take: number) => string
        ): Promise<void> => {
          const lots = (await sql`
            select id, quantity from positions
            where item_id = ${entry.item_id}
              and quality = ${entry.quality}
              and closed_at is null and source = 'game'
            order by opened_at asc
            for update
          `) as unknown as { id: string; quantity: number }[];

          let remaining = units;
          for (const lot of lots) {
            if (remaining <= 0) break;
            const take = Math.min(lot.quantity, remaining);

            if (take === lot.quantity) {
              await sql`
                update positions
                set sell_price = ${sellPrice}, closed_at = now()
                where id = ${lot.id}
              `;
              await sql`
                insert into condition_log
                  (position_id, event_type, market_price_at_log, condition_text)
                values
                  (${lot.id}, 'CLOSED', ${sellPrice}, ${logText(take)})
              `;
            } else {
              await sql`
                update positions set quantity = quantity - ${take} where id = ${lot.id}
              `;
              const [closedPart] = (await sql`
                insert into positions
                  (item_id, quality, quantity, buy_price, sell_price, opened_at,
                   closed_at, source, note)
                values
                  (${entry.item_id}, ${entry.quality}, ${take},
                   (select buy_price from positions where id = ${lot.id}),
                   ${sellPrice},
                   (select opened_at from positions where id = ${lot.id}),
                   now(), 'game', 'Sync ze hry (sklad)')
                returning id
              `) as unknown as { id: string }[];
              await sql`
                insert into condition_log
                  (position_id, event_type, market_price_at_log, condition_text)
                values
                  (${closedPart.id}, 'CLOSED', ${sellPrice}, ${logText(take)})
              `;
              adjusted++;
            }
            closed++;
            remaining -= take;
          }
        };

        if (coveredBySales > 0) {
          // reálná prodejní cena (vážený průměr FIFO retail prodejů),
          // fallback tržní tick, když retail řádky cenu nemají
          const matched = await matchSalePrice(
            sql,
            entry.item_id,
            entry.quality,
            coveredBySales
          );
          const sellPrice =
            matched.price !== null
              ? matched.price
              : marketPrice > 0
                ? marketPrice
                : null;

          await closeLotsFifo(
            coveredBySales,
            sellPrice,
            (take) =>
              `Prodej ze hry – ${take.toLocaleString("cs-CZ")} ks @ ${
                sellPrice !== null ? sellPrice.toFixed(3) : "?"
              } $ (cena z cashflow).`
          );
          await applyCashflowUnits(sql, sales, coveredBySales);
        }

        const leftover = decrease - coveredBySales;
        if (leftover > 0) {
          // spotřeba ve výrobě / přesun bez prodeje → loty jen zmenšíme
          // (bez sell_price = žádný falešný realized P/L)
          await closeLotsShrink(sql, entry.item_id, entry.quality, leftover);
          lotsShrunk++;
        }
      }
    }
  });

  return {
    warehouse_rows: valid.length,
    positions_created: created,
    positions_closed: closed,
    positions_adjusted: adjusted,
    lots_shrunk: lotsShrunk,
  };
}

/** Poslední snapshot skladu (pro UI /statistiky či /portfolio). */
export async function getGameWarehouse(): Promise<
  {
    item_id: number;
    quality: number;
    quantity: number;
    unit_cost: number | null;
    updated_at: string;
  }[]
> {
  const db = getDb();
  const rows = (await db`
    select item_id, quality, quantity, unit_cost, updated_at
    from game_warehouse
    where quantity > 0
    order by quantity desc
  `) as unknown as {
    item_id: number;
    quality: number;
    quantity: number;
    unit_cost: string | null;
    updated_at: Date;
  }[];
  return rows.map((r) => ({
    item_id: r.item_id,
    quality: r.quality,
    quantity: r.quantity,
    unit_cost: r.unit_cost === null ? null : Number(r.unit_cost),
    updated_at: iso(r.updated_at),
  }));
}

/** Kolik řádků raw importů máme (audit velikosti). */
export async function countGameImports(): Promise<number> {
  const db = getDb();
  const rows = (await db`select count(*)::int as c from game_imports`) as
    unknown as { c: number }[];
  return Number(rows[0]?.c ?? 0);
}

// ── GAME CASHFLOW (reálné ceny transakcí ze hry) ────────────────────

/**
 * Řádek cashflow ze hry (GET /api/v2/companies/me/cashflow/recent/).
 * Kategorii a descriptionKey parsuje route – sem přichází hotové
 * odvozené pole. Příklad reálných řádků:
 * – { category:'m', descriptionKey:'marketbuy-3', details:{amount:1000, price:2.298} }
 * – { category:'s', descriptionKey:'retail-3', details:{price:5.07, quality:0} }
 */
export type GameCashflowRow = {
  id: number; // ID transakce ze hry (dedupe klíč)
  datetime: string; // ISO
  category: string; // 'm' | 's' | 'p' | 'g' | …
  description: string | null;
  description_key: string | null;
  money: number; // + příjem / − výdaj
  details: Record<string, unknown>;
  kind:
    | "market_buy" // nákup na burze – details.amount × details.price (EXAKTNÍ)
    | "market_sale" // prodej na burze – details.amount × details.price
    | "retail_sale" // maloobchodní prodej – details.price za ks
    | "other"; // produkce, mimořádné… (bez napojení na pozice)
  item_id: number | null;
  quality: number;
  quantity: number | null; // ks (market_buy: details.amount; retail: money/price)
  unit_price: number | null; // $/ks
  /** Počáteční zásob neaplikovaných ks (jen market_buy/retail_sale). */
  units_unapplied: number | null;
};

/**
 * Uloží cashflow ze hry (dedupe dle ID transakce). Při konfliktu
 * aktualizuje jen obsah – units_unapplied/applied_at se NEDOTKÁ,
 * ať se neztratí stav aplikace do portfolia.
 */
export async function syncGameCashflow(rows: GameCashflowRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const db = getDb();
  const result = await db`
    insert into game_cashflow ${db(
      rows.map((r) => ({
        ...r,
        details: r.details as unknown as JSONValue,
      })),
      "id",
      "datetime",
      "category",
      "description",
      "description_key",
      "money",
      "details",
      "kind",
      "item_id",
      "quality",
      "quantity",
      "unit_price",
      "units_unapplied"
    )}
    on conflict (id) do update set
      datetime = excluded.datetime,
      money = excluded.money,
      details = excluded.details,
      description = excluded.description
  `;
  return result.count;
}

/**
 * Neaplikované transakce (pending) pro jednu položku a kvalitu,
 * chronologicky. Používá reconcile skladu k dobití reálných cen.
 */
type PendingCashflow = {
  id: number;
  kind: GameCashflowRow["kind"];
  quantity: number | null;
  unit_price: number | null;
  units_unapplied: number;
};

async function getPendingCashflowFor(
  sql: PostgresSql,
  itemId: number,
  quality: number
): Promise<PendingCashflow[]> {
  return (await sql`
    select id, kind, quantity, unit_price, units_unapplied
    from game_cashflow
    where item_id = ${itemId}
      and quality = ${quality}
      and applied_at is null
      and units_unapplied > 0
      and kind in ('market_buy', 'retail_sale', 'market_sale')
    order by datetime asc
    for update
  `) as unknown as PendingCashflow[];
}

/**
 * Zmenší otevřené game lots o `units` ks (FIFO) BEZ uzavření – spotřeba
 * ve výrobě / přesun. Celé loty se mažou, částečné se zmenší. Žádný
 * sell_price → žádný falešný realized P/L.
 */
async function closeLotsShrink(
  sql: PostgresSql,
  itemId: number,
  quality: number,
  units: number
): Promise<void> {
  const lots = (await sql`
    select id, quantity from positions
    where item_id = ${itemId}
      and quality = ${quality}
      and closed_at is null and source = 'game'
    order by opened_at asc
    for update
  `) as unknown as { id: string; quantity: number }[];

  let remaining = units;
  for (const lot of lots) {
    if (remaining <= 0) break;
    const take = Math.min(lot.quantity, remaining);
    if (take === lot.quantity) {
      await sql`delete from positions where id = ${lot.id}`;
    } else {
      await sql`update positions set quantity = quantity - ${take} where id = ${lot.id}`;
    }
    remaining -= take;
  }
}

/** Aplikuje x jednotek FIFO přes pending transakce (nejstarší nejdřív). */
async function applyCashflowUnits(
  sql: PostgresSql,
  pending: PendingCashflow[],
  units: number
): Promise<void> {
  let remaining = units;
  for (const cf of pending) {
    if (remaining <= 0) break;
    const avail = cf.units_unapplied;
    const take = Math.min(avail, remaining);
    if (take >= avail) {
      await sql`
        update game_cashflow
        set units_unapplied = 0, applied_at = now()
        where id = ${cf.id}
      `;
    } else {
      await sql`
        update game_cashflow
        set units_unapplied = units_unapplied - ${take}
        where id = ${cf.id}
      `;
    }
    remaining -= take;
  }
}

/**
 * Cena prodejů (FIFO přes pending retail_sale transakcí).
 * Vrací vážený průměr ceny pro uzavření `units` ks, NEBO null, když
 * pending prodeje nedostají (př. historie nedoručena) – volající
 * použije fallback (poslední tržní tick).
 */
async function matchSalePrice(
  sql: PostgresSql,
  itemId: number,
  quality: number,
  units: number
): Promise<{ price: null | number; matchedUnits: number }> {
  const pending = await getPendingCashflowFor(sql, itemId, quality);
  const sales = pending.filter(
    (p) => p.kind === "retail_sale" || p.kind === "market_sale"
  );
  const available = sales.reduce((s, p) => s + p.units_unapplied, 0);
  if (available < units || sales.length === 0) {
    return { price: null, matchedUnits: 0 };
  }

  // vážený průměr ceny přes dotčené FIFO prodeje
  let remaining = units;
  let costSum = 0;
  for (const s of sales) {
    if (remaining <= 0) break;
    const take = Math.min(s.units_unapplied, remaining);
    if (s.unit_price !== null && s.unit_price > 0) {
      costSum += s.unit_price * take;
    }
    remaining -= take;
  }
  const price = units > 0 && costSum > 0 ? costSum / units : null;
  return { price, matchedUnits: units };
}

/**
 * Cena nákupů (FIFO přes pending market_buy transakcí) – doplněk k
 * unit_cost ze skladu, když šarže nemá cost (např. jen tržní nákup).
 */
async function matchBuyPrice(
  sql: PostgresSql,
  itemId: number,
  quality: number,
  units: number
): Promise<{ price: null | number; matchedUnits: number }> {
  const pending = await getPendingCashflowFor(sql, itemId, quality);
  const buys = pending.filter((p) => p.kind === "market_buy");
  const available = buys.reduce((s, p) => s + p.units_unapplied, 0);
  if (available < units || buys.length === 0) {
    return { price: null, matchedUnits: 0 };
  }

  let remaining = units;
  let costSum = 0;
  for (const b of buys) {
    if (remaining <= 0) break;
    const take = Math.min(b.units_unapplied, remaining);
    if (b.unit_price !== null && b.unit_price > 0) {
      costSum += b.unit_price * take;
    }
    remaining -= take;
  }
  const price = units > 0 && costSum > 0 ? costSum / units : null;
  return { price, matchedUnits: units };
}
