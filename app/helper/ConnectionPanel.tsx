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
      <div>
        <p className="trip-panel-heading__kicker">Live workflow</p>
        <h3 className="mt-1 text-xl font-semibold tracking-tight">現在要做的事</h3>
        <p className="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">先處理有待回傳的區塊；完成後再回到總覽確認整趟行程。</p>
      </div>
      <div className="grid gap-3">
        <button
          className={`trip-work-entry grid gap-3 rounded-xl border p-4 text-left shadow-sm ${unfinishedCounts.site > 0 ? "trip-work-entry--priority" : ""}`}
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
            description="把現場看到的商品先完整回傳。"
          />
        </button>
        <button
          className={`trip-work-entry grid gap-3 rounded-xl border p-4 text-left shadow-sm ${unfinishedCounts.quote > 0 ? "trip-work-entry--priority" : ""}`}
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
            description="逐張完成報價或補拍細節。"
          />
        </button>
        <button
          className={`trip-work-entry grid gap-3 rounded-xl border p-4 text-left shadow-sm ${unfinishedCounts.purchase > 0 ? "trip-work-entry--priority" : ""}`}
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
            description="完成採買、部分回報或取消。"
          />
        </button>
      </div>
    </section>
  );
}

function WorkEntryContent({
  count,
  icon,
  description,
  title,
}: {
  count: number;
  description: string;
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <>
      <span className="flex items-center justify-between gap-3">
        <span className="trip-work-entry__icon flex size-10 items-center justify-center rounded-lg">
          {icon}
        </span>
        <StatusBadge tone={count > 0 ? "amber" : "neutral"}>{count}</StatusBadge>
      </span>
      <strong className="block text-base">{title}</strong>
      <span className="block text-sm leading-6 text-muted-foreground">{description}</span>
    </>
  );
}
