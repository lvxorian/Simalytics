/**
 * Notifikace pro alerty – dvě kanály:
 *
 *  1. Webhook (DISCORD/SLACK/generický JSON) – primární kanál, okamžitá
 *     notifikace do chatu. Stačí ALERT_WEBHOOK_URL.
 *  2. E-mail přes Resend (ALERT_RESEND_API_KEY + ALERT_EMAIL_TO) –
 *     čistý fetch na REST API, žádná závislost.
 *
 * Obě kanály jsou volitelné – chybí-li konfigurace, funkce tiše vrátí
 * false a evaluace alertů pokračuje. Nikdy nespadnou kvůli notifikaci.
 */

// ── Typy ───────────────────────────────────────────────────────────

export type AlertNotification = {
  title: string; // např. „Cenový alert: Apples"
  body: string; // lidsky čitelný detail
  url: string | null; // odkaz do appky (detail komodity)
  kind: "price" | "score";
};

// ── Webhook (Discord / Slack / generický) ──────────────────────────

/**
 * Pošle webhook. Rozpozná Discord (content + embeds) a Slack
 * (text + blocks fallback na text), jinak pošle generický JSON.
 */
export async function sendWebhook(
  notification: AlertNotification,
  webhookUrl: string
): Promise<boolean> {
  try {
    let payload: Record<string, unknown>;

    if (webhookUrl.includes("discord.com/api/webhooks")) {
      payload = {
        username: "Simalytics",
        embeds: [
          {
            title: notification.title,
            description: notification.body,
            color: notification.kind === "price" ? 0x5b8def : 0x22ab94,
            ...(notification.url ? { url: notification.url } : {}),
          },
        ],
      };
    } else if (webhookUrl.includes("hooks.slack.com")) {
      payload = {
        text: notification.url
          ? `*${notification.title}*\n${notification.body}\n${notification.url}`
          : `*${notification.title}*\n${notification.body}`,
      };
    } else {
      payload = {
        title: notification.title,
        body: notification.body,
        url: notification.url,
        kind: notification.kind,
        at: new Date().toISOString(),
      };
    }

    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    return res.ok;
  } catch {
    return false;
  }
}

// ── E-mail přes Resend REST API ────────────────────────────────────

const RESEND_API = "https://api.resend.com/emails";

/**
 * Pošle e-mail přes Resend (https://resend.com). Vyžaduje:
 *   ALERT_RESEND_API_KEY – API klíč (re_…)
 *   ALERT_EMAIL_FROM     – ověřená adresa odesílatele (např. alerts@domena.cz)
 *   ALERT_EMAIL_TO       – příjemce
 *
 * Bez SDK – jen fetch. Chyba se loguje, ale nevyhazuje (alert nesmí
 * padat kvůli notifikaci).
 */
export async function sendEmail(
  notification: AlertNotification,
  to: string
): Promise<boolean> {
  const apiKey = process.env.ALERT_RESEND_API_KEY;
  const from = process.env.ALERT_EMAIL_FROM;

  if (!apiKey || !from) return false;

  try {
    const res = await fetch(RESEND_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: notification.title,
        text: notification.body + (notification.url ? `\n\n${notification.url}` : ""),
        html: renderAlertEmailHtml(notification),
      }),
    });

    return res.ok;
  } catch {
    return false;
  }
}

/** Jednoduchý HTML e-mail v barvách appky (dark, ink navy). */
function renderAlertEmailHtml(notification: AlertNotification): string {
  const link = notification.url
    ? `<a href="${notification.url}" style="color:#5b8def;">Otevřít v Simalytics →</a>`
    : "";

  return `<!doctype html>
<html lang="cs">
<body style="margin:0;padding:24px;background:#0b0e14;font-family:system-ui,-apple-system,sans-serif;color:#e6e9ef;">
  <div style="max-width:480px;margin:0 auto;border:1px solid #232a38;border-radius:12px;background:#11151f;padding:24px;">
    <div style="font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#8a93a6;margin-bottom:8px;">
      Simalytics alert
    </div>
    <h1 style="margin:0 0 12px;font-size:18px;font-weight:600;">${escapeHtml(notification.title)}</h1>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#c3cad6;">
      ${escapeHtml(notification.body)}
    </p>
    ${link ? `<p style="margin:0;font-size:14px;">${link}</p>` : ""}
    <hr style="border:0;border-top:1px solid #232a38;margin:20px 0;" />
    <p style="margin:0;font-size:11px;color:#8a93a6;">
      Automatická notifikace z Simalytics · ${new Date().toISOString()}
    </p>
  </div>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Fasáda ─────────────────────────────────────────────────────────

/**
 * Pošle notifikaci všemi dostupnými kanály. Vrací true, když dorazila
 * alespoň jedna.
 */
export async function notifyAlert(
  notification: AlertNotification,
  emailTo: string | null
): Promise<boolean> {
  const results: boolean[] = [];

  const webhookUrl = process.env.ALERT_WEBHOOK_URL;
  if (webhookUrl) {
    results.push(await sendWebhook(notification, webhookUrl));
  }

  if (emailTo) {
    results.push(await sendEmail(notification, emailTo));
  }

  return results.some(Boolean);
}
