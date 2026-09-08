import Link from "next/link";
import { Factory, Info } from "lucide-react";

import { ItemIcon } from "@/components/item-icon";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  getResourceProfile,
  productionDescription,
  profileCategory,
  recipeClass,
} from "@/lib/resource-profiles";

/**
 * „Firemní profil“ suroviny à la akcie (GOOGL → profil Google):
 * jak se surovina získává (výrobní budova + receptura) a co se z ní
 * dále vyrábí. Statická data z encyclopedia API – žádné dotazy za běhu.
 */
export function ItemProfile({
  itemId,
  className,
}: {
  itemId: number;
  className?: string;
}) {
  const profile = getResourceProfile(itemId);
  // Profily se generují z kompletního katalogu – při přidání nové suroviny
  // do hry stačí přegenerovat; UI pak jen mlčí (žádný rozbitý layout).
  if (!profile || !profile.producedAtName) return null;

  const description = productionDescription(profile);
  const category = profileCategory(profile);
  const recipe = recipeClass(profile);

  return (
    <div
      className={cn(
        "flex-1 min-w-[280px] max-w-xl rounded-xl border border-border/80 bg-card px-4 py-3",
        className
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Factory className="size-3.5 text-primary" aria-hidden />
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Profil suroviny
          </span>
        </div>
        {category && (
          <Badge variant="outline" className="font-mono text-[10px]">
            {category}
          </Badge>
        )}
      </div>

      <div className="mt-2 text-sm font-medium">{description}</div>

      {/* Receptura */}
      {profile.producedFrom.length > 0 && (
        <div className="mt-3 border-t border-border/60 pt-2">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Receptura (na 1 kus)
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1">
            {profile.producedFrom.map((input, idx) => (
              <span key={input.id} className="flex items-center gap-1.5">
                {idx > 0 && (
                  <span className="text-muted-foreground/60" aria-hidden>
                    +
                  </span>
                )}
                <Link
                  href={`/market/${input.id}`}
                  className="group flex items-center gap-1 rounded-md px-1 py-0.5 transition-colors hover:bg-secondary/60"
                  title={input.nameCs ?? input.name}
                >
                  <ItemIcon
                    url={`/icons/${input.id}.png`}
                    name={input.nameCs ?? input.name}
                    size={20}
                  />
                  <span className="font-mono text-xs text-foreground group-hover:underline">
                    {input.nameCs ?? input.name}
                  </span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {input.amount}×
                  </span>
                </Link>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Co se z toho vyrábí */}
      {profile.neededFor.length > 0 && (
        <div className="mt-3 border-t border-border/60 pt-2">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Vyrábí se z toho
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1">
            {profile.neededFor.slice(0, 6).map((out, idx) => (
              <span key={out.id} className="flex items-center gap-1.5">
                {idx > 0 && (
                  <span className="text-muted-foreground/60" aria-hidden>
                    ·
                  </span>
                )}
                <Link
                  href={`/market/${out.id}`}
                  className="group flex items-center gap-1 rounded-md px-1 py-0.5 transition-colors hover:bg-secondary/60"
                  title={out.name}
                >
                  <ItemIcon
                    url={`/icons/${out.id}.png`}
                    name={out.name}
                    size={20}
                  />
                  <span className="font-mono text-xs text-foreground group-hover:underline">
                    {out.name}
                  </span>
                </Link>
              </span>
            ))}
            {profile.neededFor.length > 6 && (
              <span className="font-mono text-[11px] text-muted-foreground">
                +{profile.neededFor.length - 6}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Třída složitosti výroby */}
      <div className="mt-3 flex items-center gap-1.5 border-t border-border/60 pt-2">
        <Info className="size-3 text-muted-foreground/70" aria-hidden />
        <span
          className={cn(
            "font-mono text-[11px]",
            recipe.tone === "up" && "text-up",
            recipe.tone === "down" && "text-down"
          )}
        >
          {recipe.label}
        </span>
        <span className="text-[11px] text-muted-foreground">
          · více vstupů = dražší logistika a zranitelnější řetězec
        </span>
      </div>
    </div>
  );
}
