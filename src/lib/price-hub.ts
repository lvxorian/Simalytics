import { getDb } from "@/lib/db";
import { getFollowedSummaries, getMarketPrices } from "@/lib/simcotools";
import { getLowestAsk, getOrderbookAsks } from "@/lib/simco-official";
import {
  evaluateLiveAlerts,
  persistTicks,
  type LiveTrigger,
} from "@/lib/live-eval";

/**
 * PRICE HUB (Fáze 3A) – perzistentní zdroj živých cen na serveru.
 *
 * JEDNA smyčka per serverless instance (Fluid Compute drží funkci živou,
 * dokud je aspoň jedno SSE spojení), která každých HUB_STEP_MS střídavě:
 *   1. getFollowedSummaries() – intra-bar tick z patiček 5min svíček
 *      (aktualizace ceny se objeví okamžitě po obchodě, bez čekání na
 *      sken posledních obchodů),
 *   2. getMarketPrices() – poslední obchody (upstream fetch cache 5 s),
 *
 * Detekce nového obchodu = změna ceny NEBO datetime. Nový tick publikuje
 * do odběratelů (SSE), spustí evaluaci alertů (latence ≤ ~2 s) a throttle
 * 30 s ukládá ticky do price_history (idempotentně, source 'live').
 *
 * Upstream limit 2 req/s: náš režim 1 request / ~2 s je hluboko pod ním
 * a je SDÍLENÝ pro všechny diváky (clienti netahají upstream vůbec).
 */

export type HubTick = {
  id: number;
  price: number;
  /** ISO čas posledního obchodu (od upstreamu). */
  datetime: string;
};

/** Jedna nabídka v orderbooku (ask strana, seřazené vzestupně). */
export type HubAsk = {
  price: number;
  quantity: number;
  npc: boolean;
};

const HUB_STEP_MS = 2_000; // střídavě A/B → každý endpoint dotazován 1× za 4 s
const PERSIST_INTERVAL_MS = 30_000;
const EVAL_INTERVAL_MS = 10_000; // evaluace alertů i bez ticků (mrtvý trh)
const MAX_SUBS = 50; // pojistka: nic nejsou spam-boti
/**
 * Orderbook hlídka (Fáze 3): položky s aktivními BUY alerty se pollují
 * round-robin – 1 request / cyklus (2 s), limit ofiko API 1 req/s drží
 * simco-official throttle. Při N položkách je ask čerstvý max ~2·N s.
 */
const ORDERBOOK_STEP_MS = 2_000;

type Sub = (ev: {
  type: "tick" | "alert" | "stale" | "orderbook";
  ticks?: HubTick[];
  alerts?: LiveTrigger[];
  /** Položky, jejichž orderbook se změnil (event 'orderbook'). */
  orderbookIds?: number[];
  /** Položky, jejichž DATA ztratila autoritu (event 'stale', per-item). */
  staleIds?: number[];
}) => void;

type HubState = {
  running: boolean;
  subs: Set<Sub>;
  /** Poslední známé Q0 ceny per položka (id → tick). */
  latest: Map<number, HubTick>;
  /** Referenční snapshot pro detekci změn (key = id|price|datetime). */
  seen: Map<number, string>;
  /** Sledované položky (track_ticks) – null = ještě nenahráno. */
  trackedIds: Set<number> | null;
  lastPersistMs: number;
  /** Poslední evaluace alertů (i bez ticků běží podle EVAL_INTERVAL_MS). */
  lastEvalMs: number;
  /** Nejnižší asky hlídaných položek (buy alert watch). */
  askWatch: Map<number, number>;
  /** Full orderbook top-5 asků pro položky otevřené diváky (SSE push). */
  orderbook: Map<number, HubAsk[]>;
  /** Položky, které si klienti výslovně vyžádali (?items= v SSE). */
  requestedOrderbookIds: Set<number>;
  /**
   * Položky, jejichž FOLLOWED patička ukázala cenu, kterou prices NEPOTVRDIL
   * (mezisoučet/agregát – viz Zlatá ruda 30,00 vs. obchod 31,50). Ceny z
   * FOLLOWED kroku pro tyto položky se ignorují, dokud prices cenu znovu
   * nepotvrdí. Nastavuje se v kroku (B), maže v kroku (A).
   */
  nonAuthoritative: Set<number>;
  /** Patičky z posledního kroku (B) – pro reconciliaci v kroku (A). */
  pendingFootprint: Map<number, number> | null;
  /** Kolo prioritních orderbook pollů. */
  orderbookCursor: number;
  /** Čas poslední změny orderbooku (pro hubOrderbookChangedSince). */
  lastOrderbookChangeMs: number;
  askWatchIds: number[];
  askWatchCursor: number;
  lastOrderbookMs: number;
  askWatchLoaded: boolean;
  lastOrderbookStepMs: number;
  toggle: boolean;
  stale: boolean;
};

