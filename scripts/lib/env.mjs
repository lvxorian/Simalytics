/**
 * Přečte proměnnou z .env.local (bez závislosti na dotenv balíku).
 * scripts/, které potřebují připojení k DB, ji používají společně.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

export function readEnvLocal(key) {
  try {
    const raw = readFileSync(path.resolve(".env.local"), "utf8");
    const match = raw.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+)$`, "m"));
    if (!match) return null;
    return match[1].trim().replace(/^["']|["']$/g, "");
  } catch {
    return null;
  }
}
