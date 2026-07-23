import Link from "next/link";
import { Suspense } from "react";
import type React from "react";
import {
  AlertCircle,
  CalendarDays,
  CreditCard,
  MapPin,
  PackageSearch,
  ReceiptText,
  Truck,
} from "lucide-react";

import {
  arriveTripAction,
  confirmSettlementAction,
  departTripAction,
} from "../actions/helper";
import { ActionButtonForm } from "../components/ActionButtonForm";
import { BackLink } from "../components/BackButton";
import {
  EmptyState,
  InsightBanner,
  PageHeader,
  SectionTitle,
  StatusBadge,
  Surface,
} from "../components/OperationsUi";
import { Button } from "../components/ui/button";
import { getCurrentUser } from "../../src/server/current-session";
import database from "../../src/server/database";
import service from "../../src/server/helper-app-service";
import { createR2ObjectStore } from "../../src/server/r2-object-store";
import { PurchaseTasks } from "./PurchaseTasks";
import { EndTripForm } from "./EndTripForm";
import { ElapsedTripTimer } from "./ElapsedTripTimer";
import { ConnectionPanel } from "./ConnectionPanel";
import { OptimisticTripGroup } from "./OptimisticTripGroup";
import { QuoteTaskWorkspace } from "./QuoteTaskReplies";
import { RebuyTasks } from "./RebuyTasks";
import { SitePhotoBatchDetail } from "./SitePhotoBatchDetail";
import { SitePhotoWorkspace } from "./SitePhotoWorkspace";
import { SettlementPrecheckForm, WarehouseProofForm } from "./Settlements";
import { SettlementAutoRefresh } from "./SettlementAutoRefresh";
import { TripSectionSwitcher } from "./TripSectionSwitcher";
import { WaitingForActivationRefresh } from "./WaitingForActivationRefresh";

type HelperSearchParams = {
  batchId?: string;
  panel?: string;
  rebuySection?: string;
  rebuyTaskId?: string;
  settlementId?: string;
  warehouseSettlementId?: string;
  tripId?: string;
  tripGroups?: string;
  view?: string;
};

type TripPanel = "overview" | "purchase" | "quote" | "site" | "work";
type TripGroupId = "completed" | "inProgress" | "notStarted";

export default async function HelperPage({
  searchParams,
}: {
  searchParams?: Promise<HelperSearchParams>;
}) {
  const params = (await searchParams) || {};
  const user = await getCurrentUser();
  if (!user) return null;

  return (
    <Suspense fallback={<HelperPageSkeleton />}>
      <HelperPageData params={params} userId={user.id} />
    </Suspense>
  );
}

