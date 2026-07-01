const {
  buildTransition,
  repairTrip: buildRepairTransition,
} = require("../domain/trip-state");
const {
  calculateSettlement,
  calculateWorkMinutes,
} = require("../domain/settlement");
const { withTransaction } = require("./database");

class HelperAppServiceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "HelperAppServiceError";
    this.code = code;
  }
}

async function listAdminDashboard(database) {
  const [helpers, trips, sitePhotoBatches, quoteTasks, purchaseTasks, rebuyTasks, stagingOrderPreviews, settlements] = await Promise.all([
    database.query(
      `select id, auth_user_id, display_name, email, compensation_mode,
              hourly_rate_twd, helper_fx_rate, bank_account_name, bank_code,
              bank_account_number, region, is_active, created_at, updated_at
       from helper_app.helper_profiles
       order by created_at desc`,
    ),
    database.query(
      `select t.id, t.trip_name, t.business_date, t.scheduled_time, t.location,
              t.timezone, t.assigned_helper_id, t.status, t.departed_at,
              t.arrived_at, t.admin_activated_at, t.ended_at, t.canceled_at,
              t.version, t.created_at, t.updated_at,
              hp.display_name as helper_display_name
       from helper_app.trips t
       left join helper_app.helper_profiles hp on hp.id = t.assigned_helper_id
       order by t.business_date desc, t.scheduled_time nulls last, t.created_at desc`,
    ),
    listSitePhotoBatches(database),
    listQuoteTasks(database),
    listPurchaseTasks(database),
    listRebuyTasks(database, { includePrivateCustomerData: true }),
    listStagingOrderPreviews(database),
    listSettlements(database),
  ]);
  return { helpers: helpers.rows, purchaseTasks, quoteTasks, rebuyTasks, settlements, sitePhotoBatches, stagingOrderPreviews, trips: trips.rows };
}

async function listCustomerNicknames(database) {
  const result = await database.query(
    `select line_community_name
     from main.customers
     where nullif(btrim(line_community_name), '') is not null
     order by line_community_name asc`,
  );
  return result.rows.map((row) => row.line_community_name);
}

async function getHelperWorkspace(database, authUserId, now = new Date()) {
  const profileResult = await database.query(
    `select id, auth_user_id, display_name, email, compensation_mode,
            hourly_rate_twd, helper_fx_rate, bank_account_name, bank_code,
            bank_account_number, region, is_active, created_at, updated_at
     from helper_app.helper_profiles
     where auth_user_id = $1`,
    [authUserId],
  );
  const profile = profileResult.rows[0] || null;
  if (!profile || !profile.is_active) {
    return {
      groups: { completed: [], history: [], inProgress: [], notStarted: [], today: [], upcoming: [] },
      profile,
    };
  }

  const tripsResult = await database.query(
    `select id, trip_name, business_date, scheduled_time, location, timezone,
            assigned_helper_id, status, departed_at, arrived_at,
            admin_activated_at, ended_at, canceled_at, version, created_at,
            updated_at
     from helper_app.trips
     where assigned_helper_id = $1
     order by business_date asc, scheduled_time nulls last, created_at asc`,
    [profile.id],
  );
  return {
    groups: groupTripsByLocalDate(tripsResult.rows, now),
    profile,
    quoteTasksByTripId: groupQuoteTasksByTripId(
      await listQuoteTasks(database, {
        helperId: profile.id,
        tripIds: tripsResult.rows.map((trip) => trip.id),
      }),
    ),
    purchaseTasksByTripId: groupPurchaseTasksByTripId(
      await listPurchaseTasks(database, {
        helperId: profile.id,
        tripIds: tripsResult.rows.map((trip) => trip.id),
      }),
    ),
    rebuyTasks: await listRebuyTasks(database, { helperId: profile.id }),
    settlements: await listSettlements(database, { helperId: profile.id }),
    sitePhotoBatchesByTripId: groupBatchesByTripId(
      await listSitePhotoBatches(database, {
        helperId: profile.id,
        tripIds: tripsResult.rows.map((trip) => trip.id),
      }),
    ),
  };
}

async function listSettlements(database, { helperId = null } = {}) {
  const params = [];
  const where = helperId ? "where s.helper_id = $1" : "";
  if (helperId) params.push(helperId);
  const result = await database.query(
    `select s.*, t.trip_name, t.business_date, t.timezone,
            hp.display_name as helper_display_name,
            coalesce((
              select jsonb_agg(jsonb_build_object(
                'id', sli.id,
                'product_name', sli.product_name,
                'quantity', sli.quantity,
                'original_price_jpy', sli.original_price_jpy,
                'product_total_jpy', sli.product_total_jpy
              ) order by sli.created_at)
              from helper_app.settlement_line_items sli
              where sli.settlement_id = s.id
            ), '[]'::jsonb) as line_items,
            coalesce((
              select jsonb_agg(jsonb_build_object(
                'id', se.id,
                'evidence_type', se.evidence_type,
                'storage_key', se.storage_key,
                'note', se.note,
                'created_at', se.created_at
              ) order by se.created_at)
              from helper_app.settlement_evidence se
              where se.settlement_id = s.id
            ), '[]'::jsonb) as evidence,
            coalesce((
              select jsonb_agg(jsonb_build_object(
                'id', sp.id,
                'payment_type', sp.payment_type,
                'amount_twd', sp.amount_twd,
                'transfer_notification', sp.transfer_notification,
                'paid_at', sp.paid_at
              ) order by sp.paid_at)
              from helper_app.settlement_payments sp
              where sp.settlement_id = s.id
            ), '[]'::jsonb) as payments
     from helper_app.settlements s
     join helper_app.trips t on t.id = s.trip_id
     join helper_app.helper_profiles hp on hp.id = s.helper_id
     ${where}
     order by s.created_at desc`,
    params,
  );
  return result.rows;
}

async function listPurchaseTasks(database, { helperId = null, tripIds = null } = {}) {
  if (tripIds && tripIds.length === 0) return [];
  const conditions = [];
  const params = [];
  if (helperId) {
    params.push(helperId);
    conditions.push(`pt.helper_id = $${params.length}`);
  }
  if (tripIds) {
    params.push(tripIds);
    conditions.push(`pt.trip_id = any($${params.length}::uuid[])`);
  }
  const where = conditions.length ? `where ${conditions.join(" and ")}` : "";
  const result = await database.query(
    `select pt.id, pt.trip_id, pt.helper_id, pt.source_quote_task_id,
            pt.source_quote_task_photo_id, pt.source_quote_reply_id,
            pt.line_community_name, pt.product_name, pt.quantity,
            pt.original_price_jpy, pt.sale_price_twd, pt.note,
            pt.requires_face_check, pt.status, pt.completed_quantity,
            pt.unavailable_quantity, pt.helper_note, pt.face_check_note,
            pt.admin_review_note, pt.created_at, pt.updated_at, pt.completed_at,
            t.trip_name, t.business_date, t.timezone, t.status as trip_status,
            hp.display_name as helper_display_name,
            coalesce(
              jsonb_agg(
                jsonb_build_object(
                  'id', ptp.id,
                  'storage_key', ptp.storage_key,
                  'photo_role', ptp.photo_role,
                  'sort_order', ptp.sort_order,
                  'created_at', ptp.created_at
                )
                order by ptp.photo_role asc, ptp.sort_order asc
              ) filter (where ptp.id is not null),
              '[]'::jsonb
            ) as photos
     from helper_app.purchase_tasks pt
     join helper_app.trips t on t.id = pt.trip_id
     join helper_app.helper_profiles hp on hp.id = pt.helper_id
     left join helper_app.purchase_task_photos ptp on ptp.purchase_task_id = pt.id
     ${where}
     group by pt.id, t.id, hp.id
     order by pt.created_at desc`,
    params,
  );
  return result.rows;
}

async function listRebuyTasks(
  database,
  { helperId = null, includePrivateCustomerData = false } = {},
) {
  const conditions = [];
  const params = [];
  if (helperId) {
    params.push(helperId);
    conditions.push(`(
      rt.assigned_helper_id = $${params.length + 1}
      or rt.claimed_helper_id = $${params.length + 1}
      or (rt.visibility = 'public' and rt.status = 'open')
    )`);
  }
  const where = conditions.length ? `where ${conditions.join(" and ")}` : "";
  const result = await database.query(
    `select rt.id, rt.visibility, rt.assigned_helper_id, rt.claimed_helper_id,
            rt.source_purchase_task_id, rt.source_trip_id,
            case
              when $1::boolean or rt.visibility = 'private' or rt.status <> 'open'
              then rt.line_community_name
              else null
            end as line_community_name,
            rt.product_name, rt.quantity, rt.original_price_jpy,
            case
              when $1::boolean or rt.visibility = 'private' or rt.status <> 'open'
              then rt.sale_price_twd
              else null
            end as sale_price_twd,
            rt.instructions, rt.priority, rt.public_available_at, rt.status,
            rt.version, rt.reported_quantity, rt.remaining_quantity,
            rt.remaining_reason, rt.helper_report_note, rt.report_photos_omitted,
            rt.checkout_trip_id, rt.checkout_purchase_task_id,
            rt.created_at, rt.updated_at, rt.claimed_at, rt.released_at,
            rt.reported_at, rt.checked_out_at,
            ah.display_name as assigned_helper_display_name,
            ch.display_name as claimed_helper_display_name,
            coalesce(
              jsonb_agg(
                jsonb_build_object(
                  'id', rtp.id,
                  'storage_key', rtp.storage_key,
                  'photo_role', rtp.photo_role,
                  'sort_order', rtp.sort_order,
                  'created_at', rtp.created_at
                )
                order by rtp.photo_role asc, rtp.sort_order asc
              ) filter (where rtp.id is not null),
              '[]'::jsonb
            ) as photos
     from helper_app.rebuy_tasks rt
     left join helper_app.helper_profiles ah on ah.id = rt.assigned_helper_id
     left join helper_app.helper_profiles ch on ch.id = rt.claimed_helper_id
     left join helper_app.rebuy_task_photos rtp on rtp.rebuy_task_id = rt.id
     ${where}
     group by rt.id, ah.id, ch.id
     order by
       coalesce(rt.public_available_at, rt.created_at) desc,
       rt.created_at desc`,
    [includePrivateCustomerData, ...params],
  );
  return result.rows;
}

async function listStagingOrderPreviews(database, { helperId = null, tripIds = null } = {}) {
  if (tripIds && tripIds.length === 0) return [];
  const conditions = [];
  const params = [];
  if (helperId) {
    params.push(helperId);
    conditions.push(`sop.helper_id = $${params.length}`);
  }
  if (tripIds) {
    params.push(tripIds);
    conditions.push(`sop.trip_id = any($${params.length}::uuid[])`);
  }
  const where = conditions.length ? `where ${conditions.join(" and ")}` : "";
  const result = await database.query(
    `select sop.*, t.trip_name, hp.display_name as helper_display_name
     from helper_app.staging_order_previews sop
     join helper_app.trips t on t.id = sop.trip_id
     join helper_app.helper_profiles hp on hp.id = sop.helper_id
     ${where}
     order by sop.created_at desc`,
    params,
  );
  return result.rows;
}

async function listQuoteTasks(database, { helperId = null, tripIds = null } = {}) {
  if (tripIds && tripIds.length === 0) return [];
  const conditions = [];
  const params = [];
  if (helperId) {
    params.push(helperId);
    conditions.push(`qt.helper_id = $${params.length}`);
  }
  if (tripIds) {
    params.push(tripIds);
    conditions.push(`qt.trip_id = any($${params.length}::uuid[])`);
  }
  const where = conditions.length ? `where ${conditions.join(" and ")}` : "";
  const result = await database.query(
    `select qt.id, qt.trip_id, qt.helper_id, qt.task_type, qt.product_name,
            qt.instruction, qt.status, qt.created_at, qt.updated_at,
            t.trip_name, t.business_date, t.timezone, t.status as trip_status,
            hp.display_name as helper_display_name,
            coalesce(
              jsonb_agg(
                jsonb_build_object(
                  'id', qtp.id,
                  'source_site_photo_id', qtp.source_site_photo_id,
                  'storage_key', qtp.storage_key,
                  'product_name', qtp.product_name,
                  'instruction', qtp.instruction,
                  'sort_order', qtp.sort_order,
                  'reply_status', qtp.reply_status,
                  'needs_review', qtp.needs_review,
                  'created_at', qtp.created_at,
                  'latest_reply', reply.latest_reply
                )
                order by qtp.sort_order asc
              ) filter (where qtp.id is not null),
              '[]'::jsonb
            ) as photos
     from helper_app.quote_tasks qt
     join helper_app.trips t on t.id = qt.trip_id
     join helper_app.helper_profiles hp on hp.id = qt.helper_id
     left join helper_app.quote_task_photos qtp on qtp.quote_task_id = qt.id
     left join lateral (
       select jsonb_build_object(
                'id', qpr.id,
                'price_jpy', qpr.price_jpy,
                'note', qpr.note,
                'detail_photos', qpr.detail_photos,
                'created_at', qpr.created_at,
                'updated_at', qpr.updated_at
              ) as latest_reply
       from helper_app.quote_photo_replies qpr
       where qpr.quote_task_photo_id = qtp.id
       order by qpr.updated_at desc
       limit 1
     ) reply on true
     ${where}
     group by qt.id, t.id, hp.id
     order by qt.created_at desc`,
    params,
  );
  return result.rows;
}

async function listSitePhotoBatches(database, { helperId = null, tripIds = null } = {}) {
  if (tripIds && tripIds.length === 0) return [];
  const conditions = [];
  const params = [];
  if (helperId) {
    params.push(helperId);
    conditions.push(`b.helper_id = $${params.length}`);
  }
  if (tripIds) {
    params.push(tripIds);
    conditions.push(`b.trip_id = any($${params.length}::uuid[])`);
  }
  const where = conditions.length ? `where ${conditions.join(" and ")}` : "";
  const result = await database.query(
    `select b.id, b.trip_id, b.helper_id, b.submission_id, b.note, b.status,
            b.created_at, b.updated_at,
            t.trip_name, t.business_date, t.timezone, t.status as trip_status,
            hp.display_name as helper_display_name,
            coalesce(
              jsonb_agg(
                jsonb_build_object(
                  'id', p.id,
                  'client_photo_id', p.client_photo_id,
                  'storage_key', p.storage_key,
                  'original_filename', p.original_filename,
                  'content_type', p.content_type,
                  'byte_size', p.byte_size,
                  'sort_order', p.sort_order,
                  'saved_by_admin', p.saved_by_admin,
                  'saved_at', p.saved_at,
                  'created_at', p.created_at
                )
                order by p.sort_order asc
              ) filter (where p.id is not null),
              '[]'::jsonb
            ) as photos
     from helper_app.site_photo_batches b
     join helper_app.trips t on t.id = b.trip_id
     join helper_app.helper_profiles hp on hp.id = b.helper_id
     left join helper_app.site_photos p on p.batch_id = b.id
     ${where}
     group by b.id, t.id, hp.id
     order by b.created_at desc`,
    params,
  );
  return result.rows;
}

