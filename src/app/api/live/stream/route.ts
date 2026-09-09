import {
  subscribeHub,
  hubSnapshot,
  hubIsStale,
  hubOrderbook,
  registerOrderbookInterest,
  type HubAsk,
} from "@/lib/price-hub";

export const dynamic = "force-dynamic";
// Fluid Compute: funkce může žít, dokud je otevřené SSE spojení
export const maxDuration = 300;

/**
 * SSE stream živých cen (Fáze 3B/3C) – náhrada 10 s REST pollingu.
 *
 * Eventy:
 *   tick      – data: { items: [{id, price, datetime}] }  (jen ZMĚNĚné položky)
 *   alert     – data: LiveTrigger[] (evaluované v hubu, latence ≤ ~2 s)
 *   stale     – upstream nedostupný (klient zobrazí stav, data drží poslední)
 *   orderbook – data: { item, asks: [{price, quantity, npc}] } – změna
 *               orderbooku položky z ?items= (mini orderbook na market page)
 *   hello     – hned po připojení: snapshot + počáteční orderbook
 *
 * `?items=1` – klient si vyžádá orderbook položky (market page). Hub tuto
 * položku polluje s předností a při změně pošle 'orderbook' event.
 *
 * Klient se reconnectuje sám (EventSource), REST /api/live zůstává
 * jako fallback pro prostředí, kde SSE nejde (proxy apod.).
 */
export async function GET(req: Request) {
  const encoder = new TextEncoder();

  // ?items=1,2,3 – zájem o orderbook těchto položek (max 3, prakticky 1)
  const url = new URL(req.url);
  const itemsParam = url.searchParams.get("items");
  const requestedIds = (itemsParam ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, 3);

  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  const unregisterOrderbook: (() => void)[] = [];

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        } catch {
          closed = true;
        }
      };

      // Okamžitý „hello" – snapshot (i prázdný) + stav + orderbooky
      const orderbooks: { item: number; asks: HubAsk[] | null }[] = [];
      for (const id of requestedIds) {
        const interest = registerOrderbookInterest(id);
        unregisterOrderbook.push(interest.unregister);
        orderbooks.push({ item: id, asks: interest.asks });
      }
      send("hello", {
        items: hubSnapshot(),
        stale: hubIsStale(),
        orderbooks,
        serverTime: new Date().toISOString(),
      });

      unsubscribe = subscribeHub((ev) => {
        if (ev.type === "tick") {
          send("tick", { items: ev.ticks ?? [], serverTime: new Date().toISOString() });
        } else if (ev.type === "alert") {
          send("alert", { alerts: ev.alerts ?? [] });
        } else if (ev.type === "orderbook") {
          for (const id of ev.orderbookIds ?? []) {
            if (!requestedIds.includes(id)) continue;
            const asks = hubOrderbook(id);
            send("orderbook", { item: id, asks: asks ?? [] });
          }
        } else {
          send("stale", { stale: true });
        }
      });

      // Heartbeat – drží spojení a proxy otevřené
      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          closed = true;
        }
      }, 15_000);

      // Uklidění po zavření klienta
      req.signal.addEventListener("abort", () => {
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        unsubscribe?.();
        for (const u of unregisterOrderbook) u();
        try {
          controller.close();
        } catch {
          // už zavřeno
        }
      });
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe?.();
      for (const u of unregisterOrderbook) u();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Sedný za proxy: žádná bufferování
      "X-Accel-Buffering": "no",
    },
  });
}