// Perzistence napříč invokacemi (stejný vzor jako db.ts)
const g = globalThis as unknown as {
  __simalyticsHub?: HubState;
};

function state(): HubState {
  if (!g.__simalyticsHub) {
    g.__simalyticsHub = {
      running: false,
      subs: new Set(),
      latest: new Map(),
      seen: new Map(),
      trackedIds: null,
      lastPersistMs: 0,
      lastEvalMs: 0,
      askWatch: new Map(),
      orderbook: new Map(),
      requestedOrderbookIds: new Set(),
      nonAuthoritative: new Set(),
      pendingFootprint: null,
      orderbookCursor: 0,
      lastOrderbookChangeMs: 0,
      askWatchIds: [],
      askWatchCursor: 0,
      lastOrderbookMs: 0,
      askWatchLoaded: false,
      lastOrderbookStepMs: 0,
      toggle: false,
      stale: false,
    };
  }
  return g.__simalyticsHub;
}

function snapshotTicks(): HubTick[] {
  return [...state().latest.values()];
}

async function loadTrackedIds(s: HubState): Promise<Set<number>> {
  if (s.trackedIds) return s.trackedIds;
  try {
    const db = getDb();
    const rows = (await db`select id from items where track_ticks = true`) as unknown as {
      id: number;
    }[];
    s.trackedIds = new Set(rows.map((r) => r.id));
    return s.trackedIds;
  } catch {
    return new Set(); // DB nedostupná – jen nepersistujeme
  }
}

function publish(ev: Parameters<Sub>[0]) {
  for (const sub of state().subs) {
    try {
      sub(ev);
    } catch {
      // mrtvý odběratel nesmí shodit smyčku
    }
  }
}

