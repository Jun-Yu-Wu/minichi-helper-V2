import { redirect } from "next/navigation";
import Link from "next/link";
import type React from "react";
import {
  CalendarDays,
  Camera,
  ClipboardList,
  CreditCard,
  Home,
  MapPin,
  Merge,
  PackageSearch,
  Radio,
  ShoppingBag,
  UserRound,
} from "lucide-react";

import {
  activateTripAction,
  approveStagingMergeJobAction,
  cancelTripAction,
  deactivateHelperAction,
  editReviewedStagingOrderAction,
  editReviewedStagingOrderPhotosAction,
  mergeApprovedStagingJobAction,
  prepareStagingReviewAction,
  recordSettlementPaymentAction,
  rejectStagingMergeJobAction,
  reviewSettlementAction,
  reviewWarehouseProofAction,
  saveSitePhotoAction,
  setSettlementExchangeRateAction,
  reviewFaceCheckPurchaseAction,
} from "../actions/admin";
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
import { getCurrentAdmin } from "../../src/server/current-session";
import database from "../../src/server/database";
import service from "../../src/server/helper-app-service";
import { createR2ObjectStore } from "../../src/server/r2-object-store";
import {
  CreateHelperForm,
  CreatePurchaseTaskForm,
  CreateQuoteTaskForm,
  CreateRebuyTaskForm,
  CreateTripForm,
  EditHelperForm,
  QuickPublishPurchaseForm,
  RepairTripForm,
} from "./AdminForms";

type AdminSearchParams = {
  helperId?: string;
  helperMode?: string;
  liveTripId?: string;
  mainSection?: string;
  taskCategory?: string;
  taskSubType?: string;
  taskTripId?: string;
  tripGroup?: string;
  tripGroups?: string;
  view?: string;
};

type TripGroupId = "completed" | "inProgress" | "notStarted";

export default async function AdminPage({
  searchParams,
}: {
  searchParams?: Promise<AdminSearchParams>;
}) {
  const params = (await searchParams) || {};
  const activeView = normalizeAdminView(params.view);
  const adminMainOpenTripGroups =
    activeView === "main" && params.mainSection === "trips"
      ? parseOpenTripGroups(params.tripGroups ?? params.tripGroup, true)
      : [];
  try {
    await getCurrentAdmin();
  } catch {
    redirect("/login?next=/admin");
  }

  const [dashboard, customerNicknames] = await Promise.all([
    service.listAdminDashboard(database.getDatabasePool(), {
      sections: adminDashboardSections(activeView, params.mainSection),
      tripStatuses:
        activeView === "main" && params.mainSection === "trips"
          ? tripStatusesForGroups(adminMainOpenTripGroups)
          : ["live", "tasks"].includes(activeView)
            ? ["active"]
            : null,
      workflowTripIds:
        activeView === "live"
          ? params.liveTripId
            ? [params.liveTripId]
            : []
          : activeView === "tasks"
            ? params.taskTripId
              ? [params.taskTripId]
              : []
            : null,
    }),
    activeView === "rebuy" ||
    (activeView === "live" && Boolean(params.liveTripId)) ||
    (activeView === "tasks" &&
      params.taskCategory === "purchase" &&
      Boolean(params.taskTripId))
      ? service.listCustomerNicknames(database.getDatabasePool())
      : Promise.resolve([]),
  ]);
  const sitePhotoBatches = ["live", "tasks"].includes(activeView) && dashboard.sitePhotoBatches.length
    ? await service.attachSignedPhotoUrls(
        dashboard.sitePhotoBatches,
        createR2ObjectStore(),
      )
    : [];
  const quoteTasks = activeView === "live" && dashboard.quoteTasks.length
    ? await service.attachSignedQuoteTaskUrls(
        dashboard.quoteTasks,
        createR2ObjectStore(),
      )
    : [];
  const purchaseTasks = activeView === "live" && dashboard.purchaseTasks.length
    ? await service.attachSignedPurchaseTaskUrls(
        dashboard.purchaseTasks,
        createR2ObjectStore(),
      )
    : dashboard.purchaseTasks;
  const settlements = activeView === "checkout" && dashboard.settlements.length
    ? await service.attachSignedSettlementUrls(
        dashboard.settlements,
        createR2ObjectStore(),
      )
    : [];
  const rebuyTasks = activeView === "rebuy" && dashboard.rebuyTasks.length
    ? await service.attachSignedRebuyTaskUrls(
        dashboard.rebuyTasks,
        createR2ObjectStore(),
      )
    : [];
  const sitePhotosByTripId = groupSitePhotosByTripId(sitePhotoBatches);

  return activeView === "main" ? (
    <AdminMain
      dashboard={dashboard}
      selectedHelperId={params.helperId}
      selectedHelperMode={params.helperMode}
      selectedSection={params.mainSection}
      selectedTripGroups={adminMainOpenTripGroups}
    />
  ) : activeView === "checkout" ? (
    <AdminCheckout settlements={settlements} />
  ) : activeView === "tasks" ? (
    <AdminTaskPublishing
      customerNicknames={customerNicknames}
      dashboard={dashboard}
      selectedCategory={params.taskCategory}
      selectedSubType={params.taskSubType}
      selectedTripId={params.taskTripId}
      sitePhotosByTripId={sitePhotosByTripId}
    />
  ) : activeView === "rebuy" ? (
    <AdminSection icon={<PackageSearch className="size-5" />} title="補買">
      <div className="grid gap-4">
        <CreateRebuyTaskForm
          customerNicknames={customerNicknames}
          helpers={dashboard.helpers}
          purchaseTasks={dashboard.purchaseTasks}
        />
        <AdminRebuyList tasks={rebuyTasks} />
      </div>
    </AdminSection>
  ) : activeView === "live" ? (
    <AdminLiveReturn
      activeTrips={dashboard.trips.filter((trip: any) => trip.status === "active")}
      customerNicknames={customerNicknames}
      purchaseTasks={purchaseTasks}
      quoteTasks={quoteTasks}
      selectedTripId={params.liveTripId}
      sitePhotoBatches={sitePhotoBatches}
      stagingOrderPreviews={dashboard.stagingOrderPreviews}
    />
  ) : activeView === "merge" ? (
    <AdminStagingReview
      jobs={dashboard.stagingMergeJobs}
      stagingOrderPreviews={dashboard.stagingOrderPreviews}
      trips={dashboard.trips}
    />
  ) : (
    <AdminHome dashboard={dashboard} />
  );
}

