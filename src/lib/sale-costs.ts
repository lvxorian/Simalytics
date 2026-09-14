/**
 * Náklady prodeje na burze ve SimCompanies – sdílené konstanty.
 *
 * Burzovní poplatek: fixní 4 % z hrubé tržby (platí při odklepnutí
 * nabídky). Hra hlásí u vlastních noticek přesnou částku – tam ji bereme
 * z herních dat, jinak se odhaduje touto sazbou.
 *
 * Přeprava: každá položka má jiný `transportation` poměr (kolik ks
 * Přepravy spotřebuje 1 ks prodeje, ze Simco Tools /resources). Exaktní
 * cena = poměr × prodané ks × cena Přepravy (item 13) ze skladu.
 * Když poměr ani skladová cena nejsou k dispozici, fallback = % z tržby
 * (historicky změřeno ~3 % z tržby).
 */

/** Burzovní poplatek z hrubé tržby (FAQ hry; kalibrováno z herních fees). */
export const MARKET_FEE_PCT = 0.04;

/** Fallback nákladu přepravy jako % z hrubé tržby (přesné z GAME_TRANSPORT_PCT). */
export const TRANSPORT_PCT_FALLBACK = 0.0306;

/** % poplatku pro tooltipy/UI („odhad 4 % z tržby“). */
export function marketFeePctLabel(): string {
  return `${(MARKET_FEE_PCT * 100).toFixed(0)} %`;
}

/**
 * Odhad burzovního poplatku (záporná částka) z hrubé tržby.
 * `gameFees` = přesná částka hlášená hrou ( záporná nebo 0), jinak null.
 */
export function estimateMarketFee(
  gross: number,
  gameFees?: number | null
): { fee: number; fromGame: boolean } {
  if (gameFees !== null && gameFees !== undefined && gameFees !== 0) {
    return { fee: -Math.abs(gameFees), fromGame: true };
  }
  return { fee: -MARKET_FEE_PCT * gross, fromGame: false };
}

/**
 * Odhad nákladu přepravy (záporná částka) pro prodej `quantity` ks.
 * `ratio` = transportation poměr položky (Simco Tools), `unitCost` =
 * cena 1 ks Přepravy na skladu. Bez nich fallback % z tržby.
 */
export function estimateTransport(
  gross: number,
  quantity: number,
  ratio: number | null,
  unitCost: number | null
): { transport: number; exact: boolean } {
  if (ratio !== null && unitCost !== null && ratio > 0 && unitCost > 0) {
    return { transport: -ratio * quantity * unitCost, exact: true };
  }
  return { transport: -gross * TRANSPORT_PCT_FALLBACK, exact: false };
}
