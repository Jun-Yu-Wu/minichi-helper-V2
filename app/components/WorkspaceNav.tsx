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
  variant,
}: {
  activeId: string;
  ariaLabel: string;
  items: WorkspaceNavItem[];
  variant?: "admin" | "helper";
}) {
  const isAdmin = variant === "admin";
  return (
    <nav
      aria-label={ariaLabel}
      className={cn(
        "workspace-nav sticky top-[4.2rem] z-20 -mx-4 flex snap-x gap-0 overflow-x-auto border-b bg-background px-4 py-0 sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0",
        isAdmin ? "admin-main" : "helper-main",
      )}
    >
      {items.map((item) => {
        const active = activeId === item.id;
        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={cn(
              "workspace-nav__item inline-flex h-12 shrink-0 snap-start items-center gap-2 border-b-2 border-transparent px-3.5 text-sm font-semibold transition-[background-color,color,border-color] hover:bg-secondary/70 sm:h-11",
              active
                ? "workspace-nav__item--active border-primary text-foreground"
                : "text-muted-foreground hover:text-foreground",
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
