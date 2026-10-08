/**
 * Profit kalkulačka – čistá herní matematika (server i client).
 *
 * Režimy prodeje dle mechaniky hry:
 *  - MALOOBCHOD (retail): cena podle tvé značky, ŽÁDNÝ poplatek,
 *    přeprava PLNÁ (exaktní: ks × ratio × cena Přepravy ze skladu).
 *  - KONTRAKT: bez poplatku, přeprava POLOVINNÁ (hra účtuje ½ poměru –
 *    potvrzeno herní cashflow kategorií 't' i Cooper's Tools).
 *  - BURZA (exchange): poplatek 4 % z hrubé tržby + přeprava PLNÁ.
 *
 * Kvalita je vlastnost šarže – překlopit Q2 zboží na Q4 nejde (výzkum
 * zvyšuje jen budoucí výrobu; Q výrobku ≤ min(Q inputů) + 1).
 * Všechny funkce jsou čisté (bez Reactu i DB), zaokrouhluje jen UI.
 */

import {
  MARKET_FEE_PCT,
  TRANSPORT_PCT_FALLBACK,
  estimateMarketFee,
  estimateTransport,
} from "@/lib/sale-costs";

/** Kanály prodeje – řazení = pořadí v UI. */
export type SaleChannel = "retail" | "contract" | "exchange";

export const SALE_CHANNELS: {
  value: SaleChannel;
  label: string;
  /** Krátký popis mechaniky pro tooltip/vysvětlivku. */
  hint: string;
}[] = [
  {
    value: "retail",
    label: "Maloobchod",
    hint: "Prodej koncovému zákazníkovi z prodejní budovy. Bez poplatku, přeprava plná.",
  },
  {
    value: "contract",
    label: "Kontrakt",
    hint: "Prodej přímo jiné firmě. Bez poplatku, přeprava půlka (hra účtuje ½ poměru).",
  },
  {
    value: "exchange",
    label: "Burza",
    hint: "Odklepnutí nabídky na burze. Poplatek 4 % z tržby, přeprava plná.",
  },
];

/** Vstupy nákladů (pořizovací + přeprava) sdílené všemi výpočty. */
export type ProfitInputs = {
  /** Pořizovací cena / ks (vlastní výroba = unit cost ze skladu). */
  buyPrice: number;
  /** Počet kusů. */
  quantity: number;
  /** Prodejní cena / ks (zákazník, kontrakt či odklepnutá nabídka). */
  sellPrice: number;
  /** Transportation poměr položky (null = neznámý → fallback % z tržby). */
  transportRatio: number | null;
  /** Cena 1 ks Přepravy na skladu (null = neznámá → fallback). */
  transportUnitCost: number | null;
};

/** Rozpad ekonomiky jednoho prodeje (vše za VŠECHNY ks, poplatky záporně). */
export type ProfitBreakdown = {
  channel: SaleChannel;
  /** Hrubá tržba = sellPrice × quantity. */
  gross: number;
  /** Poplatek (jen burza), záporný. */
  fee: number;
  /** Přeprava, záporná (0 = exaktní nula dle poměru). */
  transport: number;
  /** Čistý zisk celkem = gross + fee + transport − náklad ks. */
  net: number;
  /** Zisk na kus. */
  netPerUnit: number;
  /** Marže = net / gross v PROCENTECH (25 = 25 %) – smysl jen při gross > 0. */
  marginPct: number | null;
  /** Návratnost = net / náklad nákupu v PROCENTECH – při nákladu > 0. */
  roiPct: number | null;
  /** Přeprava exaktní (poměr × skladová cena) vs. fallback % z tržby. */
  transportExact: boolean;
};

/**
 * Úplný rozpad pro jeden kanál.
 */
