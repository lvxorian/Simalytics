import { subscribeHub, hubSnapshot, hubIsStale } from "@/lib/price-hub";

export const dynamic = "force-dynamic";
// Fluid Compute: funkce může žít, dokud je otevřené SSE spojení
export const maxDuration = 300;

/**
 * SSE stream živých cen (Fáze 3B) – náhrada 10 s REST pollingu.
 *
 * Eventy:
 *   tick  – data: { items: [{id, price, datetime}] }  (jen ZMĚNĚné položky)
 *   alert – data: LiveTrigger[] (evaluované v hubu, latence ≤ ~2 s)
 *   stale – upstream nedostupný (klient zobrazí stav, data drží poslední)
 *   hello – hned po připojení: poslední známý snapshot (může být prázdný)
 *
 * Klient se reconnectuje sám (EventSource), REST /api/live zůstává
 * jako fallback pro prostředí, kde SSE nejde (proxy apod.).
 */
export async function GET(req: Request) {
  const encoder = new TextEncoder();

  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

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

      // Okamžitý „hello" – snapshot (i prázdný) + stav
      send("hello", {
        items: hubSnapshot(),
        stale: hubIsStale(),
        serverTime: new Date().toISOString(),
      });

      unsubscribe = subscribeHub((ev) => {
        if (ev.type === "tick") {
          send("tick", { items: ev.ticks ?? [], serverTime: new Date().toISOString() });
        } else if (ev.type === "alert") {
          send("alert", { alerts: ev.alerts ?? [] });
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