async function HelperPageData({
  params,
  userId,
}: {
  params: HelperSearchParams;
  userId: string;
}) {
  const view = normalizeHelperView(params.view);
  const panel = normalizeTripPanel(params.panel);
  const helperTripGroups =
    view === "trips" && !params.tripId
      ? parseOpenTripGroups(params.tripGroups, true)
      : [];
  const workspace = await service.getHelperWorkspace(
    database.getDatabasePool(),
    userId,
    new Date(),
    {
      sections: helperWorkspaceSections(
        view,
        panel,
        Boolean(params.tripId),
        Boolean(params.batchId),
      ),
      loadTrips: view === "home" || view === "trips" || Boolean(params.tripId),
      settlementIds:
        view === "settlement" && params.settlementId
          ? [params.settlementId]
          : view === "warehouse" && params.warehouseSettlementId
            ? [params.warehouseSettlementId]
          : null,
      settlementIncludeDetails:
        view === "settlement"
          ? Boolean(params.settlementId)
          : view === "warehouse"
            ? Boolean(params.warehouseSettlementId)
            : false,
      settlementStatuses:
        view === "warehouse"
          ? ["warehouse_pending"]
          : null,
      rebuyIncludePhotos: view === "rebuy" ? Boolean(params.rebuyTaskId) : true,
      rebuyTaskIds: view === "rebuy" && params.rebuyTaskId ? [params.rebuyTaskId] : null,
      sitePhotoBatchId:
        panel === "site" && params.batchId ? params.batchId : null,
      tripIds: params.tripId ? [params.tripId] : null,
      tripStatuses:
        view === "trips" && !params.tripId
          ? tripStatusesForGroups(helperTripGroups)
          : null,
    },
  );
  if (!workspace.profile) {
    return <Notice title="尚未建立小幫手資料" body="請聯絡管理員建立並綁定你的 helper profile。" />;
  }

  if (!workspace.profile.is_active) {
    return <Notice title="帳號目前停用" body="你可以登入，但暫時不能查看或操作任何行程。" />;
  }

  const unsignedBatchesByTripId: Record<string, any[]> =
    (workspace.sitePhotoBatchesByTripId || {}) as Record<string, any[]>;
  const tripSummariesByTripId: Record<string, any> =
    (workspace.tripSummariesByTripId || {}) as Record<string, any>;
  const selectedTrip = helperAssignedTrips(workspace).find((trip: any) => trip.id === params.tripId);
  const selectedTripCanBeOpened = Boolean(
    selectedTrip && !["ended", "canceled"].includes(selectedTrip.status),
  );
  const shouldSignSettlementMedia =
    (view === "settlement" && Boolean(params.settlementId)) ||
    view === "warehouse";
  const signedSettlements = shouldSignSettlementMedia
    ? await service.attachSignedSettlementUrls(
        workspace.settlements || [],
        createR2ObjectStore(),
      )
    : workspace.settlements || [];
  const signedRebuyTasks = view === "rebuy" && Boolean(params.rebuyTaskId)
    ? await service.attachSignedRebuyTaskUrls(
        workspace.rebuyTasks || [],
        createR2ObjectStore(),
      )
    : workspace.rebuyTasks || [];

  return selectedTrip ? (
    <TripDetail
      batches={unsignedBatchesByTripId[selectedTrip.id] || []}
      selectedBatchId={params.batchId}
      canOperate={selectedTripCanBeOpened}
      panel={panel}
      summary={tripSummariesByTripId[selectedTrip.id] || {}}
      trip={selectedTrip}
    />
  ) : view === "trips" ? (
    <HelperTripsIndex openGroups={helperTripGroups} workspace={workspace} />
  ) : view === "settlement" ? (
    <HelperSettlements selectedSettlementId={params.settlementId} settlements={signedSettlements} />
  ) : view === "rebuy" ? (
    <RebuyTasks rebuySection={normalizeRebuySection(params.rebuySection)} selectedTaskId={params.rebuyTaskId} tasks={signedRebuyTasks} />
  ) : view === "warehouse" ? (
    <HelperWarehouse selectedSettlementId={params.warehouseSettlementId} settlements={signedSettlements} />
  ) : (
    <HelperHome
      inProgressTrips={workspace.groups.inProgress}
      notStartedTrips={workspace.groups.notStarted}
      profileName={workspace.profile.display_name}
      tripSummariesByTripId={tripSummariesByTripId}
    />
  );
}

function HelperPageSkeleton() {
  return (
    <div aria-label="正在載入工作台" className="grid gap-4" role="status">
      <div className="h-28 animate-pulse rounded-xl border bg-muted" />
      <div className="h-48 animate-pulse rounded-xl border bg-muted" />
      <div className="h-36 animate-pulse rounded-xl border bg-muted" />
    </div>
  );
}

function HelperSettlements({
  selectedSettlementId,
  settlements,
}: {
  selectedSettlementId?: string;
  settlements: any[];
}) {
  const selectedSettlement = settlements.find((settlement) => settlement.id === selectedSettlementId);
  if (selectedSettlement) {
    const waitingForRate =
      selectedSettlement.status === "pending_helper_precheck" &&
      Number(selectedSettlement.jpy_to_twd_rate || 0) <= 0;
    return (
      <section className="grid gap-4">
        <div className="flex items-center justify-between gap-3">
          <BackLink href="/helper?view=settlement" label="返回結帳" />
          <StatusBadge tone={selectedSettlement.status === "completed" ? "green" : "blue"}>
            {settlementStageLabel(selectedSettlement)}
          </StatusBadge>
        </div>
        <h2 className="text-2xl font-semibold tracking-tight">{selectedSettlement.trip_name}</h2>
        <SettlementAutoRefresh
          settlementId={selectedSettlement.id}
          settlements={[selectedSettlement]}
        />
        {waitingForRate ? (
          <InsightBanner
            body="管理員填入當日 JPY→TWD 匯率後，這筆結帳會自動移到進行中，屆時再進行初次檢查。"
            title="等待管理員填入當日匯率"
            tone="amber"
          />
        ) : (
          <InsightBanner
            body={helperSettlementNextStep(selectedSettlement.status)}
            title="你現在需要做什麼"
            tone={selectedSettlement.status === "correction_required" ? "red" : "blue"}
          />
        )}
        {!waitingForRate ? <div className="grid gap-2">
          <SettlementPrecheckForm settlement={selectedSettlement} />
          {selectedSettlement.status === "pending_helper_confirmation" ? (
            <ActionButtonForm
              action={confirmSettlementAction}
              fields={[{ name: "settlementId", value: selectedSettlement.id }]}
              label="確認結帳金額並等待付款"
              pendingLabel="確認中..."
            />
          ) : null}
        </div> : null}
      </section>
    );
  }
  const inProgressStatuses = new Set([
    "pending_helper_precheck",
    "pending_admin_review",
    "correction_required",
    "pending_helper_confirmation",
    "payment_pending",
    "warehouse_pending",
    "warehouse_review_pending",
    "final_payment_pending",
  ]);
  const notStarted = settlements.filter(
    (settlement) =>
      settlement.status === "pending_helper_precheck" &&
      Number(settlement.jpy_to_twd_rate || 0) <= 0,
  );
  const inProgress = settlements
    .filter(
      (settlement) =>
        inProgressStatuses.has(settlement.status) &&
        !notStarted.some((record) => record.id === settlement.id),
    )
    .sort((a, b) => Number(needsHelperAction(b)) - Number(needsHelperAction(a)));
  const completed = settlements.filter((settlement) => settlement.status === "completed");
  return (
    <Surface className="grid gap-4">
      <SettlementAutoRefresh settlements={settlements} />
      <SettlementGroup settlements={notStarted} title="未開始" />
      <SettlementGroup settlements={inProgress} title="進行中" />
      <SettlementGroup settlements={completed} title="已完成" />
    </Surface>
  );
}

