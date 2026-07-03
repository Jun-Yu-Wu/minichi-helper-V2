import { redirect } from "next/navigation";
import Link from "next/link";
import type React from "react";
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
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
import {
  EmptyState,
  InsightBanner,
  MetricTile,
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
import { OptimisticTripGroup } from "./OptimisticTripGroup";
import { QuoteTaskReplies } from "./QuoteTaskReplies";
import { RebuyTasks } from "./RebuyTasks";
import { SitePhotoUploader } from "./SitePhotoUploader";
import { SettlementPrecheckForm, WarehouseProofForm } from "./Settlements";
import { WaitingForActivationRefresh } from "./WaitingForActivationRefresh";

type HelperSearchParams = {
  panel?: string;
  settlementId?: string;
  tripId?: string;
  tripGroups?: string;
  view?: string;
};

type TripPanel = "overview" | "purchase" | "quote" | "site" | "status";
type TripGroupId = "completed" | "inProgress" | "notStarted";

export default async function HelperPage({
  searchParams,
}: {
  searchParams?: Promise<HelperSearchParams>;
}) {
  const params = (await searchParams) || {};
  const view = normalizeHelperView(params.view);
  const panel = normalizeTripPanel(params.panel);
  const helperTripGroups =
    view === "trips" && !params.tripId
      ? parseOpenTripGroups(params.tripGroups, true)
      : [];
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/helper");

  const workspace = await service.getHelperWorkspace(
    database.getDatabasePool(),
    user.id,
    new Date(),
    {
      sections: helperWorkspaceSections(view, panel, Boolean(params.tripId)),
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
  const unsignedQuoteTasksByTripId: Record<string, any[]> =
    (workspace.quoteTasksByTripId || {}) as Record<string, any[]>;
  const unsignedPurchaseTasksByTripId: Record<string, any[]> =
    (workspace.purchaseTasksByTripId || {}) as Record<string, any[]>;
  const tripSummariesByTripId: Record<string, any> =
    (workspace.tripSummariesByTripId || {}) as Record<string, any>;
  const selectedTrip = helperAssignedTrips(workspace).find((trip: any) => trip.id === params.tripId);
  const selectedTripCanBeOpened = Boolean(
    selectedTrip && !["ended", "canceled"].includes(selectedTrip.status),
  );
  const shouldSignTripMedia = Boolean(selectedTrip?.status === "active");
  const signedBatchesByTripId =
    shouldSignTripMedia && panel === "site"
      ? await signBatchesByTripId(unsignedBatchesByTripId)
      : unsignedBatchesByTripId;
  const signedQuoteTasksByTripId =
    shouldSignTripMedia && panel === "quote"
      ? await signQuoteTasksByTripId(unsignedQuoteTasksByTripId)
      : unsignedQuoteTasksByTripId;
  const signedPurchaseTasksByTripId =
    shouldSignTripMedia && panel === "purchase"
      ? await signPurchaseTasksByTripId(unsignedPurchaseTasksByTripId)
      : unsignedPurchaseTasksByTripId;
  const signedSettlements = ["settlement", "warehouse"].includes(view)
    ? await service.attachSignedSettlementUrls(
        workspace.settlements || [],
        createR2ObjectStore(),
      )
    : workspace.settlements || [];
  const signedRebuyTasks = view === "rebuy"
    ? await service.attachSignedRebuyTaskUrls(
        workspace.rebuyTasks || [],
        createR2ObjectStore(),
      )
    : workspace.rebuyTasks || [];

  return selectedTrip ? (
    <TripDetail
      batches={signedBatchesByTripId[selectedTrip.id] || []}
      canOperate={selectedTripCanBeOpened}
      panel={panel}
      purchaseTasks={signedPurchaseTasksByTripId[selectedTrip.id] || []}
      quoteTasks={signedQuoteTasksByTripId[selectedTrip.id] || []}
      summary={tripSummariesByTripId[selectedTrip.id] || {}}
      trip={selectedTrip}
    />
  ) : view === "trips" ? (
    <HelperTripsIndex openGroups={helperTripGroups} workspace={workspace} />
  ) : view === "settlement" ? (
    <HelperSettlements selectedSettlementId={params.settlementId} settlements={signedSettlements} />
  ) : view === "rebuy" ? (
    <RebuyTasks tasks={signedRebuyTasks} />
  ) : view === "warehouse" ? (
    <HelperWarehouse settlements={signedSettlements} />
  ) : (
    <HelperHome
      inProgressTrips={workspace.groups.inProgress}
      notStartedTrips={workspace.groups.notStarted}
      profileName={workspace.profile.display_name}
      tripSummariesByTripId={tripSummariesByTripId}
    />
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
    return (
      <section className="grid gap-4">
        <Button asChild size="sm" variant="ghost">
          <Link href="/helper?view=settlement">返回結帳</Link>
        </Button>
        <SectionHeader eyebrow="小幫手結帳" title={selectedSettlement.trip_name} />
        <div className="grid gap-2">
          <SettlementPrecheckForm settlement={selectedSettlement} />
          {selectedSettlement.status === "pending_helper_confirmation" ? (
            <form action={confirmSettlementAction}>
              <input name="settlementId" type="hidden" value={selectedSettlement.id} />
              <Button type="submit">確認結帳金額並等待付款</Button>
            </form>
          ) : null}
        </div>
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
  const inProgress = settlements.filter((settlement) => inProgressStatuses.has(settlement.status));
  const completed = settlements.filter((settlement) => settlement.status === "completed");
  return (
    <section className="grid gap-5">
      <SectionHeader eyebrow="小幫手結帳" title="行程結帳" />
      <SettlementGroup settlements={inProgress} title="進行中" />
      <SettlementGroup settlements={completed} title="已完成" />
    </section>
  );
}

function SettlementGroup({ settlements, title }: { settlements: any[]; title: string }) {
  return (
    <section className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold">{title}</h3>
        <span className="text-sm text-muted-foreground">{settlements.length} 筆</span>
      </div>
      {settlements.length ? (
        <div className="grid gap-3">
          {settlements.map((settlement) => (
            <Link
              className="rounded-xl border bg-card p-4 shadow-sm transition hover:border-primary/30 hover:bg-accent/40"
              href={`/helper?view=settlement&settlementId=${encodeURIComponent(settlement.id)}`}
              key={settlement.id}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h4 className="font-semibold">{settlement.trip_name}</h4>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {service.dateOnly(settlement.business_date, settlement.timezone)} · {settlementStatusLabel(settlement.status)}
                  </p>
                </div>
                <span className="text-sm font-medium text-muted-foreground">
                  {settlement.total_payable_twd !== null ? `TWD ${settlement.total_payable_twd}` : "待匯率"}
                </span>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState title={`目前沒有${title}結帳`} body="需要處理的結帳會依狀態出現在這裡。" />
      )}
    </section>
  );
}

function HelperWarehouse({ settlements }: { settlements: any[] }) {
  const waiting = settlements.filter((settlement) => settlement.status === "warehouse_pending");
  return (
    <section className="grid gap-4">
      <SectionHeader eyebrow="集運倉" title="集運倉回報" />
      {waiting.length ? waiting.map((settlement) => (
        <WarehouseProofForm key={settlement.id} settlement={settlement} />
      )) : (
        <EmptyState title="目前沒有待回報的送倉證明" body="付款後需要送倉回報時，系統會在這裡顯示。" />
      )}
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
  purchaseTasks,
  quoteTasks,
  summary,
  trip,
}: {
  batches: any[];
  canOperate: boolean;
  panel: TripPanel;
  purchaseTasks: any[];
  quoteTasks: any[];
  summary: any;
  trip: any;
}) {
  const canDepart = canOperate && ["draft", "scheduled"].includes(trip.status);
  const canArrive = canOperate && trip.status === "departed";
  const unfinishedPurchases = Number(summary.unfinished_purchase_count || 0);
  const unfinishedQuotes = Number(summary.unfinished_quote_photo_count || 0);
  const canEnd =
    canOperate &&
    ["departed", "arrived", "active"].includes(trip.status) &&
    unfinishedPurchases === 0;
  const canOpenWorkspace = canOperate && trip.status === "active";
  const actions = (
    <>
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
      {canEnd ? <EndTripForm expectedVersion={trip.version} tripId={trip.id} /> : null}
    </>
  );
  if (trip.status === "ended") {
    return (
      <article className="grid gap-4">
        <Button asChild className="w-fit" size="sm" variant="ghost">
          <Link href="/helper?view=trips">返回行程</Link>
        </Button>
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
        <Button asChild className="w-fit" size="sm" variant="ghost">
          <Link href="/helper?view=trips">返回行程</Link>
        </Button>
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
      <Button asChild className="w-fit" size="sm" variant="ghost">
        <Link href="/helper?view=trips">返回行程</Link>
      </Button>
      <PageHeader
        actions={actions}
        eyebrow="Trip Workspace"
        metrics={[
          { label: "報價/細節待處理", value: `${unfinishedQuotes}` },
          { label: "採買未結案", value: `${unfinishedPurchases}` },
          { label: "行程版本", value: `v${trip.version}` },
        ]}
        subtitle={`${service.dateOnly(trip.business_date, trip.timezone)} ${trip.scheduled_time || ""} · ${
          trip.location || "未填地點"
        } · ${trip.timezone}`}
        title={trip.trip_name}
      />
      {unfinishedPurchases > 0 ? (
        <InsightBanner
          body="完成、取消、標記缺貨或找不到後才能結束行程。"
          title={`尚有 ${unfinishedPurchases} 筆採買任務未結案`}
          tone="red"
        />
      ) : unfinishedQuotes > 0 && canEnd ? (
        <InsightBanner
          body="可以結束行程，但系統會保留警告紀錄。"
          title={`尚有 ${unfinishedQuotes} 個報價/細節子任務未完成`}
          tone="amber"
        />
      ) : null}
      <TripWorkspace
        batches={batches}
        panel={panel}
        purchaseTasks={purchaseTasks}
        quoteTasks={quoteTasks}
        summary={summary}
        trip={trip}
      />
    </article>
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
        <WaitingForActivationRefresh />
      ) : null}
    </Surface>
  );
}

function TripWorkspace({
  batches,
  panel,
  purchaseTasks,
  quoteTasks,
  summary,
  trip,
}: {
  batches: any[];
  panel: TripPanel;
  purchaseTasks: any[];
  quoteTasks: any[];
  summary: any;
  trip: any;
}) {
  return (
    <div className="grid gap-5">
      <TripPanelNav activePanel={panel} tripId={trip.id} />
      {panel === "site" ? (
        <WorkspaceBlock eyebrow="區塊一" title="現場大圖">
          <SitePhotoUploader tripId={trip.id} />
          <SubmittedBatches batches={batches} />
        </WorkspaceBlock>
      ) : panel === "quote" ? (
        <WorkspaceBlock eyebrow="區塊二" title="細圖 / 報價任務">
          <QuoteTaskReplies tasks={quoteTasks} />
        </WorkspaceBlock>
      ) : panel === "purchase" ? (
        <WorkspaceBlock eyebrow="區塊三" title="採買任務">
          <PurchaseTasks tasks={purchaseTasks} />
        </WorkspaceBlock>
      ) : panel === "status" ? (
        <TripStatusDashboard summary={summary} />
      ) : (
        <TripOverview summary={summary} trip={trip} />
      )}
    </div>
  );
}

function TripPanelNav({ activePanel, tripId }: { activePanel: string; tripId: string }) {
  const items = [
    ["overview", "行程首頁"],
    ["status", "狀態"],
    ["site", "現場大圖"],
    ["quote", "細圖/報價"],
    ["purchase", "採買"],
  ];
  return (
    <nav className="flex gap-2 overflow-x-auto rounded-xl border bg-card p-1">
      {items.map(([panel, label]) => (
        <Link
          className={`inline-flex h-9 shrink-0 items-center rounded-lg px-3 text-sm font-semibold ${
            activePanel === panel ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"
          }`}
          href={`/helper?tripId=${tripId}&panel=${panel}`}
          key={panel}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}

function TripOverview({ summary, trip }: { summary: any; trip: any }) {
  const batchCount = Number(summary.site_photo_batch_count || 0);
  const openQuotes = Number(summary.open_quote_task_count || 0);
  const openPurchases = Number(summary.unfinished_purchase_count || 0);
  return (
    <section className="grid gap-4">
      <div className="grid gap-3 rounded-xl border bg-card p-4 shadow-sm sm:grid-cols-2">
        <InfoItem label="地點" value={trip.location || "未填地點"} />
        <InfoItem label="版本" value={`v${trip.version}`} />
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        <WorkEntry href={`/helper?tripId=${trip.id}&panel=site`} index="1" label={`${batchCount} 批`} title="現場大圖" />
        <WorkEntry href={`/helper?tripId=${trip.id}&panel=quote`} index="2" label={`${openQuotes} 待回覆`} title="細圖 / 報價任務" />
        <WorkEntry href={`/helper?tripId=${trip.id}&panel=purchase`} index="3" label={`${openPurchases} 待處理`} title="採買任務" />
      </div>
    </section>
  );
}

function TripStatusDashboard({ summary }: { summary: any }) {
  const batchCount = Number(summary.site_photo_batch_count || 0);
  const quoteTaskCount = Number(summary.quote_task_count || 0);
  const openQuoteCount = Number(summary.open_quote_task_count || 0);
  const purchaseTaskCount = Number(summary.purchase_task_count || 0);
  const openPurchases = Number(summary.unfinished_purchase_count || 0);
  return (
    <section className="grid gap-3">
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <CheckCircle2 className="size-4" />
        連線狀態
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <MetricTile label="大圖批次" value={`${batchCount}`} />
        <MetricTile label="報價完成" value={`${quoteTaskCount - openQuoteCount}/${quoteTaskCount}`} />
        <MetricTile label="採買未結案" value={`${openPurchases}/${purchaseTaskCount}`} />
      </div>
    </section>
  );
}

function WorkEntry({ href, index, label, title }: { href: string; index: string; label: string; title: string }) {
  return (
    <Link className="flex items-center justify-between gap-4 rounded-xl border bg-card p-4 shadow-sm transition hover:border-primary/30 hover:bg-accent/40" href={href}>
      <span className="flex size-9 items-center justify-center rounded-lg bg-secondary text-sm font-semibold text-secondary-foreground">
        {index}
      </span>
      <span className="min-w-0 flex-1">
        <strong className="block truncate">{title}</strong>
        <small className="text-muted-foreground">{label}</small>
      </span>
    </Link>
  );
}

function SubmittedBatches({ batches }: { batches: any[] }) {
  if (!batches.length) {
    return <EmptyState title="尚未送出現場照片批次" body="小幫手送出照片後，這裡會保留本行程已提交的批次。" />;
  }
  return (
    <div className="grid gap-3">
      {batches.map((batch) => (
        <div key={batch.id} className="rounded-lg border bg-background p-3">
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

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-sm font-medium">{value}</p>
    </div>
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
    pending_helper_confirmation: "待確認",
    pending_helper_precheck: "待預檢",
    warehouse_pending: "待送倉回報",
    warehouse_review_pending: "送倉審核中",
  };
  return labels[status] || status;
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

function normalizeTripPanel(value?: string): TripPanel {
  if (value === "site" || value === "quote" || value === "purchase" || value === "status") return value;
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

function helperWorkspaceSections(view: string, panel: TripPanel, hasSelectedTrip: boolean) {
  if (hasSelectedTrip) {
    return [
      "tripSummaries",
      ...(panel === "quote" ? ["quoteTasks"] : []),
      ...(panel === "purchase" ? ["purchaseTasks"] : []),
      ...(panel === "site" || panel === "overview" || panel === "status"
        ? ["sitePhotoBatches"]
        : []),
    ];
  }
  if (view === "settlement" || view === "warehouse") return ["settlements"];
  if (view === "rebuy") return ["rebuyTasks"];
  if (view === "home") return ["tripSummaries"];
  return [];
}
