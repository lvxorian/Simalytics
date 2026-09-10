-- ═══════════════════════════════════════════════════════════════════
--  SIMALYTICS – upgrade 012: rozpad nákladů prodeje (realized P/L)
--
--  sell_price je netto (hrubá − poplatky − přeprava), ale rozpad se
--  dosud vedl jen jako text v condition_log. Pro UI (tabulka uzavřených
--  pozic) potřebujeme strukturovaná čísla.
--
--  cost_breakdown jsonb:
--  {
--    "gross": 490.0,            // hrubá tržba za uzavřené ks (kladné)
--    "fees": -14.0,             // burzovní poplatky (exact z cashflow)
--    "transport": -9.70,        // náklad přepravy (signed)
--    "transport_units": 110,    // spotřebované jednotky přepravy
--    "transport_unit_cost": 0.0882,
--    "transport_exact": true,   // false = % odhad (GAME_TRANSPORT_PCT)
--    "net": 466.30              // netto tržba = gross + fees + transport
--  }
--  Hodnoty jsou per uzavřenou pozici (u částečného lotu škálováno
--  na take). Čistý zisk = net + buy_price × quantity (buy je záporná
--  položka, zde neukládáme – buy_price už na řádku je).
--
--  Idempotentní; NULL = pozice bez herního prodeje (manuální uzavření,
--  spotřeba) → UI zobrazí „–“.
-- ═══════════════════════════════════════════════════════════════════

alter table public.positions
  add column if not exists cost_breakdown jsonb;
