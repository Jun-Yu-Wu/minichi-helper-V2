const SPLIT_PAYMENT_THRESHOLD_TWD = 20_000;

class SettlementError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SettlementError";
    this.code = code;
  }
}

function calculateWorkMinutes(departedAt, endedAt) {
  const start = new Date(departedAt).getTime();
  const end = new Date(endedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    throw new SettlementError("invalid_work_time", "Departure and end time are required for settlement.");
  }
  return Math.max(0, Math.ceil((end - start) / 60_000));
}

function calculateSettlement({
  compensationMode,
  helperFxRate,
  hourlyRateTwd,
  jpyToTwdRate,
  productTotalJpy,
  transportJpy = 0,
  transportApproved = false,
  workMinutes,
}) {
  const rate = positiveNumber(jpyToTwdRate, "jpyToTwdRate");
  const productJpy = nonNegativeInteger(productTotalJpy, "productTotalJpy");
  const minutes = nonNegativeInteger(workMinutes, "workMinutes");
  const approvedTransportJpy = transportApproved
    ? nonNegativeInteger(transportJpy, "transportJpy")
    : 0;
  const itemAdvanceTwd = Math.round(productJpy * rate);
  const approvedTransportTwd = Math.round(approvedTransportJpy * rate);
  const workPayTwd =
    compensationMode === "hourly"
      ? Math.round((minutes / 60) * nonNegativeNumber(hourlyRateTwd, "hourlyRateTwd"))
      : 0;

  let totalPayableTwd;
  if (compensationMode === "fx_rate") {
    totalPayableTwd =
      Math.round(productJpy * positiveNumber(helperFxRate, "helperFxRate")) +
      approvedTransportTwd;
  } else if (compensationMode === "hourly") {
    totalPayableTwd = itemAdvanceTwd + workPayTwd + approvedTransportTwd;
  } else {
    throw new SettlementError("invalid_compensation_mode", "Unknown compensation mode.");
  }

  const isSplitPayment = itemAdvanceTwd > SPLIT_PAYMENT_THRESHOLD_TWD;
  const firstPaymentTwd = isSplitPayment ? Math.round(totalPayableTwd / 2) : totalPayableTwd;

  return {
    approvedTransportTwd,
    finalPaymentTwd: isSplitPayment ? totalPayableTwd - firstPaymentTwd : 0,
    firstPaymentTwd,
    isSplitPayment,
    itemAdvanceTwd,
    totalPayableTwd,
    workPayTwd,
  };
}

function nonNegativeInteger(value, field) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw new SettlementError("invalid_number", `${field} must be a non-negative integer.`);
  }
  return number;
}

function nonNegativeNumber(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new SettlementError("invalid_number", `${field} must be a non-negative number.`);
  }
  return number;
}

function positiveNumber(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new SettlementError("invalid_number", `${field} must be greater than zero.`);
  }
  return number;
}

function isSettlementError(error) {
  return error instanceof SettlementError;
}

module.exports = {
  SPLIT_PAYMENT_THRESHOLD_TWD,
  SettlementError,
  calculateSettlement,
  calculateWorkMinutes,
  isSettlementError,
};
