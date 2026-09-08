/**
 * Fixed Range Volume Profile – výpočet ze svíček v daném rozsahu.
 *
 * Rozdělí cenový rozsah na N horizontálních "binů" (cenových úrovní),
 * do každého přiřadí objem: u denních svíček reálný objem (Simco Tools),
 * u intraday ticků počet ticků v bině (proxy objem).
 *
 * TradingView konvence:
 * - POC (Point of Control) = bin s největším objemem
 * - Value Area (70 %) = souvislý blok binů kolem POC s ~70 % objemu
 * - barvení: bin nad POC = "sell" barva, pod POC = "buy" barva
 *   (kde se prodávalo/kupovalo – klasika z TV)
 */

export type VPCandle = {
  high: number;
  low: number;
  /** Reálný objem (denní svíčky) nebo 1 = proxy tick (intraday). */
  volume?: number;
};

export type VolumeProfile = {
  /** Počet binů (výška profilu). */
  binCount: number;
  /** Dolní/horní hranice cenového rozsahu profilu. */
  minPrice: number;
  maxPrice: number;
  /** Velikost jednoho binu v cenových jednotkách. */
  binSize: number;
  /** Objem per bin, index 0 = nejnižší cena. */
  bins: number[];
  /** Index binu s max. objemem (POC). */
  pocIndex: number;
  /** Cena POC (střed binu). */
  pocPrice: number;
  /** Indexová hranice Value Area (70 % objemu), včetně POC. */
  vaLowIndex: number;
  vaHighIndex: number;
  /** Celkový objem v profilu (pro normalizaci). */
  totalVolume: number;
};

/**
 * Rozdělí cenový rozsah na biny a distribuuje objem svíčky mezi biny,
 * které svíčka pokrývá (high–low), proporcionalně k překryvu. Tak se i
 * dlouhé wicky správně podílí na profilu (jako v TV "Distribuovaný").
 */
function distributeCandle(
  low: number,
  high: number,
  volume: number,
  minPrice: number,
  binSize: number,
  bins: number[]
): void {
  const lo = Math.max(
    minPrice,
    low
  );
  const hi = Math.min(minPrice + binSize * bins.length, high);
  if (hi <= lo) return;

  const firstBin = Math.min(
    bins.length - 1,
    Math.max(0, Math.floor((lo - minPrice) / binSize))
  );
  const lastBin = Math.min(
    bins.length - 1,
    Math.max(0, Math.floor((hi - minPrice) / binSize))
  );

  if (firstBin === lastBin) {
    bins[firstBin] += volume;
    return;
  }

  // Lineární distribuce dle překryvu binů s rozsahem high–low
  for (let i = firstBin; i <= lastBin; i++) {
    const binLow = minPrice + i * binSize;
    const binHigh = binLow + binSize;
    const overlap =
      Math.min(hi, binHigh) - Math.max(lo, binLow);
    if (overlap > 0) {
      bins[i] += (overlap / (hi - lo)) * volume;
    }
  }
}

/**
 * Spočítá Fixed Range Volume Profile.
 * @param candles svíčky v daném rozsahu (už odfiltrované uživatelem)
 * @param binCount počet cenových úrovní (default 48, TV má 24–100)
 */
export function computeVolumeProfile(
  candles: VPCandle[],
  binCount = 48
): VolumeProfile | null {
  if (candles.length === 0) return null;

  let minPrice = Infinity;
  let maxPrice = -Infinity;
  let totalVolume = 0;

  for (const c of candles) {
    minPrice = Math.min(minPrice, c.low);
    maxPrice = Math.max(maxPrice, c.high);
    totalVolume += c.volume ?? 1;
  }
  if (!Number.isFinite(minPrice) || maxPrice <= minPrice) return null;

  // Odstup od krajů – extrémní wicky by jinak roztáhly profil
  const range = maxPrice - minPrice;
  const pad = range * 0.02;
  minPrice -= pad;
  maxPrice += pad;

  const binSize = (maxPrice - minPrice) / binCount;
  const bins = new Array<number>(binCount).fill(0);

  for (const c of candles) {
    distributeCandle(
      c.low,
      c.high,
      c.volume ?? 1,
      minPrice,
      binSize,
      bins
    );
  }

  // POC = bin s největším objemem
  let pocIndex = 0;
  for (let i = 1; i < binCount; i++) {
    if (bins[i] > bins[pocIndex]) pocIndex = i;
  }

  // Value Area 70 % – expandující okolo POC (TradingView algoritmus:
  // přidávat bin s větším sousedem, dokud není 70 % objemu)
  let acc = bins[pocIndex];
  let lo = pocIndex;
  let hi = pocIndex;
  const target = totalVolume * 0.7;
  while (acc < target && (lo > 0 || hi < binCount - 1)) {
    const below = lo > 0 ? bins[lo - 1] : -1;
    const above = hi < binCount - 1 ? bins[hi + 1] : -1;
    if (above >= below) {
      hi += 1;
      acc += bins[hi];
    } else {
      lo -= 1;
      acc += bins[lo];
  }
  }

  return {
    binCount,
    minPrice,
    maxPrice,
    binSize,
    bins,
    pocIndex,
    pocPrice: minPrice + (pocIndex + 0.5) * binSize,
    vaLowIndex: lo,
    vaHighIndex: hi,
    totalVolume,
  };
}

/** % objemu uvnitř Value Area (kontrola / UI). */
export function valueAreaPercent(vp: VolumeProfile): number {
  let va = 0;
  for (let i = vp.vaLowIndex; i <= vp.vaHighIndex; i++) va += vp.bins[i];
  return vp.totalVolume > 0 ? (va / vp.totalVolume) * 100 : 0;
}
