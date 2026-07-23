"use client";

import { useCallback, useState } from "react";
import type React from "react";
import { Camera, ShoppingBag } from "lucide-react";

import { EmptyState } from "../components/OperationsUi";
import { TaskSubtypePublisher } from "./AdminForms";

type TaskCategory = "purchase" | "quote";
type TaskSubType = "detail" | "face_check" | "quote" | "quote_and_detail" | "standard";

type ActiveTrip = {
  helper_display_name?: string | null;
  id: string;
  status: string;
  trip_name: string;
};

export function TaskPublishingWizard({
  activeTrips,
  initialCategory,
  initialSubType,
  initialTripId,
}: {
  activeTrips: ActiveTrip[];
  initialCategory?: string;
  initialSubType?: string;
  initialTripId?: string;
}) {
  const [category, setCategory] = useState<TaskCategory | undefined>(() => normalizeCategory(initialCategory));
  const [selectedTripId, setSelectedTripId] = useState(initialTripId || "");
  const [subType, setSubType] = useState<TaskSubType | undefined>(() => normalizeSubType(initialCategory, initialSubType));
  const selectedTrip = activeTrips.find((trip) => trip.id === selectedTripId);

  const syncUrl = useCallback((next: {
    category?: TaskCategory;
    subType?: TaskSubType;
    tripId?: string;
  }) => {
    const params = new URLSearchParams(window.location.search);
    params.set("view", "tasks");
    if (next.category) params.set("taskCategory", next.category);
    else params.delete("taskCategory");
    if (next.subType) params.set("taskSubType", next.subType);
    else params.delete("taskSubType");
    if (next.tripId) params.set("taskTripId", next.tripId);
    else params.delete("taskTripId");
    window.history.replaceState(null, "", `/admin?${params.toString()}`);
  }, []);

  function chooseCategory(nextCategory: TaskCategory) {
    setCategory(nextCategory);
    setSelectedTripId("");
    setSubType(undefined);
    syncUrl({ category: nextCategory });
  }

  function chooseTrip(nextTripId: string) {
    setSelectedTripId(nextTripId);
    setSubType(undefined);
    syncUrl({ category, tripId: nextTripId });
  }

  return (
    <div className="grid gap-5">
      <TaskStep number="1" title="選擇任務大類">
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectionCard
            active={category === "quote"}
            body="報價、細圖，或報價＋細圖。"
            icon={<Camera className="size-5" />}
            title="報價／細圖任務"
            onClick={() => chooseCategory("quote")}
          />
          <SelectionCard
            active={category === "purchase"}
            body="一般採買或需要管理員審核的挑臉採買。"
            icon={<ShoppingBag className="size-5" />}
            title="採買任務"
            onClick={() => chooseCategory("purchase")}
          />
        </div>
      </TaskStep>

      {category ? (
        <TaskStep number="2" title="選擇正在進行中的行程">
          {activeTrips.length ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {activeTrips.map((trip) => (
                <SelectionCard
                  active={selectedTrip?.id === trip.id}
                  body={`${trip.helper_display_name || "未指派"} · 選取後選擇細任務`}
                  title={trip.trip_name}
                  key={trip.id}
                  onClick={() => chooseTrip(trip.id)}
                />
              ))}
            </div>
          ) : (
            <EmptyState body="行程啟用後才可發布任務。" title="沒有進行中的行程" />
          )}
        </TaskStep>
      ) : null}

      {category && selectedTrip ? (
        <TaskSubtypePublisher
          category={category}
          initialSubType={subType}
          key={`${category}:${selectedTrip.id}`}
          onSubTypeChange={(nextSubType) => {
            setSubType(nextSubType);
            syncUrl({ category, subType: nextSubType, tripId: selectedTrip.id });
          }}
          trip={selectedTrip}
        />
      ) : null}
    </div>
  );
}

function TaskStep({
  children,
  number,
  title,
}: {
  children: React.ReactNode;
  number: string;
  title: string;
}) {
  return (
    <section className="grid gap-3 rounded-xl border bg-card p-4 shadow-sm sm:p-5">
      <div className="flex items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
          {number}
        </span>
        <h3 className="font-semibold">{title}</h3>
      </div>
      {children}
    </section>
  );
}

function SelectionCard({
  active,
  body,
  icon,
  title,
  onClick,
}: {
  active: boolean;
  body: string;
  icon?: React.ReactNode;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={`rounded-xl border p-4 text-left shadow-sm transition ${
        active
          ? "border-primary bg-primary/5 ring-1 ring-primary"
          : "bg-card hover:border-primary/30 hover:bg-accent/40"
      }`}
      type="button"
      onClick={onClick}
    >
      <div className="flex items-center gap-2">
        {icon ? (
          <span className="flex size-9 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
            {icon}
          </span>
        ) : null}
        <p className="font-semibold">{title}</p>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{body}</p>
    </button>
  );
}

function normalizeCategory(value?: string): TaskCategory | undefined {
  return value === "quote" || value === "purchase" ? value : undefined;
}

function normalizeSubType(category?: string, value?: string): TaskSubType | undefined {
  if (category === "quote" && ["detail", "quote", "quote_and_detail"].includes(value || "")) {
    return value as TaskSubType;
  }
  if (category === "purchase" && ["standard", "face_check"].includes(value || "")) {
    return value as TaskSubType;
  }
  return undefined;
}
