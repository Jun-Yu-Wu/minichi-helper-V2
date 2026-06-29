const path = require("node:path");
const { createClient } = require("@supabase/supabase-js");
const { Client } = require("pg");

const database = require("../src/server/database");
const { authServerConfig, databaseConfig } = require("../src/server/config");
const { loadLocalEnv } = require("../src/server/load-local-env");
const { createR2ObjectStore } = require("../src/server/r2-object-store");
const service = require("../src/server/helper-app-service");

loadLocalEnv(path.join(__dirname, ".."));

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC0lEQVR42mP8/x8AAusB9Wl2jFAAAAAASUVORK5CYII=",
  "base64",
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function assertRejects(operation, message) {
  try {
    await operation();
  } catch {
    return;
  }
  throw new Error(message);
}

function randomPassword() {
  return `CodexSlice5-${Date.now()}-${Math.random().toString(36).slice(2)}!`;
}

function todayInTokyo() {
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Tokyo",
    year: "numeric",
  }).format(new Date());
}

async function createAuthUser(supabase, email, password) {
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
  });
  if (error) throw error;
  return { email, id: data.user.id, password };
}

async function createFixture(supabase) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const users = {
    helper: await createAuthUser(
      supabase,
      `codex-slice5-helper-${stamp}@example.com`,
      randomPassword(),
    ),
    other: await createAuthUser(
      supabase,
      `codex-slice5-other-${stamp}@example.com`,
      randomPassword(),
    ),
  };
  const client = new Client(databaseConfig());
  await client.connect();
  try {
    const helper = await insertHelper(client, users.helper, "Codex Slice 5 Helper");
    const other = await insertHelper(client, users.other, "Codex Slice 5 Other");
    const today = todayInTokyo();
    const small = await insertActiveTrip(client, helper.id, today, "Codex Slice 5 Small");
    const large = await insertActiveTrip(client, helper.id, today, "Codex Slice 5 Large");
    return { helpers: { helper, other }, trips: { large, small }, users };
  } catch (error) {
    await cleanupFixture(supabase, { users }, []);
    throw error;
  } finally {
    await client.end();
  }
}

async function insertHelper(client, user, displayName) {
  const result = await client.query(
    `insert into helper_app.helper_profiles
       (auth_user_id, display_name, email, compensation_mode, hourly_rate_twd,
        bank_account_name, bank_code, bank_account_number, region, is_active)
     values ($1, $2, $3, 'hourly', 240, $2, '812', '1234567890', 'Tokyo', true)
     returning id`,
    [user.id, displayName, user.email],
  );
  return result.rows[0];
}

async function insertActiveTrip(client, helperId, businessDate, tripName) {
  const result = await client.query(
    `insert into helper_app.trips
       (trip_name, business_date, scheduled_time, location, timezone,
        assigned_helper_id, status, departed_at, arrived_at, admin_activated_at)
     values ($1, $2, '10:00', 'Tokyo', 'Asia/Tokyo', $3, 'active',
        now() - interval '2 hours', now() - interval '100 minutes',
        now() - interval '90 minutes')
     returning id, version`,
    [tripName, businessDate, helperId],
  );
  return result.rows[0];
}

async function uploadFixturePhoto(r2, tripId, label, storageKeys) {
  const storageKey = [
    "helper-app",
    tripId,
    "slice5-acceptance",
    `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`,
  ].join("/");
  const uploadUrl = await r2.signedPutUrl(storageKey, "image/png");
  const response = await fetch(uploadUrl, {
    body: PNG,
    headers: { "content-type": "image/png" },
    method: "PUT",
  });
  assert(response.ok, `R2 upload failed for ${label}: ${response.status}`);
  storageKeys.push(storageKey);
  return {
    byteSize: PNG.length,
    contentType: "image/png",
    originalFilename: `${label}.png`,
    sortOrder: 0,
    storageKey,
  };
}

async function createCompletedPurchase(pool, r2, fixture, trip, label, priceJpy, storageKeys) {
  const referencePhoto = await uploadFixturePhoto(r2, trip.id, `${label}-reference`, storageKeys);
  const task = await service.createPurchaseTask(pool, {
    actorUserId: fixture.users.helper.id,
    lineCommunityName: `驗收客人-${label}`,
    originalPriceJpy: String(priceJpy),
    productName: `Slice 5 ${label}`,
    quantity: "1",
    referencePhotos: [referencePhoto],
    salePriceTwd: "999",
    tripId: trip.id,
  });
  const response = {
    action: "complete",
    authUserId: fixture.users.helper.id,
    completedQuantity: "1",
    idempotencyKey: `slice5-purchase-${label}-${Date.now()}`,
    purchaseTaskId: task.id,
  };
  const completed = await service.respondPurchaseTask(pool, response);
  const duplicate = await service.respondPurchaseTask(pool, response);
  assert(completed.status === "completed", `${label} purchase did not complete.`);
  assert(duplicate.status === "completed", `${label} purchase retry was not idempotent.`);
  return completed;
}

