"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

const REFRESH_INTERVAL_MS = 8_000;

type SettlementState = {
  id: string;
  status: string;
  totalPayableTwd: number | null;
  updatedAt: string;
};

export function SettlementAutoRefresh({
  settlementId,
  settlements,
}: {
  settlementId?: string;
  settlements: any[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [knownSignature, setKnownSignature] = useState(() =>
    stateSignature(settlements.map(toSettlementState)),
  );

  function refreshPage() {
    startTransition(() => {
      router.refresh();
    });
  }

  useEffect(() => {
    let active = true;
    async function checkForUpdates() {
      if (document.visibilityState !== "visible") return;
      try {
        const query = settlementId
          ? `?settlementId=${encodeURIComponent(settlementId)}`
          : "";
        const response = await fetch(`/api/helper/settlements${query}`, {
          cache: "no-store",
        });
        if (!response.ok) return;
        const data = await response.json();
        if (!active) return;
        const nextSignature = stateSignature(data.settlements || []);
        if (nextSignature !== knownSignature) {
          setKnownSignature(nextSignature);
          refreshPage();
        }
      } catch {
        // A later cycle retries transient mobile/network failures.
      }
    }
    const interval = window.setInterval(() => {
      void checkForUpdates();
    }, REFRESH_INTERVAL_MS);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [knownSignature, router, settlementId]);

  return null;
}

function toSettlementState(settlement: any): SettlementState {
  return {
    id: settlement.id,
    status: settlement.status,
    totalPayableTwd: settlement.total_payable_twd,
    updatedAt: settlement.updated_at,
  };
}

function stateSignature(settlements: SettlementState[]) {
  return settlements
    .map((settlement) =>
      [
        settlement.id,
        settlement.status,
        settlement.totalPayableTwd ?? "",
        settlement.updatedAt,
      ].join(":"),
    )
    .sort()
    .join("|");
}