function groupBatchesByTripId(batches) {
  const groups = {};
  for (const batch of batches) {
    if (!groups[batch.trip_id]) groups[batch.trip_id] = [];
    groups[batch.trip_id].push(batch);
  }
  return groups;
}

function groupQuoteTasksByTripId(tasks) {
  const groups = {};
  for (const task of tasks) {
    if (!groups[task.trip_id]) groups[task.trip_id] = [];
    groups[task.trip_id].push(task);
  }
  return groups;
}

function groupPurchaseTasksByTripId(tasks) {
  const groups = {};
  for (const task of tasks) {
    if (!groups[task.trip_id]) groups[task.trip_id] = [];
    groups[task.trip_id].push(task);
  }
  return groups;
}

async function attachSignedPhotoUrls(batches, r2Store) {
  return Promise.all(
    batches.map(async (batch) => ({
      ...batch,
      photos: await Promise.all(
        (batch.photos || []).map(async (photo) => ({
          ...photo,
          signed_url: await r2Store.signedGetUrl(photo.storage_key),
        })),
      ),
    })),
  );
}

async function attachSignedQuoteTaskUrls(tasks, r2Store) {
  return Promise.all(
    tasks.map(async (task) => ({
      ...task,
      photos: await Promise.all(
        (task.photos || []).map(async (photo) => ({
          ...photo,
          signed_url: await r2Store.signedGetUrl(photo.storage_key),
          latest_reply: photo.latest_reply
            ? {
                ...photo.latest_reply,
                detail_photos: await Promise.all(
                  (photo.latest_reply.detail_photos || []).map(async (detailPhoto) => ({
                    ...detailPhoto,
                    signed_url: await r2Store.signedGetUrl(detailPhoto.storage_key),
                  })),
                ),
              }
            : null,
        })),
      ),
    })),
  );
}

async function attachSignedPurchaseTaskUrls(tasks, r2Store) {
  return Promise.all(
    tasks.map(async (task) => ({
      ...task,
      photos: await Promise.all(
        (task.photos || []).map(async (photo) => ({
          ...photo,
          signed_url: await r2Store.signedGetUrl(photo.storage_key),
        })),
      ),
    })),
  );
}

async function attachSignedRebuyTaskUrls(tasks, r2Store) {
  return Promise.all(
    tasks.map(async (task) => ({
      ...task,
      photos: await Promise.all(
        (task.photos || []).map(async (photo) => ({
          ...photo,
          signed_url: await r2Store.signedGetUrl(photo.storage_key),
        })),
      ),
    })),
  );
}

function groupTripsByLocalDate(trips, now = new Date()) {
  const groups = { completed: [], history: [], inProgress: [], notStarted: [], today: [], upcoming: [] };
  const recentCompletedCutoff = addDays(dateInTimezone(now, "Asia/Tokyo"), -2);
  for (const trip of trips) {
    if (trip.status === "ended") {
      const completedDate = dateOnly(trip.ended_at || trip.business_date, trip.timezone || "Asia/Tokyo");
      if (completedDate >= recentCompletedCutoff) groups.completed.push(trip);
    } else if (["departed", "arrived", "active"].includes(trip.status)) {
      groups.inProgress.push(trip);
    } else if (trip.status !== "canceled") {
      groups.notStarted.push(trip);
    }
  }
  return sortTripGroups(groups);
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function tripIsInProgress(status) {
  return ["departed", "arrived", "active"].includes(status);
}

function tripIsLiveWorkspaceOpen(status) {
  return status === "active";
}

function assertTripCanEnd(trip) {
  if (!tripIsInProgress(trip.status)) {
    throw new HelperAppServiceError("trip_not_active", "Only in-progress trips can be ended.");
  }
}

function assertTripCanUseLiveWorkspace(trip, message) {
  if (!tripIsLiveWorkspaceOpen(trip.status)) {
    throw new HelperAppServiceError("trip_not_active", message);
  }
}

function assertTripCanUploadSitePhotos(trip) {
  assertTripCanUseLiveWorkspace(trip, "Site photos can be uploaded only after the trip is active.");
}

function assertTripCanReplyQuote(trip) {
  assertTripCanUseLiveWorkspace(trip, "Quote replies can be submitted only while the trip is active.");
}

function assertTripCanDepart(trip) {
  if (!["draft", "scheduled"].includes(trip.status)) {
    throw new HelperAppServiceError("trip_not_active", "Only not-started trips can be marked departed.");
  }
}

function sortTripGroups(groups) {
  groups.notStarted.sort(compareTripDateAsc);
  groups.inProgress.sort(compareTripDateAsc);
  groups.completed.sort(compareTripDateDesc);
  groups.history = groups.completed;
  groups.today = groups.inProgress;
  groups.upcoming = groups.notStarted;
  return groups;
}

function compareTripDateAsc(a, b) {
  return tripDateValue(a).localeCompare(tripDateValue(b));
}

function compareTripDateDesc(a, b) {
  return tripDateValue(b).localeCompare(tripDateValue(a));
}

function tripDateValue(trip) {
  const relevantDate = trip.status === "ended" ? trip.ended_at || trip.business_date : trip.business_date;
  return `${dateOnly(relevantDate, trip.timezone || "Asia/Tokyo")} ${trip.scheduled_time || ""} ${trip.created_at || ""}`;
}

function dateInTimezone(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: timezone,
    year: "numeric",
  }).formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}

function dateOnly(value, timezone = "Asia/Tokyo") {
  if (value instanceof Date) return dateInTimezone(value, timezone);
  return String(value || "").slice(0, 10);
}

async function createHelperProfile(database, input) {
  const normalized = normalizeHelperInput(input);
  const result = await database.query(
    `insert into helper_app.helper_profiles
       (auth_user_id, display_name, email, compensation_mode, hourly_rate_twd,
        helper_fx_rate, bank_account_name, bank_code, bank_account_number,
        region, is_active)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true)
     returning *`,
    [
      normalized.authUserId,
      normalized.displayName,
      normalized.email,
      normalized.compensationMode,
      normalized.hourlyRateTwd,
      normalized.helperFxRate,
      normalized.bankAccountName,
      normalized.bankCode,
      normalized.bankAccountNumber,
      normalized.region,
    ],
  );
  return result.rows[0];
}

async function deactivateHelperProfile(database, helperId) {
  const result = await database.query(
    `update helper_app.helper_profiles
     set is_active = false, updated_at = now()
     where id = $1
     returning *`,
    [helperId],
  );
  if (!result.rows[0]) throw new HelperAppServiceError("not_found", "Helper profile was not found.");
  return result.rows[0];
}

async function updateHelperProfile(database, helperId, input) {
  const normalized = normalizeHelperInput(input);
  const result = await database.query(
    `update helper_app.helper_profiles
     set auth_user_id = $2,
         display_name = $3,
         email = $4,
         compensation_mode = $5,
         hourly_rate_twd = $6,
         helper_fx_rate = $7,
         bank_account_name = $8,
         bank_code = $9,
         bank_account_number = $10,
         region = $11,
         updated_at = now()
     where id = $1 and is_active = true
     returning *`,
    [
      requiredText(helperId, "helperId"),
      normalized.authUserId,
      normalized.displayName,
      normalized.email,
      normalized.compensationMode,
      normalized.hourlyRateTwd,
      normalized.helperFxRate,
      normalized.bankAccountName,
      normalized.bankCode,
      normalized.bankAccountNumber,
      normalized.region,
    ],
  );
  if (!result.rows[0]) throw new HelperAppServiceError("not_found", "Active helper profile was not found.");
  return result.rows[0];
}

async function createTrip(database, input) {
  const normalized = normalizeTripInput(input);
  const result = await database.query(
    `insert into helper_app.trips
       (trip_name, business_date, scheduled_time, location, timezone,
        assigned_helper_id, status)
     values ($1, $2, $3, $4, $5, $6, 'scheduled')
     returning *`,
    [
      normalized.tripName,
      normalized.businessDate,
      normalized.scheduledTime,
      normalized.location,
      normalized.timezone,
      normalized.assignedHelperId,
    ],
  );
  return result.rows[0];
}

async function authorizeSitePhotoUpload(database, { authUserId, tripId }) {
  const result = await database.query(
    `select t.id, t.status, t.business_date, t.timezone, t.assigned_helper_id,
            hp.id as helper_id, hp.is_active
     from helper_app.trips t
     join helper_app.helper_profiles hp on hp.id = t.assigned_helper_id
     where t.id = $1
       and hp.auth_user_id = $2`,
    [tripId, authUserId],
  );
  const row = result.rows[0];
  if (!row) throw new HelperAppServiceError("forbidden", "Trip is not assigned to this helper.");
  if (!row.is_active) throw new HelperAppServiceError("helper_inactive", "Helper profile is inactive.");
  assertTripCanUploadSitePhotos(row);
  return row;
}

async function submitSitePhotoBatch(database, { authUserId, note, photos, submissionId, tripId }) {
  const normalized = normalizeSitePhotoBatchInput({ note, photos, submissionId, tripId });
  return withTransaction(database, async (client) => {
    const helper = await findActiveHelperForUser(client, authUserId);
    const trip = await lockTrip(client, normalized.tripId);
    if (trip.assigned_helper_id !== helper.id) {
      throw new HelperAppServiceError("forbidden", "Trip is not assigned to this helper.");
    }
    assertTripCanUploadSitePhotos(trip);

    const existing = await client.query(
      `select id
       from helper_app.site_photo_batches
       where trip_id = $1 and helper_id = $2 and submission_id = $3`,
      [trip.id, helper.id, normalized.submissionId],
    );
    if (existing.rows[0]) return getSitePhotoBatchById(client, existing.rows[0].id);

    const batchResult = await client.query(
      `insert into helper_app.site_photo_batches
         (trip_id, helper_id, submission_id, note)
       values ($1, $2, $3, $4)
       returning *`,
      [trip.id, helper.id, normalized.submissionId, normalized.note],
    );
    const batch = batchResult.rows[0];

    for (const photo of normalized.photos) {
      await client.query(
        `insert into helper_app.media_objects
           (storage_key, media_kind, retention_status, original_filename,
            content_type, byte_size, uploaded_by_helper_id)
         values ($1, 'site_photo', 'temporary_work_media', $2, $3, $4, $5)
         on conflict (storage_key) do update
         set original_filename = coalesce(excluded.original_filename, helper_app.media_objects.original_filename),
             content_type = coalesce(excluded.content_type, helper_app.media_objects.content_type),
             byte_size = coalesce(excluded.byte_size, helper_app.media_objects.byte_size)`,
        [
          photo.storageKey,
          photo.originalFilename,
          photo.contentType,
          photo.byteSize,
          helper.id,
        ],
      );
      await client.query(
        `insert into helper_app.site_photos
           (batch_id, trip_id, helper_id, client_photo_id, storage_key,
            original_filename, content_type, byte_size, sort_order)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          batch.id,
          trip.id,
          helper.id,
          photo.clientPhotoId,
          photo.storageKey,
          photo.originalFilename,
          photo.contentType,
          photo.byteSize,
          photo.sortOrder,
        ],
      );
    }

    await insertAuditEvent(client, {
      action: "helper_site_photo_batch_submitted",
      actor_helper_id: helper.id,
      actor_role: "helper",
      actor_user_id: authUserId,
      after_state: {
        batchId: batch.id,
        photoCount: normalized.photos.length,
        submissionId: normalized.submissionId,
      },
      before_state: {},
      trip_id: trip.id,
    });

    return getSitePhotoBatchById(client, batch.id);
  });
}

async function createQuoteTask(
  database,
  { actorUserId, instruction, photoIds, productName, taskType, tripId, uploadedPhotos },
) {
  const normalized = normalizeQuoteTaskInput({
    instruction,
    photoIds,
    productName,
    taskType,
    tripId,
    uploadedPhotos,
  });
  return withTransaction(database, async (client) => {
    const trip = await lockTrip(client, normalized.tripId);
    if (!trip.assigned_helper_id) {
      throw new HelperAppServiceError("invalid_trip", "Trip must have an assigned helper.");
    }
    if (["ended", "canceled"].includes(trip.status)) {
      throw new HelperAppServiceError("trip_not_active", "Quote tasks cannot be created for ended or canceled trips.");
    }

    let taskPhotos;
    if (normalized.taskType === "detail") {
      const requiredPrefix = `helper-app/${trip.id}/admin-task-photos/`;
      for (const photo of normalized.uploadedPhotos) {
        if (!photo.storageKey.startsWith(requiredPrefix)) {
          throw new HelperAppServiceError("invalid_input", "Uploaded task photo does not belong to this trip.");
        }
      }
      taskPhotos = normalized.uploadedPhotos.map((photo) => ({
        ...photo,
        sourceSitePhotoId: null,
      }));
    } else {
      const photosResult = await client.query(
        `select id, trip_id, helper_id, storage_key
         from helper_app.site_photos
         where id = any($1::uuid[])
         order by array_position($1::uuid[], id)`,
        [normalized.photoIds],
      );
      if (photosResult.rows.length !== normalized.photoIds.length) {
        throw new HelperAppServiceError("photo_not_found", "Selected site photos were not found.");
      }
      for (const photo of photosResult.rows) {
        if (photo.trip_id !== trip.id || photo.helper_id !== trip.assigned_helper_id) {
          throw new HelperAppServiceError("invalid_input", "Selected photos must belong to this trip.");
        }
      }
      taskPhotos = photosResult.rows.map((photo) => ({
        sourceSitePhotoId: photo.id,
        storageKey: photo.storage_key,
      }));
    }

    const taskResult = await client.query(
      `insert into helper_app.quote_tasks
         (trip_id, helper_id, task_type, product_name, instruction, created_by_user_id)
       values ($1, $2, $3, $4, $5, $6)
       returning *`,
      [
        trip.id,
        trip.assigned_helper_id,
        normalized.taskType,
        normalized.productName,
        normalized.instruction,
        actorUserId,
      ],
    );
    const task = taskResult.rows[0];

    for (const [index, photo] of taskPhotos.entries()) {
      if (normalized.taskType === "detail") {
        await client.query(
          `insert into helper_app.media_objects
             (storage_key, media_kind, retention_status, original_filename, content_type, byte_size)
           values ($1, 'quote_task_photo', 'task_evidence', $2, $3, $4)
           on conflict (storage_key) do update
           set media_kind = 'quote_task_photo',
               retention_status = 'task_evidence',
               original_filename = excluded.original_filename,
               content_type = excluded.content_type,
               byte_size = excluded.byte_size`,
          [
            photo.storageKey,
            photo.originalFilename,
            photo.contentType,
            photo.byteSize,
          ],
        );
      } else {
        await client.query(
          `update helper_app.media_objects
           set media_kind = 'quote_task_photo',
               retention_status = 'task_evidence'
           where storage_key = $1`,
          [photo.storageKey],
        );
      }
      await client.query(
        `insert into helper_app.quote_task_photos
           (quote_task_id, trip_id, helper_id, source_site_photo_id, storage_key,
            product_name, instruction, sort_order)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          task.id,
          trip.id,
          trip.assigned_helper_id,
          photo.sourceSitePhotoId,
          photo.storageKey,
          normalized.productName,
          normalized.instruction,
          index,
        ],
      );
    }

    await insertAuditEvent(client, {
      action: "admin_quote_task_created",
      actor_role: "admin",
      actor_user_id: actorUserId,
      after_state: {
        photoCount: taskPhotos.length,
        taskId: task.id,
        taskType: task.task_type,
      },
      before_state: {},
      trip_id: trip.id,
    });
    return getQuoteTaskById(client, task.id);
  });
}

