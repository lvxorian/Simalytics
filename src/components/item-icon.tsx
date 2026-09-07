import Image from "next/image";

import { itemImageUrl } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Ikona komodity – čistá, bez rámečku/pozadí, aby nevynikla "krabička"
 * ale samotný produkt (ticker, tabulky, karty, grafy). Lokální soubory
 * z public/icons.
 */
export function ItemIcon({
  url,
  name,
  size = 32,
  className,
}: {
  url: string | null | undefined;
  name: string;
  size?: number;
  className?: string;
}) {
  const src = itemImageUrl(url);

  if (!src) {
    return (
      <div
        aria-hidden
        style={{ width: size, height: size }}
        className={cn("shrink-0", className)}
      />
    );
  }

  return (
    <Image
      src={src}
      alt={name}
      width={size}
      height={size}
      style={{ width: size, height: size }}
      className={cn("shrink-0 object-contain", className)}
    />
  );
}
