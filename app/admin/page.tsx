import { redirect } from "next/navigation";
import type React from "react";
import {
  Camera,
  CalendarPlus,
  ClipboardList,
  CreditCard,
  Home,
  PackageSearch,
  Radio,
  ShoppingBag,
  Users,
} from "lucide-react";

import {
  activateTripAction,
  cancelTripAction,
  deactivateHelperAction,
  recordSettlementPaymentAction,
  reviewSettlementAction,
  reviewWarehouseProofAction,
  saveSitePhotoAction,
  setSettlementExchangeRateAction,
  reviewFaceCheckPurchaseAction,
} from "../actions/admin";
import { ActionButtonForm } from "../components/ActionButtonForm";
import { SessionBar } from "../components/SessionBar";
import { Button } from "../components/ui/button";
import adminAuthorization from "../../src/server/admin-authorization";
import database from "../../src/server/database";
import service from "../../src/server/helper-app-service";
import { createR2ObjectStore } from "../../src/server/r2-object-store";
import { createServerSupabaseClient } from "../../src/server/supabase";
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
  liveTripId?: string;
  mainSection?: string;
  taskCategory?: string;
  taskSubType?: string;
  taskTripId?: string;
  view?: string;
};

export default async function AdminPage({
  searchParams,
}: {
  searchParams?: Promise<AdminSearchParams>;
}) {
  const params = (await searchParams) || {};
  const activeView = normalizeAdminView(params.view);
  const authClient = await createServerSupabaseClient();
  let admin;
  try {
    admin = await adminAuthorization.authorizeAdminByAllowlist(authClient);
  } catch {
    redirect("/login?next=/admin");
  }

  const [dashboard, customerNicknames] = await Promise.all([
    service.listAdminDashboard(database.getDatabasePool()),
    ["live", "tasks"].includes(activeView)
      ? service.listCustomerNicknames(database.getDatabasePool())
      : Promise.resolve([]),
  ]);
  const sitePhotoBatches = dashboard.sitePhotoBatches.length
    ? await service.attachSignedPhotoUrls(
        dashboard.sitePhotoBatches,
        createR2ObjectStore(),
      )
    : [];
  const quoteTasks = dashboard.quoteTasks.length
    ? await service.attachSignedQuoteTaskUrls(
        dashboard.quoteTasks,
        createR2ObjectStore(),
      )
    : [];
  const purchaseTasks = dashboard.purchaseTasks.length
    ? await service.attachSignedPurchaseTaskUrls(
        dashboard.purchaseTasks,
        createR2ObjectStore(),
      )
    : [];
  const settlements = dashboard.settlements.length
    ? await service.attachSignedSettlementUrls(
        dashboard.settlements,
        createR2ObjectStore(),
      )
    : [];
  const rebuyTasks = dashboard.rebuyTasks.length
    ? await service.attachSignedRebuyTaskUrls(
        dashboard.rebuyTasks,
        createR2ObjectStore(),
      )
    : [];
  const sitePhotosByTripId = groupSitePhotosByTripId(sitePhotoBatches);

  return (
    <>
      <SessionBar email={admin.email} title="管理工作台" />
      <main className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-5 sm:px-5 sm:py-7">
        <AdminNav activeView={activeView} />
        {activeView === "main" ? (
          <AdminMain dashboard={dashboard} selectedSection={params.mainSection} />
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
              <CreateRebuyTaskForm helpers={dashboard.helpers} purchaseTasks={dashboard.purchaseTasks} />
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
        ) : (
          <AdminHome dashboard={dashboard} />
        )}
      </main>
    </>
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
            <article className="grid gap-3 rounded-lg border bg-card p-4" key={settlement.id}>
              <div>
                <h3 className="font-semibold">{settlement.trip_name} · {settlement.helper_display_name}</h3>
                <p className="text-sm text-muted-foreground">
                  商品 JPY {settlement.product_total_jpy} · {settlementStatusLabel(settlement.status)}
                </p>
                {!hasRate ? (
                  <p className="mt-3 rounded-md border bg-muted/35 p-3 text-sm text-muted-foreground">
                    請先填寫當日 JPY→TWD 匯率。儲存後會顯示商品墊款；小幫手送出預檢後再核准結帳。
                  </p>
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
                  <div className="mt-2 grid gap-1 rounded-md bg-muted/50 p-3 text-sm">
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
                  <div className="mt-3 grid gap-2 rounded-md border bg-background p-3 text-sm">
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
                  <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">{group.empty}</p>
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
          <article className="rounded-lg border bg-card p-4 shadow-sm" key={task.id}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="font-semibold">{task.product_name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {task.visibility === "public" ? "公共" : "指定"} · {rebuyStatusLabel(task.status)} · {task.quantity} 件
                </p>
                <p className="mt-1 text-sm">
                  {task.line_community_name || "未填客人"} · JPY {task.original_price_jpy ?? "-"} · TWD {task.sale_price_twd ?? "-"}
                </p>
                {task.instructions ? <p className="mt-2 text-sm">{task.instructions}</p> : null}
              </div>
              <span className="rounded-full border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground">
                v{task.version} · priority {task.priority}
              </span>
            </div>
            <div className="mt-3 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
              <p>指定：{task.assigned_helper_display_name || "-"}</p>
              <p>認領：{task.claimed_helper_display_name || "-"}</p>
              {task.reported_quantity != null ? <p>回報數量：{task.reported_quantity}</p> : null}
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

function AdminNav({ activeView }: { activeView: string }) {
  const items = [
    ["home", "總覽", "/admin"],
    ["main", "主頁面", "/admin?view=main"],
    ["checkout", "結帳", "/admin?view=checkout"],
    ["tasks", "任務發布", "/admin?view=tasks"],
    ["rebuy", "補買", "/admin?view=rebuy"],
    ["live", "即時回傳", "/admin?view=live"],
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

function AdminHome({ dashboard }: { dashboard: any }) {
  const activeTrips = dashboard.trips.filter((trip: any) => trip.status === "active").length;
  const arrivedTrips = dashboard.trips.filter((trip: any) => trip.status === "arrived").length;
  const openQuoteTasks = dashboard.quoteTasks.filter((task: any) => task.status !== "completed").length;
  const openWork = activeTrips + arrivedTrips + openQuoteTasks;

  return (
    <section className="grid gap-5">
      <div className="rounded-lg border bg-card p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground">Admin Home</p>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
              今日營運總覽
            </h2>
          </div>
          <Button asChild>
            <a href={openWork ? "/admin?view=live" : "/admin?view=main"}>{openWork ? "進入即時回傳" : "管理行程"}</a>
          </Button>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <AdminMetric icon={<CalendarPlus className="size-5" />} label="行程" value={`${dashboard.trips.length}`} />
          <AdminMetric icon={<Radio className="size-5" />} label="連線中" value={`${activeTrips}`} />
          <AdminMetric icon={<Users className="size-5" />} label="等待確認" value={`${arrivedTrips}`} />
          <AdminMetric icon={<ClipboardList className="size-5" />} label="待回覆任務" value={`${openQuoteTasks}`} />
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <AdminShortcut href="/admin?view=main" icon={<Home className="size-5" />} label="行程與小幫手" value={`${dashboard.helpers.length} 位`} />
        <AdminShortcut href="/admin?view=checkout" icon={<CreditCard className="size-5" />} label="結帳" value="待開啟" />
        <AdminShortcut href="/admin?view=tasks" icon={<ClipboardList className="size-5" />} label="任務發布" value={`${openQuoteTasks} 待回覆`} />
        <AdminShortcut href="/admin?view=rebuy" icon={<PackageSearch className="size-5" />} label="補買" value="待命" />
      </div>
    </section>
  );
}

function AdminMain({ dashboard, selectedSection }: { dashboard: any; selectedSection?: string }) {
  const section = normalizeMainSection(selectedSection);
  const activeHelpers = dashboard.helpers.filter((helper: any) => helper.is_active);
  return (
    <AdminSection icon={<Home className="size-5" />} title="主頁面">
      <div className="grid gap-3 sm:grid-cols-3">
        <SelectionCard
          active={section === "trips"}
          body={`${dashboard.trips.length} 筆，依狀態整理。`}
          href="/admin?view=main&mainSection=trips"
          title="行程管理"
        />
        <SelectionCard
          active={section === "helpers"}
          body={`${activeHelpers.length} 位啟用小幫手，可編輯匯率、時薪與資料。`}
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
        <TripManagement trips={dashboard.trips} />
      ) : section === "helpers" ? (
        <HelperDirectory helpers={activeHelpers} />
      ) : (
        <div className="grid gap-4">
          <CreateTripForm helpers={activeHelpers} />
          <CreateHelperForm />
        </div>
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
                    body={`${trip.helper_display_name || "未指派"} · ${
                      (sitePhotosByTripId[trip.id] || []).length
                    } 張現場照片`}
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
            <article className="rounded-lg border bg-card p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold">{selectedTrip.trip_name}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {selectedTrip.helper_display_name || "未指派"} · {statusLabel(selectedTrip.status)}
                  </p>
                </div>
                <span className="rounded-full border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground">
                  {(sitePhotosByTripId[selectedTrip.id] || []).length} 張可選
                </span>
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
            <article className="rounded-lg border bg-card p-4 shadow-sm">
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
          <section className="grid gap-3">
            <h3 className="text-lg font-semibold">{selectedTrip.trip_name} · 現場照片</h3>
            {visibleBatches.length === 0 ? (
              <EmptyPanel title="尚未收到現場照片" body="正在監聽此行程，等待小幫手上傳。" />
            ) : (
              <div className="grid gap-3">
                {visibleBatches.map((batch: any) => (
                  <article key={batch.id} className="rounded-lg border bg-card p-4 shadow-sm">
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
                        <div key={photo.id} className="rounded-md border bg-background p-2">
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
            <h3 className="text-lg font-semibold">詢價 / 細節回覆</h3>
            {visibleQuoteTasks.length === 0 ? (
              <EmptyPanel title="尚無詢價/細節任務" body="等待發布。" />
            ) : (
              <div className="grid gap-3">
                {visibleQuoteTasks.map((task: any) => (
                  <article key={task.id} className="rounded-lg border bg-card p-4 shadow-sm">
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
                        <div key={photo.id} className="rounded-md border bg-background p-3">
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
            <h3 className="text-lg font-semibold">採買任務</h3>
            {visiblePurchaseTasks.length === 0 ? (
              <EmptyPanel title="尚無採買任務" body="可從任務發布建立，或從已回覆的詢價項目快速發布。" />
            ) : (
              <div className="grid gap-3">
                {visiblePurchaseTasks.map((task: any) => (
                  <article key={task.id} className="rounded-lg border bg-card p-4 shadow-sm">
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
            <h3 className="text-lg font-semibold">Staging order preview</h3>
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

function HelperDirectory({ helpers }: { helpers: any[] }) {
  return (
    <section className="grid gap-3">
      <h3 className="text-lg font-semibold">小幫手資料</h3>
      {helpers.length ? (
        <div className="grid gap-3">
          {helpers.map((helper: any) => (
            <article key={helper.id} className="grid gap-3 rounded-lg border bg-card p-4 shadow-sm">
              <div className="flex justify-end">
                <ActionButtonForm
                  action={deactivateHelperAction}
                  fields={[{ name: "helperId", value: helper.id }]}
                  label="停用"
                  variant="outline"
                />
              </div>
              <EditHelperForm helper={helper} />
            </article>
          ))}
        </div>
      ) : (
        <EmptyPanel title="沒有啟用中的小幫手" body="停用帳號不會顯示在這裡；可從新增建立新的小幫手。" />
      )}
    </section>
  );
}

function TripManagement({ trips }: { trips: any[] }) {
  const groups = [
    { empty: "目前沒有未開始行程。", statuses: ["draft", "scheduled"], title: "未開始" },
    { empty: "目前沒有進行中行程。", statuses: ["departed", "arrived", "active"], title: "進行中" },
    { empty: "目前沒有已結束行程。", statuses: ["ended"], title: "已結束" },
    { empty: "目前沒有已取消行程。", statuses: ["canceled"], title: "已取消" },
  ];
  return (
    <section className="grid gap-3">
      <h3 className="text-lg font-semibold">行程管理</h3>
      <div className="grid gap-5">
        {groups.map((group) => {
          const records = trips.filter((trip: any) => group.statuses.includes(trip.status));
          return (
            <section className="grid gap-3" key={group.title}>
              <div className="flex items-center justify-between gap-3">
                <h4 className="font-semibold">{group.title}</h4>
                <span className="text-sm text-muted-foreground">{records.length} 筆</span>
              </div>
              {records.length ? (
                <div className="grid gap-3">
                  {records.map((trip: any) => (
                    <article key={trip.id} className="rounded-lg border bg-card p-4 shadow-sm">
                      <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="font-semibold">{trip.trip_name}</h4>
                            <span className="rounded-full border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground">
                              {statusLabel(trip.status)}
                            </span>
                          </div>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {service.dateOnly(trip.business_date, trip.timezone)} {trip.scheduled_time || ""} ·{" "}
                            {trip.timezone} · {trip.helper_display_name || "未指派"}
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
                              <a href="/admin?view=checkout">前往結帳</a>
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
                      {trip.status !== "ended" ? <RepairTripForm trip={trip} /> : null}
                    </article>
                  ))}
                </div>
              ) : (
                <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground shadow-sm">
                  {group.empty}
                </p>
              )}
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
        <span className="flex size-9 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
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
    <section className="grid gap-3">
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
    <a
      className={`rounded-lg border p-4 shadow-sm transition ${
        active
          ? "border-primary bg-primary/5 ring-1 ring-primary"
          : "bg-card hover:border-primary/40 hover:bg-accent/35"
      }`}
      href={href}
    >
      <div className="flex items-center gap-2">
        {icon ? (
          <span className="flex size-9 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
            {icon}
          </span>
        ) : null}
        <p className="font-semibold">{title}</p>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{body}</p>
    </a>
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
    <a className="rounded-lg border bg-card p-4 shadow-sm transition hover:border-primary/40 hover:bg-accent/40" href={href}>
      <span className="flex size-10 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
        {icon}
      </span>
      <h3 className="mt-3 font-semibold">{label}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{value}</p>
    </a>
  );
}

function AdminMetric({
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

function EmptyPanel({ body, title }: { body: string; title: string }) {
  return (
    <div className="rounded-lg border bg-card p-4 text-sm shadow-sm">
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-muted-foreground">{body}</p>
    </div>
  );
}

function groupSitePhotosByTripId(batches: any[]) {
  const groups: Record<string, any[]> = {};
  for (const batch of batches) {
    if (!groups[batch.trip_id]) groups[batch.trip_id] = [];
    groups[batch.trip_id].push(...(batch.photos || []));
  }
  return groups;
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
  if (["home", "main", "checkout", "tasks", "rebuy", "live"].includes(value || "")) {
    return value || "home";
  }
  return "home";
}

function normalizeMainSection(value?: string) {
  if (["create", "helpers", "trips"].includes(value || "")) return value || "trips";
  return "trips";
}
