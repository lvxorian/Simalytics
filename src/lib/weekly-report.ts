/**
 * Týdenní investorský report – čistá funkce (bez DB) pro cron endpoint.
 *
 * Sestaví textový + HTML souhrn za posledních 7 dní:
 *  - realizovaný P/L z uzavřených pozic (positions.closed_at v okně),
 *  - nerealizovaný P/L otevřeného portfolia (aktuální hodnota),
 *  - obrat herního cashflow (prodeje) za týden,
 *  - top winners/losers z uzavřených pozic,
 *  - top divergence ceny vs. denní VWAP (fair value) z hlavních řádků.
 *
 * Všechna data jdou ze stávajících funkcí lib/data (žádná nová SQL) –
 * endpoint jen složí a pošle e-mail přes existující Resend fasádu
 * (lib/notifier.sendEmail). Chybí-li konfigurace, endpoint vrací
 * { sent: false, reason } a nikdy nespadne.
 */

import { formatPrice, formatSigned, formatPercent } from "@/lib/format";

// ── Vstupní typy (subsety řádků z lib/data, snadno mockovatelné) ────

export type WeeklyClosedPosition = {
  item_id: number;
  name: string | null;
  quantity: number;
  realized_pl: number | null;
  closed_at: Date | string | null;
};

export type WeeklyHolding = {
  item_id: number;
  name: string | null;
  invested: number;
  market_value: number | null;
  unrealized_pl_net: number | null;
  unrealized_pl: number | null;
};

export type WeeklyMarketRow = {
  item_id: number;
  name: string;
  price: number;
  /** Denní VWAP (fair value), null bez dat denního syncu. */
  vwap: number | null;
};

export type WeeklyReportInput = {
  closed: WeeklyClosedPosition[];
  holdings: WeeklyHolding[];
  market: WeeklyMarketRow[];
  /** Obrat herních prodejů za 7 dní ($, netto z herního cashflow). */
  weekSalesVolume: number;
};

export type WeeklyReport = {
  subject: string;
  text: string;
  html: string;
};

// ── Pomocné ────────────────────────────────────────────────────────

const fmtSigned$ = (v: number | null | undefined) =>
  v == null ? "–" : formatSigned(v);

const fmtPrice$ = (v: number | null | undefined) =>
  v == null ? "–" : formatPrice(v);

const fmtPct = (v: number | null | undefined) =>
  v == null ? "–" : formatPercent(v);

const esc = (t: string) =>
  t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Divergence ceny vs. VWAP v % (null bez VWAP). */
function divergence(row: WeeklyMarketRow): number | null {
  if (row.vwap === null || row.vwap <= 0) return null;
  return (row.price / row.vwap - 1) * 100;
}

// ── Hlavní funkce ──────────────────────────────────────────────────