async function createPurchaseTask(database, input) {
  const normalized = normalizePurchaseTaskInput(input);
  const referencePhotos = normalizePurchaseReferencePhotos(input.referencePhotos || input.uploadedPhotos);
  if (!referencePhotos.length) {
    throw new HelperAppServiceError("invalid_input", "At least one purchase reference photo is required.");
  }
  return withTransaction(database, async (client) => {
    const trip = await lockTrip(client, normalized.tripId);
    if (!trip.assigned_helper_id) {
      throw new HelperAppServiceError("invalid_trip", "Trip must have an assigned helper.");
    }
    if (trip.status !== "active") {
      throw new HelperAppServiceError("trip_not_active", "Purchase tasks can only be created for an active trip.");
    }
    const task = await insertPurchaseTask(client, {
      ...normalized,
      helperId: trip.assigned_helper_id,
    });
    for (const [index, photo] of referencePhotos.entries()) {
      await client.query(
        `insert into helper_app.media_objects
           (storage_key, media_kind, retention_status, original_filename,
            content_type, byte_size)
         values ($1, 'purchase_reference_photo', 'task_evidence', $2, $3, $4)
         on conflict (storage_key) do update
         set media_kind = 'purchase_reference_photo',
             retention_status = 'task_evidence',
             original_filename = coalesce(excluded.original_filename, helper_app.media_objects.original_filename),
             content_type = coalesce(excluded.content_type, helper_app.media_objects.content_type),
             byte_size = coalesce(excluded.byte_size, helper_app.media_objects.byte_size)`,
        [photo.storageKey, photo.originalFilename, photo.contentType, photo.byteSize],
      );
      await insertPurchasePhoto(client, {
        helperId: trip.assigned_helper_id,
        photoRole: "manual_reference",
        purchaseTaskId: task.id,
        sortOrder: index,
        storageKey: photo.storageKey,
        tripId: trip.id,
      });
    }
    return getPurchaseTaskById(client, task.id);
  });
}

async function quickPublishPurchaseTask(database, input) {
  const normalized = normalizePurchaseTaskInput(input, { allowMissingOriginalPriceJpy: true });
  const quoteTaskPhotoId = requiredText(input.quoteTaskPhotoId, "quoteTaskPhotoId");
  return withTransaction(database, async (client) => {
    const quoteResult = await client.query(
      `select qtp.id, qtp.quote_task_id, qtp.trip_id, qtp.helper_id, qtp.storage_key,
              qtp.reply_status, qt.status as quote_task_status, reply.id as reply_id,
              reply.price_jpy, reply.detail_photos
       from helper_app.quote_task_photos qtp
       join helper_app.quote_tasks qt on qt.id = qtp.quote_task_id
       left join lateral (
         select qpr.*
         from helper_app.quote_photo_replies qpr
         where qpr.quote_task_photo_id = qtp.id
         order by qpr.updated_at desc
         limit 1
       ) reply on true
       where qtp.id = $1
       for update of qtp`,
      [quoteTaskPhotoId],
    );
    const quotePhoto = quoteResult.rows[0];
    if (!quotePhoto) throw new HelperAppServiceError("photo_not_found", "Quote task photo was not found.");
    if (quotePhoto.reply_status === "converted_to_purchase") {
      throw new HelperAppServiceError("already_converted", "This quote photo is already a purchase task.");
    }
    const trip = await lockTrip(client, quotePhoto.trip_id);
    if (trip.status !== "active") {
      throw new HelperAppServiceError("trip_not_active", "Purchase tasks can only be created for an active trip.");
    }
    if (normalized.tripId !== trip.id) {
      throw new HelperAppServiceError("invalid_input", "Quote photo does not belong to the selected trip.");
    }

    const task = await insertPurchaseTask(client, {
      ...normalized,
      helperId: quotePhoto.helper_id,
      originalPriceJpy: normalized.originalPriceJpy ?? quotePhoto.price_jpy,
      sourceQuoteReplyId: quotePhoto.reply_id,
      sourceQuoteTaskId: quotePhoto.quote_task_id,
      sourceQuoteTaskPhotoId: quotePhoto.id,
    });
    await insertPurchasePhoto(client, {
      helperId: quotePhoto.helper_id,
      photoRole: "source",
      purchaseTaskId: task.id,
      sortOrder: 0,
      storageKey: quotePhoto.storage_key,
      tripId: quotePhoto.trip_id,
    });
    const detailPhotos = Array.isArray(quotePhoto.detail_photos) ? quotePhoto.detail_photos : [];
    for (const [index, detailPhoto] of detailPhotos.entries()) {
      await insertPurchasePhoto(client, {
        helperId: quotePhoto.helper_id,
        photoRole: "detail_reply",
        purchaseTaskId: task.id,
        sortOrder: index,
        storageKey: detailPhoto.storage_key,
        tripId: quotePhoto.trip_id,
      });
    }
    await client.query(
      `update helper_app.quote_task_photos
       set reply_status = 'converted_to_purchase',
           updated_at = now()
       where id = $1`,
      [quotePhoto.id],
    );
    await refreshQuoteTaskStatus(client, quotePhoto.quote_task_id);
    await insertAuditEvent(client, {
      action: "admin_purchase_quick_published",
      actor_role: "admin",
      actor_user_id: normalized.actorUserId,
      after_state: {
        purchaseTaskId: task.id,
        quoteTaskId: quotePhoto.quote_task_id,
        quoteTaskPhotoId: quotePhoto.id,
      },
      before_state: {},
      trip_id: quotePhoto.trip_id,
    });
    return getPurchaseTaskById(client, task.id);
  });
}

async function createRebuyTask(database, input) {
  const normalized = normalizeRebuyTaskInput(input);
  const referencePhotos = normalizeRebuyPhotos(input.referencePhotos, "reference");
  return withTransaction(database, async (client) => {
    let sourcePurchase = null;
    if (normalized.sourcePurchaseTaskId) {
      sourcePurchase = await lockPurchaseTask(client, normalized.sourcePurchaseTaskId);
      if (!["canceled", "unavailable", "not_found"].includes(sourcePurchase.status)) {
        throw new HelperAppServiceError("invalid_status", "Only canceled, unavailable, or not-found purchases can become rebuy tasks.");
      }
    }
    const assignedHelperId = normalized.visibility === "private"
      ? normalized.assignedHelperId || sourcePurchase?.helper_id
      : null;
    if (normalized.visibility === "private" && !assignedHelperId) {
      throw new HelperAppServiceError("invalid_input", "Private rebuy tasks require an assigned helper.");
    }
    const result = await client.query(
      `insert into helper_app.rebuy_tasks
         (visibility, assigned_helper_id, source_purchase_task_id, source_trip_id,
          line_community_name, product_name, quantity, original_price_jpy,
          sale_price_twd, instructions, priority, public_available_at,
          created_by_user_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
               case when $1 = 'public' then now() else null end, $12)
       returning *`,
      [
        normalized.visibility,
        assignedHelperId,
        normalized.sourcePurchaseTaskId,
        sourcePurchase?.trip_id || null,
        normalized.lineCommunityName || sourcePurchase?.line_community_name || null,
        normalized.productName || sourcePurchase?.product_name,
        normalized.quantity || sourcePurchase?.unavailable_quantity || sourcePurchase?.quantity,
        normalized.originalPriceJpy ?? sourcePurchase?.original_price_jpy ?? null,
        normalized.salePriceTwd ?? sourcePurchase?.sale_price_twd ?? null,
        normalized.instructions,
        normalized.priority,
        normalized.actorUserId,
      ],
    );
    const task = result.rows[0];
    for (const [index, photo] of referencePhotos.entries()) {
      await upsertRebuyPhoto(client, {
        helperId: assignedHelperId,
        mediaKind: "rebuy_reference_photo",
        photoRole: "reference",
        rebuyTaskId: task.id,
        sortOrder: index,
        ...photo,
      });
    }
    await insertAuditEvent(client, {
      action: "admin_rebuy_task_created",
      actor_role: "admin",
      actor_user_id: normalized.actorUserId,
      after_state: {
        rebuyTaskId: task.id,
        sourcePurchaseTaskId: normalized.sourcePurchaseTaskId,
        visibility: task.visibility,
      },
      before_state: {},
      trip_id: sourcePurchase?.trip_id || null,
    });
    return getRebuyTaskById(client, task.id);
  });
}

async function claimPublicRebuyTask(database, input) {
  const rebuyTaskId = requiredText(input.rebuyTaskId, "rebuyTaskId");
  const expectedVersion = Number(requiredText(input.expectedVersion, "expectedVersion"));
  const idempotencyKey = requiredText(input.idempotencyKey, "idempotencyKey");
  return withTransaction(database, async (client) => {
    const helper = await findActiveHelperForUser(client, input.authUserId);
    const existing = await client.query(
      `select * from helper_app.rebuy_tasks
       where id = $1
         and claimed_helper_id = $2
         and claim_idempotency_key = $3`,
      [rebuyTaskId, helper.id, idempotencyKey],
    );
    if (existing.rows[0]) return existing.rows[0];
    const task = await lockRebuyTask(client, rebuyTaskId);
    if (task.visibility !== "public" || task.status !== "open") {
      throw new HelperAppServiceError("invalid_status", "This public rebuy task is not open.");
    }
    if (Number(task.version) !== expectedVersion) {
      throw new HelperAppServiceError("version_conflict", "Public rebuy task changed. Please refresh.");
    }
    const result = await client.query(
      `update helper_app.rebuy_tasks
       set status = 'claimed',
           claimed_helper_id = $2,
           claim_idempotency_key = $3,
           claimed_at = now(),
           version = version + 1,
           updated_at = now()
       where id = $1 and status = 'open' and version = $4
       returning *`,
      [task.id, helper.id, idempotencyKey, expectedVersion],
    );
    if (!result.rows[0]) {
      throw new HelperAppServiceError("claim_conflict", "Another helper claimed this rebuy task first.");
    }
    await insertAuditEvent(client, {
      action: "helper_rebuy_claimed",
      actor_helper_id: helper.id,
      actor_role: "helper",
      actor_user_id: input.authUserId,
      after_state: { rebuyTaskId: task.id, status: "claimed" },
      before_state: { status: task.status },
      trip_id: task.source_trip_id,
    });
    return result.rows[0];
  });
}

async function releasePublicRebuyTask(database, input) {
  const rebuyTaskId = requiredText(input.rebuyTaskId, "rebuyTaskId");
  const expectedVersion = Number(requiredText(input.expectedVersion, "expectedVersion"));
  const idempotencyKey = requiredText(input.idempotencyKey, "idempotencyKey");
  const reason = requiredText(input.reason, "reason");
  return withTransaction(database, async (client) => {
    const helper = await findActiveHelperForUser(client, input.authUserId);
    const task = await lockRebuyTask(client, rebuyTaskId);
    if (
      task.visibility === "public" &&
      task.status === "open" &&
      task.release_idempotency_key === idempotencyKey
    ) {
      return task;
    }
    if (task.visibility !== "public") {
      throw new HelperAppServiceError("invalid_status", "Private rebuy tasks cannot be released to public.");
    }
    if (task.status !== "claimed" || task.claimed_helper_id !== helper.id) {
      throw new HelperAppServiceError("forbidden", "Only the claiming helper can release this task.");
    }
    if (Number(task.version) !== expectedVersion) {
      throw new HelperAppServiceError("version_conflict", "Rebuy task changed. Please refresh.");
    }
    const result = await client.query(
      `update helper_app.rebuy_tasks
       set status = 'open',
           claimed_helper_id = null,
           release_idempotency_key = $2,
           public_available_at = now(),
           released_at = now(),
           version = version + 1,
           updated_at = now()
       where id = $1 and status = 'claimed' and claimed_helper_id = $3 and version = $4
       returning *`,
      [task.id, idempotencyKey, helper.id, expectedVersion],
    );
    if (!result.rows[0]) {
      throw new HelperAppServiceError("release_conflict", "Rebuy task release conflicted. Please refresh.");
    }
    await insertAuditEvent(client, {
      action: "helper_rebuy_released",
      actor_helper_id: helper.id,
      actor_role: "helper",
      actor_user_id: input.authUserId,
      after_state: { rebuyTaskId: task.id, status: "open" },
      before_state: { status: task.status },
      reason,
      trip_id: task.source_trip_id,
    });
    return result.rows[0];
  });
}

async function reportRebuyTask(database, input) {
  const normalized = normalizeRebuyReportInput(input);
  return withTransaction(database, async (client) => {
    const helper = await findActiveHelperForUser(client, normalized.authUserId);
    const task = await lockRebuyTask(client, normalized.rebuyTaskId);
    if (task.report_idempotency_key === normalized.idempotencyKey) return task;
    assertHelperOwnsRebuyTask(task, helper);
    if (!["open", "claimed"].includes(task.status)) {
      throw new HelperAppServiceError("invalid_status", "This rebuy task cannot be reported now.");
    }
    if (normalized.reportedQuantity > task.quantity) {
      throw new HelperAppServiceError("invalid_input", "Reported quantity cannot exceed requested quantity.");
    }
    const remainingQuantity = task.quantity - normalized.reportedQuantity;
    if (remainingQuantity > 0 && !normalized.remainingReason) {
      throw new HelperAppServiceError("invalid_input", "Partial rebuy requires a remaining-quantity reason.");
    }
    if (!normalized.reportPhotos.length && !normalized.reportPhotosOmitted) {
      throw new HelperAppServiceError("invalid_input", "Confirm when report photos are omitted.");
    }
    for (const [index, photo] of normalized.reportPhotos.entries()) {
      await upsertRebuyPhoto(client, {
        helperId: helper.id,
        mediaKind: "rebuy_report_photo",
        photoRole: "report",
        rebuyTaskId: task.id,
        sortOrder: index,
        ...photo,
      });
    }
    const result = await client.query(
      `update helper_app.rebuy_tasks
       set status = 'reported',
           claimed_helper_id = case
             when visibility = 'public' then coalesce(claimed_helper_id, $2)
             else claimed_helper_id
           end,
           report_idempotency_key = $3,
           reported_quantity = $4,
           remaining_quantity = $5,
           remaining_reason = $6,
           helper_report_note = $7,
           report_photos_omitted = $8,
           reported_at = now(),
           version = version + 1,
           updated_at = now()
       where id = $1
       returning *`,
      [
        task.id,
        helper.id,
        normalized.idempotencyKey,
        normalized.reportedQuantity,
        remainingQuantity,
        normalized.remainingReason,
        normalized.helperNote,
        normalized.reportPhotosOmitted,
      ],
    );
    await insertAuditEvent(client, {
      action: normalized.reportPhotos.length ? "helper_rebuy_reported" : "helper_rebuy_reported_without_photos",
      actor_helper_id: helper.id,
      actor_role: "helper",
      actor_user_id: normalized.authUserId,
      after_state: {
        rebuyTaskId: task.id,
        reportPhotoCount: normalized.reportPhotos.length,
        reportedQuantity: normalized.reportedQuantity,
      },
      before_state: { status: task.status },
      trip_id: task.source_trip_id,
    });
    return result.rows[0];
  });
}

