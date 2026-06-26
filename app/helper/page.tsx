import { redirect } from "next/navigation";

import { arriveTripAction, departTripAction } from "../actions/helper";
import { ActionButtonForm } from "../components/ActionButtonForm";
import { SessionBar } from "../components/SessionBar";
import database from "../../src/server/database";
import service from "../../src/server/helper-app-service";
import { createR2ObjectStore } from "../../src/server/r2-object-store";
import { createServerSupabaseClient } from "../../src/server/supabase";
import { QuoteTaskReplies } from "./QuoteTaskReplies";
import { SitePhotoUploader } from "./SitePhotoUploader";

export default async function HelperPage() {
  const authClient = await createServerSupabaseClient();
  const { data, error } = await authClient.auth.getUser();
  if (error || !data?.user) redirect("/login?next=/helper");

  const workspace = await service.getHelperWorkspace(
    database.getDatabasePool(),
    data.user.id,
  );
  if (!workspace.profile) {
    return (
      <>
        <SessionBar email={data.user.email || ""} title="小幫手工作台" />
        <Notice title="尚未建立小幫手資料" body="請聯絡管理員建立並綁定你的 helper profile。" />
      </>
    );
  }

  if (!workspace.profile.is_active) {
    return (
      <>
        <SessionBar email={data.user.email || ""} title="小幫手工作台" />
        <Notice title="帳號目前停用" body="你可以登入，但暫時不能查看或操作任何行程。" />
      </>
    );
  }

  const unsignedBatchesByTripId: Record<string, any[]> =
    (workspace.sitePhotoBatchesByTripId || {}) as Record<string, any[]>;
  const unsignedQuoteTasksByTripId: Record<string, any[]> =
    (workspace.quoteTasksByTripId || {}) as Record<string, any[]>;
  const operableTripIds = new Set(
    workspace.groups.today
      .filter((trip: any) => trip.status === "active")
      .map((trip: any) => trip.id),
  );
  const signableBatchesByTripId = Object.fromEntries(
    Object.entries(unsignedBatchesByTripId).filter(([tripId]) => operableTripIds.has(tripId)),
  );
  const signableQuoteTasksByTripId = Object.fromEntries(
    Object.entries(unsignedQuoteTasksByTripId).filter(([tripId]) => operableTripIds.has(tripId)),
  );
  const signedBatchesByTripId = await signBatchesByTripId(signableBatchesByTripId);
  const signedQuoteTasksByTripId = await signQuoteTasksByTripId(signableQuoteTasksByTripId);

  return (
    <>
      <SessionBar email={data.user.email || ""} title={`${workspace.profile.display_name} 的工作台`} />
      <main className="mx-auto grid w-full max-w-5xl gap-6 px-5 py-6">
        <TripGroup
          batchesByTripId={signedBatchesByTripId}
          kind="today"
          quoteTasksByTripId={signedQuoteTasksByTripId}
          title="今日行程"
          trips={workspace.groups.today}
        />
        <TripGroup
          batchesByTripId={signedBatchesByTripId}
          kind="upcoming"
          quoteTasksByTripId={signedQuoteTasksByTripId}
          title="即將到來"
          trips={workspace.groups.upcoming}
        />
        <TripGroup
          batchesByTripId={signedBatchesByTripId}
          kind="history"
          quoteTasksByTripId={signedQuoteTasksByTripId}
          title="歷史行程"
          trips={workspace.groups.history}
        />
      </main>
    </>
  );
}

function Notice({ body, title }: { body: string; title: string }) {
  return (
    <main className="mx-auto grid w-full max-w-xl gap-3 px-5 py-10">
      <div className="rounded-lg border bg-card p-5">
        <h2 className="text-xl font-semibold">{title}</h2>
        <p className="mt-2 text-muted-foreground">{body}</p>
      </div>
    </main>
  );
}

function TripGroup({
  batchesByTripId,
  kind,
  quoteTasksByTripId,
  title,
  trips,
}: {
  batchesByTripId: Record<string, any[]>;
  kind: "history" | "today" | "upcoming";
  quoteTasksByTripId: Record<string, any[]>;
  title: string;
  trips: any[];
}) {
  return (
    <section className="grid gap-3">
      <h2 className="text-xl font-semibold">{title}</h2>
      {trips.length === 0 ? (
        <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
          目前沒有{title}。
        </p>
      ) : (
        <div className="grid gap-3">
          {trips.map((trip) =>
            kind === "history" ? (
              <HistoryTripCard key={trip.id} trip={trip} />
            ) : (
              <TripCard
                batches={batchesByTripId[trip.id] || []}
                isToday={kind === "today"}
                key={trip.id}
                quoteTasks={quoteTasksByTripId[trip.id] || []}
                trip={trip}
              />
            ),
          )}
        </div>
      )}
    </section>
  );
}

