import { redirect } from "next/navigation";
import type React from "react";
import {
  AlertCircle,
  CalendarDays,
  Camera,
  CheckCircle2,
  ClipboardList,
  Clock3,
  PackageSearch,
  ReceiptText,
  ShoppingBag,
  Truck,
} from "lucide-react";

import {
  arriveTripAction,
  confirmSettlementAction,
  departTripAction,
} from "../actions/helper";
import { ActionButtonForm } from "../components/ActionButtonForm";
import { SessionBar } from "../components/SessionBar";
import { Button } from "../components/ui/button";
import database from "../../src/server/database";
import service from "../../src/server/helper-app-service";
import { createR2ObjectStore } from "../../src/server/r2-object-store";
import { createServerSupabaseClient } from "../../src/server/supabase";
import { PurchaseTasks } from "./PurchaseTasks";
import { EndTripForm } from "./EndTripForm";
import { QuoteTaskReplies } from "./QuoteTaskReplies";
import { RebuyTasks } from "./RebuyTasks";
import { SitePhotoUploader } from "./SitePhotoUploader";
import { SettlementPrecheckForm, WarehouseProofForm } from "./Settlements";

type HelperSearchParams = {
  panel?: string;
  settlementId?: string;
  tripId?: string;
  view?: string;
};

type TripPanel = "overview" | "purchase" | "quote" | "site" | "status";

export default async function HelperPage({
  searchParams,
}: {
  searchParams?: Promise<HelperSearchParams>;
}) {
  const params = (await searchParams) || {};
  const view = normalizeHelperView(params.view);
  const panel = normalizeTripPanel(params.panel);
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
  const unsignedPurchaseTasksByTripId: Record<string, any[]> =
    (workspace.purchaseTasksByTripId || {}) as Record<string, any[]>;
  const operableTripIds = new Set(
    workspace.groups.inProgress
      .filter((trip: any) => trip.status === "active")
      .map((trip: any) => trip.id),
  );
  const signableBatchesByTripId = Object.fromEntries(
    Object.entries(unsignedBatchesByTripId).filter(([tripId]) => operableTripIds.has(tripId)),
  );
  const signableQuoteTasksByTripId = Object.fromEntries(
    Object.entries(unsignedQuoteTasksByTripId).filter(([tripId]) => operableTripIds.has(tripId)),
  );
  const signablePurchaseTasksByTripId = Object.fromEntries(
    Object.entries(unsignedPurchaseTasksByTripId).filter(([tripId]) => operableTripIds.has(tripId)),
  );
  const signedBatchesByTripId = await signBatchesByTripId(signableBatchesByTripId);
  const signedQuoteTasksByTripId = await signQuoteTasksByTripId(signableQuoteTasksByTripId);
  const signedPurchaseTasksByTripId = await signPurchaseTasksByTripId(signablePurchaseTasksByTripId);
  const signedSettlements = await service.attachSignedSettlementUrls(
    workspace.settlements || [],
    createR2ObjectStore(),
  );
  const signedRebuyTasks = await service.attachSignedRebuyTaskUrls(
    workspace.rebuyTasks || [],
    createR2ObjectStore(),
  );
  const selectedTrip = helperAssignedTrips(workspace).find((trip: any) => trip.id === params.tripId);
  const selectedTripCanBeOpened = Boolean(
    selectedTrip && !["ended", "canceled"].includes(selectedTrip.status),
  );

  return (
    <>
      <SessionBar email={data.user.email || ""} title={`${workspace.profile.display_name} 的工作台`} />
      <main className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-5 sm:px-5 sm:py-7">
        <HelperNav activeView={selectedTrip ? "trips" : view} />
        {selectedTrip ? (
          <TripDetail
            batches={signedBatchesByTripId[selectedTrip.id] || []}
            canOperate={selectedTripCanBeOpened}
            panel={panel}
            purchaseTasks={signedPurchaseTasksByTripId[selectedTrip.id] || []}
            quoteTasks={signedQuoteTasksByTripId[selectedTrip.id] || []}
            trip={selectedTrip}
          />
        ) : view === "trips" ? (
          <HelperTripsIndex workspace={workspace} />
        ) : view === "settlement" ? (
          <HelperSettlements selectedSettlementId={params.settlementId} settlements={signedSettlements} />
        ) : view === "rebuy" ? (
          <RebuyTasks tasks={signedRebuyTasks} />
        ) : view === "warehouse" ? (
          <HelperWarehouse settlements={signedSettlements} />
        ) : view === "issue" ? (
          <PlaceholderScreen eyebrow="Issue" title="問題回報" body="現場問題、系統問題與照片佐證會集中在這裡。" />
        ) : (
          <HelperHome
            batchesByTripId={signedBatchesByTripId}
            inProgressTrips={workspace.groups.inProgress}
            notStartedTrips={workspace.groups.notStarted}
            profileName={workspace.profile.display_name}
            quoteTasksByTripId={signedQuoteTasksByTripId}
            purchaseTasksByTripId={signedPurchaseTasksByTripId}
          />
        )}
      </main>
    </>
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
          <a href="/helper?view=settlement">返回結帳</a>
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
            <a
              className="rounded-lg border bg-card p-4 shadow-sm transition hover:border-primary/40 hover:bg-accent/35"
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
            </a>
          ))}
        </div>
      ) : (
        <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground shadow-sm">
          目前沒有{title}結帳。
        </p>
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
        <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">目前沒有待回報的送倉證明。</p>
      )}
    </section>
  );
}