async function createOpenBlocker(pool, r2, fixture, trip, storageKeys) {
  const photo = await uploadFixturePhoto(r2, trip.id, "blocking-reference", storageKeys);
  return service.createPurchaseTask(pool, {
    actorUserId: fixture.users.helper.id,
    lineCommunityName: "驗收阻擋客人",
    originalPriceJpy: "500",
    productName: "Slice 5 Blocking Purchase",
    quantity: "1",
    referencePhotos: [photo],
    salePriceTwd: "200",
    tripId: trip.id,
  });
}

async function runSettlementLifecycle({
  actorUserId,
  fixture,
  includeTransport,
  pool,
  r2,
  settlement,
  storageKeys,
}) {
  const receipt = await uploadFixturePhoto(
    r2,
    settlement.trip_id,
    `${includeTransport ? "large" : "small"}-receipt`,
    storageKeys,
  );
  const transportProof = includeTransport
    ? await uploadFixturePhoto(r2, settlement.trip_id, "large-transport", storageKeys)
    : null;
  const firstSubmission = {
    authUserId: fixture.users.helper.id,
    helperNote: includeTransport ? "含交通費申請" : "小額結帳預檢",
    idempotencyKey: `slice5-precheck-${settlement.id}-first`,
    receipt,
    settlementId: settlement.id,
    transportJpy: includeTransport ? "1000" : "",
    transportProof,
  };
  const submitted = await service.submitSettlementPrecheck(pool, firstSubmission);
  const duplicate = await service.submitSettlementPrecheck(pool, firstSubmission);
  assert(submitted.status === "pending_admin_review", "Precheck did not reach admin review.");
  assert(duplicate.status === "pending_admin_review", "Precheck retry was not idempotent.");

  if (!includeTransport) {
    const rejected = await service.reviewSettlement(pool, {
      action: "reject",
      actorUserId,
      adminReviewNote: "請重新確認收據",
      settlementId: settlement.id,
    });
    assert(rejected.status === "correction_required", "Admin rejection did not request correction.");
    const resubmitted = await service.submitSettlementPrecheck(pool, {
      ...firstSubmission,
      helperNote: "已重新確認收據",
      idempotencyKey: `slice5-precheck-${settlement.id}-corrected`,
    });
    assert(resubmitted.status === "pending_admin_review", "Correction did not return to admin review.");
  }

  const approved = await service.reviewSettlement(pool, {
    action: "approve",
    actorUserId,
    adminReviewNote: "結帳資料正確",
    jpyToTwdRate: "0.22",
    settlementId: settlement.id,
    transportDecision: includeTransport ? "approve" : "reject",
  });
  assert(
    approved.status === "pending_helper_confirmation",
    "Admin approval did not reach helper confirmation.",
  );
  assert(
    approved.transport_status === (includeTransport ? "approved" : "none"),
    "Transport decision was not persisted.",
  );

  const confirmed = await service.confirmSettlement(pool, {
    authUserId: fixture.users.helper.id,
    settlementId: settlement.id,
  });
  assert(confirmed.status === "payment_pending", "Helper confirmation did not reach payment.");

  const firstPayment = await service.recordSettlementPayment(pool, {
    actorUserId,
    settlementId: settlement.id,
    transferNotification: includeTransport ? "Slice 5 first transfer" : "Slice 5 single transfer",
  });
  assert(firstPayment.status === "warehouse_pending", "Payment did not open warehouse proof.");

  const warehouseProof = await uploadFixturePhoto(
    r2,
    settlement.trip_id,
    `${includeTransport ? "large" : "small"}-warehouse`,
    storageKeys,
  );
  const warehouseSubmission = {
    authUserId: fixture.users.helper.id,
    idempotencyKey: `slice5-warehouse-${settlement.id}`,
    note: "已送達集運倉",
    proof: warehouseProof,
    settlementId: settlement.id,
  };
  const warehousePending = await service.submitWarehouseProof(pool, warehouseSubmission);
  const warehouseDuplicate = await service.submitWarehouseProof(pool, warehouseSubmission);
  assert(
    warehousePending.status === "warehouse_review_pending",
    "Warehouse proof did not reach admin review.",
  );
  assert(
    warehouseDuplicate.status === "warehouse_review_pending",
    "Warehouse retry was not idempotent.",
  );

  const afterWarehouseReview = await service.reviewWarehouseProof(pool, {
    actorUserId,
    settlementId: settlement.id,
  });
  if (approved.is_split_payment) {
    assert(
      afterWarehouseReview.status === "final_payment_pending",
      "Large settlement did not wait for final payment.",
    );
    const completed = await service.recordSettlementPayment(pool, {
      actorUserId,
      settlementId: settlement.id,
      transferNotification: "Slice 5 final transfer",
    });
    assert(completed.status === "completed", "Large settlement final payment did not complete.");
  } else {
    assert(
      afterWarehouseReview.status === "completed",
      "Small settlement did not complete after warehouse approval.",
    );
  }
}