async function checkoutRebuyTasks(database, input) {
  const idempotencyKey = requiredText(input.idempotencyKey, "idempotencyKey");
  return withTransaction(database, async (client) => {
    const helper = await findActiveHelperForUser(client, input.authUserId);
    const existing = await client.query(
      `select distinct checkout_trip_id
       from helper_app.rebuy_tasks
       where coalesce(claimed_helper_id, assigned_helper_id) = $1
         and checkout_idempotency_key = $2
         and checkout_trip_id is not null`,
      [helper.id, idempotencyKey],
    );
    if (existing.rows[0]?.checkout_trip_id) {
      const settlement = await client.query(
        `select * from helper_app.settlements where trip_id = $1`,
        [existing.rows[0].checkout_trip_id],
      );
      return { settlement: settlement.rows[0] || null, tripId: existing.rows[0].checkout_trip_id };
    }
    const tasksResult = await client.query(
      `select *
       from helper_app.rebuy_tasks
       where status = 'reported'
         and checked_out_at is null
         and coalesce(claimed_helper_id, assigned_helper_id) = $1
       order by reported_at asc, created_at asc
       for update`,
      [helper.id],
    );
    const tasks = tasksResult.rows.filter((task) => Number(task.reported_quantity || 0) > 0);
    if (!tasks.length) {
      throw new HelperAppServiceError("nothing_to_checkout", "No completed rebuy tasks are ready for checkout.");
    }
    const tripResult = await client.query(
      `insert into helper_app.trips
         (trip_name, business_date, location, timezone, assigned_helper_id,
          status, departed_at, arrived_at, admin_activated_at, ended_at)
       values ($1, $2, 'rebuy checkout', 'Asia/Tokyo', $3, 'ended',
               now(), now(), now(), now())
       returning *`,
      [
        `補買結帳 ${dateInTimezone(new Date(), "Asia/Tokyo")}`,
        dateInTimezone(new Date(), "Asia/Tokyo"),
        helper.id,
      ],
    );
    const checkoutTrip = tripResult.rows[0];
    let lastPurchaseTask = null;
    for (const task of tasks) {
      const purchaseTask = await insertPurchaseTask(client, {
        actorUserId: input.authUserId,
        helperId: helper.id,
        lineCommunityName: task.line_community_name || "補買待確認",
        note: task.helper_report_note,
        originalPriceJpy: task.original_price_jpy,
        productName: task.product_name,
        quantity: task.reported_quantity,
        requiresFaceCheck: false,
        salePriceTwd: task.sale_price_twd || 0,
        sourceRebuyTaskId: task.id,
        tripId: checkoutTrip.id,
      });
      const completed = await client.query(
        `update helper_app.purchase_tasks
         set status = 'completed',
             completed_quantity = quantity,
             completed_at = now(),
             updated_at = now()
         where id = $1
         returning *`,
        [purchaseTask.id],
      );
      await copyRebuyPhotosToPurchase(client, {
        helperId: helper.id,
        purchaseTaskId: purchaseTask.id,
        rebuyTaskId: task.id,
        tripId: checkoutTrip.id,
      });
      await syncStagingOrderPreview(client, completed.rows[0]);
      await client.query(
        `update helper_app.rebuy_tasks
         set status = 'checked_out',
             checkout_idempotency_key = $2,
             checkout_trip_id = $3,
             checkout_purchase_task_id = $4,
             checked_out_at = now(),
             version = version + 1,
             updated_at = now()
         where id = $1`,
        [task.id, idempotencyKey, checkoutTrip.id, purchaseTask.id],
      );
      lastPurchaseTask = purchaseTask;
    }
    const settlement = await createSettlementForEndedTrip(client, {
      helper,
      trip: { ...checkoutTrip, departed_at: checkoutTrip.ended_at, ended_at: checkoutTrip.ended_at },
    });
    await insertAuditEvent(client, {
      action: "helper_rebuy_checkout_completed",
      actor_helper_id: helper.id,
      actor_role: "helper",
      actor_user_id: input.authUserId,
      after_state: {
        purchaseTaskId: lastPurchaseTask?.id || null,
        rebuyTaskCount: tasks.length,
        settlementId: settlement.id,
      },
      before_state: {},
      trip_id: checkoutTrip.id,
    });
    return { settlement, tripId: checkoutTrip.id };
  });
}

async function respondPurchaseTask(database, input) {
  const normalized = normalizePurchaseResponseInput(input);
  return withTransaction(database, async (client) => {
    const helper = await findActiveHelperForUser(client, normalized.authUserId);
    const task = await lockPurchaseTask(client, normalized.purchaseTaskId);
    if (task.helper_id !== helper.id) {
      throw new HelperAppServiceError("forbidden", "Purchase task is not assigned to this helper.");
    }
    const trip = await lockTrip(client, task.trip_id);
    assertTripCanUseLiveWorkspace(trip, "Purchase tasks can be updated only while the trip is active.");
    if (["completed", "canceled", "unavailable", "not_found"].includes(task.status)) {
      if (task.idempotency_key && task.idempotency_key === normalized.idempotencyKey) {
        return task;
      }
      throw new HelperAppServiceError("invalid_status", "This purchase task is already closed.");
    }

    if (normalized.action === "cancel" || normalized.action === "unavailable" || normalized.action === "not_found") {
      if (!normalized.helperNote) {
        throw new HelperAppServiceError("invalid_input", "A reason is required.");
      }
      const status = normalized.action === "cancel" ? "canceled" : normalized.action;
      const result = await client.query(
        `update helper_app.purchase_tasks
         set status = $2,
             unavailable_quantity = $3,
             helper_note = $4,
             idempotency_key = coalesce(idempotency_key, $5),
             canceled_at = now(),
             updated_at = now()
         where id = $1
         returning *`,
        [
          task.id,
          status,
          normalized.unavailableQuantity ?? task.quantity,
          normalized.helperNote,
          normalized.idempotencyKey,
        ],
      );
      await insertAuditEvent(client, {
        action: `helper_purchase_${status}`,
        actor_helper_id: helper.id,
        actor_role: "helper",
        actor_user_id: normalized.authUserId,
        after_state: { purchaseTaskId: task.id, status },
        before_state: { status: task.status },
        trip_id: task.trip_id,
      });
      return result.rows[0];
    }

    const completedQuantity = normalized.completedQuantity ?? task.quantity;
    if (completedQuantity > task.quantity) {
      throw new HelperAppServiceError("invalid_input", "Completed quantity cannot exceed requested quantity.");
    }
    if (completedQuantity < task.quantity && normalized.unavailableQuantity == null) {
      throw new HelperAppServiceError("invalid_input", "Partial purchases must explicitly resolve the remaining quantity.");
    }
    if (task.requires_face_check && task.status === "open") {
      if (!normalized.faceCheckPhoto) {
        throw new HelperAppServiceError("invalid_input", "Face-check photo is required.");
      }
      await client.query(
        `insert into helper_app.media_objects
           (storage_key, media_kind, retention_status, original_filename,
            content_type, byte_size, uploaded_by_helper_id)
         values ($1, 'purchase_face_check_photo', 'task_evidence', $2, $3, $4, $5)
         on conflict (storage_key) do update
         set media_kind = 'purchase_face_check_photo',
             retention_status = 'task_evidence',
             original_filename = coalesce(excluded.original_filename, helper_app.media_objects.original_filename),
             content_type = coalesce(excluded.content_type, helper_app.media_objects.content_type),
             byte_size = coalesce(excluded.byte_size, helper_app.media_objects.byte_size)`,
        [
          normalized.faceCheckPhoto.storageKey,
          normalized.faceCheckPhoto.originalFilename,
          normalized.faceCheckPhoto.contentType,
          normalized.faceCheckPhoto.byteSize,
          helper.id,
        ],
      );
      await insertPurchasePhoto(client, {
        helperId: helper.id,
        photoRole: "face_check_report",
        purchaseTaskId: task.id,
        sortOrder: 0,
        storageKey: normalized.faceCheckPhoto.storageKey,
        tripId: task.trip_id,
      });
      const result = await client.query(
        `update helper_app.purchase_tasks
         set status = 'review_pending',
             completed_quantity = $2,
             unavailable_quantity = $3,
             helper_note = $4,
             face_check_note = $5,
             idempotency_key = coalesce(idempotency_key, $6),
             updated_at = now()
         where id = $1
         returning *`,
        [
          task.id,
          completedQuantity,
          task.quantity - completedQuantity,
          normalized.helperNote,
          normalized.faceCheckNote,
          normalized.idempotencyKey,
        ],
      );
      await insertAuditEvent(client, {
        action: "helper_purchase_face_check_submitted",
        actor_helper_id: helper.id,
        actor_role: "helper",
        actor_user_id: normalized.authUserId,
        after_state: { completedQuantity, purchaseTaskId: task.id },
        before_state: { status: task.status },
        trip_id: task.trip_id,
      });
      return result.rows[0];
    }

    if (task.requires_face_check && task.status !== "approved_pending_helper_confirmation") {
      throw new HelperAppServiceError("invalid_status", "Face-check task needs admin approval first.");
    }

    const result = await client.query(
      `update helper_app.purchase_tasks
       set status = 'completed',
           completed_quantity = $2,
           unavailable_quantity = $3,
           helper_note = coalesce($4, helper_note),
           idempotency_key = $5,
           completed_at = now(),
           updated_at = now()
       where id = $1
       returning *`,
      [
        task.id,
        completedQuantity,
        task.quantity - completedQuantity,
        normalized.helperNote,
        normalized.idempotencyKey,
      ],
    );
    await syncStagingOrderPreview(client, result.rows[0]);
    await insertAuditEvent(client, {
      action: task.requires_face_check ? "helper_purchase_face_check_confirmed" : "helper_purchase_completed",
      actor_helper_id: helper.id,
      actor_role: "helper",
      actor_user_id: normalized.authUserId,
      after_state: { completedQuantity, purchaseTaskId: task.id },
      before_state: { status: task.status },
      trip_id: task.trip_id,
    });
    return result.rows[0];
  });
}

async function reviewFaceCheckPurchaseTask(database, input) {
  const purchaseTaskId = requiredText(input.purchaseTaskId, "purchaseTaskId");
  const action = requiredText(input.action, "action");
  if (!["approve", "reject"].includes(action)) {
    throw new HelperAppServiceError("invalid_input", "Invalid face-check review action.");
  }
  return withTransaction(database, async (client) => {
    const task = await lockPurchaseTask(client, purchaseTaskId);
    if (!task.requires_face_check || task.status !== "review_pending") {
      throw new HelperAppServiceError("invalid_status", "Only review-pending face-check tasks can be reviewed.");
    }
    const status = action === "approve" ? "approved_pending_helper_confirmation" : "open";
    const result = await client.query(
      `update helper_app.purchase_tasks
       set status = $2,
           admin_review_note = $3,
           admin_reviewed_by_user_id = $4,
           updated_at = now()
       where id = $1
       returning *`,
      [task.id, status, optionalText(input.adminReviewNote), input.actorUserId || null],
    );
    await insertAuditEvent(client, {
      action: action === "approve" ? "admin_face_check_approved" : "admin_face_check_rejected",
      actor_role: "admin",
      actor_user_id: input.actorUserId || null,
      after_state: { purchaseTaskId: task.id, status },
      before_state: { status: task.status },
      trip_id: task.trip_id,
    });
    return result.rows[0];
  });
}

async function authorizeAdminTaskPhotoUpload(database, { tripId }) {
  const result = await database.query(
    `select id, status
     from helper_app.trips
     where id = $1`,
    [requiredText(tripId, "tripId")],
  );
  const trip = result.rows[0];
  if (!trip) {
    throw new HelperAppServiceError("trip_not_found", "Trip was not found.");
  }
  if (trip.status !== "active") {
    throw new HelperAppServiceError("trip_not_active", "Task photos can only be uploaded for an active trip.");
  }
  return trip;
}

async function authorizeQuoteReplyUpload(database, { authUserId, quoteTaskPhotoId }) {
  const result = await database.query(
    `select qtp.id, qtp.trip_id, qtp.helper_id, t.status, t.business_date, t.timezone,
            hp.is_active
     from helper_app.quote_task_photos qtp
     join helper_app.trips t on t.id = qtp.trip_id
     join helper_app.helper_profiles hp on hp.id = qtp.helper_id
     where qtp.id = $1
       and hp.auth_user_id = $2`,
    [quoteTaskPhotoId, authUserId],
  );
  const row = result.rows[0];
  if (!row) throw new HelperAppServiceError("forbidden", "Quote photo is not assigned to this helper.");
  if (!row.is_active) throw new HelperAppServiceError("helper_inactive", "Helper profile is inactive.");
  assertTripCanReplyQuote(row);
  return row;
}

async function authorizePurchaseFaceCheckUpload(database, { authUserId, purchaseTaskId }) {
  const result = await database.query(
    `select pt.id, pt.trip_id, pt.helper_id, pt.status, pt.requires_face_check,
            t.status as trip_status, hp.is_active
     from helper_app.purchase_tasks pt
     join helper_app.trips t on t.id = pt.trip_id
     join helper_app.helper_profiles hp on hp.id = pt.helper_id
     where pt.id = $1
       and hp.auth_user_id = $2`,
    [purchaseTaskId, authUserId],
  );
  const row = result.rows[0];
  if (!row) throw new HelperAppServiceError("forbidden", "Purchase task is not assigned to this helper.");
  if (!row.is_active) throw new HelperAppServiceError("helper_inactive", "Helper profile is inactive.");
  if (!row.requires_face_check || row.status !== "open") {
    throw new HelperAppServiceError("invalid_status", "This purchase task does not need a face-check upload.");
  }
  assertTripCanUseLiveWorkspace({ status: row.trip_status }, "Face-check photos can be uploaded only while the trip is active.");
  return row;
}

async function authorizeRebuyReportUpload(database, { authUserId, rebuyTaskId }) {
  const result = await database.query(
    `select rt.id, rt.status, rt.assigned_helper_id, rt.claimed_helper_id,
            hp.id as helper_id, hp.is_active
     from helper_app.rebuy_tasks rt
     join helper_app.helper_profiles hp on hp.auth_user_id = $2
     where rt.id = $1`,
    [requiredText(rebuyTaskId, "rebuyTaskId"), authUserId],
  );
  const row = result.rows[0];
  if (!row) throw new HelperAppServiceError("rebuy_task_not_found", "Rebuy task was not found.");
  if (!row.is_active) throw new HelperAppServiceError("helper_inactive", "Helper profile is inactive.");
  const ownerId = row.claimed_helper_id || row.assigned_helper_id;
  if (ownerId !== row.helper_id) {
    throw new HelperAppServiceError("forbidden", "Rebuy task is not assigned to this helper.");
  }
  if (!["open", "claimed"].includes(row.status)) {
    throw new HelperAppServiceError("invalid_status", "Rebuy report photos cannot be uploaded now.");
  }
  return row;
}