function HistoryTripCard({ trip }: { trip: any }) {
  return (
    <article className="rounded-lg border bg-card p-4">
      <h3 className="font-semibold">{trip.trip_name}</h3>
    </article>
  );
}

function TripCard({
  batches,
  isToday,
  quoteTasks,
  trip,
}: {
  batches: any[];
  isToday: boolean;
  quoteTasks: any[];
  trip: any;
}) {
  const canOperate = isToday;
  const canDepart = canOperate && trip.status === "scheduled";
  const canArrive = canOperate && trip.status === "departed";
  const canUploadSitePhotos = canOperate && trip.status === "active";
  return (
    <article className="rounded-lg border bg-card p-4">
      <div className="grid gap-3 md:grid-cols-[1fr_auto]">
        <div>
          <h3 className="font-semibold">{trip.trip_name}</h3>
          <p className="text-sm text-muted-foreground">
            {service.dateOnly(trip.business_date, trip.timezone)} {trip.scheduled_time || ""} ·{" "}
            {trip.location || "未填地點"} · {trip.timezone}
          </p>
          <p className="mt-2 text-sm">
            狀態 <span className="font-medium">{trip.status}</span> · version {trip.version}
          </p>
          {trip.status === "arrived" ? (
            <p className="mt-2 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
              已抵達，等待管理員確認 active。
            </p>
          ) : null}
          {trip.status === "active" ? (
            <p className="mt-2 rounded-md bg-accent px-3 py-2 text-sm">
              Active workspace：可以上傳現場照片批次並回覆詢價/細節任務。
            </p>
          ) : null}
        </div>
        <div className="flex items-start gap-2">
          {canDepart ? (
            <ActionButtonForm
              action={departTripAction}
              fields={[
                { name: "tripId", value: trip.id },
                { name: "expectedVersion", value: trip.version },
              ]}
              label="標記出發"
            />
          ) : null}
          {canArrive ? (
            <ActionButtonForm
              action={arriveTripAction}
              fields={[
                { name: "tripId", value: trip.id },
                { name: "expectedVersion", value: trip.version },
              ]}
              label="標記抵達"
            />
          ) : null}
        </div>
      </div>
      {canUploadSitePhotos ? (
        <div className="mt-4 grid gap-4 border-t pt-4">
          <SitePhotoUploader tripId={trip.id} />
          <SubmittedBatches batches={batches} />
          <QuoteTaskReplies tasks={quoteTasks} />
        </div>
      ) : null}
    </article>
  );
}

function SubmittedBatches({ batches }: { batches: any[] }) {
  if (!batches.length) {
    return (
      <p className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
        尚未送出現場照片批次。
      </p>
    );
  }
  return (
    <div className="grid gap-3">
      <h4 className="font-semibold">已送出的照片批次</h4>
      {batches.map((batch) => (
        <div key={batch.id} className="rounded-md border bg-background p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">
              {new Date(batch.created_at).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}
            </p>
            <p className="text-xs text-muted-foreground">{batch.photos.length} 張照片</p>
          </div>
          {batch.note ? <p className="mt-1 text-sm text-muted-foreground">{batch.note}</p> : null}
          <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
            {batch.photos.map((photo: any) => (
              <a key={photo.id} href={photo.signed_url} target="_blank" rel="noreferrer">
                <img
                  alt={photo.original_filename || "site photo"}
                  className="aspect-square w-full rounded-md object-cover"
                  src={photo.signed_url}
                />
              </a>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

async function signBatchesByTripId(batchesByTripId: Record<string, any[]>) {
  const batches = Object.values(batchesByTripId).flat();
  if (!batches.length) return {};
  const signed = await service.attachSignedPhotoUrls(batches, createR2ObjectStore());
  return signed.reduce((groups: Record<string, any[]>, batch: any) => {
    if (!groups[batch.trip_id]) groups[batch.trip_id] = [];
    groups[batch.trip_id].push(batch);
    return groups;
  }, {});
}

async function signQuoteTasksByTripId(quoteTasksByTripId: Record<string, any[]>) {
  const tasks = Object.values(quoteTasksByTripId).flat();
  if (!tasks.length) return {};
  const signed = await service.attachSignedQuoteTaskUrls(tasks, createR2ObjectStore());
  return signed.reduce((groups: Record<string, any[]>, task: any) => {
    if (!groups[task.trip_id]) groups[task.trip_id] = [];
    groups[task.trip_id].push(task);
    return groups;
  }, {});
}
