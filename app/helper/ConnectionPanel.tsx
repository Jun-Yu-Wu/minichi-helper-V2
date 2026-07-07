"use client";

import { useRouter } from "next/navigation";
import { Camera, ClipboardList, ShoppingBag } from "lucide-react";

import { StatusBadge } from "../components/OperationsUi";
import { useTripSectionNavigation } from "./TripSectionSwitcher";

export function ConnectionPanel({
  tripId,
  unfinishedCounts,
}: {
  tripId: string;
  unfinishedCounts: {
    purchase: number;
    quote: number;
    site: number;
  };
}) {
  const router = useRouter();
  const navigation = useTripSectionNavigation();
  const purchaseHref = `/helper?tripId=${tripId}&panel=purchase`;
  const quoteHref = `/helper?tripId=${tripId}&panel=quote`;
  const siteHref = `/helper?tripId=${tripId}&panel=site`;

  return (
    <section className="grid gap-3">
      <h3 className="text-lg font-semibold tracking-tight">連線工作</h3>
      <div className="grid gap-3">
        <button
          className="grid gap-3 rounded-xl border bg-card p-4 text-left shadow-sm transition hover:border-primary/30 hover:bg-accent/40"
          onClick={() => {
            if (navigation) {
              navigation.openSite();
            } else {
              router.push(siteHref);
            }
          }}
          type="button"
        >
          <WorkEntryContent
            count={unfinishedCounts.site}
            icon={<Camera className="size-5" />}
            title="現場大圖"
          />
        </button>
        <button
          className="grid gap-3 rounded-xl border bg-card p-4 text-left shadow-sm transition hover:border-primary/30 hover:bg-accent/40"
          onClick={() => {
            if (navigation) {
              navigation.openQuote();
            } else {
              router.push(quoteHref);
            }
          }}
          type="button"
        >
          <WorkEntryContent
            count={unfinishedCounts.quote}
            icon={<ClipboardList className="size-5" />}
            title="細圖 / 報價"
          />
        </button>
        <button
          className="grid gap-3 rounded-xl border bg-card p-4 text-left shadow-sm transition hover:border-primary/30 hover:bg-accent/40"
          onClick={() => {
            if (navigation) {
              navigation.openPurchase();
            } else {
              router.push(purchaseHref);
            }
          }}
          type="button"
        >
          <WorkEntryContent
            count={unfinishedCounts.purchase}
            icon={<ShoppingBag className="size-5" />}
            title="採買任務"
          />
        </button>
      </div>
    </section>
  );
}

function WorkEntryContent({
  count,
  icon,
  title,
}: {
  count: number;
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <>
      <span className="flex items-center justify-between gap-3">
        <span className="flex size-10 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
          {icon}
        </span>
        <StatusBadge tone={count > 0 ? "amber" : "neutral"}>{count}</StatusBadge>
      </span>
      <strong className="block text-base">{title}</strong>
    </>
  );
}