async function submitQuotePhotoReply(
  database,
  { authUserId, detailPhotos, idempotencyKey, note, priceJpy, quoteTaskPhotoId },
) {
  const normalized = normalizeQuoteReplyInput({
    detailPhotos,
    idempotencyKey,
    note,
    priceJpy,
    quoteTaskPhotoId,
  });
  return withTransaction(database, async (client) => {
    const helper = await findActiveHelperForUser(client, authUserId);
    const photoResult = await client.query(
      `select qtp.*, qt.task_type
       from helper_app.quote_task_photos qtp
       join helper_app.quote_tasks qt on qt.id = qtp.quote_task_id
       where qtp.id = $1
       for update of qtp`,
      [normalized.quoteTaskPhotoId],
    );
    const taskPhoto = photoResult.rows[0];
    if (!taskPhoto) throw new HelperAppServiceError("photo_not_found", "Quote task photo was not found.");
    if (taskPhoto.helper_id !== helper.id) {
      throw new HelperAppServiceError("forbidden", "Quote task photo is not assigned to this helper.");
    }
    const trip = await lockTrip(client, taskPhoto.trip_id);
    assertTripCanReplyQuote(trip);
    if (taskPhoto.reply_status === "converted_to_purchase") {
      throw new HelperAppServiceError("already_converted", "Converted quote photos can no longer be edited.");
    }
    assertReplyMatchesTaskType(taskPhoto.task_type, normalized);

    const existing = await client.query(
      `select *
       from helper_app.quote_photo_replies
       where quote_task_photo_id = $1 and helper_id = $2 and idempotency_key = $3`,
      [taskPhoto.id, helper.id, normalized.idempotencyKey],
    );
    if (existing.rows[0]) return existing.rows[0];

    for (const detailPhoto of normalized.detailPhotos) {
      await client.query(
        `insert into helper_app.media_objects
           (storage_key, media_kind, retention_status, original_filename,
            content_type, byte_size, uploaded_by_helper_id)
         values ($1, 'quote_detail_reply_photo', 'task_evidence', $2, $3, $4, $5)
         on conflict (storage_key) do update
         set media_kind = 'quote_detail_reply_photo',
             retention_status = 'task_evidence',
             original_filename = coalesce(excluded.original_filename, helper_app.media_objects.original_filename),
             content_type = coalesce(excluded.content_type, helper_app.media_objects.content_type),
             byte_size = coalesce(excluded.byte_size, helper_app.media_objects.byte_size)`,
        [
          detailPhoto.storage_key,
          detailPhoto.original_filename,
          detailPhoto.content_type,
          detailPhoto.byte_size,
          helper.id,
        ],
      );
    }

    const replyResult = await client.query(
      `insert into helper_app.quote_photo_replies
         (quote_task_photo_id, quote_task_id, trip_id, helper_id, idempotency_key,
          price_jpy, note, detail_photos)
       values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       returning *`,
      [
        taskPhoto.id,
        taskPhoto.quote_task_id,
        taskPhoto.trip_id,
        helper.id,
        normalized.idempotencyKey,
        normalized.priceJpy,
        normalized.note,
        JSON.stringify(normalized.detailPhotos),
      ],
    );
    const reply = replyResult.rows[0];

    await client.query(
      `update helper_app.quote_task_photos
       set reply_status = 'replied',
           needs_review = false,
           updated_at = now()
       where id = $1`,
      [taskPhoto.id],
    );
    await refreshQuoteTaskStatus(client, taskPhoto.quote_task_id);
    await insertAuditEvent(client, {
      action: "helper_quote_photo_replied",
      actor_helper_id: helper.id,
      actor_role: "helper",
      actor_user_id: authUserId,
      after_state: {
        detailPhotoCount: normalized.detailPhotos.length,
        priceJpy: normalized.priceJpy,
        quoteTaskId: taskPhoto.quote_task_id,
        quoteTaskPhotoId: taskPhoto.id,
        replyId: reply.id,
      },
      before_state: {},
      trip_id: taskPhoto.trip_id,
    });
    return reply;
  });
}

async function markSitePhotoSaved(database, { actorUserId, photoId }) {
  return withTransaction(database, async (client) => {
    const result = await client.query(
      `update helper_app.site_photos
       set saved_by_admin = true,
           saved_at = coalesce(saved_at, now()),
           saved_by_user_id = coalesce(saved_by_user_id, $2)
       where id = $1
       returning *`,
      [photoId, actorUserId],
    );
    const photo = result.rows[0];
    if (!photo) throw new HelperAppServiceError("photo_not_found", "Site photo was not found.");
    await client.query(
      `update helper_app.media_objects
       set retention_status = 'admin_saved'
       where storage_key = $1
         and retention_status = 'temporary_work_media'`,
      [photo.storage_key],
    );
    await insertAuditEvent(client, {
      action: "admin_site_photo_saved",
      actor_role: "admin",
      actor_user_id: actorUserId,
      after_state: {
        photoId: photo.id,
        storageKey: photo.storage_key,
      },
      before_state: {},
      trip_id: photo.trip_id,
    });
    return photo;
  });
}

async function markHelperDeparted(database, { authUserId, expectedVersion, tripId }) {
  return mutateHelperTrip(database, {
    action: "helper_departed",
    authUserId,
    expectedVersion,
    tripId,
  });
}

async function markHelperArrived(database, { authUserId, expectedVersion, tripId }) {
  return mutateHelperTrip(database, {
    action: "helper_arrived",
    authUserId,
    expectedVersion,
    tripId,
  });
}

async function markHelperEnded(database, { authUserId, expectedVersion, tripId }) {
  return withTransaction(database, async (client) => {
    const helper = await findActiveHelperForUser(client, authUserId);
    const trip = await lockTrip(client, tripId);
    if (trip.assigned_helper_id !== helper.id) {
      throw new HelperAppServiceError("forbidden", "Trip is not assigned to this helper.");
    }
    assertTripCanEnd(trip);
    const openPurchases = await client.query(
      `select count(*)::int as count
       from helper_app.purchase_tasks
       where trip_id = $1
         and status in ('open', 'review_pending', 'approved_pending_helper_confirmation')`,
      [tripId],
    );
    if (Number(openPurchases.rows[0]?.count || 0) > 0) {
      throw new HelperAppServiceError(
        "unfinished_purchase_tasks",
        "尚有未完成的採買任務，請先完成、取消、標記缺貨或找不到。",
      );
    }
    const quoteWarnings = await client.query(
      `select count(*)::int as count
       from helper_app.quote_task_photos
       where trip_id = $1 and reply_status in ('open', 'needs_review')`,
      [tripId],
    );
    const transition = buildTransition({
      action: "helper_ended",
      actorRole: "helper",
      expectedVersion,
      trip,
    });
    const updated = await persistTripTransition(client, transition.trip);
    transition.event.after_state.unfinishedQuoteSubtasks = Number(quoteWarnings.rows[0]?.count || 0);
    await insertAuditEvent(client, {
      ...transition.event,
      actor_helper_id: helper.id,
      actor_user_id: authUserId,
      trip_id: tripId,
    });
    const settlement = await createSettlementForEndedTrip(client, {
      helper,
      trip: updated,
    });
    return { settlement, trip: updated };
  });
}

async function activateTrip(database, { actorUserId, expectedVersion, tripId }) {
  return mutateAdminTrip(database, {
    action: "admin_activated",
    actorUserId,
    expectedVersion,
    tripId,
  });
}

async function cancelTrip(database, { actorUserId, expectedVersion, reason, tripId }) {
  return mutateAdminTrip(database, {
    action: "admin_canceled",
    actorUserId,
    expectedVersion,
    reason,
    tripId,
  });
}

async function repairTrip(database, { actorUserId, expectedVersion, patch, reason, tripId }) {
  return withTransaction(database, async (client) => {
    const trip = await lockTrip(client, tripId);
    const transition = buildRepairTransition({
      expectedVersion,
      patch,
      reason,
      trip,
    });
    const updated = await persistTripTransition(client, transition.trip);
    await insertAuditEvent(client, {
      ...transition.event,
      actor_user_id: actorUserId,
      trip_id: tripId,
    });
    return updated;
  });
}

async function mutateHelperTrip(database, { action, authUserId, expectedVersion, tripId }) {
  return withTransaction(database, async (client) => {
    const helper = await findActiveHelperForUser(client, authUserId);
    const trip = await lockTrip(client, tripId);
    if (trip.assigned_helper_id !== helper.id) {
      throw new HelperAppServiceError("forbidden", "Trip is not assigned to this helper.");
    }
    if (action === "helper_departed") {
      assertTripCanDepart(trip);
    }
    if (action === "helper_ended") {
      assertTripCanEnd(trip);
    }
    const transition = buildTransition({
      action,
      actorRole: "helper",
      expectedVersion,
      trip,
    });
    const updated = await persistTripTransition(client, transition.trip);
    await insertAuditEvent(client, {
      ...transition.event,
      actor_helper_id: helper.id,
      actor_user_id: authUserId,
      trip_id: tripId,
    });
    return updated;
  });
}

async function mutateAdminTrip(database, { action, actorUserId, expectedVersion, reason, tripId }) {
  return withTransaction(database, async (client) => {
    const trip = await lockTrip(client, tripId);
    const transition = buildTransition({
      action,
      actorRole: "admin",
      expectedVersion,
      reason,
      trip,
    });
    const updated = await persistTripTransition(client, transition.trip);
    await insertAuditEvent(client, {
      ...transition.event,
      actor_user_id: actorUserId,
      trip_id: tripId,
    });
    return updated;
  });
}

async function findActiveHelperForUser(client, authUserId) {
  const result = await client.query(
    `select *
     from helper_app.helper_profiles
     where auth_user_id = $1
     for update`,
    [authUserId],
  );
  const helper = result.rows[0];
  if (!helper) throw new HelperAppServiceError("helper_not_found", "Helper profile was not found.");
  if (!helper.is_active) throw new HelperAppServiceError("helper_inactive", "Helper profile is inactive.");
  return helper;
}

async function lockTrip(client, tripId) {
  const result = await client.query(
    `select *
     from helper_app.trips
     where id = $1
     for update`,
    [tripId],
  );
  if (!result.rows[0]) throw new HelperAppServiceError("trip_not_found", "Trip was not found.");
  return result.rows[0];
}

async function persistTripTransition(client, trip) {
  const result = await client.query(
    `update helper_app.trips
     set status = $2,
         departed_at = $3,
         arrived_at = $4,
         admin_activated_at = $5,
         ended_at = $6,
         canceled_at = $7,
         version = $8,
         updated_at = now()
     where id = $1
     returning *`,
    [
      trip.id,
      trip.status,
      trip.departed_at,
      trip.arrived_at,
      trip.admin_activated_at,
      trip.ended_at,
      trip.canceled_at,
      trip.version,
    ],
  );
  return result.rows[0];
}

async function insertAuditEvent(client, event) {
  await client.query(
    `insert into helper_app.trip_audit_events
       (trip_id, actor_user_id, actor_helper_id, actor_role, action,
        before_state, after_state, reason)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)`,
    [
      event.trip_id,
      event.actor_user_id || null,
      event.actor_helper_id || null,
      event.actor_role,
      event.action,
      JSON.stringify(event.before_state || {}),
      JSON.stringify(event.after_state || {}),
      event.reason || null,
    ],
  );
}

async function createSettlementForEndedTrip(client, { helper, trip }) {
  const workMinutes = calculateWorkMinutes(trip.departed_at, trip.ended_at);
  const totalResult = await client.query(
    `select coalesce(sum(quantity * coalesce(original_price_jpy, 0)), 0)::int as product_total_jpy
     from helper_app.staging_order_previews
     where trip_id = $1 and helper_id = $2`,
    [trip.id, helper.id],
  );
  const productTotalJpy = Number(totalResult.rows[0]?.product_total_jpy || 0);
  const settlementResult = await client.query(
    `insert into helper_app.settlements
       (trip_id, helper_id, compensation_mode, hourly_rate_twd, helper_fx_rate,
        product_total_jpy, work_minutes)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (trip_id) do nothing
     returning *`,
    [
      trip.id,
      helper.id,
      helper.compensation_mode,
      helper.hourly_rate_twd,
      helper.helper_fx_rate,
      productTotalJpy,
      workMinutes,
    ],
  );
  let settlement = settlementResult.rows[0];
  if (!settlement) {
    const existing = await client.query(
      `select * from helper_app.settlements where trip_id = $1`,
      [trip.id],
    );
    settlement = existing.rows[0];
  }
  await client.query(
    `insert into helper_app.settlement_line_items
       (settlement_id, staging_order_preview_id, purchase_task_id, product_name,
        quantity, original_price_jpy, product_total_jpy)
     select $1, sop.id, sop.purchase_task_id, sop.product_name, sop.quantity,
            coalesce(sop.original_price_jpy, 0),
            sop.quantity * coalesce(sop.original_price_jpy, 0)
     from helper_app.staging_order_previews sop
     where sop.trip_id = $2 and sop.helper_id = $3
     on conflict (settlement_id, staging_order_preview_id) do nothing`,
    [settlement.id, trip.id, helper.id],
  );
  return settlement;
}

async function authorizeSettlementEvidenceUpload(
  database,
  { authUserId, evidenceType, settlementId },
) {
  const allowedTypes = ["daily_receipt", "transport_proof", "warehouse_proof"];
  if (!allowedTypes.includes(evidenceType)) {
    throw new HelperAppServiceError("invalid_input", "Unknown settlement evidence type.");
  }
  const result = await database.query(
    `select s.id, s.trip_id, s.status
     from helper_app.settlements s
     join helper_app.helper_profiles hp on hp.id = s.helper_id
     where s.id = $1 and hp.auth_user_id = $2 and hp.is_active = true`,
    [settlementId, authUserId],
  );
  const settlement = result.rows[0];
  if (!settlement) throw new HelperAppServiceError("forbidden", "Settlement is not available.");
  const precheckAllowed = ["pending_helper_precheck", "correction_required"].includes(settlement.status);
  const warehouseAllowed = settlement.status === "warehouse_pending";
  if (
    (evidenceType === "warehouse_proof" && !warehouseAllowed) ||
    (evidenceType !== "warehouse_proof" && !precheckAllowed)
  ) {
    throw new HelperAppServiceError("invalid_status", "Settlement evidence cannot be uploaded now.");
  }
  return settlement;
}

async function attachSignedSettlementUrls(settlements, r2Store) {
  return Promise.all(
    settlements.map(async (settlement) => ({
      ...settlement,
      evidence: await Promise.all(
        (settlement.evidence || []).map(async (item) => ({
          ...item,
          signed_url: await r2Store.signedGetUrl(item.storage_key),
        })),
      ),
    })),
  );
}

