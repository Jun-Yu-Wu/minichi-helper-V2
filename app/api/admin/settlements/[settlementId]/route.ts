import { NextResponse } from "next/server";

import { getCurrentAdmin } from "../../../../../src/server/current-session";
import database from "../../../../../src/server/database";
import service from "../../../../../src/server/helper-app-service";

function formText(formData: FormData, name: string) {
  return String(formData.get(name) || "").trim();
}

function settlementError(error: unknown) {
  console.error("Admin settlement API failed", error);
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "操作失敗，請稍後再試。" },
    { status: 400 },
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ settlementId: string }> },
) {
  let admin;
  try {
    admin = await getCurrentAdmin();
  } catch {
    return NextResponse.json({ error: "請先登入管理員帳號。" }, { status: 401 });
  }

  const { settlementId } = await params;
  const formData = await request.formData();
  const action = formText(formData, "action");
  const inputSettlementId = formText(formData, "settlementId") || settlementId;
  if (inputSettlementId !== settlementId) {
    return NextResponse.json({ error: "結帳資料不一致，請重新整理後再試。" }, { status: 400 });
  }

  try {
    if (action === "set_exchange_rate") {
      const settlement = await service.setSettlementExchangeRate(database.getDatabasePool(), {
        actorUserId: admin.user.id,
        jpyToTwdRate: formText(formData, "jpyToTwdRate"),
        settlementId,
      });
      return NextResponse.json({ message: "匯率已儲存。", ok: true, settlement });
    }

    if (action === "review") {
      await service.reviewSettlement(database.getDatabasePool(), {
        action: formText(formData, "reviewAction"),
        actorUserId: admin.user.id,
        adminReviewNote: formText(formData, "adminReviewNote"),
        jpyToTwdRate: formText(formData, "jpyToTwdRate"),
        settlementId,
        transportDecision: formText(formData, "transportDecision"),
      });
      return NextResponse.json({ message: "結帳審核已更新。", ok: true });
    }

    if (action === "record_payment") {
      await service.recordSettlementPayment(database.getDatabasePool(), {
        actorUserId: admin.user.id,
        settlementId,
        transferNotification: formText(formData, "transferNotification"),
      });
      return NextResponse.json({ message: "付款紀錄已儲存。", ok: true });
    }

    if (action === "review_warehouse_proof") {
      await service.reviewWarehouseProof(database.getDatabasePool(), {
        actorUserId: admin.user.id,
        settlementId,
      });
      return NextResponse.json({ message: "送倉證明已核准。", ok: true });
    }

    return NextResponse.json({ error: "未知的結帳操作。" }, { status: 400 });
  } catch (error) {
    return settlementError(error);
  }
}
