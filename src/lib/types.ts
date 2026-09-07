// ─────────────────────────────────────────────────────────────────
// Typy odpovídající schématu v db/schema.sql
// ─────────────────────────────────────────────────────────────────

export type Item = {
  id: number;
  name: string;
  db_letter: string | null;
  category: string | null;
  image_url: string | null;
  created_at: string;
};

export type PricePoint = {
  id: number;
  item_id: number;
  quality: number;
  price: number;
  quantity: number | null;
  recorded_at: string;
};

/** Řádek market dashboardu (výstup RPC get_latest_prices). */
export type LatestPriceRow = {
  item_id: number;
  name: string;
  db_letter: string | null;
  category: string | null;
  image_url: string | null;
  price: number;
  quantity: number | null;
  recorded_at: string;
};

export type Position = {
  id: string;
  item_id: number;
  quality: number;
  quantity: number;
  buy_price: number;
  sell_price: number | null;
  opened_at: string;
  closed_at: string | null;
  note: string | null;
  created_at: string;
};

export type ConditionLogEntry = {
  id: string;
  position_id: string;
  event_type: "OPENED" | "ADDED" | "CLOSED" | "NOTE";
  market_price_at_log: number | null;
  condition_text: string;
  trigger_reason: string | null;
  created_at: string;
};

/** Pozice obohacená o aktuální cenu a P/L – používá UI trackeru. */
export type PositionWithPnl = Position & {
  item_name: string;
  image_url: string | null;
  current_price: number | null;
  unrealized_pl: number | null; // absolutní $ (pozice otevřená)
  unrealized_pl_pct: number | null; // procenta
  realized_pl: number | null; // pro uzavřené pozice
};

export type Quality = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