export function buildWeeklyReport(
  input: WeeklyReportInput,
  now: Date = new Date()
): WeeklyReport {
  const weekAgo = new Date(now.getTime() - 7 * 24 * 3600_000);
  const weekClosed = input.closed.filter(
    (p) =>
      p.closed_at !== null &&
      new Date(p.closed_at).getTime() >= weekAgo.getTime()
  );

  const realizedWeek = weekClosed.reduce(
    (s, p) => s + (p.realized_pl ?? 0),
    0
  );
  const unrealized = input.holdings.reduce(
    (s, h) => s + (h.unrealized_pl_net ?? h.unrealized_pl ?? 0),
    0
  );
  const invested = input.holdings.reduce((s, h) => s + h.invested, 0);
  const marketValue = input.holdings.reduce(
    (s, h) => s + (h.market_value ?? h.invested),
    0
  );

  const winners = [...weekClosed]
    .filter((p) => (p.realized_pl ?? 0) > 0)
    .sort((a, b) => (b.realized_pl ?? 0) - (a.realized_pl ?? 0))
    .slice(0, 3);
  const losers = [...weekClosed]
    .filter((p) => (p.realized_pl ?? 0) < 0)
    .sort((a, b) => (a.realized_pl ?? 0) - (b.realized_pl ?? 0))
    .slice(0, 3);

  // Divergence vs. fair value: top overpriced / underpriced.
  const divs = input.market
    .map((r) => ({ row: r, div: divergence(r) }))
    .filter((d): d is { row: WeeklyMarketRow; div: number } => d.div !== null)
    .sort((a, b) => b.div - a.div);
  const overpriced = divs.slice(0, 3);
  const underpriced = [...divs].reverse().slice(0, 3);

  const netWorth = marketValue;
  const dateLabel = new Intl.DateTimeFormat("cs-CZ", {
    dateStyle: "medium",
  }).format(now);

  // ── Text ──
  const lines: string[] = [];
  lines.push(`Simalytics – týdenní report (${dateLabel})`);
  lines.push("");
  lines.push("PORTFOLIO");
  lines.push(
    `Hodnota aktiv: ${fmtPrice$(netWorth)} (investováno ${fmtPrice$(invested)})`
  );
  lines.push(
    `Nerealizovaný P/L (netto): ${fmtSigned$(unrealized)} (${fmtPct(
      invested > 0 ? (unrealized / invested) * 100 : null
    )})`
  );
  lines.push(
    `Realizovaný P/L za 7 dní: ${fmtSigned$(realizedWeek)} z ${weekClosed.length} uzavřených pozic`
  );
  lines.push(`Obrat prodejů (herní cashflow, 7 dní): ${fmtPrice$(input.weekSalesVolume)}`);
  if (winners.length > 0) {
    lines.push("");
    lines.push("NEJVYŠŠÍ ZISK (7 dní)");
    for (const w of winners) {
      lines.push(
        `+ ${w.name ?? `#${w.item_id}`}: ${fmtSigned$(w.realized_pl)} (${w.quantity.toLocaleString("cs-CZ")} ks)`
      );
    }
  }
  if (losers.length > 0) {
    lines.push("");
    lines.push("NEJVĚTŠÍ ZTRÁTA (7 dní)");
    for (const l of losers) {
      lines.push(
        `- ${l.name ?? `#${l.item_id}`}: ${fmtSigned$(l.realized_pl)} (${l.quantity.toLocaleString("cs-CZ")} ks)`
      );
    }
  }
  if (overpriced.length > 0) {
    lines.push("");
    lines.push("NAJDRAŽŠÍ vs. FAIR VALUE (cena vs. denní VWAP)");
    for (const d of overpriced) {
      lines.push(`+ ${d.row.name}: ${fmtPct(d.div)} (cena ${fmtPrice$(d.row.price)})`);
    }
    lines.push("NEJLACINEJŠÍ vs. FAIR VALUE");
    for (const d of underpriced) {
      lines.push(`− ${d.row.name}: ${fmtPct(d.div)} (cena ${fmtPrice$(d.row.price)})`);
    }
  }
  lines.push("");
  lines.push("https://simalytics.vercel.app");

  const text = lines.join("\n");

  // ── HTML ──
  const section = (title: string, rows: string[]) =>
    rows.length === 0
      ? ""
      : `<h3 style="margin:18px 0 6px;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#8a93a6;">${esc(title)}</h3>
<ul style="margin:0;padding:0;list-style:none;font-size:13px;line-height:1.7;color:#e6e9ef;">
${rows.join("\n")}
</ul>`;

  const rowHtml = (label: string, value: string, color?: string) =>
    `<li style="display:flex;justify-content:space-between;gap:12px;">
  <span>${esc(label)}</span>
  <b style="font-family:ui-monospace,monospace;${color ? `color:${color};` : ""}">${esc(value)}</b>
</li>`;

  const upColor = "#22ab94";
  const downColor = "#ec5063";

  const html = `<!doctype html>
<html lang="cs">
<body style="margin:0;padding:24px;background:#0b0e14;font-family:system-ui,-apple-system,sans-serif;color:#e6e9ef;">
  <div style="max-width:520px;margin:0 auto;border:1px solid #232a38;border-radius:12px;background:#11151f;padding:24px;">
    <div style="font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#8a93a6;margin-bottom:8px;">
      Simalytics · týdenní report
    </div>
    <h1 style="margin:0 0 16px;font-size:18px;font-weight:600;">Přehled za 7 dní · ${esc(dateLabel)}</h1>

    ${section("Portfolio", [
      rowHtml("Hodnota aktiv", fmtPrice$(netWorth)),
      rowHtml("Nerealizovaný P/L (netto)", fmtSigned$(unrealized), unrealized >= 0 ? upColor : downColor),
      rowHtml("Realizovaný P/L (7 dní)", fmtSigned$(realizedWeek), realizedWeek >= 0 ? upColor : downColor),
      rowHtml("Obrat prodejů (cashflow)", fmtPrice$(input.weekSalesVolume)),
    ])}

    ${section(
      "Nejvyšší zisk (7 dní)",
      winners.map((w) =>
        rowHtml(
          `${w.name ?? `#${w.item_id}`} · ${w.quantity.toLocaleString("cs-CZ")} ks`,
          fmtSigned$(w.realized_pl),
          upColor
        )
      )
    )}

    ${section(
      "Největší ztráta (7 dní)",
      losers.map((l) =>
        rowHtml(
          `${l.name ?? `#${l.item_id}`} · ${l.quantity.toLocaleString("cs-CZ")} ks`,
          fmtSigned$(l.realized_pl),
          downColor
        )
      )
    )}

    ${section(
      "Trh vs. fair value (denní VWAP)",
      [
        ...overpriced.map((d) =>
          rowHtml(`${d.row.name} (nadhodnoceno)`, fmtPct(d.div), downColor)
        ),
        ...underpriced.map((d) =>
          rowHtml(`${d.row.name} (podhodnoceno)`, fmtPct(d.div), upColor)
        ),
      ]
    )}

    <p style="margin:20px 0 0;font-size:13px;">
      <a href="https://simalytics.vercel.app" style="color:#5b8def;">Otevřít Simalytics →</a>
    </p>
    <hr style="border:0;border-top:1px solid #232a38;margin:20px 0;" />
    <p style="margin:0;font-size:11px;color:#8a93a6;">
      Automatický týdenní souhrn · data z tvého herního syncu a burzy
    </p>
  </div>
</body>
</html>`;

  const weekSign =
    realizedWeek + unrealized >= 0 ? "+" : "−";
  const subject = `Simalytics týden ${weekSign}${formatPrice(
    Math.abs(realizedWeek + unrealized)
  )} P/L (${dateLabel})`;

  return { subject, text, html };
}