function HelperHome({
  batchesByTripId,
  inProgressTrips,
  notStartedTrips,
  profileName,
  purchaseTasksByTripId,
  quoteTasksByTripId,
}: {
  batchesByTripId: Record<string, any[]>;
  inProgressTrips: any[];
  notStartedTrips: any[];
  profileName: string;
  purchaseTasksByTripId: Record<string, any[]>;
  quoteTasksByTripId: Record<string, any[]>;
}) {
  const activeTrip = inProgressTrips[0] || null;
  const primaryTrip = activeTrip || notStartedTrips[0] || null;
  const inProgressTripIds = new Set(inProgressTrips.map((trip) => trip.id));
  const inProgressBatchCount = Object.entries(batchesByTripId)
    .filter(([tripId]) => inProgressTripIds.has(tripId))
    .flatMap(([, batches]) => batches).length;
  const inProgressOpenQuoteCount = Object.entries(quoteTasksByTripId)
    .filter(([tripId]) => inProgressTripIds.has(tripId))
    .flatMap(([, tasks]) => tasks)
    .filter((task: any) => task.status !== "completed").length;
  const inProgressOpenPurchaseCount = Object.entries(purchaseTasksByTripId)
    .filter(([tripId]) => inProgressTripIds.has(tripId))
    .flatMap(([, tasks]) => tasks)
    .filter((task: any) => !["completed", "canceled", "unavailable", "not_found"].includes(task.status)).length;

  return (
    <section className="grid gap-5">
      <div className="rounded-lg border bg-card p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground">今天辛苦了</p>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
              {profileName}
            </h2>
          </div>
          <Button asChild variant="outline">
            <a href="/helper?view=trips">行程</a>
          </Button>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <DashboardMetric icon={<CalendarDays className="size-5" />} label="正在進行" value={`${inProgressTrips.length}`} />
          <DashboardMetric icon={<Clock3 className="size-5" />} label="未開始" value={`${notStartedTrips.length}`} />
          <DashboardMetric icon={<Camera className="size-5" />} label="照片批次" value={`${inProgressBatchCount}`} />
          <DashboardMetric icon={<ClipboardList className="size-5" />} label="待回覆" value={`${inProgressOpenQuoteCount}`} />
          <DashboardMetric icon={<ShoppingBag className="size-5" />} label="待採買" value={`${inProgressOpenPurchaseCount}`} />
        </div>
      </div>

      {primaryTrip ? (
        <section className="grid gap-3">
          <SectionHeader eyebrow="行程" title="下一個工作入口" />
          <TripListCard isInProgress={Boolean(activeTrip)} trip={primaryTrip} />
        </section>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <HomeShortcut
          body={activeTrip ? "行程進行中" : "等待出發"}
          href={activeTrip ? `/helper?tripId=${activeTrip.id}` : "/helper?view=trips"}
          icon={<ShoppingBag className="size-5" />}
          title="小幫手結帳"
        />
        <HomeShortcut body="尚無補買任務" href="/helper?view=rebuy" icon={<PackageSearch className="size-5" />} title="補買區" />
        <HomeShortcut body="尚無待回報" href="/helper?view=warehouse" icon={<Truck className="size-5" />} title="集運倉回報" />
        <HomeShortcut body="尚無回報" href="/helper?view=issue" icon={<AlertCircle className="size-5" />} title="問題回報" />
      </div>
    </section>
  );
}

function HelperNav({ activeView }: { activeView: string }) {
  const items = [
    ["home", "首頁", "/helper"],
    ["trips", "行程", "/helper?view=trips"],
    ["settlement", "結帳", "/helper?view=settlement"],
    ["rebuy", "補買", "/helper?view=rebuy"],
    ["warehouse", "集運倉", "/helper?view=warehouse"],
    ["issue", "問題", "/helper?view=issue"],
  ];
  return (
    <nav className="sticky top-0 z-10 -mx-4 flex gap-2 overflow-x-auto border-b bg-background/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0">
      {items.map(([id, label, href]) => (
        <a
          className={`inline-flex h-9 shrink-0 items-center rounded-full border px-4 text-sm font-medium transition ${
            activeView === id ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-accent"
          }`}
          href={href}
          key={id}
        >
          {label}
        </a>
      ))}
    </nav>
  );
}

function HelperTripsIndex({ workspace }: { workspace: any }) {
  return (
    <section className="grid gap-5">
      <SectionHeader eyebrow="Trips" title="行程" />
      <TripGroup kind="inProgress" title="正在進行" trips={workspace.groups.inProgress} />
      <TripGroup kind="notStarted" title="未開始" trips={workspace.groups.notStarted} />
      <TripGroup kind="completed" title="已完成" trips={workspace.groups.completed} />
    </section>
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

function PlaceholderScreen({ body, eyebrow, title }: { body: string; eyebrow: string; title: string }) {
  return (
    <section className="rounded-lg border bg-card p-5 shadow-sm sm:p-6">
      <p className="text-sm font-medium text-muted-foreground">{eyebrow}</p>
      <h2 className="mt-1 text-2xl font-semibold tracking-tight">{title}</h2>
      <p className="mt-3 text-sm text-muted-foreground">{body}</p>
    </section>
  );
}

function TripGroup({
  kind,
  title,
  trips,
}: {
  kind: "completed" | "inProgress" | "notStarted";
  title: string;
  trips: any[];
}) {
  return (
    <section className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold">{title}</h3>
        <span className="text-sm text-muted-foreground">{trips.length} 筆</span>
      </div>
      {trips.length === 0 ? (
        <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground shadow-sm">
          目前沒有{title}。
        </p>
      ) : (
        <div className="grid gap-3">
          {trips.map((trip) =>
            kind === "completed" ? (
              <HistoryTripCard key={trip.id} trip={trip} />
            ) : (
              <TripListCard isInProgress={kind === "inProgress"} key={trip.id} trip={trip} />
            ),
          )}
        </div>
      )}
    </section>
  );
}

function HistoryTripCard({ trip }: { trip: any }) {
  return (
    <article className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h4 className="font-semibold">{trip.trip_name}</h4>
          <p className="mt-1 text-sm text-muted-foreground">已結束 · 結帳入口</p>
        </div>
        <Button asChild size="sm" variant="outline">
          <a href="/helper?view=settlement">
            <ReceiptText className="size-4" />
            結帳
          </a>
        </Button>
      </div>
    </article>
  );
}

function TripListCard({ isInProgress, trip }: { isInProgress: boolean; trip: any }) {
  const openCount = Number(trip.summary?.openQuotes || 0) + Number(trip.summary?.openPurchases || 0);
  return (
    <a
      className="rounded-lg border bg-card p-4 shadow-sm transition hover:border-primary/40 hover:bg-accent/35 sm:p-5"
      href={`/helper?tripId=${trip.id}`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-lg font-semibold">{trip.trip_name}</h4>
            <StatusPill status={trip.status} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {service.dateOnly(trip.business_date, trip.timezone)} {trip.scheduled_time || ""} ·{" "}
            {trip.location || "未填地點"}
          </p>
        </div>
        <span className="text-sm font-medium text-muted-foreground">
          {isInProgress ? `${openCount} 待辦` : "查看"}
        </span>
      </div>
    </a>
  );
}

function TripDetail({
  batches,
  canOperate,
  panel,
  purchaseTasks,
  quoteTasks,
  trip,
}: {
  batches: any[];
  canOperate: boolean;
  panel: TripPanel;
  purchaseTasks: any[];
  quoteTasks: any[];
  trip: any;
}) {
  const canDepart = canOperate && ["draft", "scheduled"].includes(trip.status);
  const canArrive = canOperate && trip.status === "departed";
  const unfinishedPurchases = purchaseTasks.filter(
    (task) => !["completed", "canceled", "unavailable", "not_found"].includes(task.status),
  ).length;
  const unfinishedQuotes = quoteTasks.flatMap((task) => task.photos || []).filter(
    (photo: any) => ["open", "needs_review"].includes(photo.reply_status),
  ).length;
  const canEnd =
    canOperate &&
    ["departed", "arrived", "active"].includes(trip.status) &&
    unfinishedPurchases === 0;
  const canOpenWorkspace = canOperate && trip.status === "active";
  return (
    <article className="rounded-lg border bg-card p-4 shadow-sm sm:p-5">
      <Button asChild size="sm" variant="ghost">
        <a href="/helper?view=trips">返回行程</a>
      </Button>
      <div className="mt-3 grid gap-4 md:grid-cols-[1fr_auto]">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-2xl font-semibold tracking-tight">{trip.trip_name}</h2>
            <StatusPill status={trip.status} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {service.dateOnly(trip.business_date, trip.timezone)} {trip.scheduled_time || ""} ·{" "}
            {trip.location || "未填地點"} · {trip.timezone}
          </p>
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
          {canEnd ? (
            <EndTripForm expectedVersion={trip.version} tripId={trip.id} />
          ) : null}
        </div>
      </div>
      {unfinishedPurchases > 0 ? (
        <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          尚有 {unfinishedPurchases} 筆採買任務未結案，完成、取消、標記缺貨或找不到後才能結束行程。
        </p>
      ) : unfinishedQuotes > 0 && canEnd ? (
        <p className="mt-3 rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
          尚有 {unfinishedQuotes} 個報價／細節子任務未完成；可結束行程，但系統會保留警告紀錄。
        </p>
      ) : null}
      {canOpenWorkspace ? (
        <TripWorkspace batches={batches} panel={panel} purchaseTasks={purchaseTasks} quoteTasks={quoteTasks} trip={trip} />
      ) : trip.status === "ended" ? (
        <div className="mt-4 grid gap-3 rounded-lg border bg-muted/30 p-4">
          <div>
            <h3 className="font-semibold">行程已結束</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              現場任務已鎖定，請前往結帳確認商品、收據與交通費資料。
            </p>
          </div>
          <Button asChild className="w-full sm:w-fit">
            <a href="/helper?view=settlement">
              <ReceiptText className="size-4" />
              前往結帳
            </a>
          </Button>
        </div>
      ) : (
        <TripPreActiveState trip={trip} />
      )}
    </article>
  );
}

function TripPreActiveState({ trip }: { trip: any }) {
  const message =
    trip.status === "arrived"
      ? "已通知管理員，等待確認連線。"
      : trip.status === "departed"
        ? "抵達現場後回報開始連線。"
        : "出發後會進入到場流程。";
  return (
    <section className="mt-5 rounded-lg bg-muted/35 p-4">
      <p className="text-sm text-muted-foreground">{message}</p>
    </section>
  );
}

function TripWorkspace({
  batches,
  panel,
  purchaseTasks,
  quoteTasks,
  trip,
}: {
  batches: any[];
  panel: TripPanel;
  purchaseTasks: any[];
  quoteTasks: any[];
  trip: any;
}) {
  return (
    <div className="mt-5 grid gap-5 border-t pt-5">
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
        <TripStatusDashboard batches={batches} purchaseTasks={purchaseTasks} quoteTasks={quoteTasks} />
      ) : (
        <TripOverview batches={batches} purchaseTasks={purchaseTasks} quoteTasks={quoteTasks} trip={trip} />
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
    <nav className="flex gap-2 overflow-x-auto">
      {items.map(([panel, label]) => (
        <a
          className={`inline-flex h-9 shrink-0 items-center rounded-full border px-4 text-sm font-medium ${
            activePanel === panel ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-accent"
          }`}
          href={`/helper?tripId=${tripId}&panel=${panel}`}
          key={panel}
        >
          {label}
        </a>
      ))}
    </nav>
  );
}

function TripOverview({ batches, purchaseTasks, quoteTasks, trip }: { batches: any[]; purchaseTasks: any[]; quoteTasks: any[]; trip: any }) {
  const openQuotes = quoteTasks.filter((task: any) => task.status !== "completed").length;
  const openPurchases = purchaseTasks.filter((task: any) => !["completed", "canceled", "unavailable", "not_found"].includes(task.status)).length;
  return (
    <section className="grid gap-4">
      <div className="grid gap-3 rounded-lg bg-muted/35 p-4 sm:grid-cols-3">
        <InfoItem label="連線狀態" value="已開啟" />
        <InfoItem label="地點" value={trip.location || "未填地點"} />
        <InfoItem label="版本" value={`v${trip.version}`} />
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        <WorkEntry href={`/helper?tripId=${trip.id}&panel=site`} index="1" label={`${batches.length} 批`} title="現場大圖" />
        <WorkEntry href={`/helper?tripId=${trip.id}&panel=quote`} index="2" label={`${openQuotes} 待回覆`} title="細圖 / 報價任務" />
        <WorkEntry href={`/helper?tripId=${trip.id}&panel=purchase`} index="3" label={`${openPurchases} 待處理`} title="採買任務" />
      </div>
    </section>
  );
}

function TripStatusDashboard({ batches, purchaseTasks, quoteTasks }: { batches: any[]; purchaseTasks: any[]; quoteTasks: any[] }) {
  const completedQuotes = quoteTasks.filter((task: any) => task.status === "completed").length;
  const openPurchases = purchaseTasks.filter((task: any) => !["completed", "canceled", "unavailable", "not_found"].includes(task.status)).length;
  return (
    <section className="grid gap-3">
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <CheckCircle2 className="size-4" />
        連線狀態
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <DashboardMetric icon={<Camera className="size-5" />} label="大圖批次" value={`${batches.length}`} />
        <DashboardMetric icon={<ClipboardList className="size-5" />} label="報價完成" value={`${completedQuotes}/${quoteTasks.length}`} />
        <DashboardMetric icon={<ShoppingBag className="size-5" />} label="採買任務" value={`${openPurchases}/${purchaseTasks.length}`} />
      </div>
    </section>
  );
}

function WorkEntry({ href, index, label, title }: { href: string; index: string; label: string; title: string }) {
  return (
    <a className="flex items-center justify-between gap-4 rounded-lg border bg-card p-4 shadow-sm transition hover:border-primary/40 hover:bg-accent/35" href={href}>
      <span className="flex size-9 items-center justify-center rounded-md bg-secondary text-sm font-semibold text-secondary-foreground">
        {index}
      </span>
      <span className="min-w-0 flex-1">
        <strong className="block truncate">{title}</strong>
        <small className="text-muted-foreground">{label}</small>
      </span>
    </a>
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

function DashboardMetric({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border bg-background p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-muted-foreground">{icon}</span>
        <span className="text-2xl font-semibold">{value}</span>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">{label}</p>
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
    <a className="rounded-lg border bg-card p-4 shadow-sm transition hover:border-primary/40 hover:bg-accent/40" href={href}>
      <span className="flex size-10 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
        {icon}
      </span>
      <h3 className="mt-3 font-semibold">{title}</h3>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">{body}</p>
    </a>
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
    <section className="grid gap-3 rounded-lg border bg-card p-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{eyebrow}</p>
        <h5 className="mt-1 text-lg font-semibold">{title}</h5>
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

function StatusPill({ status }: { status: string }) {
  return (
    <span className="rounded-full border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground">
      {statusLabel(status)}
    </span>
  );
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
  if (["home", "trips", "settlement", "rebuy", "warehouse", "issue"].includes(value || "")) {
    return value || "home";
  }
  return "home";
}

function normalizeTripPanel(value?: string): TripPanel {
  if (value === "site" || value === "quote" || value === "purchase" || value === "status") return value;
  return "overview";
}