function SettlementGroup({
  hrefForSettlement = (settlement) => `/helper?view=settlement&settlementId=${encodeURIComponent(settlement.id)}`,
  settlements,
  title,
}: {
  hrefForSettlement?: (settlement: any) => string;
  settlements: any[];
  title: string;
}) {
  return (
    <section className="grid gap-2">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <span className="text-xs font-medium text-muted-foreground">{settlements.length} 筆</span>
      </div>
      {settlements.length ? (
        <div className="grid gap-2">
          {settlements.map((settlement) => (
            <Link
              className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-foreground/20 hover:bg-accent/30 ${
                settlement.status === "completed"
                  ? "border-emerald-200 bg-emerald-50/60"
                  : "bg-background"
              }`}
              href={hrefForSettlement(settlement)}
              key={settlement.id}
            >
              <span className="min-w-0">
                <strong className="block truncate text-base">{settlement.trip_name}</strong>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <StatusBadge tone={settlement.status === "completed" ? "green" : settlement.status.includes("payment") ? "amber" : "blue"}>
                  {settlementStageLabel(settlement)}
                </StatusBadge>
                {needsHelperAction(settlement) ? (
                  <span
                    aria-label="需要你處理"
                    className="inline-flex size-7 items-center justify-center rounded-full bg-amber-100 text-base font-bold text-amber-800"
                    title="需要你處理"
                  >
                    !
                  </span>
                ) : null}
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
          目前沒有{title}結帳。
        </p>
      )}
    </section>
  );
}

function HelperWarehouse({ selectedSettlementId, settlements }: { selectedSettlementId?: string; settlements: any[] }) {
  const waiting = settlements.filter((settlement) => settlement.status === "warehouse_pending");
  const selectedSettlement = waiting.find((settlement) => settlement.id === selectedSettlementId);
  if (selectedSettlement) {
    return (
      <section className="grid gap-4">
        <BackLink href="/helper?view=warehouse" label="返回集運回報" />
        <SectionHeader eyebrow="集運回報" title={selectedSettlement.trip_name} />
        <InsightBanner body="請上傳商品送去集運的照片，送出後會交由管理員審核。" title="回報送去集運的照片" tone="amber" />
        <WarehouseProofForm settlement={selectedSettlement} />
      </section>
    );
  }
  return (
    <section className="grid gap-4">
      <SectionHeader eyebrow="集運倉" title="集運倉回報" />
      <SettlementGroup
        hrefForSettlement={(settlement) => `/helper?view=warehouse&warehouseSettlementId=${encodeURIComponent(settlement.id)}`}
        settlements={waiting}
        title="需要回報"
      />
    </section>
  );
}

function HelperHome({
  inProgressTrips,
  notStartedTrips,
  profileName,
  tripSummariesByTripId,
}: {
  inProgressTrips: any[];
  notStartedTrips: any[];
  profileName: string;
  tripSummariesByTripId: Record<string, any>;
}) {
  const activeTrip = inProgressTrips.find((trip) => trip.status === "active") || null;
  const preActiveTrips = inProgressTrips.filter((trip) => trip.status !== "active");
  const primaryTrip = activeTrip || inProgressTrips[0] || notStartedTrips[0] || null;
  const inProgressTripIds = new Set(inProgressTrips.map((trip) => trip.id));
  const inProgressSummaries = Object.entries(tripSummariesByTripId)
    .filter(([tripId]) => inProgressTripIds.has(tripId))
    .map(([, summary]) => summary);
  const inProgressBatchCount = inProgressSummaries.reduce(
    (total, summary) => total + Number(summary.site_photo_batch_count || 0),
    0,
  );
  const nextAction = activeTrip
    ? {
        title: activeTrip.trip_name,
      }
    : primaryTrip
      ? {
          title: primaryTrip.trip_name,
        }
      : null;

  return (
    <section className="grid gap-5">
      <PageHeader
        eyebrow="Helper Home"
        metrics={[
          { label: "正在進行", value: `${inProgressTrips.length}` },
          { label: "未開始", value: `${notStartedTrips.length}` },
          { label: "待開通", value: `${preActiveTrips.length}` },
          { label: "照片批次", value: `${inProgressBatchCount}` },
        ]}
        subtitle="先處理正在進行的行程；結帳、補買與集運回報會在下方保留入口。"
        title={`${profileName}，現在要做的事`}
      />

      {nextAction ? (
        <Surface className="grid gap-4">
          <div>
            <h3 className="text-xl font-semibold tracking-tight">{nextAction.title}</h3>
            {primaryTrip ? <TripMiniFacts trip={primaryTrip} /> : null}
          </div>
        </Surface>
      ) : (
        <EmptyState title="目前沒有行程" body="新的行程被指派後，這裡會顯示下一步工作入口。" />
      )}

      <section className="grid gap-3">
        <SectionTitle eyebrow="Shortcuts" title="其他工作入口" />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <HomeShortcut body="查看進行中與歷史結帳。" href="/helper?view=settlement" icon={<CreditCard className="size-5" />} title="行程結帳" />
          <HomeShortcut body="接公開補買或回報自己的補買。" href="/helper?view=rebuy" icon={<PackageSearch className="size-5" />} title="補買區" />
          <HomeShortcut body="付款後回報送達集運倉照片。" href="/helper?view=warehouse" icon={<Truck className="size-5" />} title="集運倉回報" />
          <UnavailableShortcut
            body="回報流程尚未納入新系統；緊急狀況請先直接聯絡管理員。"
            icon={<AlertCircle className="size-5" />}
            title="問題回報"
          />
        </div>
      </section>
    </section>
  );
}

function HelperTripsIndex({
  openGroups,
  workspace,
}: {
  openGroups: TripGroupId[];
  workspace: any;
}) {
  const openSet = new Set(openGroups);
  return (
    <section className="grid gap-5">
      <SectionTitle eyebrow="Trips" title="行程" />
      <TripGroup
        isOpen={openSet.has("inProgress")}
        kind="inProgress"
        openGroups={openGroups}
        title="正在進行"
        trips={workspace.groups.inProgress}
      />
      <TripGroup
        isOpen={openSet.has("notStarted")}
        kind="notStarted"
        openGroups={openGroups}
        title="未開始"
        trips={workspace.groups.notStarted}
      />
      <TripGroup
        isOpen={openSet.has("completed")}
        kind="completed"
        openGroups={openGroups}
        title="已完成"
        trips={workspace.groups.completed}
      />
    </section>
  );
}

function Notice({ body, title }: { body: string; title: string }) {
  return (
    <main className="mx-auto grid w-full max-w-xl gap-3 px-5 py-10">
      <div className="rounded-xl border bg-card p-5 shadow-sm">
        <h2 className="text-xl font-semibold">{title}</h2>
        <p className="mt-2 text-muted-foreground">{body}</p>
      </div>
    </main>
  );
}

function TripGroup({
  isOpen,
  kind,
  openGroups,
  title,
  trips,
}: {
  isOpen: boolean;
  kind: "completed" | "inProgress" | "notStarted";
  openGroups: TripGroupId[];
  title: string;
  trips: any[];
}) {
  return (
    <OptimisticTripGroup
        href={helperTripGroupsHref(toggleTripGroup(openGroups, kind))}
        isOpen={isOpen}
        title={title}
    >
      {isOpen && trips.length === 0 ? (
        <EmptyState title={`目前沒有${title}`} body="有新的指派或狀態變更後會出現在這裡。" />
      ) : (
        <div className="grid gap-3">
          {trips.map((trip) =>
            kind === "completed" ? (
              <HistoryTripCard key={trip.id} trip={trip} />
            ) : (
              <TripListCard key={trip.id} trip={trip} />
            ),
          )}
        </div>
      )}
    </OptimisticTripGroup>
  );
}

function HistoryTripCard({ trip }: { trip: any }) {
  return (
    <article className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h4 className="font-semibold">{trip.trip_name}</h4>
          <p className="mt-1 text-sm text-muted-foreground">已結束 · 結帳入口</p>
        </div>
        <Button asChild size="sm" variant="outline">
          <Link href="/helper?view=settlement">
            <ReceiptText className="size-4" />
            結帳
          </Link>
        </Button>
      </div>
    </article>
  );
}

function TripListCard({ trip }: { trip: any }) {
  return (
    <Link
      className="rounded-xl border bg-card p-4 shadow-sm transition hover:border-primary/30 hover:bg-accent/40 sm:p-5"
      href={`/helper?tripId=${trip.id}`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-lg font-semibold">{trip.trip_name}</h4>
            <StatusPill status={trip.status} />
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            <CalendarDays className="size-4" />
            <span>{service.dateOnly(trip.business_date, trip.timezone)} {trip.scheduled_time || ""}</span>
            <MapPin className="size-4" />
            <span>{trip.location || "未填地點"}</span>
          </p>
        </div>
      </div>
    </Link>
  );
}

function TripDetail({
  batches,
  canOperate,
  panel,
  selectedBatchId,
  summary,
  trip,
}: {
  batches: any[];
  canOperate: boolean;
  panel: TripPanel;
  selectedBatchId?: string;
  summary: any;
  trip: any;
}) {
  const canDepart = canOperate && ["draft", "scheduled"].includes(trip.status);
  const canArrive = canOperate && trip.status === "departed";
  const unfinishedPurchases = Number(summary.unfinished_purchase_count || 0);
  const canOpenWorkspace = canOperate && trip.status === "active";
  if (trip.status === "ended") {
    return (
      <article className="grid gap-4">
        <ReturnToTripsButton />
        <Surface className="grid gap-3">
          <StatusBadge tone="green">已完成</StatusBadge>
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">{trip.trip_name}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              現場任務已鎖定，請前往結帳確認商品、收據與交通費資料。
            </p>
          </div>
          <Button asChild className="w-full sm:w-fit">
            <Link href="/helper?view=settlement">
              <ReceiptText className="size-4" />
              前往結帳
            </Link>
          </Button>
        </Surface>
      </article>
    );
  }

  if (!canOpenWorkspace) {
    return (
      <article className="grid gap-4">
        <ReturnToTripsButton />
        <TripPreActiveState
          canArrive={canArrive}
          canDepart={canDepart}
          trip={trip}
        />
      </article>
    );
  }

  return (
    <article className="grid gap-4">
      <TripWorkspace
        batches={batches}
        panel={panel}
        selectedBatchId={selectedBatchId}
        summary={summary}
        trip={trip}
      />
    </article>
  );
}

function ReturnToTripsButton() {
  return (
    <BackLink
      className="border-border/80 bg-background shadow-sm"
      href="/helper?view=trips"
      label="返回行程列表"
      variant="outline"
    />
  );
}

function TripPreActiveState({
  canArrive,
  canDepart,
  trip,
}: {
  canArrive: boolean;
  canDepart: boolean;
  trip: any;
}) {
  const message =
    trip.status === "arrived"
      ? "已通知管理員，等待確認連線。"
      : trip.status === "departed"
        ? "抵達現場後回報開始連線。"
        : "出發後會進入到場流程。";
  return (
    <Surface className="grid gap-4">
      <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-start">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">{trip.trip_name}</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{message}</p>
          <TripMiniFacts trip={trip} />
        </div>
      </div>
      {trip.departed_at ? (
        <ElapsedTripTimer startedAt={trip.departed_at} />
      ) : null}
      <div className="grid gap-2 rounded-lg bg-muted/45 p-3 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">操作提醒</p>
        <p>
          出發與抵達由小幫手回報；抵達後需管理員確認，才會開啟照片、報價與採買工作區。
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
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
      {trip.status === "arrived" ? (
        <WaitingForActivationRefresh
          initialStatus={trip.status}
          initialUpdatedAt={trip.updated_at}
          initialVersion={trip.version}
          tripId={trip.id}
        />
      ) : null}
    </Surface>
  );
}

function TripWorkspace({
  batches,
  panel,
  selectedBatchId,
  summary,
  trip,
}: {
  batches: any[];
  panel: TripPanel;
  selectedBatchId?: string;
  summary: any;
  trip: any;
}) {
  const unfinishedPurchases = Number(summary.unfinished_purchase_count || 0);
  const overviewPanel = (
    <TripOverview
      canEnd={unfinishedPurchases === 0}
      summary={summary}
      trip={trip}
    />
  );
  const connectionPanel = (
    <ConnectionPanel
      tripId={trip.id}
      unfinishedCounts={{
        purchase: Number(summary.unfinished_purchase_count || 0),
        quote: Number(summary.unfinished_quote_photo_count || 0),
        site: 0,
      }}
    />
  );
  const chrome = <ActiveTripChrome trip={trip} />;
  const workChrome = <ReturnToTripsButton />;
  const purchasePanel = <PurchaseTasks tripId={trip.id} />;
  const quotePanel = <QuoteTaskWorkspace tripId={trip.id} />;
  const sitePanel = (
    <SitePhotoWorkspace
      initialBatches={panel === "site" ? batches : undefined}
      tripId={trip.id}
    />
  );

  if (panel === "overview") {
    return (
      <TripSectionSwitcher
        chrome={chrome}
        connection={connectionPanel}
        detail={purchasePanel}
        hideChromeInDetail
        hideNavInDetail
        initialSection="overview"
        key={panel}
        overview={overviewPanel}
        quote={quotePanel}
        site={sitePanel}
        workChrome={workChrome}
      />
    );
  }

  if (panel === "work") {
    return (
      <TripSectionSwitcher
        chrome={chrome}
        connection={connectionPanel}
        detail={purchasePanel}
        hideChromeInDetail
        hideNavInDetail
        initialSection="work"
        key={panel}
        overview={overviewPanel}
        quote={quotePanel}
        site={sitePanel}
        workChrome={workChrome}
      />
    );
  }

  const detailPanel =
    panel === "site" ? (
      selectedBatchId ? (
        <WorkspaceBlock eyebrow="區塊一" title="現場大圖">
          <SitePhotoBatchDetail batchId={selectedBatchId} tripId={trip.id} />
        </WorkspaceBlock>
      ) : (
        sitePanel
      )
    ) : (
      purchasePanel
    );

  return (
    <TripSectionSwitcher
      chrome={chrome}
      connection={connectionPanel}
      detail={detailPanel}
      hideChromeInDetail={panel === "site" || panel === "quote" || panel === "purchase"}
      hideNavInDetail={panel === "purchase" || panel === "site"}
      initialSection={panel === "quote" ? "quote" : "detail"}
      key={panel}
      overview={overviewPanel}
      quote={quotePanel}
      site={sitePanel}
      workChrome={workChrome}
    />
  );
}

function ActiveTripChrome({ trip }: { trip: any }) {
  return (
    <>
      <ReturnToTripsButton />
      <Surface className="grid gap-3">
        <div>
          <StatusBadge tone="green">連線中</StatusBadge>
        </div>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">{trip.trip_name}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {service.dateOnly(trip.business_date, trip.timezone)} {trip.scheduled_time || ""}
            {" · "}
            {trip.location || "未填地點"}
          </p>
        </div>
      </Surface>
    </>
  );
}

function TripOverview({
  canEnd,
  summary,
  trip,
}: {
  canEnd: boolean;
  summary: any;
  trip: any;
}) {
  const batchCount = Number(summary.site_photo_batch_count || 0);
  const quoteTaskCount = Number(summary.quote_task_count || 0);
  const openQuotes = Number(
    summary.unfinished_quote_task_count ?? summary.open_quote_task_count ?? 0,
  );
  const completedQuoteTasks = Number(
    summary.completed_quote_task_count ?? Math.max(quoteTaskCount - openQuotes, 0),
  );
  const purchaseTaskCount = Number(summary.purchase_task_count || 0);
  const openPurchases = Number(summary.unfinished_purchase_count || 0);
  const completedPurchases = Math.max(purchaseTaskCount - openPurchases, 0);
  return (
    <section className="grid gap-3">
      <Surface className="grid gap-3">
        <div className="grid gap-2 text-sm">
          <CompactStatusLine label="現場照片" value={`${batchCount} 批`} />
          <CompactStatusLine
            label="細圖/報價"
            urgent={openQuotes > 0}
            value={`${completedQuoteTasks}/${quoteTaskCount || 0} 完成`}
          />
          <CompactStatusLine
            label="採買任務"
            urgent={openPurchases > 0}
            value={`${completedPurchases}/${purchaseTaskCount || 0} 完成`}
          />
        </div>
      </Surface>
      <TripEndGate
        canEnd={canEnd}
        expectedVersion={trip.version}
        tripId={trip.id}
        unfinishedPurchases={openPurchases}
      />
    </section>
  );
}

function TripEndGate({
  canEnd,
  expectedVersion,
  tripId,
  unfinishedPurchases,
}: {
  canEnd: boolean;
  expectedVersion: number;
  tripId: string;
  unfinishedPurchases: number;
}) {
  if (!canEnd) {
    return (
      <Surface className="grid gap-3 border-amber-200 bg-amber-50/70">
        <div className="flex items-start gap-2 text-amber-950">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold">還不能結束行程</p>
            <p className="mt-1 text-xs leading-5">
              尚有 {unfinishedPurchases} 筆採買未結案。待採買、挑臉待審、挑臉待小幫手確認都必須先完成或取消。
            </p>
          </div>
        </div>
        <Button asChild className="w-full">
          <Link href={`/helper?tripId=${encodeURIComponent(tripId)}&panel=purchase`}>
            前往採買任務
          </Link>
        </Button>
      </Surface>
    );
  }
  return (
    <EndTripForm expectedVersion={expectedVersion} tripId={tripId} />
  );
}

function CompactStatusLine({
  label,
  urgent = false,
  value,
}: {
  label: string;
  urgent?: boolean;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={urgent ? "font-semibold text-amber-700" : "font-semibold"}>
        {value}
      </span>
    </div>
  );
}

function chineseBatchNumber(value: number) {
  const digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  if (value <= 10) return value === 10 ? "十" : digits[value] || String(value);
  if (value < 20) return `十${digits[value % 10]}`;
  if (value < 100) {
    const remainder = value % 10;
    return `${digits[Math.floor(value / 10)]}十${remainder ? digits[remainder] : ""}`;
  }
  return String(value);
}

function HomeShortcut({
  body,
  href,
  icon,
  title,
}: {
  body: string;
  href: string;
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <Link className="rounded-xl border bg-card p-4 shadow-sm transition hover:border-primary/30 hover:bg-accent/40" href={href}>
      <span className="flex size-10 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
        {icon}
      </span>
      <h3 className="mt-3 font-semibold">{title}</h3>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">{body}</p>
    </Link>
  );
}

function UnavailableShortcut({
  body,
  icon,
  title,
}: {
  body: string;
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <div
      aria-disabled="true"
      className="grid gap-4 rounded-xl border border-dashed bg-muted/35 p-4 text-muted-foreground"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="flex size-10 items-center justify-center rounded-lg bg-background text-foreground">
          {icon}
        </span>
        <StatusBadge tone="neutral">尚未開放</StatusBadge>
      </div>
      <div>
        <h3 className="font-semibold text-foreground">{title}</h3>
        <p className="mt-1 text-sm leading-6">{body}</p>
      </div>
    </div>
  );
}

function SectionHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div>
      <p className="text-sm font-medium text-muted-foreground">{eyebrow}</p>
      <h2 className="mt-1 text-2xl font-semibold tracking-tight">{title}</h2>
    </div>
  );
}

function WorkspaceBlock({
  children,
  eyebrow,
  title,
}: {
  children: React.ReactNode;
  eyebrow: string;
  title: string;
}) {
  return (
    <section className="grid gap-4 rounded-xl border bg-card p-4 shadow-sm sm:p-5">
      <div>
        <p className="text-xs font-semibold uppercase text-muted-foreground">{eyebrow}</p>
        <h5 className="mt-1 text-xl font-semibold tracking-tight">{title}</h5>
      </div>
      {children}
    </section>
  );
}

function TripMiniFacts({ trip }: { trip: any }) {
  return (
    <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1">
        <CalendarDays className="size-3.5" />
        {service.dateOnly(trip.business_date, trip.timezone)} {trip.scheduled_time || ""}
      </span>
      <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1">
        <MapPin className="size-3.5" />
        {trip.location || "未填地點"}
      </span>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone = status === "active" ? "green" : status === "arrived" ? "amber" : status === "canceled" ? "red" : "neutral";
  return <StatusBadge tone={tone}>{statusLabel(status)}</StatusBadge>;
}

function statusLabel(status: string) {
  if (status === "draft" || status === "scheduled") return "未開始";
  if (["departed", "arrived", "active"].includes(status)) return "正在進行";
  if (status === "ended") return "已完成";
  if (status === "canceled") return "已取消";
  return status;
}

function settlementStatusLabel(status: string) {
  const labels: Record<string, string> = {
    completed: "已完成",
    correction_required: "待補正",
    final_payment_pending: "待尾款",
    payment_pending: "待付款",
    pending_admin_review: "管理員審核中",
    pending_helper_confirmation: "最終確認",
    pending_helper_precheck: "初次檢查",
    warehouse_pending: "集運回報",
    warehouse_review_pending: "送倉審核中",
  };
  return labels[status] || status;
}

function settlementStageLabel(settlement: any) {
  if (
    settlement.status === "pending_helper_precheck" &&
    Number(settlement.jpy_to_twd_rate || 0) <= 0
  ) {
    return "等待管理員匯率";
  }
  if (["pending_admin_review", "correction_required"].includes(settlement.status)) {
    return "管理員審核";
  }
  if (settlement.status === "pending_helper_confirmation") return "最終確認";
  if (["payment_pending", "final_payment_pending"].includes(settlement.status)) return "等待匯款";
  if (["warehouse_pending", "warehouse_review_pending"].includes(settlement.status)) return "集運回報";
  return settlementStatusLabel(settlement.status);
}

function needsHelperAction(settlement: any) {
  if (
    settlement.status === "pending_helper_precheck" &&
    Number(settlement.jpy_to_twd_rate || 0) <= 0
  ) {
    return false;
  }
  return ["pending_helper_precheck", "correction_required", "pending_helper_confirmation", "warehouse_pending"].includes(settlement.status);
}

function helperSettlementNextStep(status: string) {
  const steps: Record<string, string> = {
    completed: "結帳與送倉流程已完成，可隨時回來查看紀錄。",
    correction_required: "依管理員的補正內容更新收據、交通費或說明後重新送出。",
    final_payment_pending: "尾款由管理員處理中，不需要重複操作。",
    payment_pending: "管理員正在安排付款，資料有更新時此頁會自動同步。",
    pending_admin_review: "資料已送出，等待管理員審核金額。",
    pending_helper_confirmation: "請核對結帳總額，確認無誤後送出。",
    pending_helper_precheck: "確認商品、上傳每日收據，並填寫交通費申請。",
    warehouse_pending: "款項已處理，請到集運倉回報上傳送達證明。",
    warehouse_review_pending: "送倉證明已送出，等待管理員審核。",
  };
  return steps[status] || "查看最新結帳狀態與下一步。";
}

async function signPurchaseTasksByTripId(purchaseTasksByTripId: Record<string, any[]>) {
  const tasks = Object.values(purchaseTasksByTripId).flat();
  if (!tasks.length) return {};
  const signed = await service.attachSignedPurchaseTaskUrls(tasks, createR2ObjectStore());
  return signed.reduce((groups: Record<string, any[]>, task: any) => {
    if (!groups[task.trip_id]) groups[task.trip_id] = [];
    groups[task.trip_id].push(task);
    return groups;
  }, {});
}

function helperAssignedTrips(workspace: any) {
  return [
    ...(workspace.groups?.inProgress || []),
    ...(workspace.groups?.notStarted || []),
    ...(workspace.groups?.completed || []),
  ];
}

function normalizeHelperView(value?: string) {
  if (["home", "trips", "settlement", "rebuy", "warehouse"].includes(value || "")) {
    return value || "home";
  }
  return "home";
}

function normalizeRebuySection(value?: string) {
  if (value === "public" || value === "mine") return value;
  return undefined;
}

function normalizeTripPanel(value?: string): TripPanel {
  if (value === "site" || value === "quote" || value === "purchase" || value === "work") return value;
  return "overview";
}

function parseOpenTripGroups(value?: string, defaultInProgress = false): TripGroupId[] {
  if (value === "none") return [];
  const groups = (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter((item): item is TripGroupId =>
      item === "completed" || item === "inProgress" || item === "notStarted",
    );
  const unique = Array.from(new Set(groups));
  if (!unique.length && defaultInProgress) return ["inProgress"];
  return unique;
}

function toggleTripGroup(groups: TripGroupId[], group: TripGroupId) {
  const open = new Set(groups);
  if (open.has(group)) {
    open.delete(group);
  } else {
    open.add(group);
  }
  return Array.from(open);
}

function helperTripGroupsHref(groups: TripGroupId[]) {
  const params = new URLSearchParams({ view: "trips" });
  params.set("tripGroups", groups.length ? groups.join(",") : "none");
  return `/helper?${params.toString()}`;
}

function tripStatusesForGroups(groups: TripGroupId[]) {
  const statuses = new Set<string>();
  for (const group of groups) {
    if (group === "completed") statuses.add("ended");
    if (group === "notStarted") {
      statuses.add("draft");
      statuses.add("scheduled");
    }
    if (group === "inProgress") {
      statuses.add("departed");
      statuses.add("arrived");
      statuses.add("active");
    }
  }
  return Array.from(statuses);
}

function helperWorkspaceSections(
  view: string,
  panel: TripPanel,
  hasSelectedTrip: boolean,
  hasSelectedBatch: boolean,
) {
  if (hasSelectedTrip) {
    return [
      ...(["overview", "work", "quote", "purchase"].includes(panel)
        ? ["tripSummaries"]
        : []),
      ...(panel === "site" && !hasSelectedBatch ? ["sitePhotoBatches"] : []),
    ];
  }
  if (view === "settlement" || view === "warehouse") return ["settlements"];
  if (view === "rebuy") return ["rebuyTasks"];
  if (view === "home") return ["tripSummaries"];
  return [];
}