async function hubStep(s: HubState) {
  try {
    let ticks: HubTick[] = [];

    if (s.toggle) {
      // (A) market/prices – poslední obchody, autorita pro datetime
      const prices = await getMarketPrices();
      for (const t of prices) {
        if (t.quality !== 0 || !(t.price > 0)) continue;
        ticks.push({ id: t.resourceId, price: t.price, datetime: t.datetime });
      }
    } else {
      // (B) market/followed – intra-bar patičky 5min svíček (rychlý tick).
      // POZOR: patička někdy ukazuje cenu, kterou market/prices NEZNÁ
      // (mezisoučet/agregát v rámci 5m svíčky – pozorováno na Zlaté rudě:
      // patička 30,00 vs. poslední obchod 31,50). Taková cena NENÍ skutečný
      // obchod → heroto černá/živá grafu by se zbláznila (cena „přeskakuje“).
      // FIX: položky v `nonAuthoritative` (patička „zaskočila“ a prices to
      // nepotvrdil) se z FOLLOWED kroku nepublishují, dokud prices cenu
      // znovu nepotvrdí.
      if (s.trackedIds && s.trackedIds.size > 0) {
        const pairs = [...s.trackedIds].map((id) => ({ resourceId: id, quality: 0 }));
        const summaries = await getFollowedSummaries(pairs);
        const footprint = new Map<number, number>();
        // Podezřelé patičky (cena ≠ poslední známá) – publikují se AŽ po
        // verifikaci proti prices (pod vteřinu navíc, ale žádný falešný tick
        // se nikdy nedostane do dávky).
        const suspects: { id: number; price: number; datetime: string }[] = [];
        for (const sm of summaries) {
          if (sm.quality !== 0 || !(sm.price > 0)) continue;
          footprint.set(sm.resourceId, sm.price);
          // Položka bez autority: cenu z patičky NEBEREME (viz komentář výše)
          if (s.nonAuthoritative.has(sm.resourceId)) continue;
          const known = s.latest.get(sm.resourceId);
          if (known && known.price !== sm.price) {
            suspects.push({
              id: sm.resourceId,
              price: sm.price,
              datetime: sm.timestamp,
            });
          } else {
            // Stejná cena jako známá (jen datetime update) nebo první tick
            ticks.push({
              id: sm.resourceId,
              price: sm.price,
              datetime: sm.timestamp,
            });
          }
        }
        if (suspects.length > 0) {
          try {
            const prices = await getMarketPrices();
            const priceMap = new Map(
              prices
                .filter((t) => t.quality === 0 && t.price > 0)
                .map((t) => [t.resourceId, t.price])
            );
            for (const sp of suspects) {
              const authoritativePrice = priceMap.get(sp.id);
              if (authoritativePrice === sp.price) {
                // Prices patičku POTVRDIL = skutečný nový obchod → publish
                // (rychlá cesta preserved: patička nás nepozdrží)
                ticks.push(sp);
              } else {
                // Patička ukazuje cenu, kterou prices nezná → mezisoučet/
                // agregát. Blokuj FOLLOWED cenu do dalšího prices kroku.
                s.nonAuthoritative.add(sp.id);
                // Prices zná JINOU (novější) cenu než naše latest? → publish
                // autoritu (např. obchod proběhl, prices ho vidí, patička ne)
                const known = s.latest.get(sp.id);
                if (
                  known &&
                  authoritativePrice !== undefined &&
                  authoritativePrice !== known.price
                ) {
                  ticks.push({
                    id: sp.id,
                    price: authoritativePrice,
                    datetime: known.datetime,
                  });
                }
              }
            }
          } catch {
            // prices nedostupné – podezřelé patičky ZAHAZUJEME (bezpečnější
            // než je publikovat: žádný falešný obchod se neobjeví)
          }
        }
        s.pendingFootprint = footprint;
      }
    }
    s.toggle = !s.toggle;
    s.stale = false;

    // ── Detekce změn + publish ──────────────────────────────────────
    const changed: HubTick[] = [];
    if (s.toggle === false) {
      // Krok (A) = prices (autorita). Položky v nonAuthoritative jsou zpět
      // ve hře, jakmile prices ukáže cenu (jakoukoliv – prices je zdroj pravdy;
      // nonAuthoritative jen blokovalo FOLLOWED cenu do té doby).
      for (const t of ticks) {
        s.nonAuthoritative.delete(t.id);
      }
    }
    for (const t of ticks) {
      const key = `${t.price}|${t.datetime}`;
      if (s.seen.get(t.id) === key) continue;
      s.seen.set(t.id, key);
      s.latest.set(t.id, t);
      changed.push(t);
    }

    if (changed.length > 0) {
      publish({ type: "tick", ticks: changed });
      s.lastEvalMs = 0; // tick = vynucená evaluace hned
    }

    // ── Evaluace alertů ─────────────────────────────────────────────
    // Po ticku hned (latence ≤ ~2 s); i bez ticků pravidelně každých
    // EVAL_INTERVAL_MS – nově vložený alert se spustí i na mrtvém trhu
    // (žádné obchody → žádné ticky → jinak by čekal až do dalšího).
    const nowMs = Date.now();
    if (changed.length > 0 || nowMs - s.lastEvalMs >= EVAL_INTERVAL_MS) {
      s.lastEvalMs = nowMs;
      try {
        const priceMap = new Map(
          [...s.latest.entries()].map(([id, t]) => [id, t.price])
        );
        const alerts = await evaluateLiveAlerts(priceMap, s.askWatch);
        if (alerts.length > 0) publish({ type: "alert", alerts });
      } catch {
        // evaluace nesmí shodit smyčku
      }
    }

    if (changed.length > 0) {
      // Persist – throttle 30 s, idempotentní
      const now = Date.now();
      if (now - s.lastPersistMs >= PERSIST_INTERVAL_MS) {
        s.lastPersistMs = now;
        const tracked = await loadTrackedIds(s);
        void persistTicks(
          changed.map((t) => ({
            resourceId: t.id,
            quality: 0,
            datetime: t.datetime,
            price: t.price,
          })),
          tracked
        ).catch(() => {});
      }
    }
  } catch {
    // upstream chyba → označ stale, alerty/ticky nejsou aktuální
    if (!s.stale) {
      s.stale = true;
      publish({ type: "stale" });
    }
  }
}

/**
 * Orderbook hlídka (Fáze 3): načte seznam položek s aktivními BUY alerty
 * ('price' + 'below') a round-robin polluje jejich nejnižší asky (1 request
 * / cyklus). Výsledek jde do evaluace alertů (ask ≤ práh = nákupní
 * příležitost i bez obchodu). Refresh seznamu max 1× / 60 s.
 *
 * Navíc (SSE push): položky, které si klienti vyžádali (?items=), polluje
 * s PŘEDNOSTÍ a s CELÝM top-5 orderbookem – publish 'orderbook' event při
 * změně (mini orderbook na market page tak žije bez vlastního pollingu).
 */
