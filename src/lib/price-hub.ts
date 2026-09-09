import { getDb } from "@/lib/db";
import { getFollowedSummaries, getMarketPrices } from "@/lib/simcotools";
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

const HUB_STEP_MS = 2_000; // střídavě A/B → každý endpoint dotazován 1× za 4 s
const PERSIST_INTERVAL_MS = 30_000;
const MAX_SUBS = 50; // pojistka: nic nejsou spam-boti

type Sub = (ev: {
  type: "tick" | "alert" | "stale";
  ticks?: HubTick[];
  alerts?: LiveTrigger[];
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
      // (B) market/followed – intra-bar patičky 5min svíček (rychlý tick)
      if (s.trackedIds && s.trackedIds.size > 0) {
        const pairs = [...s.trackedIds].map((id) => ({ resourceId: id, quality: 0 }));
        const summaries = await getFollowedSummaries(pairs);
        for (const sm of summaries) {
          if (sm.quality !== 0 || !(sm.price > 0)) continue;
          ticks.push({
            id: sm.resourceId,
            price: sm.price,
            // timestamp summary = čas poslední aktualizace 5m svíčky
            datetime: sm.timestamp,
          });
        }
      }
    }
    s.toggle = !s.toggle;
    s.stale = false;

    // ── Detekce změn + publish ──────────────────────────────────────
    const changed: HubTick[] = [];
    for (const t of ticks) {
      const key = `${t.price}|${t.datetime}`;
      if (s.seen.get(t.id) === key) continue;
      s.seen.set(t.id, key);
      s.latest.set(t.id, t);
      changed.push(t);
    }

    if (changed.length > 0) {
      publish({ type: "tick", ticks: changed });

      // Evaluace alertů – hned po publishi (latence alertu ≤ ~2 s)
      try {
        const priceMap = new Map(s.latest.size > 0 ? [...s.latest.entries()].map(([id, t]) => [id, t.price]) : []);
        const alerts = await evaluateLiveAlerts(priceMap);
        if (alerts.length > 0) publish({ type: "alert", alerts });
      } catch {
        // evaluace nesmí shodit smyčku
      }

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

async function loop(s: HubState) {
  // Eager: seznam sledovaných položek nahrajeme hned (používá i větev B)
  await loadTrackedIds(s);

  while (s.running) {
    if (s.subs.size > 0) {
      await hubStep(s);
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
