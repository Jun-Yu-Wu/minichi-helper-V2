"use client";

import type React from "react";
import Link from "next/link";

import { cn } from "@/src/lib/utils";

type WorkspaceNavItem = {
  href: string;
  icon: React.ReactNode;
  id: string;
  label: string;
};

export function WorkspaceNav({
  activeId,
  ariaLabel,
  items,
}: {
  activeId: string;
  ariaLabel: string;
  items: WorkspaceNavItem[];
}) {
  return (
    <nav
      aria-label={ariaLabel}
      className="sticky top-0 z-10 -mx-4 flex snap-x gap-1 overflow-x-auto border-b bg-background/95 px-4 py-2 shadow-[0_1px_0_hsl(var(--border))] backdrop-blur sm:static sm:mx-0 sm:rounded-xl sm:border sm:bg-card sm:p-1 sm:shadow-sm"
    >
      {items.map((item) => {
        const active = activeId === item.id;
        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex h-11 shrink-0 snap-start items-center gap-2 rounded-lg px-3 text-sm font-semibold transition sm:h-10",
              active
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
            href={item.href}
            key={item.id}
          >
            <span aria-hidden="true">{item.icon}</span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
