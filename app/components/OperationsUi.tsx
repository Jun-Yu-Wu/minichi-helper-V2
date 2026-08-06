import type React from "react";
import { AlertCircle, CheckCircle2, Info } from "lucide-react";

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
    <section className="page-header relative overflow-hidden p-1 pb-7 sm:p-2 sm:pb-8">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          {eyebrow ? (
            <p className="text-xs font-semibold tracking-wide text-muted-foreground">
              {eyebrow}
            </p>
          ) : null}
          <h2 className="mt-2 text-3xl font-semibold tracking-[-0.04em] sm:text-5xl">
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
        <div className="page-header__metrics mt-7 grid grid-cols-2 gap-y-4 pt-5 sm:grid-cols-4 sm:gap-y-0">
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
    <div className="metric-tile px-4 first:border-l-0 sm:first:border-l-0">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="data-type mt-1 text-2xl font-semibold tracking-tight">{value}</p>
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
        "inline-flex min-h-7 items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold",
        toneClasses[tone],
      )}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current opacity-70" />
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
    <div aria-live="polite" className="empty-state rounded-xl bg-secondary/55 p-6 text-sm" role="status">
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
  const Icon = tone === "red" ? AlertCircle : tone === "green" ? CheckCircle2 : Info;
  return (
    <div className={cn("flex gap-3 rounded-xl border p-3.5 text-sm", toneClasses[tone])}>
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div>
        <p className="font-semibold">{title}</p>
        {body ? <p className="mt-1 leading-6 opacity-85">{body}</p> : null}
      </div>
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
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {eyebrow}
          </p>
        ) : null}
        <h3 className="mt-1 text-xl font-semibold tracking-[-0.02em]">{title}</h3>
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
    <section className={cn("surface rounded-2xl border bg-card p-4 sm:p-5", className)}>
      {children}
    </section>
  );
}
