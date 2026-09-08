import { getDb } from "@/lib/db";
import {
  getCertificateKinds,
  getContests,
  getVwaps,
} from "@/lib/simcotools";
import { syncCertKinds, syncContests, syncVwapDaily } from "@/lib/data";

export const dynamic = "force-dynamic";

/**
 * Denní sync pro Signal Engine (fáze 1) – volá externí cron
 * (cron-job.org / GitHub Actions) 1× denně. Tři requesty do Simco
 * Tools celkem (limit 2 req/s – mezi voláními je krátká pauza):
 *
 *   1. market/vwaps    → market_vwap_daily (celý trh v 1 requestu)
 *   2. contests        → contests (historie od 2019, is_active flag)
 *   3. certificates    → cert_kinds (referenční data)
 *
 * Chráněno hlavičkou Authorization: Bearer CRON_SECRET.
 */
export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;

  if (!secret || auth !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = {
    vwapRows: 0,
    contests: 0,
    certKinds: 0,
    errors: [] as string[],
  };

  try {
    const vwaps = await getVwaps();
    result.vwapRows = await syncVwapDaily(vwaps);
  } catch (err) {
    result.errors.push(
      `vwaps: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // Krátká pauza – slušnost vůči limitu 2 req/s
  await new Promise((r) => setTimeout(r, 600));

  try {
    const contests = await getContests();
    result.contests = await syncContests(contests);
  } catch (err) {
    result.errors.push(
      `contests: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  await new Promise((r) => setTimeout(r, 600));

  try {
    const kinds = await getCertificateKinds();
    result.certKinds = await syncCertKinds(kinds);
  } catch (err) {
    result.errors.push(
      `certKinds: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const ok = result.errors.length === 0;

  return Response.json(
    { ok, ...result, at: new Date().toISOString() },
    { status: ok ? 200 : 207 }
  );
}
