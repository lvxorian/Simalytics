"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Periodicky obnovuje server components (router.refresh()).
 * Položí se na dashboard i pozice, aby data „žila“ bez reloadu.
 */
export function AutoRefresh({ intervalMs = 60_000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);

  return null;
}
