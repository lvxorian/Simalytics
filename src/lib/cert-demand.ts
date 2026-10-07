/**
 * Cert demand – kolik firem drží relevantní certifikát pro daný resource.
 *
 * Certifikát = „quality leader" vyrábějící danou komoditu; firmy bez
 * certu musí komoditu KUPEROVAT ⇒ vysoký počet certů na komoditu =
 * strukturální poptávka po ní (a naopak držitelé certů ji nabízejí).
 *
 * Relevantní druhy certů (kind 39/40/41/42/52) mapují na resources přes
 * tabulku cert_kinds (resource_ids integer[]).
 */

import { getDb } from "@/lib/db";
import { getCertificatesByKind } from "@/lib/simcotools";

export type CertDemandRow = {
  itemId: number;
  name: string | null; // český název z items (null = neznámá komodita)
  imageUrl: string | null;
  holderCount: number; // kolik firem drží cert pro tento resource
  totalAmount: number; // celková produkce/objem certů
  topHolder: { name: string; amount: number } | null;
};

/**
 * Načte relevantní druhy certů z DB a pro každý relevantní kind
 * stáhne držitele. Vrací mapu resource_id → agregovaný demand.
 *
 * Počet requestů = počet relevantních druhů (typicky 5) – při limitu
 * 2 req/s zvládneme s malými pauzami.
 */
export async function getCertDemand(): Promise<Map<number, CertDemandRow>> {
  // In-memory TTL cache (15 min): cert demand se mění pomalu a výpočet
  // dělá 5 SEKVENČNÍCH upstream volání (600 ms pauza kvůli 2 req/s)
  // ≈ 8 s – bez cache stálo každé načtení /statistiky těchto 8 s.
  // next.revalidate se u force-dynamic stránek neprojevil, proto pevná
  // paměťová cache (vzor /api/live/asks).
  const now = Date.now();
  if (certDemandCache && now - certDemandCacheAtMs < CERT_DEMAND_TTL_MS) {
    return certDemandCache;
  }

  const db = getDb();
  const kinds = (await db`
    select kind from cert_kinds where relevant = true order by kind
  `) as unknown as { kind: number }[];

  const demand = new Map<number, CertDemandRow>();
  if (kinds.length === 0) return demand;

  // Čísla komodit z API → názvy/ikony z items (kvalita 0, vč. neznámých ID)
  const items = (await db`
    select id, name, image_url from items
  `) as unknown as { id: number; name: string; image_url: string | null }[];
  const itemsById = new Map(items.map((i) => [i.id, i]));

  for (let i = 0; i < kinds.length; i++) {
    // Pauza mezi requesty – slušnost vůči 2 req/s limitu
    if (i > 0) await new Promise((r) => setTimeout(r, 600));

    let certs;
    try {
      certs = await getCertificatesByKind(kinds[i].kind);
    } catch {
      continue; // jeden selhavší kind nesmí zabít celý výpočet
    }

    for (const cert of certs) {
      const resource = cert.resourceKind;
      if (resource === undefined || resource === null) continue;

      const item = itemsById.get(resource);
      const existing = demand.get(resource) ?? {
        itemId: resource,
        name: item?.name ?? null,
        imageUrl: item?.image_url ?? null,
        holderCount: 0,
        totalAmount: 0,
        topHolder: null,
      };

      // Název/ikonu doplň, i pokud řádek vznikl dřív než items metadata
      existing.name = existing.name ?? item?.name ?? null;
      existing.imageUrl = existing.imageUrl ?? item?.image_url ?? null;

      existing.holderCount += 1;
      existing.totalAmount += cert.certInfo?.amount ?? 0;

      const amount = cert.certInfo?.amount ?? 0;
      if (
        !existing.topHolder ||
        amount > existing.topHolder.amount
      ) {
        existing.topHolder = {
          name: cert.companyName,
          amount,
        };
      }

      demand.set(resource, existing);
    }
  }

  certDemandCache = demand;
  certDemandCacheAtMs = now;
  return demand;
}

const CERT_DEMAND_TTL_MS = 15 * 60 * 1000;
let certDemandCache: Map<number, CertDemandRow> | null = null;
let certDemandCacheAtMs = 0;

/** Volitelné: vrátí i relevantní druhy pro UI tooltip. */
export async function getRelevantKinds(): Promise<number[]> {
  const db = getDb();
  const kinds = (await db`
    select kind from cert_kinds where relevant = true order by kind
  `) as unknown as { kind: number }[];
  return kinds.map((k) => k.kind);
}