async function verifyAcceptance(pool, fixture) {
  const client = await pool.connect();
  try {
    const settlements = await client.query(
      `select id, trip_id, status, item_advance_twd, is_split_payment,
              transport_status, total_payable_twd
       from helper_app.settlements
       where trip_id = any($1::uuid[])
       order by item_advance_twd`,
      [[fixture.trips.small.id, fixture.trips.large.id]],
    );
    assert(settlements.rows.length === 2, "Expected two Slice 5 settlements.");
    assert(settlements.rows.every((row) => row.status === "completed"), "Not all settlements completed.");
    assert(settlements.rows[0].is_split_payment === false, "Small settlement was split.");
    assert(settlements.rows[1].is_split_payment === true, "Large settlement was not split.");

    const evidence = await client.query(
      `select se.evidence_type, se.storage_key, mo.media_kind, mo.retention_status
       from helper_app.settlement_evidence se
       join helper_app.settlements s on s.id = se.settlement_id
       join helper_app.media_objects mo on mo.storage_key = se.storage_key
       where s.trip_id = any($1::uuid[])`,
      [[fixture.trips.small.id, fixture.trips.large.id]],
    );
    const warehouseRows = evidence.rows.filter((row) => row.evidence_type === "warehouse_proof");
    assert(warehouseRows.length === 2, "Warehouse evidence count was incorrect.");
    assert(
      warehouseRows.every(
        (row) =>
          row.media_kind === "warehouse_evidence" &&
          row.retention_status === "warehouse_evidence" &&
          !/^https?:\/\//.test(row.storage_key),
      ),
      "Warehouse evidence did not preserve durable private storage keys.",
    );

    const payments = await client.query(
      `select sp.payment_type, sp.amount_twd, sp.transfer_notification, s.is_split_payment
       from helper_app.settlement_payments sp
       join helper_app.settlements s on s.id = sp.settlement_id
       where s.trip_id = any($1::uuid[])
       order by sp.paid_at`,
      [[fixture.trips.small.id, fixture.trips.large.id]],
    );
    assert(payments.rows.length === 3, "Expected one small and two large payments.");
    assert(
      payments.rows.every((row) => row.amount_twd > 0 && row.transfer_notification),
      "Payment audit fields were incomplete.",
    );

    const audit = await client.query(
      `select action
       from helper_app.trip_audit_events
       where trip_id = any($1::uuid[])`,
      [[fixture.trips.small.id, fixture.trips.large.id]],
    );
    const actions = new Set(audit.rows.map((row) => row.action));
    for (const action of [
      "helper_ended",
      "helper_settlement_precheck_submitted",
      "admin_settlement_approved",
      "helper_settlement_confirmed",
      "helper_warehouse_proof_submitted",
      "admin_warehouse_proof_approved",
    ]) {
      assert(actions.has(action), `Missing Slice 5 audit event: ${action}`);
    }

    const mainLinks = await client.query(
      `select count(*)::int as count
       from main.order_source_links
       where trip_id = any($1::text[])`,
      [[fixture.trips.small.id, fixture.trips.large.id]],
    );
    assert(mainLinks.rows[0].count === 0, "Slice 5 unexpectedly wrote main order provenance.");

    return {
      auditActions: actions.size,
      evidenceCount: evidence.rows.length,
      paymentCount: payments.rows.length,
      settlements: settlements.rows,
    };
  } finally {
    client.release();
  }
}

