"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Pencil } from "lucide-react";

import {
  PortfolioSellDialog,
} from "@/components/portfolio-sell-dialog";
import {
  PortfolioEditLotsDialog,
  type EditableLot,
} from "@/components/portfolio-edit-lots-dialog";
import {
  PortfolioIgnoreDialog,
  PortfolioIgnoreTrigger,
} from "@/components/portfolio-ignore-dialog";
import { ItemIcon } from "@/components/item-icon";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatPrice, formatSigned, plColorClass } from "@/lib/format";
import type { PortfolioHolding } from "@/lib/data";
import { MARKET_FEE_PCT } from "@/lib/sale-costs";

/** Řádek tabulky aktiv – držba jedné (položka, kvalita). */
export type AssetRow = PortfolioHolding & { lots: EditableLot[] };

/** Skupina aktiv jedné položky (může mít více kvalit). */
type AssetGroup = { rows: RefinedRow[] };

/** Klíč per (položka, kvalita) pro mapy asků. */
const hKey = (h: { item_id: number; quality: number }) =>
  `${h.item_id}:${h.quality}`;

/** Řádek po přepočtu na referenční cenu (ask nebo poslední obchod). */
type RefinedRow = AssetRow & { from_ask: boolean };

/**
 * Přepočet řádku na referenční cenu – HERNÍ PARITA prodejního dialogu:
 * hra předvyplňuje cenu prodeje ASKEM dané kvality (nejnižší aktivní
 * nabídka), takže i „Odhadovaný zisk“ počítá od asku. Bez asku (žádné
 * nabídky / data ještě nedorazila) zůstává poslední obchod dané kvality.
 * Netto = hrubý − poplatek 4 % − přeprava (jen exaktní; server stejně).
 */
function refineRow(h: AssetRow, ask: number | null | undefined): RefinedRow {
  const fromAsk = typeof ask === "number" && ask > 0;
  const refPrice = fromAsk ? (ask as number) : h.current_price;
  if (refPrice === null) return { ...h, from_ask: false };
  const value = refPrice * h.quantity;
  const plGross = value - h.invested;
  const fee = -MARKET_FEE_PCT * value;
  const transport = h.transport_exact ? (h.est_transport ?? 0) : 0;
  const plNet = plGross + fee + transport;
  return {
    ...h,
    current_price: refPrice,
    market_value: value,
    unrealized_pl: plGross,
    unrealized_pl_pct:
      h.invested > 0 ? (plGross / h.invested) * 100 : null,
    est_fee: fee,
    unrealized_pl_net: plNet,
    unrealized_pl_net_pct:
      h.invested > 0 ? (plNet / h.invested) * 100 : null,
    from_ask: fromAsk,
  };
}

/**
 * Živé asky per (položka, kvalita) – klientský enrichment přes
 * /api/live/ask (ofiko v3 orderbook, throttle 1,1 s na serveru, cache 3 s
 * per pár). Držeb je málo (řádově jednotky), takže 1 dotaz na pár / 60 s
 * zůstává hluboko pod limitem API. null = bez aktivních nabídek.
 */