export function computeBreakdown(
  inputs: ProfitInputs,
  channel: SaleChannel
): ProfitBreakdown {
  const gross = inputs.sellPrice * inputs.quantity;
  const cost = inputs.buyPrice * inputs.quantity;

  // Poplatek: jen burza. estimateMarketFee s gameFees = null dá −4 % × gross.
  const fee = channel === "exchange" ? estimateMarketFee(gross, null).fee : 0;

  // Přeprava: kontrakt spotřebuje POLOVINU poměru (viz lib/sale-costs
  // + herní cashflow 't'), retail i burza plnou. Fallback (% z tržby)
  // se u kontraktu taky půlí – konzistentní s exaktní větví.
  const ratio =
    inputs.transportRatio === null
      ? null
      : channel === "contract"
        ? inputs.transportRatio / 2
        : inputs.transportRatio;
  const { transport, exact } = estimateTransport(
    gross,
    inputs.quantity,
    ratio,
    inputs.transportUnitCost
  );

  const net = gross + fee + transport - cost;

  return {
    channel,
    gross,
    fee,
    transport,
    net,
    netPerUnit: inputs.quantity > 0 ? net / inputs.quantity : 0,
    // ×100 – pole *Pct nesou PROCENTA (konvence pl_pct / change24h);
    // UI formátuje formatPercent(), který čeká procenta, ne zlomek.
    marginPct: gross > 0 ? (net / gross) * 100 : null,
    roiPct: cost > 0 ? (net / cost) * 100 : null,
    transportExact: exact,
  };
}

/** Rozpad všech tří kanálů stejnými vstupy (pro srovnávací tabulku). */
export function computeAllChannels(
  inputs: ProfitInputs
): Record<SaleChannel, ProfitBreakdown> {
  return {
    retail: computeBreakdown(inputs, "retail"),
    contract: computeBreakdown(inputs, "contract"),
    exchange: computeBreakdown(inputs, "exchange"),
  };
}

/**
 * Break-even prodejní cena/ks: nejnižší cena, při které je netto ≥ 0
 * v daném kanálu.
 *
 * Exaktní přeprava: transport celkem je konstanta (nezávislá na ceně).
 *   net = p·q·(1 − fee) − |transport| − cost ≥ 0
 *   ⇔   p = (cost + |transport|) / (q·(1 − fee))
 *
 * Fallback přepravy (% z tržby) + fee (burza) jsou proporcionální tržbě:
 *   net = p·q·(1 − k) − cost ≥ 0  ⇔  p = buyPrice / (1 − k),
 *   k = fee% + transport% (transport u kontraktu půlí stejně).
 */
export function breakEvenSellPrice(
  inputs: Omit<ProfitInputs, "sellPrice">,
  channel: SaleChannel
): { price: number | null; exact: boolean } {
  const q = inputs.quantity;
  if (q <= 0) return { price: null, exact: true };
  const ratio =
    inputs.transportRatio === null
      ? null
      : channel === "contract"
        ? inputs.transportRatio / 2
        : inputs.transportRatio;
  const feePct = channel === "exchange" ? MARKET_FEE_PCT : 0;
  const cost = inputs.buyPrice * q;

  // Exaktní přeprava (známý poměr + skladová cena Přepravy).
  if (ratio !== null && inputs.transportUnitCost !== null) {
    const transportAbs =
      ratio > 0 ? ratio * q * inputs.transportUnitCost : 0;
    const price =
      (cost + transportAbs) / (q * (1 - feePct));
    return { price, exact: true };
  }

  // Fallback: přeprava jako % z tržby (poměr 0 = známá nula → k = fee).
  const transportPct =
    ratio !== null && ratio === 0 ? 0 : TRANSPORT_PCT_FALLBACK;
  const k = feePct + transportPct;
  if (k >= 1) return { price: null, exact: false };
  return { price: inputs.buyPrice / (1 - k), exact: false };
}

/**
 * % MP pro zadanou cenu (kontrola „kolik je to z trhu“), nebo null.
 */
export function pctFromMarket(
  sellPrice: number,
  marketPrice: number
): number | null {
  if (marketPrice <= 0) return null;
  return (sellPrice / marketPrice - 1) * 100;
}

// ── Fáze 2: Research ROI (kvalita jako investice do budoucí výroby) ──

