import postgres from "postgres";

/**
 * Připojení k PostgreSQL (Neon) přes postgres.js.
 *
 * – Používej POOLED connection string z Neonu (host končí na `-pooler`),
 *   proto je `prepare: false` (kompatibilita s PgBouncerem).
 * – V dev režimu cacheuje jedno spojení přes globalThis, aby Next.js HMR
 *   neotvíral nové připojení při každém reloadu.
 */

const globalForDb = globalThis as unknown as {
  __simalyticsSql?: postgres.Sql;
};

export function getDb(): postgres.Sql {
  if (globalForDb.__simalyticsSql) return globalForDb.__simalyticsSql;

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "Chybí DATABASE_URL. Viz .env.example – vlož connection string z Neon Console."
    );
  }

  const sql = postgres(url, {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false, // nutné pro Neon pooled connection (PgBouncer)
  });

  globalForDb.__simalyticsSql = sql;
  return sql;
}