function useHoldingAsks(assets: AssetRow[]): Map<string, number | null> {
  const [asks, setAsks] = useState<Map<string, number | null>>(new Map());
  const pairKey = useMemo(
    () => [...new Set(assets.map(hKey))].sort().join(","),
    [assets]
  );

  useEffect(() => {
    if (pairKey === "") return;
    let cancelled = false;
    const fetchAsks = async () => {
      const pairs = pairKey
        .split(",")
        .map((s) => s.split(":").map(Number));
      const next = new Map<string, number | null>();
      await Promise.allSettled(
        pairs.map(async ([itemId, quality]) => {
          try {
            const res = await fetch(
              `/api/live/ask?item=${itemId}&quality=${quality}&depth=1`,
              { cache: "no-store" }
            );
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = (await res.json()) as { ask?: number | null };
            next.set(
              `${itemId}:${quality}`,
              typeof data.ask === "number" && data.ask > 0 ? data.ask : null
            );
          } catch {
            next.set(`${itemId}:${quality}`, null);
          }
        })
      );
      if (!cancelled) setAsks(next);
    };
    void fetchAsks();
    const timer = setInterval(fetchAsks, 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [pairKey]);

  return asks;
}

/** Tooltip nerealizovaného P/L – metodika dle režimu přepravy. */
function plTooltip(h: RefinedRow): string {
  if (h.est_fee === null)
    return "Bez aktuální ceny nelze odhadnout náklady prodeje";
  const ref = h.from_ask
    ? `ask ${formatPrice(h.current_price)} (tu předvyplňuje herní prodejní dialog)`
    : `poslední obchod ${formatPrice(h.current_price)}`;
  const tail = ` Referenční cena: ${ref} – prodáš-li za jinou cenu, změní se i zisk.`;
  if (!h.transport_exact)
    return `Hrubý ${formatSigned(h.unrealized_pl)} − poplatek 4 % ${formatPrice(h.est_fee)} = ${formatSigned(h.unrealized_pl_net ?? h.unrealized_pl)}. Přepravu se nepodařilo spočítat (chybí přepravní poměr nebo cena Přepravy) – nezapočítána.${tail}`;
  if ((h.est_transport ?? 0) === 0)
    return `Hrubý ${formatSigned(h.unrealized_pl)} − poplatek 4 % ${formatPrice(h.est_fee)} = ${formatSigned(h.unrealized_pl_net ?? h.unrealized_pl)} (jako „Odhadovaný zisk“ v herním prodejním dialogu). Položka přepravu nespotřebuje (poměr 0).${tail}`;
  return `Herní parita („Odhadovaný zisk“): hrubý ${formatSigned(h.unrealized_pl)} − poplatek 4 % ${formatPrice(h.est_fee)} − přeprava ${formatPrice(h.est_transport)} (ks × přepravní poměr × cena Přepravy ze skladu) = ${formatSigned(h.unrealized_pl_net ?? h.unrealized_pl)}.${tail}`;
}

/**
 * Tabulka aktiv portfolia – aktivum = (položka, kvalita); cena i P/L se
 * počítají z ticků DANÉ kvality. Položka držená ve více kvalitách má
 * navíc SOUČTOVÝ řádek (nerealizovaný P/L všech kvalit v součtu) a pod
 * ním řádky per kvalita (Q1, Q2, …) s vlastními akcemi.
 */
export function PortfolioHoldingsTable({
  assets,
}: {
  assets: AssetRow[];
}) {
  // Živé asky (herní parita reference ceny) + přepočet řádků.
  const asks = useHoldingAsks(assets);
  const rows = useMemo(
    () => assets.map((h) => refineRow(h, asks.get(hKey(h)))),
    [assets, asks]
  );
  // Celková tržní hodnota portfolia – pro % alokace řádků (viz Podíl).
  const totalMarketValue = useMemo(
    () => rows.reduce((s, h) => s + (h.market_value ?? h.invested), 0),
    [rows]
  );

  // Skupiny per položka – zachováme pořadí dle investice (první výskyt).
  const groups: AssetGroup[] = [];
  for (const a of rows) {
    const g = groups.find((grp) => grp.rows[0]!.item_id === a.item_id);
    if (g) g.rows.push(a);
    else groups.push({ rows: [a] });
  }

  const renderRow = (h: RefinedRow, opts: { sub?: boolean }) => (
    <TableRow key={`${h.item_id}-${h.quality}`} className={opts.sub ? "border-border/40" : undefined}>
      <TableCell className={opts.sub ? "pl-10" : "pl-4"}>
        <Link
          href={`/market/${h.item_id}`}
          className="group flex items-center gap-3"
        >
          <ItemIcon url={h.image_url} name={h.name} size={opts.sub ? 24 : 34} />
          <span
            className={`group-hover:text-primary ${opts.sub ? "text-sm text-foreground/90" : "font-medium"}`}
          >
            {h.name}
            {h.quality > 0 && (
              <span
                className="ml-1.5 rounded border border-border/60 bg-secondary/40 px-1 font-mono text-[10px] text-muted-foreground"
                title={`Držba kvality Q${h.quality} – cena i P/L z asku/ticků této kvality`}
              >
                Q{h.quality}
              </span>
            )}
          </span>
        </Link>
      </TableCell>

      <TableCell className="text-right font-mono tabular-nums">
        {h.quantity.toLocaleString("cs-CZ")}
      </TableCell>

      <TableCell className="text-right font-mono tabular-nums">
        {/* Za řádek ZAINVESTOVÁNO (hlavní číslo – „kolik v tom mám peněz“),
            jednotková cena jako doplněk. Stejná hierarchie jak v broker
            appkách (cost basis dominuje, avg price je detail). */}
        <span title={`Zainvestováno: ${h.quantity.toLocaleString("cs-CZ")} ks × Ø ${formatPrice(h.avg_buy_price)}`}>
          {formatPrice(h.invested)}
        </span>
        <div className="text-[10px] text-muted-foreground">
          Ø {formatPrice(h.avg_buy_price)} /ks
        </div>
        {h.lots.length > 1 && (
          <div
            className="text-[10px] text-muted-foreground"
            title="Vážený průměr napříč všemi nákupy"
          >
            {h.lots.length} nákupů
          </div>
        )}
      </TableCell>

      <TableCell className="text-right font-mono tabular-nums">
        {formatPrice(h.current_price)}
        {h.from_ask && (
          <span
            className="ml-1.5 rounded bg-secondary/40 px-1 align-middle font-mono text-[10px] text-muted-foreground"
            title="Ask – nejnižší aktivní nabídka dané kvality (tu cenu předvyplňuje herní prodejní dialog)"
          >
            ask
          </span>
        )}
      </TableCell>

      <TableCell className="text-right font-mono tabular-nums">
        {formatPrice(h.market_value)}
      </TableCell>

      {/* Podíl na celkové tržní hodnotě portfolia (alokace jak v broker
          appkách) – číslo + jemný bar na šířku buňky. */}
      <TableCell className="text-right">
        {(() => {
          const share =
            totalMarketValue > 0 && h.market_value !== null
              ? (h.market_value / totalMarketValue) * 100
              : null;
          return (
            <>
              <div
                className="font-mono text-sm tabular-nums text-muted-foreground"
                title={`Podíl na celkové tržní hodnotě portfolia (${formatPrice(totalMarketValue)})`}
              >
                {share === null ? "–" : `${share.toFixed(2)} %`}
              </div>
              {share !== null && (
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary/60"
                    style={{ width: `${Math.min(100, share)}%` }}
                  />
                </div>
              )}
            </>
          );
        })()}
      </TableCell>

      <TableCell className="text-right">
        {/* Netto nerealizovaný P/L = HERNÍ PARITA prodejního dialogu
            („Odhadovaný zisk“): hrubý − poplatek 4 % − přeprava (jen
            položky s poměrem > 0 – hra ji v dialogu ukazuje a odečítá,
            kalibrováno na Dýni Q3). Referenční cena = ask dané kvality
            (live, herní dialog ji předvyplňuje), fallback poslední obchod. */}
        <div
          className={`font-mono tabular-nums ${plColorClass(h.unrealized_pl_net)}`}
          title={plTooltip(h)}
        >
          {formatSigned(h.unrealized_pl_net ?? h.unrealized_pl)}
        </div>
        <div
          className={`font-mono text-xs tabular-nums ${plColorClass(h.unrealized_pl_net_pct)}`}
        >
          {h.unrealized_pl_net_pct === null
            ? "–"
            : `${h.unrealized_pl_net_pct > 0 ? "+" : h.unrealized_pl_net_pct < 0 ? "−" : ""}${Math.abs(h.unrealized_pl_net_pct).toFixed(2)} %`}
        </div>
        {h.est_fee !== null && (
          <div
            className="text-[10px] leading-tight text-muted-foreground"
            title={plTooltip(h)}
          >
            poplatek {formatPrice(h.est_fee)}
            {(h.est_transport ?? 0) !== 0 &&
              ` · přeprava ${formatPrice(h.est_transport)}`}
          </div>
        )}
      </TableCell>

      <TableCell className="hidden text-right md:table-cell">
        <span
          className="font-mono text-xs text-muted-foreground"
          title={
            h.lots.length > 1
              ? "Aktivum tvoří více nákupů – uprav je tužkou"
              : "Jeden nákup"
          }
        >
          {h.lots.length}×
        </span>
      </TableCell>

      <TableCell className="pr-4 text-right">
        <div className="flex items-center justify-end gap-1">
          <PortfolioSellDialog
            itemId={h.item_id}
            quality={h.quality}
            itemName={h.name}
            quantity={h.quantity}
            avgBuyPrice={h.avg_buy_price}
            currentPrice={h.current_price}
            limitPrice={h.limit_price}
            trigger={
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground hover:text-up"
                title="Odklepnout prodej / zadat limit"
              >
                <ArrowUpRight className="size-4" />
                <span className="sr-only">
                  Prodat {h.name} Q{h.quality}
                </span>
              </Button>
            }
          />
          <PortfolioEditLotsDialog
            holdingLabel={h.name}
            lots={h.lots}
            trigger={
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground hover:text-foreground"
                title="Upravit nákupy (množství, cena)"
              >
                <Pencil className="size-4" />
                <span className="sr-only">
                  Upravit {h.name} Q{h.quality}
                </span>
              </Button>
            }
          />
          {/* Přesun do „Mimo portfolio“ – dialog s potvrzením
              a volitelným důvodem (koš bez potvrzení hrozil
              omylem zahodenou držbou). */}
          <PortfolioIgnoreDialog
            itemId={h.item_id}
            quality={h.quality}
            itemName={h.name}
            quantity={h.quantity}
            trigger={<PortfolioIgnoreTrigger />}
          />
        </div>
      </TableCell>
    </TableRow>
  );

  // Součtový řádek položky s více kvalitami: Σ množství, vážený průměr
  // pořizovací ceny, Σ hodnoty a HLAVNĚ Σ nerealizovaného P/L (netto).
  const renderParentRow = (g: AssetGroup) => {
    const rows = g.rows;
    const first = rows[0]!;
    const qty = rows.reduce((s, h) => s + h.quantity, 0);
    const invested = rows.reduce((s, h) => s + h.invested, 0);
    const value = rows.reduce((s, h) => s + (h.market_value ?? h.invested), 0);
    const fees = rows.reduce((s, h) => s + (h.est_fee ?? 0), 0);
    // Do součtu jen exaktní přeprava (stejné pravidlo jako u řádků).
    const transport = rows.reduce(
      (s, h) => s + (h.transport_exact ? (h.est_transport ?? 0) : 0),
      0
    );
    const lots = rows.reduce((s, h) => s + h.lots.length, 0);
    const hasPl = rows.some(
      (h) => h.unrealized_pl_net !== null || h.unrealized_pl !== null
    );
    const plNet = hasPl
      ? rows.reduce(
          (s, h) => s + (h.unrealized_pl_net ?? h.unrealized_pl ?? 0),
          0
        )
      : null;
    const pct =
      hasPl && invested > 0 ? ((plNet ?? 0) / invested) * 100 : null;
    const kvLabel =
      rows.length < 5 ? `${rows.length} kvality` : `${rows.length} kvalit`;

    return (
      <TableRow className="bg-secondary/20">
        <TableCell className="pl-4">
          <Link
            href={`/market/${first.item_id}`}
            className="group flex items-center gap-3"
          >
            <ItemIcon url={first.image_url} name={first.name} size={34} />
            <span className="font-semibold group-hover:text-primary">
              {first.name}
              <span
                className="ml-1.5 rounded border border-border/60 bg-secondary/40 px-1 font-mono text-[10px] font-normal text-muted-foreground"
                title={`Položka držená v ${rows.length} kvalitách – níže rozpad po jednotlivých kvalitách`}
              >
                {kvLabel}
              </span>
            </span>
          </Link>
        </TableCell>

        <TableCell className="text-right font-mono tabular-nums">
          {qty.toLocaleString("cs-CZ")}
        </TableCell>

        <TableCell
          className="text-right font-mono tabular-nums"
          title={`Zainvestováno do všech ${rows.length} kvalit položky (Ø pořizovací cena ${formatPrice(invested / qty)} /ks)`}
        >
          {formatPrice(invested)}
          <div className="text-[10px] font-normal text-muted-foreground">
            Ø {formatPrice(invested / qty)} /ks
          </div>
        </TableCell>

        <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
          –
        </TableCell>

        <TableCell className="text-right font-mono tabular-nums">
          {formatPrice(value)}
        </TableCell>

        {/* Podíl – MUSÍ být ve stejném pořadí jako v renderRow a headeru
            (… Hodnota, Podíl, P/L …); dřív seděl mezi cenou a hodnotou
            a celý řádek se tím posunul o sloupec. */}
        {(() => {
          const share =
            totalMarketValue > 0
              ? (value / totalMarketValue) * 100
              : null;
          return (
            <TableCell className="text-right">
              <div className="font-mono text-sm tabular-nums text-muted-foreground">
                {share === null ? "–" : `${share.toFixed(2)} %`}
              </div>
              {share !== null && (
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary/60"
                    style={{ width: `${Math.min(100, share)}%` }}
                  />
                </div>
              )}
            </TableCell>
          );
        })()}

        <TableCell className="text-right">
          <div
            className={`font-mono tabular-nums ${plColorClass(plNet)}`}
            title={`Součet nerealizovaného P/L (netto) všech ${rows.length} kvalit položky – poplatek ${formatPrice(fees)}${transport !== 0 ? ` + přeprava ${formatPrice(transport)}` : ""} celkem. Rozpad per kvalita je níže.`}
          >
            {plNet === null ? "–" : formatSigned(plNet)}
          </div>
          <div
            className={`font-mono text-xs tabular-nums ${plColorClass(pct)}`}
          >
            {pct === null
              ? "–"
              : `${pct > 0 ? "+" : pct < 0 ? "−" : ""}${Math.abs(pct).toFixed(2)} %`}
          </div>
          <div className="text-[10px] leading-tight text-muted-foreground">
            poplatek {formatPrice(fees)}
            {transport !== 0 && ` · přeprava ${formatPrice(transport)}`}
          </div>
        </TableCell>

        <TableCell className="hidden text-right md:table-cell">
          <span
            className="font-mono text-xs text-muted-foreground"
            title="Nákupy napříč všemi kvalitami"
          >
            {lots}×
          </span>
        </TableCell>

        <TableCell className="pr-4" />
      </TableRow>
    );
  };

  return (
    <div className="overflow-hidden rounded-xl border border-border/80 bg-card">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="pl-4">Aktivum</TableHead>
            <TableHead className="text-right">Množství</TableHead>
            <TableHead className="text-right">Pořízení (celkem)</TableHead>
            <TableHead className="text-right">Aktuální cena</TableHead>
            <TableHead className="text-right">Hodnota</TableHead>
            <TableHead className="text-right">Podíl</TableHead>
            <TableHead className="text-right">Nerealizovaný P/L (netto)</TableHead>
            <TableHead className="hidden text-right md:table-cell">
              Nákupy
            </TableHead>
            <TableHead className="pr-4 text-right">Akce</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.map((g) =>
            g.rows.length === 1 ? (
              <Fragment key={`${g.rows[0]!.item_id}`}>
                {renderRow(g.rows[0]!, {})}
              </Fragment>
            ) : (
              <Fragment key={`${g.rows[0]!.item_id}`}>
                {renderParentRow(g)}
                {g.rows.map((h) => renderRow(h, { sub: true }))}
              </Fragment>
            )
          )}
        </TableBody>
      </Table>
      <p className="border-t border-border/60 px-4 py-3 text-xs text-muted-foreground">
        Nerealizovaný P/L je NETTO – stejná metodika jako „Odhadovaný zisk“
        v herním prodejním dialogu na burze: hrubý P/L − burzovní poplatek
        4 % − přeprava (jen položky s přepravním poměrem nad 0; hra ji v
        dialogu ukazuje a odečítá – kalibrováno na Dýni Q3: 13 500 ks ×
        poměr 1 × 0,3544 ze skladu = 4 785 $). Referenční cena je ASK dané
        kvality (nejnižší nabídka – tu cenu herní dialog předvyplňuje;
        dorazí živě pár sekund po načtení), bez nabídek poslední obchod
        DANÉ kvality – prodáš-li za jinou cenu, změní se i zisk. Hrubý
        P/L, poplatek i přeprava jsou v tooltipu u čísla. Položka držená
        ve více kvalitách má součtový řádek a pod ním rozpad po kvalitách.
      </p>
    </div>
  );
}