/**
 * Kumulativní patenty potřebné na dosažení kvality (wiki SimCompanies):
 * Q1 = 12, na Q2 dalších 50, na Q3 dalších 500, na Q4 dalších 2000,
 * na Q5 dalších 5000, Q6–Q10 po 10 000. Index pole = kvalita.
 */
const PATENTS_CUMULATIVE: number[] = [0, 12, 62, 562, 2562, 7562];
for (let q = 6; q <= 13; q++) {
  PATENTS_CUMULATIVE[q] = PATENTS_CUMULATIVE[5] + (q - 5) * 10_000;
}

/** Patenty POTŘEBNÉ pro upgrade z `fromQ` na `toQ` (kumulativní diff). */
export function patentsForUpgrade(fromQ: number, toQ: number): number {
  const last = PATENTS_CUMULATIVE.length - 1;
  const a = PATENTS_CUMULATIVE[Math.min(fromQ, last)] ?? 0;
  const b = PATENTS_CUMULATIVE[Math.min(toQ, last)] ?? 0;
  return Math.max(0, b - a);
}

/** Průměrný počet research unitů na 1 patent (wiki: ≈ 8, „kostka“). */
export const RESEARCH_UNITS_PER_PATENT = 8;

/**
 * Náklad výzkumu Q fromQ→toQ: patenty × ≈8 unitů × cena 1 research unitu.
 * `researchUnitPrice` = poslední obchod research položky (naše ticky).
 */
export function researchCost(
  fromQ: number,
  toQ: number,
  researchUnitPrice: number | null
): number | null {
  if (researchUnitPrice === null || researchUnitPrice <= 0) return null;
  return patentsForUpgrade(fromQ, toQ) * RESEARCH_UNITS_PER_PATENT * researchUnitPrice;
}

/**
 * Zjednodušený ROI výzkumu: prodané ks/den × prémie/ks (QN trh − Q0 trh
 * − extra náklad výroby/ks). Vrací $/den a buyback dny.
 *
 * MECHANICKÁ POZNÁMKA: vyšší Q v retailu primarily ZRYCHLUJE prodej
 * (za stejný throughput si účtuješ víc); prémie při stejném počtu ks je
 * proto CONSERVATIVNÍ spodní hranice výnosu výzkumu.
 */
export type ResearchRoi = {
  patents: number;
  /** Náklad výzkumu (patenty × 8 × cena unitu), null bez ceny unitu. */
  cost: number | null;
  /** Prémie $/ks (QN trh vs. Q0 trh − extra náklad). */
  premiumPerUnit: number | null;
  /** Navíc $/den při stejném throughputu. */
  extraPerDay: number | null;
  /** Buyback ve dnech (cost / extraPerDay). */
  paybackDays: number | null;
};

export function computeResearchRoi(args: {
  fromQ: number;
  toQ: number;
  /** Cena research unitu (null = bez ceny → jen patenty). */
  researchUnitPrice: number | null;
  /** Tržní cena Q0 a cílové kvality (naše ticky, null = bez dat). */
  priceQ0: number | null;
  priceQTarget: number | null;
  /** Prodáno ks/den (z herního cashflow, null = neuvedeno). */
  unitsPerDay: number | null;
  /** Extra náklad výroby Q oproti Q0 ($/ks, volitelné – mzdy atp.). */
  extraCostPerUnit?: number | null;
}): ResearchRoi {
  const patents = patentsForUpgrade(args.fromQ, args.toQ);
  const cost = researchCost(args.fromQ, args.toQ, args.researchUnitPrice);
  const premiumPerUnit =
    args.priceQ0 !== null &&
    args.priceQTarget !== null &&
    args.priceQ0 > 0
      ? args.priceQTarget - args.priceQ0 - (args.extraCostPerUnit ?? 0)
      : null;
  const extraPerDay =
    premiumPerUnit !== null && args.unitsPerDay !== null
      ? premiumPerUnit * args.unitsPerDay
      : null;
  const paybackDays =
    cost !== null && extraPerDay !== null && extraPerDay > 0
      ? cost / extraPerDay
      : null;
  return { patents, cost, premiumPerUnit, extraPerDay, paybackDays };
}