function AdminCheckout({ settlements }: { settlements: any[] }) {
  const groups = [
    {
      empty: "目前沒有待開始結帳。",
      statuses: ["pending_helper_precheck"],
      title: "未付款",
    },
    {
      empty: "目前沒有進行中的結帳。",
      statuses: [
        "pending_admin_review",
        "correction_required",
        "pending_helper_confirmation",
        "payment_pending",
        "warehouse_pending",
        "warehouse_review_pending",
        "final_payment_pending",
      ],
      title: "進行中",
    },
    {
      empty: "目前沒有已完成結帳。",
      statuses: ["completed"],
      title: "已完成",
    },
  ];
  return (
    <AdminSection icon={<CreditCard className="size-5" />} title="結帳">
      {settlements.length ? (
        <div className="grid gap-6">
          {groups.map((group) => {
            const records = settlements.filter((settlement) => group.statuses.includes(settlement.status));
            return (
              <section className="grid gap-3" key={group.title}>
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold">{group.title}</h3>
                  <span className="text-sm text-muted-foreground">{records.length} 筆</span>
                </div>
                {records.length ? records.map((settlement) => {
                  const hasRate = Number(settlement.jpy_to_twd_rate || 0) > 0;
                  return (
            <article className="grid gap-4 rounded-xl border bg-card p-4 shadow-sm" key={settlement.id}>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone={settlement.status === "completed" ? "green" : settlement.status.includes("payment") ? "amber" : "blue"}>
                    {settlementStatusLabel(settlement.status)}
                  </StatusBadge>
                  <h3 className="font-semibold">{settlement.trip_name} · {settlement.helper_display_name}</h3>
                </div>
                <p className="text-sm text-muted-foreground">
                  商品 JPY {settlement.product_total_jpy}
                </p>
                {!hasRate ? (
                  <InsightBanner
                    body="儲存後會顯示商品墊款；小幫手送出預檢後再核准結帳。"
                    title="請先填寫當日 JPY→TWD 匯率"
                    tone="amber"
                  />
                ) : null}
                {settlement.status !== "completed" ? (
                  <form action={setSettlementExchangeRateAction} className="mt-3 grid gap-2 rounded-md border bg-background p-3 sm:grid-cols-[1fr_auto]">
                    <input name="settlementId" type="hidden" value={settlement.id} />
                    <label className="grid gap-1 text-sm">
                      <span className="font-medium">當日 JPY→TWD 匯率</span>
                      <input
                        defaultValue={settlement.jpy_to_twd_rate ?? ""}
                        inputMode="decimal"
                        name="jpyToTwdRate"
                        placeholder="例如 0.22"
                        required
                      />
                    </label>
                    <Button className="self-end" type="submit" variant={hasRate ? "outline" : "default"}>
                      {hasRate ? "更新匯率" : "儲存匯率"}
                    </Button>
                  </form>
                ) : null}
                {settlement.total_payable_twd !== null && hasRate ? (
                  <div className="mt-3 grid gap-1 rounded-lg bg-muted/50 p-3 text-sm">
                    <p>商品墊款 TWD {settlement.item_advance_twd}</p>
                    <AdminCompensationLine settlement={settlement} />
                    <p>核准交通費 TWD {settlement.approved_transport_twd || 0}</p>
                    <p className="font-semibold">
                      應付 TWD {settlement.total_payable_twd}
                      {settlement.is_split_payment ? " · 兩階段付款" : " · 一次付款"}
                    </p>
                  </div>
                ) : null}
                {hasRate && settlement.line_items?.length ? (
                  <div className="mt-3 grid gap-2 rounded-lg border bg-background p-3 text-sm">
                    {settlement.line_items.map((item: any) => (
                      <div className="flex items-start justify-between gap-3 border-b pb-2 last:border-b-0 last:pb-0" key={item.id}>
                        <div>
                          <p className="font-medium">{item.product_name}</p>
                          <p className="text-muted-foreground">
                            {item.quantity} 件 × JPY {item.original_price_jpy}
                          </p>
                        </div>
                        <p className="shrink-0 text-right font-medium">
                          TWD {Math.round(Number(item.product_total_jpy || 0) * Number(settlement.jpy_to_twd_rate))}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : null}
                {settlement.transport_claim_jpy ? (
                  <div className="mt-3 rounded-md border bg-background p-3 text-sm">
                    <p className="font-medium">交通申請 JPY {settlement.transport_claim_jpy}</p>
                    <p className="mt-1 text-muted-foreground">
                      {settlement.transport_claim_note || "未填交通區間"}
                    </p>
                  </div>
                ) : null}
              </div>
              {settlement.evidence?.length ? (
                <div className="grid gap-2">
                  <p className="text-sm font-medium">已上傳照片</p>
                  <div className="flex flex-wrap gap-2">
                  {settlement.evidence.map((item: any) => (
                      <a className="grid gap-1 text-xs text-muted-foreground" href={item.signed_url} key={item.id} rel="noreferrer" target="_blank">
                        <img alt={settlementEvidenceLabel(item.evidence_type)} className="size-20 rounded-md border object-cover" src={item.signed_url} />
                        <span>{settlementEvidenceLabel(item.evidence_type)}</span>
                      </a>
                  ))}
                  </div>
                </div>
              ) : null}
              {settlement.status === "pending_admin_review" ? (
                <div className="grid gap-3 rounded-md border bg-background p-3">
                  <form action={reviewSettlementAction} className="grid gap-3 sm:grid-cols-2">
                    <input name="settlementId" type="hidden" value={settlement.id} />
                    <input name="reviewAction" type="hidden" value="approve" />
                    <input
                      defaultValue={settlement.jpy_to_twd_rate ?? ""}
                      name="jpyToTwdRate"
                      type="hidden"
                    />
                    <select name="transportDecision" defaultValue="reject">
                      <option value="reject">不核准交通費／無申請</option>
                      <option value="approve">核准交通費</option>
                    </select>
                    <textarea className="sm:col-span-2" name="adminReviewNote" placeholder="審核備註（選填）" />
                    <Button className="sm:col-span-2" type="submit">核准並計算結帳</Button>
                  </form>
                  <form action={reviewSettlementAction} className="flex gap-2">
                    <input name="settlementId" type="hidden" value={settlement.id} />
                    <input name="reviewAction" type="hidden" value="reject" />
                    <input className="flex-1" name="adminReviewNote" placeholder="退回補正原因" required />
                    <Button type="submit" variant="outline">退回</Button>
                  </form>
                </div>
              ) : null}
              {["payment_pending", "final_payment_pending"].includes(settlement.status) ? (
                <div className="grid gap-2">
                  <p className="text-sm font-medium">
                    本次應付 TWD {settlementNextPaymentAmount(settlement)}
                  </p>
                  <form action={recordSettlementPaymentAction} className="flex flex-col gap-2 sm:flex-row">
                    <input name="settlementId" type="hidden" value={settlement.id} />
                    <textarea className="flex-1" name="transferNotification" placeholder="貼上轉帳通知文字" required />
                    <Button type="submit">{settlement.status === "final_payment_pending" ? "支付尾款" : "記錄付款"}</Button>
                  </form>
                </div>
              ) : null}
              {settlement.status === "warehouse_review_pending" ? (
                <form action={reviewWarehouseProofAction}>
                  <input name="settlementId" type="hidden" value={settlement.id} />
                  <Button type="submit">核准送倉證明</Button>
                </form>
              ) : null}
            </article>
                  );
                }) : (
                  <EmptyPanel title={group.empty} body="有符合狀態的結帳後會顯示在這裡。" />
                )}
              </section>
            );
          })}
        </div>
      ) : (
        <EmptyPanel title="結帳工作區" body="目前沒有待處理結帳。" />
      )}
    </AdminSection>
  );
}

function AdminRebuyList({ tasks }: { tasks: any[] }) {
  if (!tasks.length) {
    return <EmptyPanel title="補買工作區" body="目前沒有補買任務。" />;
  }
  return (
    <section className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold">補買任務</h3>
        <span className="text-sm text-muted-foreground">{tasks.length} 筆</span>
      </div>
      <div className="grid gap-3">
        {tasks.map((task) => (
          <article className="rounded-xl border bg-card p-4 shadow-sm" key={task.id}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone={task.status === "reported" || task.status === "checked_out" ? "green" : task.status === "claimed" ? "amber" : "blue"}>
                    {rebuyStatusLabel(task.status)}
                  </StatusBadge>
                  <StatusBadge tone={task.visibility === "public" ? "blue" : "neutral"}>
                    {task.visibility === "public" ? "公共" : "指定"}
                  </StatusBadge>
                </div>
                <h3 className="mt-2 font-semibold">{task.product_name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {task.quantity} 件
                </p>
                <p className="mt-1 text-sm">
                  {task.line_community_name || "未填客人"} · JPY {task.original_price_jpy ?? "-"} · TWD {task.sale_price_twd ?? "-"}
                </p>
                {task.instructions ? <p className="mt-2 text-sm">{task.instructions}</p> : null}
              </div>
            </div>
            <div className="mt-3 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
              <p className="rounded-md bg-muted/60 px-3 py-2 font-medium text-foreground">
                小幫手補買到：{task.reported_quantity != null ? `${task.reported_quantity} / ${task.quantity} 件` : `尚未回報 / ${task.quantity} 件`}
              </p>
              <p>指定：{task.assigned_helper_display_name || "-"}</p>
              <p>認領：{task.claimed_helper_display_name || "-"}</p>
              {task.remaining_quantity ? <p>剩餘：{task.remaining_quantity} · {task.remaining_reason}</p> : null}
            </div>
            {task.photos?.length ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {task.photos.map((photo: any) => (
                  <a className="grid gap-1 text-xs text-muted-foreground" href={photo.signed_url} key={photo.id} rel="noreferrer" target="_blank">
                    <img alt={photo.photo_role} className="size-20 rounded-md border object-cover" src={photo.signed_url} />
                    <span>{photo.photo_role === "reference" ? "參考" : "回報"}</span>
                  </a>
                ))}
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function settlementNextPaymentAmount(settlement: any) {
  const total = Number(settlement.total_payable_twd || 0);
  if (settlement.status === "final_payment_pending") {
    const paid = (settlement.payments || []).reduce(
      (sum: number, payment: any) => sum + Number(payment.amount_twd || 0),
      0,
    );
    return Math.max(0, total - paid);
  }
  return settlement.is_split_payment ? Math.round(total / 2) : total;
}

function AdminCompensationLine({ settlement }: { settlement: any }) {
  const minutes = Number(settlement.work_minutes || 0);
  const hours = minutes / 60;
  if (settlement.compensation_mode === "hourly") {
    return (
      <p>
        薪資 TWD {settlement.work_pay_twd || 0} · {formatHours(hours)} 小時 × TWD {settlement.hourly_rate_twd || 0}
      </p>
    );
  }
  return (
    <p>
      薪資 TWD {Number(settlement.total_payable_twd || 0) - Number(settlement.approved_transport_twd || 0)}
      {" "}· JPY {settlement.product_total_jpy} × 小幫手匯率 {settlement.helper_fx_rate || "-"}
    </p>
  );
}

function formatHours(value: number) {
  if (!Number.isFinite(value)) return "0";
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function AdminHome({ dashboard }: { dashboard: any }) {
  const summary = dashboard.summary || {};
  const activeHelpers = Number(summary.active_helpers || 0);
  const activeTrips = Number(summary.active_trips || 0);
  const arrivedTrips = Number(summary.arrived_trips || 0);
  const openQuoteTasks = Number(summary.open_quote_tasks || 0);
  const faceCheckPending = Number(summary.face_check_pending || 0);
  const settlementPending = Number(summary.settlement_pending || 0);
  const mergePending = Number(summary.merge_pending || 0);
  const openWork = activeTrips + arrivedTrips + openQuoteTasks + faceCheckPending + settlementPending + mergePending;

  return (
    <section className="grid gap-5">
      <PageHeader
        actions={
          <Button asChild>
            <Link href={openWork ? "/admin?view=live" : "/admin?view=main"}>{openWork ? "查看待處理" : "管理行程"}</Link>
          </Button>
        }
        eyebrow="Admin Operations"
        metrics={[
          { label: "連線中", value: `${activeTrips}` },
          { label: "等待開通", value: `${arrivedTrips}` },
          { label: "挑臉待審", value: `${faceCheckPending}` },
          { label: "結帳/合併待處理", value: `${settlementPending + mergePending}` },
        ]}
        subtitle="先處理會阻塞現場或金流的事項；建立資料與低頻設定放在主頁面。"
        title="今日營運總覽"
      />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <AdminShortcut href="/admin?view=main" icon={<Home className="size-5" />} label="行程與小幫手" value={`${activeHelpers} 位`} />
        <AdminShortcut href="/admin?view=checkout" icon={<CreditCard className="size-5" />} label="結帳" value={`${settlementPending} 待處理`} />
        <AdminShortcut href="/admin?view=tasks" icon={<ClipboardList className="size-5" />} label="任務發布" value={`${openQuoteTasks} 任務中`} />
        <AdminShortcut href="/admin?view=merge" icon={<Merge className="size-5" />} label="審核合併" value={`${mergePending} 批`} />
      </div>
    </section>
  );
}

function AdminMain({
  dashboard,
  selectedHelperId,
  selectedHelperMode,
  selectedSection,
  selectedTripGroups,
}: {
  dashboard: any;
  selectedHelperId?: string;
  selectedHelperMode?: string;
  selectedSection?: string;
  selectedTripGroups: TripGroupId[];
}) {
  const section = normalizeMainSection(selectedSection);
  const activeHelpers = dashboard.helpers.filter((helper: any) => helper.is_active);
  const summary = dashboard.summary || {};
  const waitingActivation = Number(summary.arrived_trips || 0);
  const liveTrips = Number(summary.active_trips || 0);
  const activeHelperCount = Number(summary.active_helpers || activeHelpers.length || 0);
  const totalTrips = Number(summary.total_trips || dashboard.trips.length || 0);
  return (
    <AdminSection icon={<Home className="size-5" />} title="主頁面">
      <PageHeader
        actions={
          <Button asChild>
            <Link href="/admin?view=main&mainSection=create">新增行程</Link>
          </Button>
        }
        eyebrow="Trip & Helper Control"
        metrics={[
          { label: "等待開通", value: `${waitingActivation}` },
          { label: "連線中", value: `${liveTrips}` },
          { label: "啟用小幫手", value: `${activeHelperCount}` },
          { label: "全部行程", value: `${totalTrips}` },
        ]}
        subtitle="這裡只處理行程排程、現場連線開通與小幫手資料；任務發布、結帳與合併維持在各自工作區。"
        title="行程與小幫手管理"
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <SelectionCard
          active={section === "trips"}
          body="依狀態展開；點開某一組才載入行程。"
          href="/admin?view=main&mainSection=trips"
          title="行程管理"
        />
        <SelectionCard
          active={section === "helpers"}
          body="先看名單；點進單一小幫手後才顯示資料。"
          href="/admin?view=main&mainSection=helpers"
          title="小幫手資料"
        />
        <SelectionCard
          active={section === "create"}
          body="新增行程或新增小幫手。"
          href="/admin?view=main&mainSection=create"
          title="新增"
        />
      </div>
      {section === "trips" ? (
        <TripManagement openGroups={selectedTripGroups} trips={dashboard.trips} />
      ) : section === "helpers" ? (
        <HelperDirectory
          helpers={activeHelpers}
          selectedHelperId={selectedHelperId}
          selectedHelperMode={selectedHelperMode}
        />
      ) : section === "create" ? (
        <CreateManagementPanel activeHelpers={activeHelpers} />
      ) : (
        <AdminMainLanding />
      )}
    </AdminSection>
  );
}

function AdminTaskPublishing({
  customerNicknames,
  dashboard,
  selectedCategory,
  selectedSubType,
  selectedTripId,
  sitePhotosByTripId,
}: {
  customerNicknames: string[];
  dashboard: any;
  selectedCategory?: string;
  selectedSubType?: string;
  selectedTripId?: string;
  sitePhotosByTripId: Record<string, any[]>;
}) {
  const activeTrips = dashboard.trips.filter((trip: any) => trip.status === "active");
  const category = normalizeTaskCategory(selectedCategory);
  const subType = normalizeTaskSubType(category, selectedSubType);
  const selectedTrip = activeTrips.find((trip: any) => trip.id === selectedTripId);
  const quoteTypes = [
    { id: "quote", label: "報價", body: "請小幫手回傳商品價格。" },
    { id: "detail", label: "細圖", body: "請小幫手補拍商品細節。" },
    { id: "quote_and_detail", label: "報價＋細圖", body: "同時回傳價格與商品細節照。" },
  ];
  const purchaseTypes = [
    { id: "standard", label: "一般採買", body: "發布一般數量的採買指示。" },
    { id: "face_check", label: "挑臉採買", body: "採買後需由管理員審核商品狀態。" },
  ];
  const subTypes = category === "quote" ? quoteTypes : category === "purchase" ? purchaseTypes : [];

  return (
    <AdminSection icon={<ClipboardList className="size-5" />} title="任務發布">
      <div className="grid gap-5">
        <TaskStep number="1" title="選擇任務大類">
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectionCard
              active={category === "quote"}
              body="報價、細圖，或報價＋細圖。"
              href="/admin?view=tasks&taskCategory=quote"
              icon={<Camera className="size-5" />}
              title="報價／細圖任務"
            />
            <SelectionCard
              active={category === "purchase"}
              body="一般採買或需要管理員審核的挑臉採買。"
              href="/admin?view=tasks&taskCategory=purchase"
              icon={<ShoppingBag className="size-5" />}
              title="採買任務"
            />
          </div>
        </TaskStep>

        {category ? (
          <TaskStep number="2" title="選擇細任務">
            <div className="grid gap-3 sm:grid-cols-3">
              {subTypes.map((item) => (
                <SelectionCard
                  active={subType === item.id}
                  body={item.body}
                  href={adminTaskHref(category, item.id)}
                  key={item.id}
                  title={item.label}
                />
              ))}
            </div>
          </TaskStep>
        ) : null}

        {category && subType ? (
          <TaskStep number="3" title="選擇正在進行中的行程">
            {activeTrips.length ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {activeTrips.map((trip: any) => (
                  <SelectionCard
                    active={selectedTrip?.id === trip.id}
                    body={`${trip.helper_display_name || "未指派"} · 選取後載入現場照片`}
                    href={adminTaskHref(category, subType, trip.id)}
                    key={trip.id}
                    title={trip.trip_name}
                  />
                ))}
              </div>
            ) : (
              <EmptyPanel title="沒有進行中的行程" body="行程啟用後才可發布任務。" />
            )}
          </TaskStep>
        ) : null}

        {selectedTrip && category === "quote" && isQuoteTaskType(subType) ? (
          <TaskStep number="4" title={`發布${taskTypeLabel(subType)}任務`}>
            <article className="rounded-xl border bg-card p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold">{selectedTrip.trip_name}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {selectedTrip.helper_display_name || "未指派"} · {statusLabel(selectedTrip.status)}
                  </p>
                </div>
                <StatusBadge tone="neutral">
                  {(sitePhotosByTripId[selectedTrip.id] || []).length} 張可選
                </StatusBadge>
              </div>
              <CreateQuoteTaskForm
                availablePhotos={sitePhotosByTripId[selectedTrip.id] || []}
                taskType={subType}
                trip={selectedTrip}
              />
            </article>
          </TaskStep>
        ) : null}

        {selectedTrip && category === "purchase" ? (
          <TaskStep number="4" title="建立採買內容">
            <article className="rounded-xl border bg-card p-4 shadow-sm">
              <div>
                <h3 className="font-semibold">{selectedTrip.trip_name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {selectedTrip.helper_display_name || "未指派"} ·{" "}
                  {purchaseTypes.find((item) => item.id === subType)?.label}
                </p>
              </div>
              <CreatePurchaseTaskForm
                customerNicknames={customerNicknames}
                requiresFaceCheck={subType === "face_check"}
                trip={selectedTrip}
              />
            </article>
          </TaskStep>
        ) : null}
      </div>
    </AdminSection>
  );
}

function AdminLiveReturn({
  activeTrips,
  customerNicknames,
  purchaseTasks,
  quoteTasks,
  selectedTripId,
  sitePhotoBatches,
  stagingOrderPreviews,
}: {
  activeTrips: any[];
  customerNicknames: string[];
  purchaseTasks: any[];
  quoteTasks: any[];
  selectedTripId?: string;
  sitePhotoBatches: any[];
  stagingOrderPreviews: any[];
}) {
  const selectedTrip = activeTrips.find((trip) => trip.id === selectedTripId);
  const visibleBatches = selectedTrip
    ? sitePhotoBatches.filter((batch) => batch.trip_id === selectedTrip.id)
    : [];
  const visibleQuoteTasks = selectedTrip
    ? quoteTasks.filter((task) => task.trip_id === selectedTrip.id)
    : [];
  const visiblePurchaseTasks = selectedTrip
    ? purchaseTasks.filter((task) => task.trip_id === selectedTrip.id)
    : [];
  const visibleStagingPreviews = selectedTrip
    ? stagingOrderPreviews.filter((preview) => preview.trip_id === selectedTrip.id)
    : [];

  return (
    <AdminSection icon={<Radio className="size-5" />} title="即時回傳">
      <TaskStep number="1" title="選擇要監聽的行程">
        {activeTrips.length ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {activeTrips.map((trip) => (
              <SelectionCard
                active={selectedTrip?.id === trip.id}
                body={`${trip.helper_display_name || "未指派"} · ${statusLabel(trip.status)}`}
                href={`/admin?view=live&liveTripId=${encodeURIComponent(trip.id)}`}
                key={trip.id}
                title={trip.trip_name}
              />
            ))}
          </div>
        ) : (
          <EmptyPanel title="沒有進行中的行程" body="行程啟用後才會出現在監聽清單。" />
        )}
      </TaskStep>

      {!selectedTrip ? (
        <EmptyPanel title="尚未選擇監聽行程" body="先選擇上方行程，才會顯示該行程的即時回傳。" />
      ) : (
        <>
          <Surface className="grid gap-3 md:grid-cols-4">
            <MetricTile label="現場照片批次" value={`${visibleBatches.length}`} />
            <MetricTile label="詢價/細節任務" value={`${visibleQuoteTasks.length}`} />
            <MetricTile label="採買任務" value={`${visiblePurchaseTasks.length}`} />
            <MetricTile label="暫存訂單" value={`${visibleStagingPreviews.length}`} />
          </Surface>
          <section className="grid gap-3">
            <SectionTitle eyebrow={selectedTrip.trip_name} title="現場照片" />
            {visibleBatches.length === 0 ? (
              <EmptyPanel title="尚未收到現場照片" body="正在監聽此行程，等待小幫手上傳。" />
            ) : (
              <div className="grid gap-3">
                {visibleBatches.map((batch: any) => (
                  <article key={batch.id} className="rounded-xl border bg-card p-4 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="font-semibold">{batch.trip_name}</h3>
                        <p className="text-sm text-muted-foreground">
                          {service.dateOnly(batch.business_date, batch.timezone)} ·{" "}
                          {batch.helper_display_name} · {batch.photos.length} 張
                        </p>
                        {batch.note ? <p className="mt-1 text-sm">{batch.note}</p> : null}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {new Date(batch.created_at).toLocaleString("zh-TW", {
                          timeZone: "Asia/Taipei",
                        })}
                      </p>
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      {batch.photos.map((photo: any) => (
                          <div key={photo.id} className="rounded-lg border bg-background p-2">
                          <a href={photo.signed_url} target="_blank" rel="noreferrer">
                            <img
                              alt={photo.original_filename || "site photo"}
                              className="aspect-square w-full rounded-md object-cover"
                              src={photo.signed_url}
                            />
                          </a>
                          <div className="mt-2 grid gap-2">
                            <p className="truncate text-sm font-medium">
                              {photo.sort_order + 1}. {photo.original_filename || "現場照片"}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {photo.saved_by_admin ? "已保存" : "暫存"}
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {!photo.saved_by_admin ? (
                                <ActionButtonForm
                                  action={saveSitePhotoAction}
                                  fields={[{ name: "photoId", value: photo.id }]}
                                  label="保存"
                                  variant="outline"
                                />
                              ) : null}
                              <Button asChild size="sm" variant="secondary">
                                <a href={photo.signed_url} target="_blank" rel="noreferrer">
                                  分享
                                </a>
                              </Button>
                              <Button asChild size="sm" variant="secondary">
                                <a href={photo.signed_url} download>
                                  下載
                                </a>
                              </Button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="grid gap-3">
            <SectionTitle title="詢價 / 細節回覆" />
            {visibleQuoteTasks.length === 0 ? (
              <EmptyPanel title="尚無詢價/細節任務" body="等待發布。" />
            ) : (
              <div className="grid gap-3">
                {visibleQuoteTasks.map((task: any) => (
                  <article key={task.id} className="rounded-xl border bg-card p-4 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="font-semibold">
                          {task.product_name || "未命名任務"} · {taskTypeLabel(task.task_type)}
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          {task.trip_name} · {task.helper_display_name} · {statusLabel(task.status)}
                        </p>
                        {task.instruction ? <p className="mt-1 text-sm">{task.instruction}</p> : null}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {new Date(task.created_at).toLocaleString("zh-TW", {
                          timeZone: "Asia/Taipei",
                        })}
                      </p>
                    </div>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      {task.photos.map((photo: any) => (
                          <div key={photo.id} className="rounded-lg border bg-background p-3">
                          <div className="grid gap-3 sm:grid-cols-[120px_1fr]">
                            <a href={photo.signed_url} target="_blank" rel="noreferrer">
                              <img
                                alt={photo.product_name || "quote task photo"}
                                className="aspect-square w-full rounded-md object-cover"
                                src={photo.signed_url}
                              />
                            </a>
                            <div className="grid gap-2">
                              <p className="text-sm font-medium">
                                #{photo.sort_order + 1} · {replyStatusLabel(photo.reply_status)}
                                {photo.needs_review ? " · 需確認" : ""}
                              </p>
                              {photo.latest_reply ? (
                                <div className="grid gap-2 text-sm">
                                  {photo.latest_reply.price_jpy != null ? (
                                    <p>JPY {photo.latest_reply.price_jpy}</p>
                                  ) : null}
                                  {photo.latest_reply.note ? <p>{photo.latest_reply.note}</p> : null}
                                  {photo.latest_reply.detail_photos?.length ? (
                                    <div className="grid grid-cols-3 gap-2">
                                      {photo.latest_reply.detail_photos.map((detailPhoto: any) => (
                                        <a
                                          key={detailPhoto.storage_key}
                                          href={detailPhoto.signed_url}
                                          target="_blank"
                                          rel="noreferrer"
                                        >
                                          <img
                                            alt={detailPhoto.original_filename || "detail photo"}
                                            className="aspect-square w-full rounded-md object-cover"
                                            src={detailPhoto.signed_url}
                                          />
                                        </a>
                                      ))}
                                    </div>
                                  ) : null}
                                  <QuickPublishPurchaseForm
                                    customerNicknames={customerNicknames}
                                    photo={photo}
                                    task={task}
                                  />
                                </div>
                              ) : (
                                <p className="text-sm text-muted-foreground">等待小幫手回覆。</p>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="grid gap-3">
            <SectionTitle title="採買任務" />
            {visiblePurchaseTasks.length === 0 ? (
              <EmptyPanel title="尚無採買任務" body="可從任務發布建立，或從已回覆的詢價項目快速發布。" />
            ) : (
              <div className="grid gap-3">
                {visiblePurchaseTasks.map((task: any) => (
                  <article key={task.id} className="rounded-xl border bg-card p-4 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="font-semibold">{task.product_name}</h3>
                        <p className="text-sm text-muted-foreground">
                          {task.line_community_name} · {task.quantity} 件 · {purchaseStatusLabel(task.status)}
                          {task.requires_face_check ? " · 挑臉" : ""}
                        </p>
                        <p className="mt-1 text-sm">
                          JPY {task.original_price_jpy ?? "-"} · TWD {task.sale_price_twd}
                        </p>
                        {task.helper_note ? <p className="mt-1 text-sm">{task.helper_note}</p> : null}
                      </div>
                      {task.status === "review_pending" ? (
                        <div className="flex flex-wrap gap-2">
                          <ActionButtonForm
                            action={reviewFaceCheckPurchaseAction}
                            fields={[
                              { name: "purchaseTaskId", value: task.id },
                              { name: "reviewAction", value: "approve" },
                              { name: "adminReviewNote", value: "Approved from live return" },
                            ]}
                            label="審核通過"
                          />
                          <ActionButtonForm
                            action={reviewFaceCheckPurchaseAction}
                            fields={[
                              { name: "purchaseTaskId", value: task.id },
                              { name: "reviewAction", value: "reject" },
                              { name: "adminReviewNote", value: "Retake requested from live return" },
                            ]}
                            label="重拍"
                            variant="outline"
                          />
                        </div>
                      ) : null}
                    </div>
                    {task.photos?.length ? (
                      <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
                        {task.photos.map((photo: any) => (
                          <a href={photo.signed_url} key={photo.id} target="_blank" rel="noreferrer">
                            <img
                              alt={photo.photo_role}
                              className="aspect-square w-full rounded-md object-cover"
                              src={photo.signed_url}
                            />
                          </a>
                        ))}
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="grid gap-3">
            <SectionTitle title="暫存訂單預覽" />
            {visibleStagingPreviews.length === 0 ? (
              <EmptyPanel title="尚無完成採買" body="只有 completed 採買任務會出現在此預覽；review、取消、缺貨與找不到都不會進入。" />
            ) : (
              <div className="grid gap-2">
                {visibleStagingPreviews.map((preview: any) => (
                  <div key={preview.id} className="rounded-md border bg-card p-3 text-sm">
                    <p className="font-medium">
                      {preview.line_community_name} · {preview.product_name}
                    </p>
                    <p className="mt-1 text-muted-foreground">
                      {preview.quantity} 件 · JPY {preview.original_price_jpy ?? "-"} · TWD {preview.sale_price_twd}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </AdminSection>
  );
}

function AdminStagingReview({
  jobs,
  stagingOrderPreviews,
  trips,
}: {
  jobs: any[];
  stagingOrderPreviews: any[];
  trips: any[];
}) {
  const endedTrips = trips.filter((trip: any) => trip.status === "ended");
  const jobTripIds = new Set(jobs.map((job: any) => job.trip_id));
  const readyTrips = endedTrips.filter((trip: any) => !jobTripIds.has(trip.id));

  return (
    <AdminSection icon={<Merge className="size-5" />} title="審核合併">
      <div className="grid gap-5">
        <section className="grid gap-3">
          <SectionTitle count={readyTrips.length} title="建立審核批次" />
          {readyTrips.length ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {readyTrips.map((trip: any) => {
                const previewCount = stagingOrderPreviews.filter((preview: any) => preview.trip_id === trip.id).length;
                return (
                  <article className="rounded-xl border bg-card p-4 shadow-sm" key={trip.id}>
                    <h4 className="font-semibold">{trip.trip_name}</h4>
                    <p className="mt-1 text-sm text-muted-foreground">
                        {trip.helper_display_name || "未指派"} · {previewCount} 筆暫存訂單
                    </p>
                    <div className="mt-3">
                      <ActionButtonForm
                        action={prepareStagingReviewAction}
                        fields={[{ name: "tripId", value: trip.id }]}
                        label="建立審核"
                      />
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <EmptyPanel title="沒有可建立的審核批次" body="只有已結束且尚未建立審核批次的行程會出現在這裡。" />
          )}
        </section>

        <section className="grid gap-3">
          <SectionTitle count={jobs.length} title="審核批次" />
          {jobs.length ? (
            <div className="grid gap-4">
              {jobs.map((job: any) => {
                const reviewedOrders = job.reviewed_orders || [];
                const includedCount = reviewedOrders.filter((order: any) => !order.is_excluded).length;
                const unknownCount = reviewedOrders.filter(
                  (order: any) => !order.is_excluded && !order.customer_exists && !order.customer_confirmed,
                ).length;
                return (
                  <article className="grid gap-4 rounded-xl border bg-card p-4 shadow-sm" key={job.id}>
                    <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge tone={mergeStatusTone(job.status)}>{mergeStatusLabel(job.status)}</StatusBadge>
                          <h4 className="font-semibold">{job.trip_name}</h4>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {job.helper_display_name || "未指派"} · {includedCount} 筆會合併
                        </p>
                        {unknownCount ? (
                          <InsightBanner
                            body="需明確確認後才能核准；合併不會自動建立客戶資料。"
                            title={`${unknownCount} 筆 LINE 暱稱不在客戶名單`}
                            tone="amber"
                          />
                        ) : null}
                        {job.last_error ? <p className="mt-2 text-sm text-destructive">{job.last_error}</p> : null}
                      </div>
                      <div className="flex flex-wrap items-start gap-2">
                        {["pending_review", "failed", "rejected"].includes(job.status) ? (
                          <ActionButtonForm
                            action={approveStagingMergeJobAction}
                            fields={[
                              { name: "mergeJobId", value: job.id },
                              { name: "expectedVersion", value: job.version },
                            ]}
                            label="核准審核"
                            variant={unknownCount ? "outline" : "default"}
                          />
                        ) : null}
                        {job.status === "approved" ? (
                          <ActionButtonForm
                            action={mergeApprovedStagingJobAction}
                            fields={[
                              { name: "mergeJobId", value: job.id },
                              { name: "expectedVersion", value: job.version },
                              { name: "idempotencyKey", value: `merge-${job.id}-${job.version}` },
                            ]}
                            label="合併至正式訂單"
                          />
                        ) : null}
                      </div>
                    </div>

                    {job.status !== "merged" ? (
                      <form action={rejectStagingMergeJobAction} className="grid gap-2 rounded-md border bg-background p-3 sm:grid-cols-[1fr_auto]">
                        <input name="mergeJobId" type="hidden" value={job.id} />
                        <input name="rejectionNote" placeholder="退回原因" required />
                        <Button type="submit" variant="outline">退回審核</Button>
                      </form>
                    ) : null}

                    <div className="grid gap-3">
                      {reviewedOrders.map((order: any) => (
                        <div className="grid gap-3 rounded-lg border bg-background p-3" key={order.id}>
                          <form action={editReviewedStagingOrderAction} className="grid gap-3">
                            <input name="reviewedOrderId" type="hidden" value={order.id} />
                            <div className="grid gap-2 md:grid-cols-2">
                              <label className="grid gap-1 text-sm">
                                <span className="font-medium">LINE 暱稱</span>
                                <input name="lineCommunityName" defaultValue={order.line_community_name} required />
                              </label>
                              <label className="grid gap-1 text-sm">
                                <span className="font-medium">商品</span>
                                <input name="productName" defaultValue={order.product_name} required />
                              </label>
                              <label className="grid gap-1 text-sm">
                                <span className="font-medium">外觀備註</span>
                                <input name="appearanceNotes" defaultValue={order.appearance_notes || ""} />
                              </label>
                              <div className="grid grid-cols-3 gap-2">
                                <label className="grid gap-1 text-sm">
                                  <span className="font-medium">數量</span>
                                  <input inputMode="numeric" name="quantity" defaultValue={order.quantity} required />
                                </label>
                                <label className="grid gap-1 text-sm">
                                  <span className="font-medium">JPY</span>
                                  <input inputMode="numeric" name="originalPriceJpy" defaultValue={order.original_price_jpy ?? ""} />
                                </label>
                                <label className="grid gap-1 text-sm">
                                  <span className="font-medium">TWD</span>
                                  <input inputMode="numeric" name="salePriceTwd" defaultValue={order.sale_price_twd} required />
                                </label>
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-3 text-sm">
                              <label className="inline-flex items-center gap-2">
                                <input name="customerConfirmed" type="checkbox" defaultChecked={order.customer_confirmed} />
                                <span>{order.customer_exists ? "客戶名單已有此暱稱" : "確認未知暱稱仍可合併"}</span>
                              </label>
                              <label className="inline-flex items-center gap-2">
                                <input name="isExcluded" type="checkbox" defaultChecked={order.is_excluded} />
                                <span>排除不合併</span>
                              </label>
                              <input className="min-w-56 flex-1" name="exclusionReason" placeholder="排除原因" defaultValue={order.exclusion_reason || ""} />
                              <Button size="sm" type="submit" variant="outline">儲存訂單</Button>
                            </div>
                          </form>
                          {order.photos?.length ? (
                            <form action={editReviewedStagingOrderPhotosAction} className="grid gap-2 rounded-md border bg-muted/30 p-3">
                              <input name="reviewedOrderId" type="hidden" value={order.id} />
                              <div className="flex items-center justify-between gap-3">
                                <p className="text-sm font-medium">合併照片</p>
                                <Button size="sm" type="submit" variant="outline">儲存照片</Button>
                              </div>
                              <div className="grid gap-2">
                                {order.photos.map((photo: any) => (
                                  <div className="grid gap-2 rounded-md border bg-background p-2 text-sm md:grid-cols-[auto_1fr_auto]" key={photo.id}>
                                    <input name="photoId" type="hidden" value={photo.id} />
                                    <label className="inline-flex items-center gap-2">
                                      <input name="includePhoto" type="checkbox" value={photo.id} defaultChecked={photo.include_in_merge} />
                                      <span>合併</span>
                                    </label>
                                    <label className="grid gap-1">
                                      <span className="text-xs text-muted-foreground">
                                        {photo.photo_role} · {photo.storage_key}
                                      </span>
                                      <input name={`photoLabel:${photo.id}`} placeholder="照片標籤" defaultValue={photo.label || ""} />
                                    </label>
                                    <span className="self-center text-xs text-muted-foreground">#{photo.sort_order}</span>
                                  </div>
                                ))}
                              </div>
                            </form>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <EmptyPanel title="尚無審核批次" body="先從已結束行程建立審核批次。" />
          )}
        </section>
      </div>
    </AdminSection>
  );
}

function AdminMainLanding() {
  return (
    <Surface className="grid gap-3">
      <StatusBadge tone="blue">請選擇工作區</StatusBadge>
      <div>
        <h3 className="text-xl font-semibold tracking-tight">先看總覽，不預載明細</h3>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          這個頁面只顯示 Trip & Helper Control 的摘要。需要處理行程、小幫手資料或新增資料時，再點上方卡片進入對應區塊。
        </p>
      </div>
    </Surface>
  );
}

function CreateManagementPanel({ activeHelpers }: { activeHelpers: any[] }) {
  return (
    <section className="grid gap-4">
      <SectionTitle
        eyebrow="Create"
        title="新增資料"
      />
      <div className="grid gap-4 xl:grid-cols-2">
        <CreateTripForm helpers={activeHelpers} />
        <CreateHelperForm />
      </div>
    </section>
  );
}

function HelperDirectory({
  helpers,
  selectedHelperId,
  selectedHelperMode,
}: {
  helpers: any[];
  selectedHelperId?: string;
  selectedHelperMode?: string;
}) {
  const selectedHelper = helpers.find((helper: any) => helper.id === selectedHelperId);
  const isEditing = selectedHelperMode === "edit";
  return (
    <section className="grid gap-3">
      <SectionTitle count={helpers.length} title="小幫手資料" />
      {helpers.length ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(220px,320px)_1fr]">
          <div className="grid content-start gap-2">
            {helpers.map((helper: any) => (
              <Link
                className={`flex min-h-12 items-center justify-between rounded-xl border bg-card px-4 py-3 text-sm font-semibold shadow-sm transition hover:border-primary/30 hover:bg-accent/40 ${
                  selectedHelper?.id === helper.id ? "border-primary/30 bg-accent/50" : ""
                }`}
                href={`/admin?view=main&mainSection=helpers&helperId=${encodeURIComponent(helper.id)}`}
                key={helper.id}
              >
                <span className="inline-flex items-center gap-2">
                  <UserRound className="size-4 text-muted-foreground" />
                  {helper.display_name}
                </span>
                <span className="text-xs text-muted-foreground">查看</span>
              </Link>
            ))}
          </div>
          {selectedHelper ? (
            isEditing ? (
              <Surface className="grid gap-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <SectionTitle eyebrow="Edit helper" title={`修改 ${selectedHelper.display_name}`} />
                  <Button asChild size="sm" variant="ghost">
                    <Link href={`/admin?view=main&mainSection=helpers&helperId=${encodeURIComponent(selectedHelper.id)}`}>
                      取消修改
                    </Link>
                  </Button>
                </div>
                <EditHelperForm helper={selectedHelper} />
              </Surface>
            ) : (
              <HelperProfileCard helper={selectedHelper} />
            )
          ) : (
            <EmptyPanel title="選擇一位小幫手" body="左側先只顯示名字；點進去後才會載入並呈現詳細資料與管理操作。" />
          )}
        </div>
      ) : (
        <EmptyPanel title="沒有啟用中的小幫手" body="停用帳號不會顯示在這裡；可從新增建立新的小幫手。" />
      )}
    </section>
  );
}

function HelperProfileCard({ helper }: { helper: any }) {
  const fields = [
    { label: "顯示名稱", value: helper.display_name, note: "管理員與小幫手畫面顯示的工作名稱。" },
    { label: "登入 Email", value: helper.email, note: "Supabase Auth 登入帳號。" },
    { label: "Auth user id", value: helper.auth_user_id || "尚未綁定", note: "用來把 Auth 帳號與小幫手 profile 綁定。" },
    { label: "計薪方式", value: helper.compensation_mode === "fx_rate" ? "匯率差" : "時薪", note: "結帳時計算小幫手薪資的模式。" },
    { label: "時薪 TWD", value: helper.hourly_rate_twd ?? "未設定", note: "時薪模式使用；依出發到結束時間計算。" },
    { label: "小幫手匯率", value: helper.helper_fx_rate ?? "未設定", note: "匯率差模式使用；不可與管理員每日匯率混淆。" },
    { label: "地區", value: helper.region || "未填", note: "主要執行區域，例如 Tokyo。" },
    { label: "銀行戶名", value: helper.bank_account_name || "未填", note: "付款/匯款紀錄用。" },
    { label: "銀行代碼", value: helper.bank_code || "未填", note: "付款/匯款紀錄用。" },
    { label: "銀行帳號", value: helper.bank_account_number || "未填", note: "付款/匯款紀錄用。" },
  ];
  return (
    <Surface className="grid gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <StatusBadge tone="green">啟用中</StatusBadge>
          <h3 className="mt-2 text-2xl font-semibold tracking-tight">{helper.display_name}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{helper.email}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm">
            <Link href={`/admin?view=main&mainSection=helpers&helperId=${encodeURIComponent(helper.id)}&helperMode=edit`}>
              修改資料
            </Link>
          </Button>
          <ActionButtonForm
            action={deactivateHelperAction}
            fields={[{ name: "helperId", value: helper.id }]}
            label="停用小幫手"
            variant="outline"
          />
        </div>
      </div>
      <dl className="grid gap-3 md:grid-cols-2">
        {fields.map((field) => (
          <div className="rounded-lg border bg-background p-3" key={field.label}>
            <dt className="text-sm font-semibold">{field.label}</dt>
            <dd className="mt-1 break-words text-sm">{String(field.value)}</dd>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">{field.note}</p>
          </div>
        ))}
      </dl>
    </Surface>
  );
}

function TripManagement({
  openGroups,
  trips,
}: {
  openGroups: TripGroupId[];
  trips: any[];
}) {
  const groups = [
    { empty: "目前沒有進行中行程。", id: "inProgress" as const, statuses: ["active"], title: "進行中" },
    { empty: "目前沒有未開始行程。", id: "notStarted" as const, statuses: ["draft", "scheduled", "departed", "arrived"], title: "未開始" },
    { empty: "目前沒有已結束行程。", id: "completed" as const, statuses: ["ended"], title: "已結束" },
  ];
  const openSet = new Set(openGroups);
  return (
    <section className="grid gap-3">
      <SectionTitle title="行程管理" />
      <div className="grid gap-5">
        {groups.map((group) => {
          const isOpen = openSet.has(group.id);
          const records = isOpen ? trips.filter((trip: any) => group.statuses.includes(trip.status)) : [];
          return (
            <section className="grid gap-3" key={group.title}>
              <Link
                className={`flex min-h-12 items-center justify-between rounded-xl border px-4 py-3 shadow-sm transition hover:border-primary/30 hover:bg-accent/40 ${
                  isOpen ? "bg-card" : "bg-card/70"
                }`}
                href={adminTripGroupsHref(toggleTripGroup(openGroups, group.id))}
              >
                <span className="font-semibold">{group.title}</span>
                <span className="text-sm text-muted-foreground">{isOpen ? "收合" : "展開載入"}</span>
              </Link>
              {isOpen && records.length ? (
                <div className="grid gap-3">
                  {records.map((trip: any) => (
                    <article key={trip.id} className="rounded-xl border bg-card p-4 shadow-sm">
                      <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="font-semibold">{trip.trip_name}</h4>
                            <StatusBadge tone={trip.status === "active" ? "green" : trip.status === "arrived" ? "amber" : trip.status === "canceled" ? "red" : "neutral"}>
                              {statusLabel(trip.status)}
                            </StatusBadge>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                            <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1">
                              <CalendarDays className="size-3.5" />
                              {service.dateOnly(trip.business_date, trip.timezone)} {trip.scheduled_time || ""}
                            </span>
                            <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1">
                              <MapPin className="size-3.5" />
                              {trip.location || "未填地點"}
                            </span>
                            <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1">
                              <UserRound className="size-3.5" />
                              {trip.helper_display_name || "未指派"}
                            </span>
                          </div>
                          <p className="mt-3 text-sm font-medium text-foreground">
                            {adminTripNextAction(trip.status)}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-start gap-2">
                          {trip.status === "arrived" ? (
                            <ActionButtonForm
                              action={activateTripAction}
                              fields={[
                                { name: "tripId", value: trip.id },
                                { name: "expectedVersion", value: trip.version },
                              ]}
                              label="啟用"
                            />
                          ) : null}
                          {trip.status === "ended" ? (
                            <Button asChild size="sm">
                              <Link href="/admin?view=checkout">前往結帳</Link>
                            </Button>
                          ) : null}
                          {!["ended", "canceled"].includes(trip.status) ? (
                            <ActionButtonForm
                              action={cancelTripAction}
                              fields={[
                                { name: "tripId", value: trip.id },
                                { name: "expectedVersion", value: trip.version },
                                {
                                  name: "reason",
                                  value: "Admin canceled from main trip management",
                                },
                              ]}
                              label="取消"
                              variant="outline"
                            />
                          ) : null}
                        </div>
                      </div>
                      {trip.status !== "ended" ? <TripOperationTimeline status={trip.status} /> : null}
                      {trip.status !== "ended" ? (
                        <details className="mt-3 rounded-lg border bg-muted/30 p-3">
                          <summary className="cursor-pointer text-sm font-semibold">狀態修復工具</summary>
                          <RepairTripForm trip={trip} />
                        </details>
                      ) : null}
                    </article>
                  ))}
                </div>
              ) : isOpen ? (
                <EmptyPanel title={group.empty} body="有符合狀態的行程後會顯示在這裡。" />
              ) : null}
            </section>
          );
        })}
      </div>
    </section>
  );
}

function AdminSection({
  children,
  icon,
  title,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <section className="grid gap-4">
      <div className="flex items-center gap-2">
        <span className="flex size-9 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
          {icon}
        </span>
        <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
      </div>
      {children}
    </section>
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
  href,
  icon,
  title,
}: {
  active: boolean;
  body: string;
  href: string;
  icon?: React.ReactNode;
  title: string;
}) {
  return (
    <Link
      className={`rounded-xl border p-4 shadow-sm transition ${
        active
          ? "border-primary bg-primary/5 ring-1 ring-primary"
          : "bg-card hover:border-primary/30 hover:bg-accent/40"
      }`}
      href={href}
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
    </Link>
  );
}

function AdminShortcut({
  href,
  icon,
  label,
  value,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <Link className="rounded-xl border bg-card p-4 shadow-sm transition hover:border-primary/30 hover:bg-accent/40" href={href}>
      <span className="flex size-10 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
        {icon}
      </span>
      <h3 className="mt-3 font-semibold">{label}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{value}</p>
    </Link>
  );
}

function EmptyPanel({ body, title }: { body: string; title: string }) {
  return <EmptyState body={body} title={title} />;
}

function groupSitePhotosByTripId(batches: any[]) {
  const groups: Record<string, any[]> = {};
  for (const batch of batches) {
    if (!groups[batch.trip_id]) groups[batch.trip_id] = [];
    groups[batch.trip_id].push(...(batch.photos || []));
  }
  return groups;
}

function adminTripNextAction(status: string) {
  if (status === "arrived") return "小幫手已抵達，確認現場可連線後請啟用。";
  if (status === "departed") return "小幫手前往中，等待抵達回報。";
  if (status === "active") return "連線中；任務發布與現場回傳請到對應工作區處理。";
  if (status === "scheduled" || status === "draft") return "尚未出發；確認日期、小幫手與地點即可等待出發。";
  if (status === "ended") return "行程已結束；後續處理結帳、審核與合併。";
  if (status === "canceled") return "已取消，不再顯示現場操作。";
  return "依目前狀態處理下一步。";
}

function TripOperationTimeline({ status }: { status: string }) {
  const steps = [
    { key: "scheduled", label: "排定" },
    { key: "departed", label: "出發" },
    { key: "arrived", label: "抵達" },
    { key: "active", label: "連線" },
  ];
  const activeIndex =
    status === "active" ? 3 :
    status === "arrived" ? 2 :
    status === "departed" ? 1 :
    0;
  const canceled = status === "canceled";
  return (
    <ol className="mt-4 grid grid-cols-4 gap-2 text-xs">
      {steps.map((step, index) => (
        <li
          className={`rounded-full border px-2 py-1 text-center font-medium ${
            canceled
              ? "bg-muted text-muted-foreground"
              : index === activeIndex
                ? "border-primary/20 bg-primary text-primary-foreground"
                : "bg-background text-muted-foreground"
          }`}
          key={step.key}
        >
          {step.label}
        </li>
      ))}
    </ol>
  );
}

function statusLabel(status: string) {
  if (status === "scheduled") return "排定";
  if (status === "departed") return "前往中";
  if (status === "arrived") return "等待確認";
  if (status === "active") return "連線中";
  if (status === "completed") return "已完成";
  if (status === "ended") return "已結束";
  if (status === "canceled") return "已取消";
  if (status === "open") return "進行中";
  return status;
}

function taskTypeLabel(taskType: string) {
  if (taskType === "quote") return "報價";
  if (taskType === "detail") return "細節照";
  return "報價 + 細節照";
}

function replyStatusLabel(status: string) {
  if (status === "replied") return "已回覆";
  if (status === "converted_to_purchase") return "已轉採買";
  return "待回覆";
}

function purchaseStatusLabel(status: string) {
  if (status === "open") return "待採買";
  if (status === "review_pending") return "等待審核";
  if (status === "approved_pending_helper_confirmation") return "待小幫手確認";
  if (status === "completed") return "已完成";
  if (status === "unavailable") return "缺貨";
  if (status === "not_found") return "找不到";
  if (status === "canceled") return "已取消";
  return status;
}

function rebuyStatusLabel(status: string) {
  const labels: Record<string, string> = {
    canceled: "已取消",
    checked_out: "已結帳",
    claimed: "已認領",
    open: "待認領/待回報",
    reported: "已回報",
  };
  return labels[status] || status;
}

function mergeStatusLabel(status: string) {
  const labels: Record<string, string> = {
    approved: "已核准",
    failed: "合併失敗",
    merged: "已合併",
    merging: "合併中",
    pending_review: "待審核",
    rejected: "已退回",
  };
  return labels[status] || status;
}

function mergeStatusTone(status: string): "amber" | "blue" | "green" | "neutral" | "red" {
  if (status === "merged") return "green";
  if (status === "approved" || status === "merging") return "blue";
  if (status === "failed" || status === "rejected") return "red";
  if (status === "pending_review") return "amber";
  return "neutral";
}

function settlementStatusLabel(status: string) {
  const labels: Record<string, string> = {
    completed: "已完成",
    correction_required: "待小幫手補正",
    final_payment_pending: "待支付尾款",
    payment_pending: "待付款",
    pending_admin_review: "待管理員審核",
    pending_helper_confirmation: "待小幫手確認",
    pending_helper_precheck: "待小幫手預檢",
    warehouse_pending: "待送倉回報",
    warehouse_review_pending: "待審核送倉證明",
  };
  return labels[status] || status;
}

function settlementEvidenceLabel(type: string) {
  if (type === "daily_receipt") return "每日收據";
  if (type === "transport_proof") return "交通照片";
  if (type === "warehouse_proof") return "集運倉照片";
  return "照片";
}

function adminTaskHref(category: string, subType?: string, tripId?: string) {
  const query = new URLSearchParams({ taskCategory: category, view: "tasks" });
  if (subType) query.set("taskSubType", subType);
  if (tripId) query.set("taskTripId", tripId);
  return `/admin?${query.toString()}`;
}

function isQuoteTaskType(value?: string): value is "detail" | "quote" | "quote_and_detail" {
  return ["detail", "quote", "quote_and_detail"].includes(value || "");
}

function normalizeTaskCategory(value?: string) {
  return value === "quote" || value === "purchase" ? value : undefined;
}

function normalizeTaskSubType(category?: string, value?: string) {
  if (category === "quote" && isQuoteTaskType(value)) return value;
  if (category === "purchase" && ["standard", "face_check"].includes(value || "")) {
    return value;
  }
  return undefined;
}

function normalizeAdminView(value?: string) {
  if (["home", "main", "checkout", "tasks", "rebuy", "live", "merge"].includes(value || "")) {
    return value || "home";
  }
  return "home";
}

function adminDashboardSections(view: string, mainSection?: string) {
  const sectionsByView: Record<string, string[]> = {
    checkout: ["settlements"],
    home: ["summary"],
    live: [
      "trips",
      "sitePhotoBatches",
      "quoteTasks",
      "purchaseTasks",
      "stagingOrderPreviews",
    ],
    main:
      mainSection === "trips"
        ? ["summary", "trips"]
        : mainSection === "helpers" || mainSection === "create"
          ? ["summary", "helpers"]
          : ["summary"],
    merge: ["trips", "stagingOrderPreviews", "stagingMergeJobs"],
    rebuy: ["helpers", "purchaseTasks", "rebuyTasks"],
    tasks: ["trips", "sitePhotoBatches"],
  };
  return sectionsByView[view] || sectionsByView.home;
}

function normalizeMainSection(value?: string) {
  if (["create", "helpers", "trips"].includes(value || "")) return value;
  return undefined;
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

function adminTripGroupsHref(groups: TripGroupId[]) {
  const params = new URLSearchParams({ mainSection: "trips", view: "main" });
  params.set("tripGroups", groups.length ? groups.join(",") : "none");
  return `/admin?${params.toString()}`;
}

function tripStatusesForGroups(groups: TripGroupId[]) {
  const statuses = new Set<string>();
  for (const group of groups) {
    if (group === "completed") statuses.add("ended");
    if (group === "notStarted") {
      statuses.add("draft");
      statuses.add("scheduled");
      statuses.add("departed");
      statuses.add("arrived");
    }
    if (group === "inProgress") statuses.add("active");
  }
  return Array.from(statuses);
}
