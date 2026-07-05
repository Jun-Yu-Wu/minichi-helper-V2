"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Camera, ClipboardList, ShoppingBag } from "lucide-react";

import { StatusBadge } from "../components/OperationsUi";
import { useTripSectionNavigation } from "./TripSectionSwitcher";

export function ConnectionPanel({ tripId }: { tripId: string }) {
  const router = useRouter();
  const navigation = useTripSectionNavigation();
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
            icon={<Camera className="size-5" />}
            label="區塊 1"
            title="現場大圖"
          />
        </button>
        <WorkEntry
          href={`/helper?tripId=${tripId}&panel=quote`}
          icon={<ClipboardList className="size-5" />}
          label="區塊 2"
          title="細圖 / 報價"
        />
        <WorkEntry
          href={`/helper?tripId=${tripId}&panel=purchase`}
          icon={<ShoppingBag className="size-5" />}
          label="區塊 3"
          title="採買任務"
        />
      </div>
    </section>
  );
}

function WorkEntry({
  href,
  icon,
  label,
  title,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  title: string;
}) {
  return (
    <Link
      className="grid gap-3 rounded-xl border bg-card p-4 shadow-sm transition hover:border-primary/30 hover:bg-accent/40"
      href={href}
    >
      <WorkEntryContent icon={icon} label={label} title={title} />
    </Link>
  );
}

function WorkEntryContent({
  icon,
  label,
  title,
}: {
  icon: React.ReactNode;
  label: string;
  title: string;
}) {
  return (
    <>
      <span className="flex items-center justify-between gap-3">
        <span className="flex size-10 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
          {icon}
        </span>
        <StatusBadge>{label}</StatusBadge>
      </span>
      <strong className="block text-base">{title}</strong>
    </>
  );
}
