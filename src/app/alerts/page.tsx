import type { Metadata } from "next";
import { BellRing, Mail, Webhook } from "lucide-react";

import { AlertsTable } from "@/components/alerts-table";
import { getAlertsWithItems } from "@/lib/data";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Alerty",
  description: "Cenové a signálové alerty s notifikacemi.",
};

export default async function AlertsPage() {
  let alerts: Awaited<ReturnType<typeof getAlertsWithItems>> = [];
  let dbError: string | null = null;

  try {
    alerts = await getAlertsWithItems();
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
  }

  const webhookSet = Boolean(process.env.ALERT_WEBHOOK_URL);
  const emailSet = Boolean(
    process.env.ALERT_RESEND_API_KEY && process.env.ALERT_EMAIL_TO
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Alerty</h1>
        <p className="text-sm text-muted-foreground">
          Notifikace při cenových úrovních a signálech Signal Engine.
          Evaluace běží po každém polleru ticků (5 min).
        </p>
      </div>

      {/* Stav notifikačních kanálů */}
      <section className="grid gap-3 sm:grid-cols-2">
        <div
          className={`rounded-xl border px-4 py-3 ${
            webhookSet
              ? "border-up/25 bg-up/5"
              : "border-border/80 bg-card"
          }`}
        >
          <div className="flex items-center gap-2 text-sm font-medium">
            <Webhook className="size-4 text-primary" />
            Webhook (Discord / Slack)
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {webhookSet
              ? "Nakonfigurováno – notifikace chodí do chatu."
              : "Nenastaveno – doplň ALERT_WEBHOOK_URL do env."}
          </p>
        </div>
        <div
          className={`rounded-xl border px-4 py-3 ${
            emailSet ? "border-up/25 bg-up/5" : "border-border/80 bg-card"
          }`}
        >
          <div className="flex items-center gap-2 text-sm font-medium">
            <Mail className="size-4 text-primary" />
            E-mail (Resend)
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {emailSet
              ? "Nakonfigurováno – alerty chodí i mailem."
              : "Nenastaveno – doplň ALERT_RESEND_API_KEY + ALERT_EMAIL_TO."}
          </p>
        </div>
      </section>

      {dbError && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 font-mono text-xs text-red-300">
          {dbError}
        </div>
      )}

      {alerts.length > 0 && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <BellRing className="size-4" />
          {alerts.filter((a) => a.active).length} aktivních z {alerts.length} alertů
        </p>
      )}

      <AlertsTable alerts={alerts} />
    </div>
  );
}
