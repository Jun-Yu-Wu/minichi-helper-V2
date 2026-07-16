import type React from "react";

import { cn } from "@/src/lib/utils";

type Tone = "amber" | "blue" | "green" | "neutral" | "red";

const toneClasses: Record<Tone, string> = {
  amber: "border-amber-200 bg-amber-50 text-amber-900",
  blue: "border-sky-200 bg-sky-50 text-sky-900",
  green: "border-emerald-200 bg-emerald-50 text-emerald-900",
  neutral: "border-border bg-secondary text-secondary-foreground",
  red: "border-red-200 bg-red-50 text-red-900",
};

export function PageHeader({
  actions,
  eyebrow,
  metrics,
  subtitle,
  title,
}: {
  actions?: React.ReactNode;
  eyebrow?: string;
  metrics?: Array<{ label: string; value: string }>;
  subtitle?: string;
  title: string;
}) {
  return (
    <section className="rounded-xl border bg-card p-5 shadow-sm sm:p-6">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          {eyebrow ? (
            <p className="text-xs font-semibold uppercase text-muted-foreground">
              {eyebrow}
            </p>
          ) : null}
          <h2 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
            {title}
          </h2>
          {subtitle ? (
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              {subtitle}
            </p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
      </div>
      {metrics?.length ? (
        <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {metrics.map((metric) => (
            <MetricTile key={metric.label} label={metric.label} value={metric.value} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-background px-4 py-3">
      <p className="text-2xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

export function StatusBadge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: Tone;
}) {
  return (
    <span
      aria-label={typeof children === "string" ? children : undefined}
      className={cn(
        "inline-flex min-h-7 items-center rounded-full border px-2.5 py-1 text-xs font-semibold",
        toneClasses[tone],
      )}
    >
      {children}
    </span>
  );
}

export function EmptyState({
  body,
  title,
}: {
  body: string;
  title: string;
}) {
  return (
    <div aria-live="polite" className="rounded-xl border border-dashed bg-card p-5 text-sm shadow-sm" role="status">
      <p className="font-semibold text-foreground">{title}</p>
      <p className="mt-1 leading-6 text-muted-foreground">{body}</p>
    </div>
  );
}

export function InsightBanner({
  body,
  title,
  tone = "neutral",
}: {
  body?: string;
  title: string;
  tone?: Tone;
}) {
  return (
    <div className={cn("rounded-lg border p-3 text-sm", toneClasses[tone])}>
      <p className="font-semibold">{title}</p>
      {body ? <p className="mt-1 leading-6 opacity-85">{body}</p> : null}
    </div>
  );
}

export function SectionTitle({
  count,
  eyebrow,
  title,
}: {
  count?: number;
  eyebrow?: string;
  title: string;
}) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div>
        {eyebrow ? (
          <p className="text-xs font-semibold uppercase text-muted-foreground">
            {eyebrow}
          </p>
        ) : null}
        <h3 className="mt-1 text-lg font-semibold tracking-tight">{title}</h3>
      </div>
      {typeof count === "number" ? (
        <span className="text-sm text-muted-foreground">{count} 筆</span>
      ) : null}
    </div>
  );
}

export function Surface({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-xl border bg-card p-4 shadow-sm sm:p-5", className)}>
      {children}
    </section>
  );
}
