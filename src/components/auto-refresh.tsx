"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Periodicky obnovuje server components (router.refresh()).
 * Položí se na dashboard, market i pozice, aby data „žila“ bez reloadu.
 *
 * Navíc: návrat na kartu (visibilitychange) spustí okamžitý refresh –
 * intervaly běží na pozadí throttlovaně, takže bez toho by po přepnutí
 * zpět do tabu zůstaly staré ceny, dokud uživatel nedá F5.
 */
export function AutoRefresh({ intervalMs = 20_000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router, intervalMs]);

  return null;
}