async function orderbookStep(s: HubState) {
  const now = Date.now();
  if (s.askWatchIds.length === 0 || now - s.lastOrderbookMs >= 60_000) {
    if (now - s.lastOrderbookMs >= 60_000 || !s.askWatchLoaded) {
      try {
        const db = getDb();
        const rows = (await db`
          select distinct item_id from alerts
          where active = true and kind = 'price' and direction = 'below'
        `) as unknown as { item_id: number }[];
        s.askWatchIds = rows.map((r) => r.item_id);
        s.askWatchCursor = 0;
        s.askWatchLoaded = true;
      } catch {
        // DB nedostupná – zkusíme příště
      }
      s.lastOrderbookMs = now;
    }
  }

  // Priorita 1: položky požadované klienty (otevřená market page)
  // – full top-5, publish při změně. Kolo se otáčí nezávisle na alert watch.
  if (s.requestedOrderbookIds.size > 0) {
    const ids = [...s.requestedOrderbookIds];
    const id = ids[s.orderbookCursor % ids.length];
    s.orderbookCursor = (s.orderbookCursor + 1) % ids.length;
    try {
      const asks = await getOrderbookAsks(id, 0, 5);
      const prev = s.orderbook.get(id);
      const next = asks.length > 0 ? asks : null;
      if (next === null) {
        s.orderbook.delete(id);
      } else {
        s.orderbook.set(id, next);
      }
      // Publish jen při skutečné změně (JSON srovnání – 5 položek, levné)
      const changed =
        JSON.stringify(prev ?? null) !== JSON.stringify(next ?? null);
      if (changed) {
        s.lastOrderbookChangeMs = Date.now();
        publish({ type: "orderbook", orderbookIds: [id] });
      }
      return; // tento krok šel na prioritní položku
    } catch {
      // orderbook selhání – spadni na alert watch kolo
    }
  }

  // Priorita 2: alert watch (nejnižší ask pro evaluaci buy alertů)
  if (s.askWatchIds.length === 0) return;
  const id = s.askWatchIds[s.askWatchCursor % s.askWatchIds.length];
  s.askWatchCursor = (s.askWatchCursor + 1) % Math.max(1, s.askWatchIds.length);

  try {
    const ask = await getLowestAsk(id, 0);
    if (ask && ask.price > 0) {
      s.askWatch.set(id, ask.price);
    } else {
      s.askWatch.delete(id);
    }
  } catch {
    // orderbook selhání – neblokuje smyčku
  }
}

async function loop(s: HubState) {
  // Eager: seznam sledovaných položek nahrajeme hned (používá i větev B)
  await loadTrackedIds(s);

  while (s.running) {
    if (s.subs.size > 0) {
      await hubStep(s);
      // Orderbook hlídka – nezávislý krok (round-robin, 1 req)
      if (Date.now() - s.lastOrderbookStepMs >= ORDERBOOK_STEP_MS) {
        s.lastOrderbookStepMs = Date.now();
        await orderbookStep(s);
      }
      await new Promise((r) => setTimeout(r, HUB_STEP_MS));
    } else {
      // Žádní odběratelé – smyčka se vypne; první subscribe ji restartuje.
      // (Fluid compute tak může funkci uvolnit, když appku nikdo nemá
      // otevřenou; data pro první render dodává SSR z DB.)
      s.running = false;
    }
  }
}

/** Přidá odběratele a startuje smyčku, pokud neběží. Vrací unsubscribe. */
export function subscribeHub(sub: Sub): () => void {
  const s = state();
  if (s.subs.size >= MAX_SUBS && !s.subs.has(sub)) {
    // místo házení chyby vrátíme no-op – klient spadne do REST fallbacku
    return () => {};
  }
  s.subs.add(sub);
  if (!s.running) {
    s.running = true;
    void loop(s);
  }
  return () => {
    s.subs.delete(sub);
  };
}

/** Poslední známé ceny (pro okamžitý první event po připojení SSE). */
export function hubSnapshot(): HubTick[] {
  return snapshotTicks();
}

export function hubIsStale(): boolean {
  return state().stale;
}

/**
 * Registrace zájmu klienta o orderbook položek (market page otevře SSE
 * s ?items=id). Hub tuto položku polluje S PŘEDNOSTÍ (full top-5) a při
 * změně publikuje 'orderbook' event. Vrací aktuální snapshot k okamžitému
 * odeslání + unregister funkci.
 */
export function registerOrderbookInterest(
  itemId: number
): { asks: HubAsk[] | null; unregister: () => void } {
  const s = state();
  s.requestedOrderbookIds.add(itemId);
  return {
    asks: s.orderbook.get(itemId) ?? null,
    unregister: () => {
      s.requestedOrderbookIds.delete(itemId);
      // Cache necháme (další divák téže položky dostane hned data);
      // GC: smažeme jen položky bez zájmu a bez alert watch při příštím
      // cyklu – jednoduchost předána na malou velikost mapy (max pár IDS).
      if (s.requestedOrderbookIds.size === 0) {
        s.orderbook.clear();
      }
    },
  };
}

/** Orderbook snapshot pro položku (SSE 'hello' event). */
export function hubOrderbook(itemId: number): HubAsk[] | null {
  return state().orderbook.get(itemId) ?? null;
}

/** Změnil se orderbook od času ms? (pro rozhodnutí o refetch fallbacku) */
export function hubOrderbookChangedSince(ms: number): boolean {
  return state().lastOrderbookChangeMs > ms;
}