async function submitSettlementPrecheck(database, input) {
  const idempotencyKey = requiredText(input.idempotencyKey, "idempotencyKey");
  const receipt = normalizeSettlementEvidence(input.receipt, "daily_receipt");
  const transportJpy = optionalNonNegativeInteger(input.transportJpy);
  const transportClaimNote = optionalText(input.transportClaimNote);
  const transportProof = input.transportProof
    ? normalizeSettlementEvidence(input.transportProof, "transport_proof")
    : null;
  if ((transportJpy === null) !== (transportClaimNote === null)) {
    throw new HelperAppServiceError(
      "invalid_transport_claim",
      "申請交通費時，日圓金額與搭車區間文字都必須提供。",
    );
  }
  return withTransaction(database, async (client) => {
    const helper = await findActiveHelperForUser(client, input.authUserId);
    const settlement = await lockSettlement(client, input.settlementId);
    assertHelperOwnsSettlement(settlement, helper);
    if (settlement.helper_submission_key === idempotencyKey) return settlement;
    if (!["pending_helper_precheck", "correction_required"].includes(settlement.status)) {
      throw new HelperAppServiceError("invalid_status", "This settlement cannot be submitted now.");
    }
    await upsertSettlementEvidence(client, {
      evidence: receipt,
      evidenceType: "daily_receipt",
      helperId: helper.id,
      settlementId: settlement.id,
    });
    if (transportProof) {
      await upsertSettlementEvidence(client, {
        evidence: transportProof,
        evidenceType: "transport_proof",
        helperId: helper.id,
        settlementId: settlement.id,
      });
    }
    const updated = await client.query(
      `update helper_app.settlements
       set status = 'pending_admin_review',
           transport_claim_jpy = $2,
           transport_status = case when $2::int is null then 'none' else 'pending' end,
           transport_claim_note = $3,
           helper_note = $4,
           correction_note = null,
           helper_submission_key = $5,
           helper_submitted_at = now(),
           updated_at = now()
       where id = $1
       returning *`,
      [
        settlement.id,
        transportJpy,
        transportClaimNote,
        optionalText(input.helperNote),
        idempotencyKey,
      ],
    );
    await insertAuditEvent(client, {
      action: "helper_settlement_precheck_submitted",
      actor_helper_id: helper.id,
      actor_role: "helper",
      actor_user_id: input.authUserId,
      after_state: { settlementId: settlement.id, status: "pending_admin_review" },
      before_state: { status: settlement.status },
      trip_id: settlement.trip_id,
    });
    return updated.rows[0];
  });
}

async function reviewSettlement(database, input) {
  const action = requiredText(input.action, "action");
  if (!["approve", "reject"].includes(action)) {
    throw new HelperAppServiceError("invalid_input", "Unknown settlement review action.");
  }
  return withTransaction(database, async (client) => {
    const settlement = await lockSettlement(client, input.settlementId);
    if (settlement.status !== "pending_admin_review") {
      throw new HelperAppServiceError("invalid_status", "Settlement is not waiting for admin review.");
    }
    if (action === "reject") {
      const note = requiredText(input.adminReviewNote, "adminReviewNote");
      const result = await client.query(
        `update helper_app.settlements
         set status = 'correction_required', correction_note = $2,
             helper_submission_key = null, admin_reviewed_at = now(), updated_at = now()
         where id = $1 returning *`,
        [settlement.id, note],
      );
      await auditSettlementState(client, settlement, result.rows[0], input.actorUserId, "admin_settlement_rejected");
      return result.rows[0];
    }
    const jpyToTwdRate = positiveNumber(
      optionalText(input.jpyToTwdRate) || settlement.jpy_to_twd_rate,
      "jpyToTwdRate",
    );
    const transportApproved =
      settlement.transport_status === "pending" && input.transportDecision === "approve";
    const totals = calculateSettlement({
      compensationMode: settlement.compensation_mode,
      helperFxRate: settlement.helper_fx_rate,
      hourlyRateTwd: settlement.hourly_rate_twd,
      jpyToTwdRate,
      productTotalJpy: settlement.product_total_jpy,
      transportApproved,
      transportJpy: settlement.transport_claim_jpy || 0,
      workMinutes: settlement.work_minutes,
    });
    const result = await client.query(
      `update helper_app.settlements
       set status = 'pending_helper_confirmation',
           jpy_to_twd_rate = $2,
           item_advance_twd = $3,
           work_pay_twd = $4,
           approved_transport_twd = $5,
           total_payable_twd = $6,
           is_split_payment = $7,
           transport_status = case
             when transport_status = 'none' then 'none'
             when $8::boolean then 'approved'
             else 'rejected'
           end,
           admin_review_note = $9,
           correction_note = null,
           admin_reviewed_at = now(),
           updated_at = now()
       where id = $1
       returning *`,
      [
        settlement.id,
        jpyToTwdRate,
        totals.itemAdvanceTwd,
        totals.workPayTwd,
        totals.approvedTransportTwd,
        totals.totalPayableTwd,
        totals.isSplitPayment,
        transportApproved,
        optionalText(input.adminReviewNote),
      ],
    );
    await auditSettlementState(client, settlement, result.rows[0], input.actorUserId, "admin_settlement_approved");
    return result.rows[0];
  });
}

async function setSettlementExchangeRate(database, input) {
  const jpyToTwdRate = positiveNumber(input.jpyToTwdRate, "jpyToTwdRate");
  return withTransaction(database, async (client) => {
    const settlement = await lockSettlement(client, input.settlementId);
    if (settlement.status === "completed") {
      throw new HelperAppServiceError("invalid_status", "Completed settlement rate cannot be changed.");
    }
    const itemAdvanceTwd = Math.round(Number(settlement.product_total_jpy || 0) * jpyToTwdRate);
    const result = await client.query(
      `update helper_app.settlements
       set jpy_to_twd_rate = $2,
           item_advance_twd = $3,
           updated_at = now()
       where id = $1
       returning *`,
      [settlement.id, jpyToTwdRate, itemAdvanceTwd],
    );
    await insertAuditEvent(client, {
      action: "admin_settlement_exchange_rate_set",
      actor_role: "admin",
      actor_user_id: input.actorUserId,
      after_state: {
        itemAdvanceTwd,
        jpyToTwdRate,
        settlementId: settlement.id,
      },
      before_state: {
        itemAdvanceTwd: settlement.item_advance_twd,
        jpyToTwdRate: settlement.jpy_to_twd_rate,
        settlementId: settlement.id,
      },
      trip_id: settlement.trip_id,
    });
    return result.rows[0];
  });
}

async function confirmSettlement(database, input) {
  return withTransaction(database, async (client) => {
    const helper = await findActiveHelperForUser(client, input.authUserId);
    const settlement = await lockSettlement(client, input.settlementId);
    assertHelperOwnsSettlement(settlement, helper);
    if (settlement.status !== "pending_helper_confirmation") {
      throw new HelperAppServiceError("invalid_status", "Settlement is not ready for final confirmation.");
    }
    const result = await client.query(
      `update helper_app.settlements
       set status = 'payment_pending', helper_confirmed_at = now(), updated_at = now()
       where id = $1 returning *`,
      [settlement.id],
    );
    await auditSettlementState(client, settlement, result.rows[0], input.authUserId, "helper_settlement_confirmed", helper.id);
    return result.rows[0];
  });
}

async function recordSettlementPayment(database, input) {
  const transferNotification = requiredText(input.transferNotification, "transferNotification");
  return withTransaction(database, async (client) => {
    const settlement = await lockSettlement(client, input.settlementId);
    let paymentType;
    let amount;
    if (settlement.status === "payment_pending") {
      paymentType = settlement.is_split_payment ? "first" : "single";
      amount = settlement.is_split_payment
        ? Math.round(Number(settlement.total_payable_twd) / 2)
        : Number(settlement.total_payable_twd);
    } else if (settlement.status === "final_payment_pending" && settlement.is_split_payment) {
      paymentType = "final";
      const paid = await client.query(
        `select coalesce(sum(amount_twd), 0)::int as paid
         from helper_app.settlement_payments where settlement_id = $1`,
        [settlement.id],
      );
      amount = Number(settlement.total_payable_twd) - Number(paid.rows[0]?.paid || 0);
    } else {
      throw new HelperAppServiceError("invalid_status", "Settlement is not waiting for this payment.");
    }
    await client.query(
      `insert into helper_app.settlement_payments
         (settlement_id, payment_type, amount_twd, transfer_notification, paid_by_user_id)
       values ($1, $2, $3, $4, $5)`,
      [settlement.id, paymentType, amount, transferNotification, input.actorUserId],
    );
    const nextStatus = paymentType === "final" ? "completed" : "warehouse_pending";
    const result = await client.query(
      `update helper_app.settlements
       set status = $2,
           completed_at = case when $2 = 'completed' then now() else completed_at end,
           updated_at = now()
       where id = $1 returning *`,
      [settlement.id, nextStatus],
    );
    await auditSettlementState(client, settlement, result.rows[0], input.actorUserId, `admin_settlement_${paymentType}_paid`);
    return result.rows[0];
  });
}

async function submitWarehouseProof(database, input) {
  const idempotencyKey = requiredText(input.idempotencyKey, "idempotencyKey");
  const proof = normalizeSettlementEvidence(input.proof, "warehouse_proof");
  return withTransaction(database, async (client) => {
    const helper = await findActiveHelperForUser(client, input.authUserId);
    const settlement = await lockSettlement(client, input.settlementId);
    assertHelperOwnsSettlement(settlement, helper);
    if (settlement.warehouse_submission_key === idempotencyKey) return settlement;
    if (settlement.status !== "warehouse_pending") {
      throw new HelperAppServiceError("invalid_status", "Warehouse proof cannot be submitted now.");
    }
    await upsertSettlementEvidence(client, {
      evidence: proof,
      evidenceType: "warehouse_proof",
      helperId: helper.id,
      note: optionalText(input.note),
      settlementId: settlement.id,
    });
    const result = await client.query(
      `update helper_app.settlements
       set status = 'warehouse_review_pending', warehouse_submission_key = $2,
           warehouse_submitted_at = now(), updated_at = now()
       where id = $1 returning *`,
      [settlement.id, idempotencyKey],
    );
    await auditSettlementState(client, settlement, result.rows[0], input.authUserId, "helper_warehouse_proof_submitted", helper.id);
    return result.rows[0];
  });
}

async function reviewWarehouseProof(database, input) {
  return withTransaction(database, async (client) => {
    const settlement = await lockSettlement(client, input.settlementId);
    if (settlement.status !== "warehouse_review_pending") {
      throw new HelperAppServiceError("invalid_status", "Warehouse proof is not waiting for review.");
    }
    const nextStatus = settlement.is_split_payment ? "final_payment_pending" : "completed";
    const result = await client.query(
      `update helper_app.settlements
       set status = $2, warehouse_reviewed_at = now(),
           completed_at = case when $2 = 'completed' then now() else completed_at end,
           updated_at = now()
       where id = $1 returning *`,
      [settlement.id, nextStatus],
    );
    await auditSettlementState(client, settlement, result.rows[0], input.actorUserId, "admin_warehouse_proof_approved");
    return result.rows[0];
  });
}

async function lockSettlement(client, settlementId) {
  const result = await client.query(
    `select * from helper_app.settlements where id = $1 for update`,
    [requiredText(settlementId, "settlementId")],
  );
  if (!result.rows[0]) throw new HelperAppServiceError("settlement_not_found", "Settlement was not found.");
  return result.rows[0];
}

function assertHelperOwnsSettlement(settlement, helper) {
  if (settlement.helper_id !== helper.id) {
    throw new HelperAppServiceError("forbidden", "Settlement does not belong to this helper.");
  }
}

async function upsertSettlementEvidence(
  client,
  { evidence, evidenceType, helperId, note = null, settlementId },
) {
  const mediaKind = evidenceType === "daily_receipt"
    ? "settlement_receipt"
    : evidenceType === "transport_proof"
      ? "transport_proof"
      : "warehouse_evidence";
  const retentionStatus = evidenceType === "warehouse_proof" ? "warehouse_evidence" : "order_evidence";
  await client.query(
    `insert into helper_app.media_objects
       (storage_key, media_kind, retention_status, original_filename,
        content_type, byte_size, uploaded_by_helper_id)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (storage_key) do update
     set media_kind = excluded.media_kind, retention_status = excluded.retention_status`,
    [
      evidence.storageKey,
      mediaKind,
      retentionStatus,
      evidence.originalFilename,
      evidence.contentType,
      evidence.byteSize,
      helperId,
    ],
  );
  await client.query(
    `insert into helper_app.settlement_evidence
       (settlement_id, storage_key, evidence_type, note)
     values ($1, $2, $3, $4)
     on conflict (settlement_id, evidence_type) do update
     set storage_key = excluded.storage_key, note = excluded.note, updated_at = now()`,
    [settlementId, evidence.storageKey, evidenceType, note],
  );
}

async function auditSettlementState(
  client,
  before,
  after,
  actorUserId,
  action,
  actorHelperId = null,
) {
  await insertAuditEvent(client, {
    action,
    actor_helper_id: actorHelperId,
    actor_role: actorHelperId ? "helper" : "admin",
    actor_user_id: actorUserId,
    after_state: { settlementId: after.id, status: after.status },
    before_state: { settlementId: before.id, status: before.status },
    trip_id: before.trip_id,
  });
}

function normalizeSettlementEvidence(value, fieldName) {
  if (!value || typeof value !== "object") {
    throw new HelperAppServiceError("invalid_input", `${fieldName} photo is required.`);
  }
  return {
    byteSize: optionalNonNegativeInteger(value.byteSize),
    contentType: optionalText(value.contentType),
    originalFilename: optionalText(value.originalFilename),
    storageKey: requiredText(value.storageKey, `${fieldName}.storageKey`),
  };
}

function optionalNonNegativeInteger(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw new HelperAppServiceError("invalid_input", "Expected a non-negative integer.");
  }
  return number;
}

function positiveNumber(value, fieldName) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new HelperAppServiceError("invalid_input", `${fieldName} must be greater than zero.`);
  }
  return number;
}

function normalizeHelperInput(input) {
  const displayName = requiredText(input.displayName, "displayName");
  const email = requiredText(input.email, "email").toLowerCase();
  const compensationMode = requiredText(input.compensationMode, "compensationMode");
  if (!["hourly", "fx_rate"].includes(compensationMode)) {
    throw new HelperAppServiceError("invalid_input", "Invalid compensation mode.");
  }
  return {
    authUserId: optionalText(input.authUserId),
    bankAccountName: optionalText(input.bankAccountName),
    bankAccountNumber: optionalText(input.bankAccountNumber),
    bankCode: optionalText(input.bankCode),
    compensationMode,
    displayName,
    email,
    helperFxRate: input.helperFxRate ? Number(input.helperFxRate) : null,
    hourlyRateTwd: input.hourlyRateTwd ? Number(input.hourlyRateTwd) : null,
    region: optionalText(input.region),
  };
}