async function cleanupFixture(supabase, fixture, storageKeys) {
  const client = new Client(databaseConfig());
  await client.connect();
  try {
    const tripIds = Object.values(fixture.trips || {}).map((trip) => trip.id).filter(Boolean);
    const helperIds = Object.values(fixture.helpers || {}).map((helper) => helper.id).filter(Boolean);
    if (tripIds.length) {
      await client.query(
        `delete from helper_app.settlement_payments
         where settlement_id in (select id from helper_app.settlements where trip_id = any($1::uuid[]))`,
        [tripIds],
      );
      await client.query("delete from helper_app.settlements where trip_id = any($1::uuid[])", [tripIds]);
      await client.query("delete from helper_app.trips where id = any($1::uuid[])", [tripIds]);
    }
    if (storageKeys.length) {
      await client.query("delete from helper_app.media_objects where storage_key = any($1::text[])", [
        storageKeys,
      ]);
    }
    if (helperIds.length) {
      await client.query("delete from helper_app.helper_profiles where id = any($1::uuid[])", [
        helperIds,
      ]);
    }
  } catch (error) {
    console.error("Slice 5 database cleanup failed:", error.message);
  } finally {
    await client.end();
  }

  const r2 = createR2ObjectStore();
  for (const storageKey of storageKeys) {
    try {
      await r2.deleteObject(storageKey);
    } catch (error) {
      console.error(`Failed to delete R2 object ${storageKey}:`, error.message);
    }
  }
  for (const user of Object.values(fixture.users || {})) {
    if (!user?.id) continue;
    const { error } = await supabase.auth.admin.deleteUser(user.id);
    if (error) console.error(`Failed to delete auth user ${user.id}:`, error.message);
  }
}

async function main() {
  const supabase = createClient(authServerConfig().url, authServerConfig().secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  const fixture = await createFixture(supabase);
  const storageKeys = [];
  try {
    const pool = database.getDatabasePool();
    const r2 = createR2ObjectStore();
    await createCompletedPurchase(
      pool,
      r2,
      fixture,
      fixture.trips.small,
      "Small Purchase",
      10_000,
      storageKeys,
    );
    await createCompletedPurchase(
      pool,
      r2,
      fixture,
      fixture.trips.large,
      "Large Purchase",
      100_000,
      storageKeys,
    );
    const blocker = await createOpenBlocker(pool, r2, fixture, fixture.trips.large, storageKeys);
    await assertRejects(
      () =>
        service.markHelperEnded(pool, {
          authUserId: fixture.users.helper.id,
          expectedVersion: fixture.trips.large.version,
          tripId: fixture.trips.large.id,
        }),
      "Trip end was not blocked by an open purchase task.",
    );
    await service.respondPurchaseTask(pool, {
      action: "cancel",
      authUserId: fixture.users.helper.id,
      helperNote: "Slice 5 acceptance resolved blocker.",
      idempotencyKey: `slice5-blocker-cancel-${Date.now()}`,
      purchaseTaskId: blocker.id,
    });

    const smallEnd = await service.markHelperEnded(pool, {
      authUserId: fixture.users.helper.id,
      expectedVersion: fixture.trips.small.version,
      tripId: fixture.trips.small.id,
    });
    const largeEnd = await service.markHelperEnded(pool, {
      authUserId: fixture.users.helper.id,
      expectedVersion: fixture.trips.large.version,
      tripId: fixture.trips.large.id,
    });
    assert(smallEnd.trip.ended_at && largeEnd.trip.ended_at, "Trip end timestamps were not written.");

    await assertRejects(
      () =>
        service.authorizeSettlementEvidenceUpload(pool, {
          authUserId: fixture.users.other.id,
          evidenceType: "daily_receipt",
          settlementId: smallEnd.settlement.id,
        }),
      "Another helper was allowed to upload settlement evidence.",
    );
    const ownAuthorization = await service.authorizeSettlementEvidenceUpload(pool, {
      authUserId: fixture.users.helper.id,
      evidenceType: "daily_receipt",
      settlementId: smallEnd.settlement.id,
    });
    assert(ownAuthorization.trip_id === fixture.trips.small.id, "Own settlement authorization failed.");

    await runSettlementLifecycle({
      actorUserId: fixture.users.other.id,
      fixture,
      includeTransport: false,
      pool,
      r2,
      settlement: smallEnd.settlement,
      storageKeys,
    });
    await runSettlementLifecycle({
      actorUserId: fixture.users.other.id,
      fixture,
      includeTransport: true,
      pool,
      r2,
      settlement: largeEnd.settlement,
      storageKeys,
    });

    const workspace = await service.getHelperWorkspace(pool, fixture.users.other.id);
    assert(workspace.settlements.length === 0, "Other helper could read Slice 5 settlements.");
    const verification = await verifyAcceptance(pool, fixture);
    console.log(
      JSON.stringify(
        {
          ...verification,
          productAcceptance: "slice5",
          uploadedR2ObjectCount: storageKeys.length,
        },
        null,
        2,
      ),
    );
  } finally {
    await cleanupFixture(supabase, fixture, storageKeys);
    await database.getDatabasePool().end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
