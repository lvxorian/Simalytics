"use client";

/**
 * Live cenová data (Fáze 3) – sdílený client-side store.
 *
 * JEDNO SSE spojení na celou aplikaci (/api/live/stream, refcount přes
 * subscribe): serverový price hub PUSHE jen ZMĚNĚné ticky (latence ~1–2 s
 * od obchodu), alerty evaluuje uvnitř hubu (event 'alert').
 *
 * Fallback: když SSE nejde (proxy, starší prohlížeč), store spadne na
 * REST polling /api/live každých 10 s (původní Fáze 2 chování).
 *
 * Snapshot je immutable; entry per položka má STABILNÍ referenci, dokud
 * se cena/čas nezmění → re-render jen u komponent, jejichž položka změna
 * skutečně patří.
 */

import { useEffect, useState, useSyncExternalStore } from "react";

export type LiveItem = {
  id: number;
  price: number;
  datetime: string; // ISO – čas posledního obchodu
};

export type LiveAlertEvent = {
  alertId: string;
  /** Unikátní klíč pro "už zobrazeno" v toastech. */
  key: string;
  item_id: number;
  item_name: string;
  kind: "price" | "limit_sell";
  direction: "above" | "below";
  threshold: number;
  price: number;
  image_url: string | null;
  /** Client čas přijetí (pro potlačení dvojitých zvuků ze zvonku). */
  atMs: number;
};

export type LiveStatus = "connecting" | "live" | "offline";

export type LiveSnapshot = {
  status: LiveStatus;
  items: ReadonlyMap<number, LiveItem>;
  /** serverTime − clientTime při poslední odpovědi (korekce driftu). */
  serverOffsetMs: number;
  lastUpdatedMs: number | null;
  events: readonly LiveAlertEvent[];
};

const SERVER_SNAPSHOT: LiveSnapshot = {
  status: "connecting",
  items: new Map(),
  serverOffsetMs: 0,
  lastUpdatedMs: null,
  events: [],
};

const REST_FALLBACK_MS = 10_000;
const REST_FALLBACK_MAX_MS = 60_000;

type ApiAlert = {
  id: string;
  item_id: number;
  item_name: string;
  kind: "price" | "limit_sell";
  direction: "above" | "below";
  threshold: number;
  price: number;
  image_url: string | null;
};

class LiveStore {
  private snap: LiveSnapshot = SERVER_SNAPSHOT;
  private listeners = new Set<() => void>();
  private es: EventSource | null = null;
  private restTimer: ReturnType<typeof setTimeout> | null = null;
  private restDelay = REST_FALLBACK_MS;
  private mode: "idle" | "sse" | "rest" = "idle";
  private sseHelloTimer: ReturnType<typeof setTimeout> | null = null;
  private sseGotData = false;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    if (this.mode === "idle") this.startSse();
    return () => {
      this.listeners.delete(fn);
      if (this.listeners.size === 0) this.stopAll();
    };
  };

  getSnapshot = (): LiveSnapshot => this.snap;

  getServerSnapshot = (): LiveSnapshot => SERVER_SNAPSHOT;

  private emit() {
    for (const l of this.listeners) l();
  }

  private set(partial: Partial<LiveSnapshot>) {
    this.snap = { ...this.snap, ...partial };
    this.emit();
  }

  // ── SSE (primární cesta) ─────────────────────────────────────────
  private startSse() {
    if (typeof EventSource === "undefined") {
      this.startRest();
      return;
    }
    this.mode = "sse";
    this.sseGotData = false;
    const es = new EventSource("/api/live/stream");
    this.es = es;

    // Pojistka: když do 8 s nedorazí žádná data (blokované SSE za proxy,
    // věčný reconnect), přepneme na REST fallback.
    this.sseHelloTimer = setTimeout(() => {
      if (!this.sseGotData && this.mode === "sse") {
        this.stopSse();
        this.startRest();
      }
    }, 8_000);

    const onHello = (e: MessageEvent) => {
      this.sseGotData = true;
      if (this.sseHelloTimer) {
        clearTimeout(this.sseHelloTimer);
        this.sseHelloTimer = null;
      }
      try {
        const data = JSON.parse(e.data) as {
          items: LiveItem[];
          stale?: boolean;
          serverTime: string;
        };
        this.applyItems(data.items, data.serverTime);
        this.set({
          status: data.stale ? "offline" : "live",
          lastUpdatedMs: Date.now(),
        });
      } catch {
        // malformed event – čekej na další
      }
    };

    const onTick = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as {
          items: LiveItem[];
          serverTime: string;
        };
        this.applyItems(data.items, data.serverTime);
        this.set({ status: "live", lastUpdatedMs: Date.now() });
      } catch {
        // ignore
      }
    };

    const onAlert = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as { alerts: ApiAlert[] };
        this.pushAlerts(data.alerts ?? []);
      } catch {
        // ignore
      }
    };

    const onStale = () => {
      this.set({ status: "offline" });
    };

    es.addEventListener("hello", onHello as EventListener);
    es.addEventListener("tick", onTick as EventListener);
    es.addEventListener("alert", onAlert as EventListener);
    es.addEventListener("stale", onStale as EventListener);
    es.onopen = () => this.set({ status: "live" });

    es.onerror = () => {
      // EventSource se sám reconnectuje; pokud selže natvrdo, spadneme
      // na REST fallback. Rozlišíme: readyState CONNECTING = zkusí to
      // znovu sám, CLOSED = musíme přepnout.
      if (es.readyState === EventSource.CLOSED) {
        this.stopSse();
        this.startRest();
      } else {
        this.set({ status: "connecting" });
      }
    };
  }

  private stopSse() {
    if (this.es) {
      this.es.close();
      this.es = null;
    }
  }

  // ── REST fallback (Fáze 2 polling) ───────────────────────────────
  private startRest() {
    this.mode = "rest";
    this.restDelay = REST_FALLBACK_MS;
    document.addEventListener("visibilitychange", this.onVisibility);
    this.scheduleRest(0);
  }

  private onVisibility = () => {
    if (
      this.mode === "rest" &&
      document.visibilityState === "visible" &&
      !this.restTimer
    ) {
      this.scheduleRest(0);
    }
  };

  private scheduleRest(ms: number) {
    if (this.restTimer) clearTimeout(this.restTimer);
    this.restTimer = setTimeout(() => void this.fetchRest(), ms);
  }

  private async fetchRest() {
    if (document.visibilityState === "hidden") {
      this.restTimer = null;
      return; // onVisibility restartuje
    }
    try {
      const res = await fetch("/api/live", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        serverTime: string;
        items: LiveItem[];
        alerts: ApiAlert[];
      };
      this.applyItems(data.items, data.serverTime);
      this.pushAlerts(data.alerts ?? []);
      this.restDelay = REST_FALLBACK_MS;
      this.set({ status: "live", lastUpdatedMs: Date.now() });
    } catch {
      this.restDelay = Math.min(this.restDelay * 2, REST_FALLBACK_MAX_MS);
      this.set({ status: "offline" });
    }
    this.scheduleRest(this.restDelay);
  }

  // ── Sdílená logika ───────────────────────────────────────────────
  private applyItems(items: LiveItem[], serverTime: string) {
    if (!items?.length) return;
    const prev = this.snap.items;
    let mutated = false;
    const next = new Map<number, LiveItem>(prev);
    for (const it of items) {
      if (!(it.price > 0) || !it.datetime) continue;
      const old = prev.get(it.id);
      // Stabilní reference beze změny – klíčové pro useLiveTick
      if (old && old.price === it.price && old.datetime === it.datetime) continue;
      next.set(it.id, { id: it.id, price: it.price, datetime: it.datetime });
      mutated = true;
    }
    if (!mutated) return;
    const offset = Date.parse(serverTime) - Date.now();
    this.set({
      items: next,
      serverOffsetMs: offset,
    });
  }

  private pushAlerts(alerts: ApiAlert[]) {
    if (!alerts?.length) return;
    const atMs = Date.now();
    const fresh: LiveAlertEvent[] = alerts.map((a) => ({
      alertId: a.id,
      key: `${a.id}:${a.price}:${atMs}`,
      item_id: a.item_id,
      item_name: a.item_name,
      kind: a.kind,
      direction: a.direction,
      threshold: a.threshold,
      price: a.price,
      image_url: a.image_url,
      atMs,
    }));
    this.set({
      events: [...fresh, ...this.snap.events].slice(0, 30),
    });
  }

  private stopAll() {
    this.stopSse();
    if (this.sseHelloTimer) {
      clearTimeout(this.sseHelloTimer);
      this.sseHelloTimer = null;
    }
    document.removeEventListener("visibilitychange", this.onVisibility);
    if (this.restTimer) {
      clearTimeout(this.restTimer);
      this.restTimer = null;
    }
    this.mode = "idle";
  }
}