function normalizeTripInput(input) {
  return {
    assignedHelperId: requiredText(input.assignedHelperId, "assignedHelperId"),
    businessDate: requiredText(input.businessDate, "businessDate"),
    location: optionalText(input.location),
    scheduledTime: optionalText(input.scheduledTime),
    timezone: optionalText(input.timezone) || "Asia/Tokyo",
    tripName: requiredText(input.tripName, "tripName"),
  };
}

function normalizeSitePhotoBatchInput(input) {
  const tripId = requiredText(input.tripId, "tripId");
  const submissionId = requiredText(input.submissionId, "submissionId");
  const photos = Array.isArray(input.photos) ? input.photos : [];
  if (photos.length === 0) {
    throw new HelperAppServiceError("invalid_input", "At least one uploaded photo is required.");
  }
  if (photos.length > 40) {
    throw new HelperAppServiceError("invalid_input", "A site photo batch can include at most 40 photos.");
  }
  const seenClientIds = new Set();
  const seenSortOrders = new Set();
  const normalizedPhotos = photos.map((photo, index) => {
    const clientPhotoId = requiredText(photo.clientPhotoId, "clientPhotoId");
    if (seenClientIds.has(clientPhotoId)) {
      throw new HelperAppServiceError("invalid_input", "Photo client ids must be unique.");
    }
    seenClientIds.add(clientPhotoId);
    const sortOrder = Number(photo.sortOrder ?? index);
    if (!Number.isInteger(sortOrder) || sortOrder < 0) {
      throw new HelperAppServiceError("invalid_input", "Photo sort order must be a non-negative integer.");
    }
    if (seenSortOrders.has(sortOrder)) {
      throw new HelperAppServiceError("invalid_input", "Photo sort orders must be unique.");
    }
    seenSortOrders.add(sortOrder);
    const contentType = requiredText(photo.contentType, "contentType");
    if (!contentType.startsWith("image/")) {
      throw new HelperAppServiceError("invalid_input", "Only image uploads are supported.");
    }
    const byteSize = photo.byteSize == null || photo.byteSize === ""
      ? null
      : Number(photo.byteSize);
    if (byteSize != null && (!Number.isFinite(byteSize) || byteSize < 0)) {
      throw new HelperAppServiceError("invalid_input", "Photo byte size must be non-negative.");
    }
    return {
      byteSize,
      clientPhotoId,
      contentType,
      originalFilename: optionalText(photo.originalFilename),
      sortOrder,
      storageKey: requiredText(photo.storageKey, "storageKey"),
    };
  });

  return {
    note: optionalText(input.note),
    photos: normalizedPhotos.sort((left, right) => left.sortOrder - right.sortOrder),
    submissionId,
    tripId,
  };
}

function normalizeQuoteTaskInput(input) {
  const taskType = requiredText(input.taskType, "taskType");
  if (!["quote", "detail", "quote_and_detail"].includes(taskType)) {
    throw new HelperAppServiceError("invalid_input", "Invalid quote task type.");
  }
  const photoIds = Array.isArray(input.photoIds) ? input.photoIds.map(optionalText).filter(Boolean) : [];
  if (new Set(photoIds).size !== photoIds.length) {
    throw new HelperAppServiceError("invalid_input", "Task photos must be unique.");
  }
  const uploadedPhotos = Array.isArray(input.uploadedPhotos)
    ? input.uploadedPhotos.map((photo) => {
        const byteSize = Number(photo.byteSize);
        if (!Number.isFinite(byteSize) || byteSize < 0) {
          throw new HelperAppServiceError("invalid_input", "Photo byte size must be non-negative.");
        }
        const contentType = requiredText(photo.contentType, "contentType");
        if (!contentType.startsWith("image/")) {
          throw new HelperAppServiceError("invalid_input", "Task uploads must be images.");
        }
        const sortOrder = Number(photo.sortOrder);
        if (!Number.isInteger(sortOrder) || sortOrder < 0) {
          throw new HelperAppServiceError("invalid_input", "Photo sort order must be a non-negative integer.");
        }
        return {
          byteSize,
          contentType,
          originalFilename: optionalText(photo.originalFilename),
          sortOrder,
          storageKey: requiredText(photo.storageKey, "storageKey"),
        };
      })
    : [];
  if (taskType === "detail" && uploadedPhotos.length === 0) {
    throw new HelperAppServiceError("invalid_input", "At least one uploaded task photo is required.");
  }
  if (taskType !== "detail" && photoIds.length === 0) {
    throw new HelperAppServiceError("invalid_input", "At least one task photo is required.");
  }
  if (taskType === "detail" && photoIds.length > 0) {
    throw new HelperAppServiceError("invalid_input", "Detail tasks must use uploaded task photos.");
  }
  if (taskType !== "detail" && uploadedPhotos.length > 0) {
    throw new HelperAppServiceError("invalid_input", "Only detail tasks may use uploaded task photos.");
  }
  if (new Set(uploadedPhotos.map((photo) => photo.storageKey)).size !== uploadedPhotos.length) {
    throw new HelperAppServiceError("invalid_input", "Uploaded task photos must be unique.");
  }
  if (new Set(uploadedPhotos.map((photo) => photo.sortOrder)).size !== uploadedPhotos.length) {
    throw new HelperAppServiceError("invalid_input", "Uploaded task photo order must be unique.");
  }
  if (Math.max(photoIds.length, uploadedPhotos.length) > 40) {
    throw new HelperAppServiceError("invalid_input", "A quote task can include at most 40 photos.");
  }
  return {
    instruction: optionalText(input.instruction),
    photoIds,
    productName: optionalText(input.productName),
    taskType,
    tripId: requiredText(input.tripId, "tripId"),
    uploadedPhotos: uploadedPhotos.sort((left, right) => left.sortOrder - right.sortOrder),
  };
}

function normalizeQuoteReplyInput(input) {
  const detailPhotos = Array.isArray(input.detailPhotos) ? input.detailPhotos : [];
  const normalizedDetailPhotos = detailPhotos.map((photo, index) => {
    const contentType = requiredText(photo.contentType || photo.content_type, "contentType");
    if (!contentType.startsWith("image/")) {
      throw new HelperAppServiceError("invalid_input", "Only image reply uploads are supported.");
    }
    const byteSize = photo.byteSize ?? photo.byte_size;
    const sortOrder = Number(photo.sortOrder ?? photo.sort_order ?? index);
    if (!Number.isInteger(sortOrder) || sortOrder < 0) {
      throw new HelperAppServiceError("invalid_input", "Detail photo sort order must be a non-negative integer.");
    }
    return {
      byte_size: byteSize == null || byteSize === "" ? null : Number(byteSize),
      content_type: contentType,
      original_filename: optionalText(photo.originalFilename || photo.original_filename),
      sort_order: sortOrder,
      storage_key: requiredText(photo.storageKey || photo.storage_key, "storageKey"),
    };
  });
  const priceText = optionalText(input.priceJpy);
  const priceJpy = priceText == null ? null : Number(priceText);
  if (priceJpy != null && (!Number.isInteger(priceJpy) || priceJpy < 0)) {
    throw new HelperAppServiceError("invalid_input", "JPY price must be a non-negative integer.");
  }
  return {
    detailPhotos: normalizedDetailPhotos.sort((left, right) => left.sort_order - right.sort_order),
    idempotencyKey: requiredText(input.idempotencyKey, "idempotencyKey"),
    note: optionalText(input.note),
    priceJpy,
    quoteTaskPhotoId: requiredText(input.quoteTaskPhotoId, "quoteTaskPhotoId"),
  };
}

function normalizePurchaseTaskInput(input, { allowMissingOriginalPriceJpy = false } = {}) {
  const quantity = Number(requiredText(input.quantity, "quantity"));
  const salePriceTwd = Number(requiredText(input.salePriceTwd, "salePriceTwd"));
  const originalPriceText = optionalText(input.originalPriceJpy);
  if (originalPriceText == null && !allowMissingOriginalPriceJpy) {
    throw new HelperAppServiceError("invalid_input", "Original JPY price is required.");
  }
  const originalPriceJpy = originalPriceText == null ? null : Number(originalPriceText);
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new HelperAppServiceError("invalid_input", "Quantity must be a positive integer.");
  }
  if (!Number.isInteger(salePriceTwd) || salePriceTwd < 0) {
    throw new HelperAppServiceError("invalid_input", "Sale price TWD must be a non-negative integer.");
  }
  if (originalPriceJpy != null && (!Number.isInteger(originalPriceJpy) || originalPriceJpy < 0)) {
    throw new HelperAppServiceError("invalid_input", "Original JPY price must be a non-negative integer.");
  }
  return {
    actorUserId: input.actorUserId || null,
    lineCommunityName: requiredText(input.lineCommunityName, "lineCommunityName"),
    note: optionalText(input.note),
    originalPriceJpy,
    productName: requiredText(input.productName, "productName"),
    quantity,
    requiresFaceCheck: Boolean(input.requiresFaceCheck),
    salePriceTwd,
    sourceQuoteReplyId: input.sourceQuoteReplyId || null,
    sourceQuoteTaskId: input.sourceQuoteTaskId || null,
    sourceQuoteTaskPhotoId: input.sourceQuoteTaskPhotoId || null,
    tripId: requiredText(input.tripId, "tripId"),
  };
}

function normalizePurchaseReferencePhotos(photos) {
  const normalized = Array.isArray(photos)
    ? photos.map((photo, index) => {
        const contentType = requiredText(photo.contentType || photo.content_type, "contentType");
        if (!contentType.startsWith("image/")) {
          throw new HelperAppServiceError("invalid_input", "Only image uploads are supported.");
        }
        const byteSize = photo.byteSize ?? photo.byte_size;
        const sortOrder = Number(photo.sortOrder ?? photo.sort_order ?? index);
        if (!Number.isInteger(sortOrder) || sortOrder < 0) {
          throw new HelperAppServiceError("invalid_input", "Reference photo sort order must be a non-negative integer.");
        }
        return {
          byteSize: byteSize == null || byteSize === "" ? null : Number(byteSize),
          contentType,
          originalFilename: optionalText(photo.originalFilename || photo.original_filename),
          sortOrder,
          storageKey: requiredText(photo.storageKey || photo.storage_key, "storageKey"),
        };
      })
    : [];
  if (new Set(normalized.map((photo) => photo.storageKey)).size !== normalized.length) {
    throw new HelperAppServiceError("invalid_input", "Reference photos must be unique.");
  }
  if (new Set(normalized.map((photo) => photo.sortOrder)).size !== normalized.length) {
    throw new HelperAppServiceError("invalid_input", "Reference photo order must be unique.");
  }
  return normalized.sort((left, right) => left.sortOrder - right.sortOrder);
}

function normalizePurchaseResponseInput(input) {
  const action = requiredText(input.action || "complete", "action");
  if (!["cancel", "complete", "not_found", "unavailable"].includes(action)) {
    throw new HelperAppServiceError("invalid_input", "Invalid purchase response action.");
  }
  const completedText = optionalText(input.completedQuantity);
  const unavailableText = optionalText(input.unavailableQuantity);
  const completedQuantity = completedText == null ? null : Number(completedText);
  const unavailableQuantity = unavailableText == null ? null : Number(unavailableText);
  if (completedQuantity != null && (!Number.isInteger(completedQuantity) || completedQuantity <= 0)) {
    throw new HelperAppServiceError("invalid_input", "Completed quantity must be a positive integer.");
  }
  if (unavailableQuantity != null && (!Number.isInteger(unavailableQuantity) || unavailableQuantity < 0)) {
    throw new HelperAppServiceError("invalid_input", "Unavailable quantity must be a non-negative integer.");
  }
  return {
    action,
    authUserId: requiredText(input.authUserId, "authUserId"),
    completedQuantity,
    faceCheckNote: optionalText(input.faceCheckNote),
    faceCheckPhoto: normalizeOptionalPhoto(input.faceCheckPhoto),
    helperNote: optionalText(input.helperNote),
    idempotencyKey: requiredText(input.idempotencyKey, "idempotencyKey"),
    purchaseTaskId: requiredText(input.purchaseTaskId, "purchaseTaskId"),
    unavailableQuantity,
  };
}

function normalizeRebuyTaskInput(input) {
  const visibility = requiredText(input.visibility || "private", "visibility");
  if (!["private", "public"].includes(visibility)) {
    throw new HelperAppServiceError("invalid_input", "Invalid rebuy visibility.");
  }
  const quantityText = optionalText(input.quantity);
  const quantity = quantityText == null ? null : Number(quantityText);
  if (quantity != null && (!Number.isInteger(quantity) || quantity <= 0)) {
    throw new HelperAppServiceError("invalid_input", "Quantity must be a positive integer.");
  }
  const originalPriceText = optionalText(input.originalPriceJpy);
  const originalPriceJpy = originalPriceText == null ? null : Number(originalPriceText);
  if (originalPriceJpy != null && (!Number.isInteger(originalPriceJpy) || originalPriceJpy < 0)) {
    throw new HelperAppServiceError("invalid_input", "Original JPY price must be a non-negative integer.");
  }
  const salePriceText = optionalText(input.salePriceTwd);
  const salePriceTwd = salePriceText == null ? null : Number(salePriceText);
  if (salePriceTwd != null && (!Number.isInteger(salePriceTwd) || salePriceTwd < 0)) {
    throw new HelperAppServiceError("invalid_input", "Sale price TWD must be a non-negative integer.");
  }
  const sourcePurchaseTaskId = optionalText(input.sourcePurchaseTaskId);
  if (!sourcePurchaseTaskId && (!quantity || !optionalText(input.productName))) {
    throw new HelperAppServiceError("invalid_input", "Manual rebuy tasks require product name and quantity.");
  }
  return {
    actorUserId: input.actorUserId || null,
    assignedHelperId: optionalText(input.assignedHelperId),
    instructions: optionalText(input.instructions),
    lineCommunityName: optionalText(input.lineCommunityName),
    originalPriceJpy,
    priority: 100,
    productName: optionalText(input.productName),
    quantity,
    salePriceTwd,
    sourcePurchaseTaskId,
    visibility,
  };
}

function normalizeRebuyReportInput(input) {
  const reportedQuantity = Number(requiredText(input.reportedQuantity, "reportedQuantity"));
  if (!Number.isInteger(reportedQuantity) || reportedQuantity <= 0) {
    throw new HelperAppServiceError("invalid_input", "Reported quantity must be a positive integer.");
  }
  return {
    authUserId: requiredText(input.authUserId, "authUserId"),
    helperNote: optionalText(input.helperNote),
    idempotencyKey: requiredText(input.idempotencyKey, "idempotencyKey"),
    rebuyTaskId: requiredText(input.rebuyTaskId, "rebuyTaskId"),
    remainingReason: optionalText(input.remainingReason),
    reportPhotos: normalizeRebuyPhotos(input.reportPhotos, "report"),
    reportPhotosOmitted: Boolean(input.reportPhotosOmitted),
    reportedQuantity,
  };
}

