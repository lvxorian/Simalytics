import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import {
  getPortfolioHoldings,
  getPositionsWithPnl,
  getLatestVwaps,
  getMarketInstruments,
} from "@/lib/data";
import { sendCustomEmail } from "@/lib/notifier";
import { buildWeeklyReport } from "@/lib/weekly-report";

export const dynamic = "force-dynamic";

/**
 * Týdenní investorský report e-mailem (cron-job.org, Bearer CRON_SECRET).
 *
 * Složí data ze stávajících funkcí (uzavřené pozice, holdings, denní
 * VWAP, obrat herních prodejů za 7 dní) a pošle je přes existující
 * Resend konfiguraci (ALERT_RESEND_API_KEY + ALERT_EMAIL_FROM na
 * ALERT_EMAIL_TO). Bez e-mailové konfigurace vrací { sent: false,
 * reason } – cron může běžet, nic se nerozbije; po doplnění env report
 * jde sám.
 */
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const emailTo = process.env.ALERT_EMAIL_TO;
  if (!emailTo) {
    return NextResponse.json({
      sent: false,
      reason: "ALERT_EMAIL_TO není nastaveno – report se neposílá.",
    });
  }

  try {
    const db = getDb();

    const holdings = await getPortfolioHoldings().catch((err) => {
      console.error("[weekly] holdings failed", err);
      return [];
    });

    const closed = await getPositionsWithPnl({ open: false }).catch((err) => {
      console.error("[weekly] closed positions failed", err);
      return [];
    });

    // VWAP pro držby + uzavřené pozice (fair value) – až po closed,
    // protože jejich itemIdy potřebujeme. Sales volume nezávislý.
    const [vwaps, salesVolume] = await Promise.all([
      getLatestVwaps([
        ...new Set([
          ...holdings.map((h) => h.item_id),
          ...closed.map((p) => p.item_id),
        ]),
      ]).catch((err) => {
        console.error("[weekly] vwaps failed", err);
        return new Map<number, number>();
      }),
      (async () => {
        try {
          const rows = (await db`
            select coalesce(sum(money), 0) as volume
            from game_cashflow
            where kind in ('retail_sale', 'market_sale', 'contract_sale')
              and datetime > now() - interval '7 days'
          `) as unknown as { volume: string }[];
          return Number(rows[0]?.volume ?? 0);
        } catch (err) {
          console.error("[weekly] sales volume failed", err);
          return 0;
        }
      })(),
    ]);

    // Jména instrumentů pro VWAP řádky (holdings/positions už jména mají).
    const items = await getMarketInstruments().catch(() => []);
    const nameOf = new Map(items.map((i) => [i.id, i.name]));

    // Řádky trhu pro divergenční sekci: fair value = denní VWAP,
    // aktuální cena = poslední obchod (z instrumentů).
    const market = [...vwaps.entries()].map(([itemId, vwap]) => {
      const inst = items.find((i) => i.id === itemId);
      return {
        item_id: itemId,
        name: nameOf.get(itemId) ?? `#${itemId}`,
        price: inst?.prices["0"] ?? 0,
        vwap,
      };
    });

    const report = buildWeeklyReport({
      closed: closed.map((p) => ({
        item_id: p.item_id,
        name: p.item_name ?? null,
        quantity: p.quantity,
        realized_pl: p.realized_pl ?? null,
        closed_at: p.closed_at,
      })),
      holdings: holdings.map((h) => ({
        item_id: h.item_id,
        name: h.name ?? null,
        invested: h.invested,
        market_value: h.market_value,
        unrealized_pl_net: h.unrealized_pl_net,
        unrealized_pl: h.unrealized_pl,
      })),
      market,
      weekSalesVolume: salesVolume,
    });

    const sent = await sendCustomEmail({
      subject: report.subject,
      text: report.text,
      html: report.html,
      to: emailTo,
    });

    return NextResponse.json({
      sent,
      realized_week: closed.reduce((s, p) => s + (p.realized_pl ?? 0), 0),
      holdings_count: holdings.length,
    });
  } catch (err) {
    console.error("[weekly] report failed", err);
    return NextResponse.json(
      { sent: false, error: "report failed" },
      { status: 500 }
    );
  }
}
