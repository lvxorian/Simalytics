"use client";

import { useState, useTransition } from "react";
import { Star } from "lucide-react";

import { toggleWatchlistAction } from "@/app/actions";
import { cn } from "@/lib/utils";

export function StarButton({
  itemId,
  watched: initialWatched,
  size = "md",
}: {
  itemId: number;
  watched: boolean;
  size?: "sm" | "md";
}) {
  const [watched, setWatched] = useState(initialWatched);
  const [pending, startTransition] = useTransition();

  return (
    <button
      onClick={() =>
        startTransition(async () => {
          const next = await toggleWatchlistAction(itemId);
          setWatched(next);
        })
      }
      disabled={pending}
      aria-label={
        watched ? "Odebrat z watchlistu" : "Přidat do watchlistu"
      }
      title={watched ? "Odebrat z watchlistu" : "Přidat do watchlistu"}
      className={cn(
        "rounded-md transition-colors hover:bg-secondary disabled:opacity-40",
        size === "sm" ? "p-1" : "p-1.5",
        watched
          ? "text-primary"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      <Star
        className={cn("shrink-0", size === "sm" ? "size-3.5" : "size-5", watched && "fill-primary")}
      />
    </button>
  );
}