function normalizeRebuyPhotos(photos, role) {
  const normalized = Array.isArray(photos)
    ? photos.map((photo, index) => {
        const contentType = requiredText(photo.contentType || photo.content_type, "contentType");
        if (!contentType.startsWith("image/")) {
          throw new HelperAppServiceError("invalid_input", "Only image uploads are supported.");
        }
        const byteSize = photo.byteSize ?? photo.byte_size;
        const sortOrder = Number(photo.sortOrder ?? photo.sort_order ?? index);
        if (!Number.isInteger(sortOrder) || sortOrder < 0) {
          throw new HelperAppServiceError("invalid_input", "Photo sort order must be a non-negative integer.");
        }
        return {
          byteSize: byteSize == null || byteSize === "" ? null : Number(byteSize),
          contentType,
          originalFilename: optionalText(photo.originalFilename || photo.original_filename),
          sortOrder,
          storageKey: requiredText(photo.storageKey || photo.storage_key, "storageKey"),
        };
      })
    : [];
  if (new Set(normalized.map((photo) => photo.storageKey)).size !== normalized.length) {
    throw new HelperAppServiceError("invalid_input", `${role} photos must be unique.`);
  }
  if (new Set(normalized.map((photo) => photo.sortOrder)).size !== normalized.length) {
    throw new HelperAppServiceError("invalid_input", `${role} photo order must be unique.`);
  }
  return normalized.sort((left, right) => left.sortOrder - right.sortOrder);
}

function normalizeOptionalPhoto(photo) {
  if (!photo) return null;
  const contentType = requiredText(photo.contentType || photo.content_type, "contentType");
  if (!contentType.startsWith("image/")) {
    throw new HelperAppServiceError("invalid_input", "Only image uploads are supported.");
  }
  const byteSize = photo.byteSize ?? photo.byte_size;
  return {
    byteSize: byteSize == null || byteSize === "" ? null : Number(byteSize),
    contentType,
    originalFilename: optionalText(photo.originalFilename || photo.original_filename),
    storageKey: requiredText(photo.storageKey || photo.storage_key, "storageKey"),
  };
}

function assertReplyMatchesTaskType(taskType, reply) {
  if (["quote", "quote_and_detail"].includes(taskType) && reply.priceJpy == null) {
    throw new HelperAppServiceError("invalid_input", "JPY price is required for this reply.");
  }
  if (["detail", "quote_and_detail"].includes(taskType) && reply.detailPhotos.length === 0) {
    throw new HelperAppServiceError("invalid_input", "At least one detail photo is required for this reply.");
  }
}

async function getSitePhotoBatchById(client, batchId) {
  const result = await client.query(
    `select b.id, b.trip_id, b.helper_id, b.submission_id, b.note, b.status,
            b.created_at, b.updated_at,
            coalesce(
              jsonb_agg(
                jsonb_build_object(
                  'id', p.id,
                  'client_photo_id', p.client_photo_id,
                  'storage_key', p.storage_key,
                  'original_filename', p.original_filename,
                  'content_type', p.content_type,
                  'byte_size', p.byte_size,
                  'sort_order', p.sort_order,
                  'saved_by_admin', p.saved_by_admin,
                  'saved_at', p.saved_at,
                  'created_at', p.created_at
                )
                order by p.sort_order asc
              ) filter (where p.id is not null),
              '[]'::jsonb
            ) as photos
     from helper_app.site_photo_batches b
     left join helper_app.site_photos p on p.batch_id = b.id
     where b.id = $1
     group by b.id`,
    [batchId],
  );
  if (!result.rows[0]) {
    throw new HelperAppServiceError("batch_not_found", "Site photo batch was not found.");
  }
  return result.rows[0];
}

async function getQuoteTaskById(client, taskId) {
  const result = await client.query(
    `select qt.id, qt.trip_id, qt.helper_id, qt.task_type, qt.product_name,
            qt.instruction, qt.status, qt.created_at, qt.updated_at,
            coalesce(
              jsonb_agg(
                jsonb_build_object(
                  'id', qtp.id,
                  'source_site_photo_id', qtp.source_site_photo_id,
                  'storage_key', qtp.storage_key,
                  'product_name', qtp.product_name,
                  'instruction', qtp.instruction,
                  'sort_order', qtp.sort_order,
                  'reply_status', qtp.reply_status,
                  'needs_review', qtp.needs_review
                )
                order by qtp.sort_order asc
              ) filter (where qtp.id is not null),
              '[]'::jsonb
            ) as photos
     from helper_app.quote_tasks qt
     left join helper_app.quote_task_photos qtp on qtp.quote_task_id = qt.id
     where qt.id = $1
     group by qt.id`,
    [taskId],
  );
  if (!result.rows[0]) {
    throw new HelperAppServiceError("quote_task_not_found", "Quote task was not found.");
  }
  return result.rows[0];
}

async function insertPurchaseTask(client, input) {
  const result = await client.query(
    `insert into helper_app.purchase_tasks
       (trip_id, helper_id, source_quote_task_id, source_quote_task_photo_id,
        source_quote_reply_id, line_community_name, product_name, quantity,
        original_price_jpy, sale_price_twd, note, requires_face_check,
        created_by_user_id, source_rebuy_task_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     returning *`,
    [
      input.tripId,
      input.helperId,
      input.sourceQuoteTaskId || null,
      input.sourceQuoteTaskPhotoId || null,
      input.sourceQuoteReplyId || null,
      input.lineCommunityName,
      input.productName,
      input.quantity,
      input.originalPriceJpy,
      input.salePriceTwd,
      input.note,
      input.requiresFaceCheck,
      input.actorUserId,
      input.sourceRebuyTaskId || null,
    ],
  );
  const task = result.rows[0];
  await insertAuditEvent(client, {
    action: "admin_purchase_task_created",
    actor_role: "admin",
    actor_user_id: input.actorUserId,
    after_state: {
      purchaseTaskId: task.id,
      requiresFaceCheck: task.requires_face_check,
      sourceRebuyTaskId: task.source_rebuy_task_id,
      sourceQuoteTaskPhotoId: task.source_quote_task_photo_id,
    },
    before_state: {},
    trip_id: task.trip_id,
  });
  return task;
}

async function insertPurchasePhoto(client, input) {
  await client.query(
    `insert into helper_app.purchase_task_photos
       (purchase_task_id, trip_id, helper_id, storage_key, photo_role, sort_order)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (purchase_task_id, photo_role, sort_order) do nothing`,
    [
      input.purchaseTaskId,
      input.tripId,
      input.helperId,
      input.storageKey,
      input.photoRole,
      input.sortOrder,
    ],
  );
  await client.query(
    `update helper_app.media_objects
     set retention_status = 'order_evidence'
     where storage_key = $1`,
    [input.storageKey],
  );
}

async function getPurchaseTaskById(client, purchaseTaskId) {
  const result = await client.query(
    `select pt.*,
            coalesce(
              jsonb_agg(
                jsonb_build_object(
                  'id', ptp.id,
                  'storage_key', ptp.storage_key,
                  'photo_role', ptp.photo_role,
                  'sort_order', ptp.sort_order
                )
                order by ptp.photo_role asc, ptp.sort_order asc
              ) filter (where ptp.id is not null),
              '[]'::jsonb
            ) as photos
     from helper_app.purchase_tasks pt
     left join helper_app.purchase_task_photos ptp on ptp.purchase_task_id = pt.id
     where pt.id = $1
     group by pt.id`,
    [purchaseTaskId],
  );
  if (!result.rows[0]) throw new HelperAppServiceError("purchase_task_not_found", "Purchase task was not found.");
  return result.rows[0];
}

async function lockPurchaseTask(client, purchaseTaskId) {
  const result = await client.query(
    `select *
     from helper_app.purchase_tasks
     where id = $1
     for update`,
    [purchaseTaskId],
  );
  if (!result.rows[0]) throw new HelperAppServiceError("purchase_task_not_found", "Purchase task was not found.");
  return result.rows[0];
}

async function syncStagingOrderPreview(client, task) {
  if (task.status !== "completed" || !task.completed_quantity || task.completed_quantity <= 0) return null;
  const result = await client.query(
    `insert into helper_app.staging_order_previews
       (trip_id, helper_id, purchase_task_id, line_community_name, product_name,
        quantity, original_price_jpy, sale_price_twd, source_quote_task_id,
        source_quote_task_photo_id, source_quote_reply_id, source_rebuy_task_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     on conflict (purchase_task_id) do update
     set line_community_name = excluded.line_community_name,
         product_name = excluded.product_name,
         quantity = excluded.quantity,
         original_price_jpy = excluded.original_price_jpy,
         sale_price_twd = excluded.sale_price_twd,
         source_quote_task_id = excluded.source_quote_task_id,
         source_quote_task_photo_id = excluded.source_quote_task_photo_id,
         source_quote_reply_id = excluded.source_quote_reply_id,
         source_rebuy_task_id = excluded.source_rebuy_task_id,
         updated_at = now()
     returning *`,
    [
      task.trip_id,
      task.helper_id,
      task.id,
      task.line_community_name,
      task.product_name,
      task.completed_quantity,
      task.original_price_jpy,
      task.sale_price_twd,
      task.source_quote_task_id,
      task.source_quote_task_photo_id,
      task.source_quote_reply_id,
      task.source_rebuy_task_id,
    ],
  );
  return result.rows[0];
}

async function lockRebuyTask(client, rebuyTaskId) {
  const result = await client.query(
    `select * from helper_app.rebuy_tasks where id = $1 for update`,
    [rebuyTaskId],
  );
  if (!result.rows[0]) throw new HelperAppServiceError("rebuy_task_not_found", "Rebuy task was not found.");
  return result.rows[0];
}

async function getRebuyTaskById(client, rebuyTaskId) {
  const result = await client.query(
    `select rt.*,
            coalesce(
              jsonb_agg(
                jsonb_build_object(
                  'id', rtp.id,
                  'storage_key', rtp.storage_key,
                  'photo_role', rtp.photo_role,
                  'sort_order', rtp.sort_order
                )
                order by rtp.photo_role asc, rtp.sort_order asc
              ) filter (where rtp.id is not null),
              '[]'::jsonb
            ) as photos
     from helper_app.rebuy_tasks rt
     left join helper_app.rebuy_task_photos rtp on rtp.rebuy_task_id = rt.id
     where rt.id = $1
     group by rt.id`,
    [rebuyTaskId],
  );
  if (!result.rows[0]) throw new HelperAppServiceError("rebuy_task_not_found", "Rebuy task was not found.");
  return result.rows[0];
}

function assertHelperOwnsRebuyTask(task, helper) {
  const ownerId = task.claimed_helper_id || task.assigned_helper_id;
  if (ownerId !== helper.id) {
    throw new HelperAppServiceError("forbidden", "Rebuy task is not assigned to this helper.");
  }
}

async function upsertRebuyPhoto(client, input) {
  await client.query(
    `insert into helper_app.media_objects
       (storage_key, media_kind, retention_status, original_filename,
        content_type, byte_size, uploaded_by_helper_id)
     values ($1, $2, 'order_evidence', $3, $4, $5, $6)
     on conflict (storage_key) do update
     set media_kind = excluded.media_kind,
         retention_status = 'order_evidence',
         original_filename = coalesce(excluded.original_filename, helper_app.media_objects.original_filename),
         content_type = coalesce(excluded.content_type, helper_app.media_objects.content_type),
         byte_size = coalesce(excluded.byte_size, helper_app.media_objects.byte_size)`,
    [
      input.storageKey,
      input.mediaKind,
      input.originalFilename,
      input.contentType,
      input.byteSize,
      input.helperId || null,
    ],
  );
  await client.query(
    `insert into helper_app.rebuy_task_photos
       (rebuy_task_id, storage_key, photo_role, sort_order)
     values ($1, $2, $3, $4)
     on conflict (rebuy_task_id, photo_role, sort_order) do update
     set storage_key = excluded.storage_key`,
    [input.rebuyTaskId, input.storageKey, input.photoRole, input.sortOrder],
  );
}

async function copyRebuyPhotosToPurchase(client, input) {
  const photos = await client.query(
    `select storage_key, photo_role, sort_order
     from helper_app.rebuy_task_photos
     where rebuy_task_id = $1
     order by photo_role asc, sort_order asc`,
    [input.rebuyTaskId],
  );
  for (const photo of photos.rows) {
    await insertPurchasePhoto(client, {
      helperId: input.helperId,
      photoRole: photo.photo_role === "reference" ? "manual_reference" : "detail_reply",
      purchaseTaskId: input.purchaseTaskId,
      sortOrder: photo.sort_order,
      storageKey: photo.storage_key,
      tripId: input.tripId,
    });
  }
}

async function refreshQuoteTaskStatus(client, quoteTaskId) {
  const result = await client.query(
    `select count(*)::int as total,
            count(*) filter (where reply_status = 'replied')::int as replied,
            bool_or(needs_review)::boolean as has_review
     from helper_app.quote_task_photos
     where quote_task_id = $1`,
    [quoteTaskId],
  );
  const summary = result.rows[0];
  const status = summary.has_review
    ? "needs_review"
    : summary.total > 0 && summary.total === summary.replied
      ? "completed"
      : "open";
  await client.query(
    `update helper_app.quote_tasks
     set status = $2,
         updated_at = now()
     where id = $1`,
    [quoteTaskId, status],
  );
}

function requiredText(value, fieldName) {
  const text = optionalText(value);
  if (!text) throw new HelperAppServiceError("invalid_input", `${fieldName} is required.`);
  return text;
}

function optionalText(value) {
  const text = String(value || "").trim();
  return text || null;
}

function isHelperAppServiceError(error) {
  return error instanceof HelperAppServiceError;
}

module.exports = {
  HelperAppServiceError,
  activateTrip,
  attachSignedSettlementUrls,
  attachSignedQuoteTaskUrls,
  attachSignedPurchaseTaskUrls,
  attachSignedPhotoUrls,
  attachSignedRebuyTaskUrls,
  authorizeAdminTaskPhotoUpload,
  authorizePurchaseFaceCheckUpload,
  authorizeQuoteReplyUpload,
  authorizeRebuyReportUpload,
  authorizeSettlementEvidenceUpload,
  authorizeSitePhotoUpload,
  cancelTrip,
  checkoutRebuyTasks,
  claimPublicRebuyTask,
  createHelperProfile,
  createPurchaseTask,
  createQuoteTask,
  createRebuyTask,
  createTrip,
  dateInTimezone,
  dateOnly,
  deactivateHelperProfile,
  updateHelperProfile,
  getHelperWorkspace,
  groupTripsByLocalDate,
  isHelperAppServiceError,
  listPurchaseTasks,
  listQuoteTasks,
  listRebuyTasks,
  listSettlements,
  listSitePhotoBatches,
  listStagingOrderPreviews,
  listAdminDashboard,
  listCustomerNicknames,
  markSitePhotoSaved,
  markHelperArrived,
  markHelperDeparted,
  markHelperEnded,
  repairTrip,
  recordSettlementPayment,
  respondPurchaseTask,
  reviewSettlement,
  setSettlementExchangeRate,
  reviewWarehouseProof,
  reviewFaceCheckPurchaseTask,
  quickPublishPurchaseTask,
  releasePublicRebuyTask,
  reportRebuyTask,
  submitQuotePhotoReply,
  submitSettlementPrecheck,
  submitSitePhotoBatch,
  submitWarehouseProof,
  confirmSettlement,
};
