import { cn } from "@/src/lib/utils";

const stages = [
  { helperAction: true, label: "初次檢查" },
  { helperAction: false, label: "管理員審核" },
  { helperAction: true, label: "最終確認" },
  { helperAction: false, label: "等待匯款" },
  { helperAction: true, label: "集運回報" },
];

export function SettlementProgress({ settlement }: { settlement: any }) {
  const current = settlementStage(settlement.status);
  return (
    <div aria-label="結帳進度" className="flex flex-wrap gap-2">
      {stages.map((stage, index) => {
        const completed = index < current || settlement.status === "completed";
        const active = index === current && settlement.status !== "completed";
        return (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium",
              completed && "border-emerald-200 bg-emerald-50 text-emerald-700",
              active && stage.helperAction && "border-amber-300 bg-amber-100 text-amber-900",
              active && !stage.helperAction && "border-primary/30 bg-primary/10 text-primary",
              !completed && !active && "bg-background text-muted-foreground",
            )}
            key={stage.label}
          >
            {stage.label}
            {active && stage.helperAction ? <strong>· 需要你處理</strong> : null}
          </span>
        );
      })}
    </div>
  );
}

export function SettlementAmountHero({
  label = "本次結帳總額",
  settlement,
}: {
  label?: string;
  settlement: any;
}) {
  const hasTotal = settlement.total_payable_twd !== null;
  return (
    <div className="rounded-xl bg-primary px-4 py-4 text-primary-foreground">
      <p className="text-xs font-medium opacity-70">{label}</p>
      <p className="mt-1 text-3xl font-semibold tracking-tight">
        {hasTotal ? `TWD ${formatMoney(settlement.total_payable_twd)}` : "等待金額確認"}
      </p>
      <p className="mt-2 text-xs opacity-75">
        商品 JPY {formatMoney(settlement.product_total_jpy)}
        {settlement.is_split_payment && hasTotal ? " · 兩階段付款" : ""}
      </p>
    </div>
  );
}

export function settlementStage(status: string) {
  if (["pending_helper_precheck", "correction_required"].includes(status)) return 0;
  if (["pending_admin_review", "pending_helper_confirmation"].includes(status)) return 1;
  if (["payment_pending", "final_payment_pending"].includes(status)) return 2;
  return 3;
}

function formatMoney(value: unknown) {
  return new Intl.NumberFormat("zh-TW").format(Number(value || 0));
}
