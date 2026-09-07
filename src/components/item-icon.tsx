import Image from "next/image";

import { itemImageUrl } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Ikona komodity s konzistentním "mince" stylem (pozadí + jemný rám)
 * napříč celou appkou – ticker je výjimka, tam se styl potlačí přes
 * `bare` (čistý produkt, jak na běžících burzových listách).
 */
export function ItemIcon({
  url,
  name,
  size = 32,
  bare = false,
  className,
}: {
  url: string | null | undefined;
  name: string;
  size?: number;
  bare?: boolean;
  className?: string;
}) {
  const src = itemImageUrl(url);

  if (!src) {
    return (
      <div
        aria-hidden
        style={{ width: size, height: size }}
        className={cn(
          "shrink-0",
          !bare && "rounded-lg bg-secondary ring-1 ring-inset ring-white/5",
          className
        )}
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
      className={cn(
        "shrink-0 object-contain",
        !bare &&
          "rounded-lg bg-secondary/80 object-contain p-1 ring-1 ring-inset ring-white/5",
        className
      )}
    />
  );
}
