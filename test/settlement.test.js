const assert = require("node:assert/strict");
const test = require("node:test");

const {
  calculateSettlement,
  calculateWorkMinutes,
} = require("../src/domain/settlement");

test("hourly settlement uses departed-to-ended time and item advance for split threshold", () => {
  const workMinutes = calculateWorkMinutes(
    "2026-06-28T01:00:00.000Z",
    "2026-06-28T03:30:00.000Z",
  );
  const result = calculateSettlement({
    compensationMode: "hourly",
    hourlyRateTwd: 200,
    jpyToTwdRate: 0.22,
    productTotalJpy: 100_000,
    transportApproved: true,
    transportJpy: 1_000,
    workMinutes,
  });

  assert.equal(workMinutes, 150);
  assert.equal(result.itemAdvanceTwd, 22_000);
  assert.equal(result.workPayTwd, 500);
  assert.equal(result.approvedTransportTwd, 220);
  assert.equal(result.totalPayableTwd, 22_720);
  assert.equal(result.isSplitPayment, true);
  assert.equal(result.firstPaymentTwd + result.finalPaymentTwd, result.totalPayableTwd);
});

test("fx-rate settlement excludes an unapproved transport claim", () => {
  const result = calculateSettlement({
    compensationMode: "fx_rate",
    helperFxRate: 0.25,
    jpyToTwdRate: 0.22,
    productTotalJpy: 50_000,
    transportApproved: false,
    transportJpy: 2_000,
    workMinutes: 60,
  });

  assert.equal(result.itemAdvanceTwd, 11_000);
  assert.equal(result.approvedTransportTwd, 0);
  assert.equal(result.totalPayableTwd, 12_500);
  assert.equal(result.isSplitPayment, false);
});
