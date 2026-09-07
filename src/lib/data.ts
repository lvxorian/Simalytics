import { getDb } from "@/lib/db";
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

/** Historie cen jedné položky (pro graf). */
export async function getPriceHistory(
  itemId: number,
  quality = 0,
  sinceDays = 30
): Promise<{ recorded_at: string; price: number }[]> {
  const db = getDb();
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);

  const rows = (await db`
    select recorded_at, price
    from price_history
    where item_id = ${itemId} and quality = ${quality}
      and recorded_at >= ${since}
    order by recorded_at asc
    limit 20000
  `) as unknown as RawTick[];

  return rows.map((r) => ({
    recorded_at: iso(r.recorded_at),
    price: Number(r.price),
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
