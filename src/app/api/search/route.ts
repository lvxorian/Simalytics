import { NextResponse } from "next/server";

import { getLatestPrices } from "@/lib/data";

export const dynamic = "force-dynamic";

/**
 * Vyhledávání komodit pro hlavičkový search (client-side dropdown).
 * Vrací max 10 výsledků seřazených podle relevance (prefix nejdřív).
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim().toLowerCase();

  if (q.length < 1) {
    return NextResponse.json({ results: [] });
  }

  const rows = await getLatestPrices(0);

  const normalize = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

  const nq = normalize(q);
  const scored = rows
    .map((r) => {
      const name = normalize(r.name);
      const category = r.category ? normalize(r.category) : "";
      let score = -1;
      if (name.startsWith(nq)) score = 0;
      else if (name.includes(nq)) score = 1;
      else if (category.includes(nq)) score = 2;
      return { row: r, score };
    })
    .filter((s) => s.score >= 0)
    .sort((a, b) => a.score - b.score || a.row.name.localeCompare(b.row.name, "cs"))
    .slice(0, 10);

  return NextResponse.json({
    results: scored.map(({ row }) => ({
      item_id: row.item_id,
      name: row.name,
      category: row.category,
      image_url: row.image_url,
      price: row.price,
    })),
  });
}