export const livePrices = new LiveStore();

/**
 * Base cena odvozená ze SSR hodnot (initialPrice + change24h %) –
 * pro přepočet 24h změny, když dorazí živý tick (base zůstává,
 * mění se jen čitatel).
 */
export function impliedBase24h(
  price: number,
  change24hPct: number
): number | null {
  if (price <= 0) return null;
  const base = price / (1 + change24hPct / 100);
  return base > 0 ? base : null;
}

/** Celý snapshot – re-render při každém ticku (toasty, status). */
export function useLiveSnapshot(): LiveSnapshot {
  return useSyncExternalStore(
    livePrices.subscribe,
    livePrices.getSnapshot,
    livePrices.getServerSnapshot
  );
}

/**
 * Tick jedné položky – re-render POUZE když tato položka dostala
 * nový obchod (stabilní reference entry, viz store).
 */
export function useLiveTick(
  itemId: number | undefined | null
): LiveItem | null {
  const [tick, setTick] = useState<LiveItem | null>(null);

  useEffect(() => {
    if (itemId == null) {
      setTick(null);
      return;
    }
    let last: LiveItem | null =
      livePrices.getSnapshot().items.get(itemId) ?? null;
    setTick(last);
    const check = () => {
      const next = livePrices.getSnapshot().items.get(itemId) ?? null;
      if (next !== last) {
        last = next;
        setTick(next);
      }
    };
    const unsub = livePrices.subscribe(check);
    return unsub;
  }, [itemId]);

  return tick;
}

/**
 * Živá cena jedné položky s SSR fallbackem (Fáze 3C pro tabulky/karty):
 * dokud nedorazí živý tick, vrací SSR hodnotu (initialPrice + change24h),
 * po ticku přepočítá 24h změnu proti base odvozené ze SSR. Re-render jen
 * u položek, které skutečně dostaly nový obchod.
 */
export function useLivePriceOverride(
  itemId: number,
  initialPrice: number | null,
  initialChange24h: number | null
): { price: number | null; change24h: number | null } {
  const tick = useLiveTick(itemId);

  if (!tick) return { price: initialPrice, change24h: initialChange24h };

  const base24h =
    initialPrice !== null && initialChange24h !== null
      ? impliedBase24h(initialPrice, initialChange24h)
      : null;
  const change24h =
    base24h !== null && base24h > 0
      ? ((tick.price - base24h) / base24h) * 100
      : initialChange24h;

  return { price: tick.price, change24h };
}
