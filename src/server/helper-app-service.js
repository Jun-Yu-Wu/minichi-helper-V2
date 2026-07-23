const crypto = require("node:crypto");

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

const ADMIN_DASHBOARD_SECTIONS = [
  "helpers",
  "trips",
  "sitePhotoBatches",
  "quoteTasks",
  "purchaseTasks",
  "rebuyTasks",
  "summary",
  "stagingOrderPreviews",
  "stagingMergeJobs",
  "settlements",
];

/**
 * @param {object} database
 * @param {{
 *   sections?: string[],
 *   settlementIds?: string[] | null,
 *   settlementIncludeDetails?: boolean,
 *   settlementStatuses?: string[] | null,
 *   rebuyTaskIds?: string[] | null,
 *   rebuyIncludePhotos?: boolean,
 *   rebuyVisibility?: string | null,
 *   rebuyStatuses?: string[] | null,
 *   rebuyAssignedHelperId?: string | null,
 *   stagingMergeJobId?: string | null,
 *   stagingMergeIncludeOrders?: boolean,
 *   stagingMergeReviewedOrderId?: string | null,
 *   stagingMergeIncludeOrderPhotos?: boolean,
 *   tripStatuses?: string[] | null,
 *   workflowTripIds?: string[] | null
 * }} [options]
 */
async function listAdminDashboard(
  database,
  {
    sections = ADMIN_DASHBOARD_SECTIONS,
    settlementIds = null,
    settlementIncludeDetails = true,
    settlementStatuses = null,
    rebuyTaskIds = null,
    rebuyIncludePhotos = true,
    rebuyVisibility = null,
    rebuyStatuses = null,
    rebuyAssignedHelperId = null,
    stagingMergeJobId = null,
    stagingMergeIncludeOrders = false,
    stagingMergeReviewedOrderId = null,
    stagingMergeIncludeOrderPhotos = false,
    tripStatuses = null,
    workflowTripIds = null,
  } = {},
) {
  const included = new Set(sections);
  const tripParams = [];
  const tripWhere = tripStatuses
    ? `where t.status = any($1::text[])`
    : "";
  if (tripStatuses) tripParams.push(tripStatuses);
  const [helpers, trips, sitePhotoBatches, quoteTasks, purchaseTasks, rebuyTasks, summary, stagingOrderPreviews, stagingMergeJobs, settlements] = await Promise.all([
    included.has("helpers") ? database.query(
      `select id, auth_user_id, display_name, email, compensation_mode,
              hourly_rate_twd, helper_fx_rate, bank_account_name, bank_code,
              bank_account_number, region, is_active, created_at, updated_at
       from helper_app.helper_profiles
       order by created_at desc`,
    ) : Promise.resolve({ rows: [] }),
    included.has("trips") ? database.query(
      `select t.id, t.trip_name, t.business_date, t.scheduled_time, t.location,
              t.timezone, t.assigned_helper_id, t.status, t.departed_at,
              t.arrived_at, t.admin_activated_at, t.ended_at, t.canceled_at,
              t.version, t.created_at, t.updated_at,
              hp.display_name as helper_display_name
       from helper_app.trips t
       left join helper_app.helper_profiles hp on hp.id = t.assigned_helper_id
       ${tripWhere}
       order by t.business_date desc, t.scheduled_time nulls last, t.created_at desc`,
      tripParams,
    ) : Promise.resolve({ rows: [] }),
    included.has("sitePhotoBatches")
      ? listSitePhotoBatches(database, { tripIds: workflowTripIds })
      : Promise.resolve([]),
    included.has("quoteTasks")
      ? listQuoteTasks(database, { tripIds: workflowTripIds })
      : Promise.resolve([]),
    included.has("purchaseTasks")
      ? listPurchaseTasks(database, { includePhotos: false, tripIds: workflowTripIds })
      : Promise.resolve([]),
    included.has("rebuyTasks")
      ? listRebuyTasks(database, {
          includePhotos: rebuyIncludePhotos,
          includePrivateCustomerData: true,
          visibility: rebuyVisibility,
          statuses: rebuyStatuses,
          assignedHelperId: rebuyAssignedHelperId,
          rebuyTaskIds,
        })
      : Promise.resolve([]),
    included.has("summary") ? loadAdminDashboardSummary(database) : Promise.resolve(null),
    included.has("stagingOrderPreviews")
      ? listStagingOrderPreviews(database, { tripIds: workflowTripIds })
      : Promise.resolve([]),
    included.has("stagingMergeJobs")
      ? listStagingMergeJobs(database, {
          includeReviewedOrders: stagingMergeIncludeOrders,
          includeOrderPhotos: stagingMergeIncludeOrderPhotos,
          mergeJobId: stagingMergeJobId,
          reviewedOrderId: stagingMergeReviewedOrderId,
        })
      : Promise.resolve([]),
    included.has("settlements")
      ? listSettlements(database, {
          includeDetails: settlementIncludeDetails,
          settlementIds,
          statuses: settlementStatuses,
        })
      : Promise.resolve([]),
  ]);
  return {
    helpers: helpers.rows,
    purchaseTasks,
    quoteTasks,
    rebuyTasks,
    settlements,
    sitePhotoBatches,
    stagingMergeJobs,
    stagingOrderPreviews,
    summary,
    trips: trips.rows,
  };
}

async function loadAdminDashboardSummary(database) {
  const result = await database.query(
    `select
       (select count(*)::int
        from helper_app.helper_profiles
        where is_active = true) as active_helpers,
       (select count(*)::int
        from helper_app.trips
        where status = 'active') as active_trips,
       (select count(*)::int
        from helper_app.trips
        where status = 'arrived') as arrived_trips,
       (select count(*)::int
        from helper_app.trips
        where status <> 'canceled') as total_trips,
       (select count(*)::int
        from helper_app.quote_tasks
        where status <> 'completed') as open_quote_tasks,
       (select count(*)::int
        from helper_app.purchase_tasks
        where status = 'review_pending') as face_check_pending,
       (select count(*)::int
        from helper_app.settlements
        where status = any($1::text[])) as settlement_pending,
       (select count(*)::int
        from helper_app.staging_merge_jobs
        where status <> 'merged') as merge_pending`,
    [[
      "pending_admin_review",
      "payment_pending",
      "warehouse_review_pending",
      "final_payment_pending",
    ]],
  );
  return result.rows[0] || {
    active_helpers: 0,
    active_trips: 0,
    arrived_trips: 0,
    face_check_pending: 0,
    merge_pending: 0,
    open_quote_tasks: 0,
    settlement_pending: 0,
    total_trips: 0,
  };
}

async function listCustomerNicknames(database) {
  const result = await database.query(
    `select distinct on (lower(btrim(line_community_name))) line_community_name
     from main.customers
     where nullif(btrim(line_community_name), '') is not null
     order by lower(btrim(line_community_name)), line_community_name asc`,
  );
  return result.rows.map((row) => row.line_community_name);
}

async function searchCustomerNicknames(database, input, limit = 8) {
  const query = optionalText(input);
  if (!query) return [];
  const normalizedLimit = Math.min(Math.max(Number(limit) || 8, 1), 20);
  const result = await database.query(
    `select distinct on (lower(btrim(line_community_name))) line_community_name
     from main.customers
     where nullif(btrim(line_community_name), '') is not null
       and position(lower(btrim($1)) in lower(btrim(line_community_name))) > 0
     order by
       lower(btrim(line_community_name)),
       case when lower(btrim(line_community_name)) like lower(btrim($1)) || '%' then 0 else 1 end,
       line_community_name asc
     limit $2`,
    [query, normalizedLimit],
  );
  return result.rows.map((row) => row.line_community_name);
}

const HELPER_WORKSPACE_SECTIONS = [
  "quoteTasks",
  "purchaseTasks",
  "rebuyTasks",
  "settlements",
  "sitePhotoBatches",
  "tripSummaries",
];

/**
 * @param {object} database
 * @param {string} authUserId
 * @param {Date} [now]
 * @param {{
 *   sections?: string[],
 *   settlementIds?: string[] | null,
 *   settlementIncludeDetails?: boolean,
 *   settlementStatuses?: string[] | null,
 *   rebuyIncludePhotos?: boolean,
 *   rebuyTaskIds?: string[] | null,
 *   loadTrips?: boolean,
 *   sitePhotoBatchId?: string | null,
 *   tripIds?: string[] | null,
 *   tripStatuses?: string[] | null
 * }} [options]
 */
async function getHelperWorkspace(database, authUserId, now = new Date(), options = {}) {
  const {
    sections = HELPER_WORKSPACE_SECTIONS,
    settlementIds = null,
    settlementIncludeDetails = true,
    settlementStatuses = null,
    rebuyIncludePhotos = true,
    rebuyTaskIds = null,
    loadTrips = true,
    sitePhotoBatchId = null,
    tripIds = null,
    tripStatuses = null,
  } = options;
  const included = new Set(sections);
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

  const tripsResult = loadTrips
    ? await loadAssignedHelperTrips(database, profile.id, { tripIds, tripStatuses })
    : { rows: [] };
  const assignedTripIds = new Set(tripsResult.rows.map((trip) => trip.id));
  const workflowTripIds = tripIds
    ? tripIds.filter((tripId) => assignedTripIds.has(tripId))
    : tripsResult.rows.map((trip) => trip.id);
  const shouldLoadTripSummaries =
    included.has("tripSummaries") &&
    !(
      tripIds &&
      tripsResult.rows.length > 0 &&
      tripsResult.rows.every((trip) => trip.status !== "active")
    );
  const [
    quoteTasks,
    purchaseTasks,
    rebuyTasks,
    settlements,
    sitePhotoBatches,
    tripSummaries,
  ] = await Promise.all([
    included.has("quoteTasks")
      ? listQuoteTasks(database, {
          helperId: profile.id,
          tripIds: workflowTripIds,
        })
      : Promise.resolve([]),
    included.has("purchaseTasks")
      ? listPurchaseTasks(database, {
          helperId: profile.id,
          includePhotos: false,
          tripIds: workflowTripIds,
        })
      : Promise.resolve([]),
    included.has("rebuyTasks")
      ? listRebuyTasks(database, {
          helperId: profile.id,
          includePhotos: rebuyIncludePhotos,
          rebuyTaskIds,
        })
      : Promise.resolve([]),
    included.has("settlements")
      ? listSettlements(database, {
          helperId: profile.id,
          includeDetails: settlementIncludeDetails,
          settlementIds,
          statuses: settlementStatuses,
        })
      : Promise.resolve([]),
    included.has("sitePhotoBatches")
      ? sitePhotoBatchId
        ? listHelperSitePhotoBatchDetail(database, {
            batchId: sitePhotoBatchId,
            helperId: profile.id,
            tripIds: workflowTripIds,
          })
        : listSitePhotoBatchSummaries(database, {
            helperId: profile.id,
            tripIds: workflowTripIds,
          })
      : Promise.resolve([]),
    shouldLoadTripSummaries
      ? listHelperTripSummaries(database, {
          helperId: profile.id,
          tripIds: workflowTripIds,
        })
      : Promise.resolve([]),
  ]);
  return {
    groups: groupTripsByLocalDate(tripsResult.rows, now),
    profile,
    quoteTasksByTripId: groupQuoteTasksByTripId(quoteTasks),
    purchaseTasksByTripId: groupPurchaseTasksByTripId(purchaseTasks),
    rebuyTasks,
    settlements,
    sitePhotoBatchesByTripId: groupBatchesByTripId(sitePhotoBatches),
    tripSummariesByTripId: Object.fromEntries(
      tripSummaries.map((summary) => [summary.trip_id, summary]),
    ),
  };
}

async function loadAssignedHelperTrips(
  database,
  helperId,
  { tripIds = null, tripStatuses = null } = {},
) {
  const tripParams = [helperId];
  const tripConditions = ["assigned_helper_id = $1"];
  if (tripIds) {
    tripParams.push(tripIds);
    tripConditions.push(`id = any($${tripParams.length}::uuid[])`);
  }
  if (tripStatuses) {
    if (tripStatuses.length === 0) {
      tripConditions.push("false");
    } else {
      tripParams.push(tripStatuses);
      tripConditions.push(`status = any($${tripParams.length}::text[])`);
    }
  }
  return database.query(
    `select id, trip_name, business_date, scheduled_time, location, timezone,
            assigned_helper_id, status, departed_at, arrived_at,
            admin_activated_at, ended_at, canceled_at, version, created_at,
            updated_at
     from helper_app.trips
     where ${tripConditions.join(" and ")}
     order by business_date asc, scheduled_time nulls last, created_at asc`,
    tripParams,
  );
}

async function listHelperTripSummaries(
  database,
  { helperId, tripIds = null },
) {
  if (tripIds && tripIds.length === 0) return [];
  const params = [helperId];
  const conditions = ["t.assigned_helper_id = $1"];
  if (tripIds) {
    params.push(tripIds);
    conditions.push(`t.id = any($${params.length}::uuid[])`);
  }
  const result = await database.query(
    `with scoped_trips as (
       select t.id
       from helper_app.trips t
       where ${conditions.join(" and ")}
     ),
     site_photo_counts as (
       select b.trip_id, count(*)::int as site_photo_batch_count
       from helper_app.site_photo_batches b
       join scoped_trips st on st.id = b.trip_id
       group by b.trip_id
     ),
     quote_task_photo_stats as (
       select qt.id,
              qt.trip_id,
              qt.status,
              count(qtp.id)::int as photo_count,
              count(qtp.id) filter (
                where qtp.reply_status in ('replied', 'converted_to_purchase')
              )::int as replied_photo_count
       from helper_app.quote_tasks qt
       join scoped_trips st on st.id = qt.trip_id
       left join helper_app.quote_task_photos qtp on qtp.quote_task_id = qt.id
       group by qt.id, qt.trip_id, qt.status
     ),
     quote_task_counts as (
       select trip_id,
              count(*)::int as quote_task_count,
              count(*) filter (where status <> 'completed')::int as open_quote_task_count,
              count(*) filter (
                where status = 'completed'
                   or (photo_count > 0 and photo_count = replied_photo_count)
              )::int as completed_quote_task_count,
              count(*) filter (
                where not (
                  status = 'completed'
                  or (photo_count > 0 and photo_count = replied_photo_count)
                )
              )::int as unfinished_quote_task_count
       from quote_task_photo_stats
       group by trip_id
     ),
     quote_photo_counts as (
       select qt.trip_id,
              count(qtp.id)::int as quote_photo_count,
              count(qtp.id) filter (
                where qtp.reply_status in ('replied', 'converted_to_purchase')
              )::int as replied_quote_photo_count,
              count(qtp.id) filter (
                where qtp.reply_status in ('open', 'needs_review')
              )::int as unfinished_quote_photo_count
       from helper_app.quote_tasks qt
       join scoped_trips st on st.id = qt.trip_id
       left join helper_app.quote_task_photos qtp on qtp.quote_task_id = qt.id
       group by qt.trip_id
     ),
     purchase_counts as (
       select pt.trip_id,
              count(*)::int as purchase_task_count,
              count(*) filter (
                where pt.status not in ('completed', 'canceled', 'unavailable', 'not_found')
              )::int as unfinished_purchase_count
       from helper_app.purchase_tasks pt
       join scoped_trips st on st.id = pt.trip_id
       group by pt.trip_id
     )
     select st.id as trip_id,
            coalesce(spc.site_photo_batch_count, 0)::int as site_photo_batch_count,
            coalesce(qtc.quote_task_count, 0)::int as quote_task_count,
            coalesce(qtc.completed_quote_task_count, 0)::int as completed_quote_task_count,
            coalesce(qtc.unfinished_quote_task_count, 0)::int as unfinished_quote_task_count,
            coalesce(qtc.open_quote_task_count, 0)::int as open_quote_task_count,
            coalesce(qpc.quote_photo_count, 0)::int as quote_photo_count,
            coalesce(qpc.replied_quote_photo_count, 0)::int as replied_quote_photo_count,
            coalesce(qpc.unfinished_quote_photo_count, 0)::int as unfinished_quote_photo_count,
            coalesce(pc.purchase_task_count, 0)::int as purchase_task_count,
            coalesce(pc.unfinished_purchase_count, 0)::int as unfinished_purchase_count
     from scoped_trips st
     left join site_photo_counts spc on spc.trip_id = st.id
     left join quote_task_counts qtc on qtc.trip_id = st.id
     left join quote_photo_counts qpc on qpc.trip_id = st.id
     left join purchase_counts pc on pc.trip_id = st.id`,
    params,
  );
  return result.rows;
}

async function listSettlements(
  database,
  {
    helperId = null,
    includeDetails = true,
    settlementIds = null,
    statuses = null,
  } = {},
) {
  if ((settlementIds && settlementIds.length === 0) || (statuses && statuses.length === 0)) {
    return [];
  }
  const params = [];
  const conditions = [];
  if (helperId) {
    params.push(helperId);
    conditions.push(`s.helper_id = $${params.length}`);
  }
  if (settlementIds) {
    params.push(settlementIds);
    conditions.push(`s.id = any($${params.length}::uuid[])`);
  }
  if (statuses) {
    params.push(statuses);
    conditions.push(`s.status = any($${params.length}::text[])`);
  }
  const where = conditions.length ? `where ${conditions.join(" and ")}` : "";
  const detailColumns = includeDetails
    ? `,
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
            ), '[]'::jsonb) as payments`
    : `,
            '[]'::jsonb as line_items,
            '[]'::jsonb as evidence,
            '[]'::jsonb as payments`;
  const result = await database.query(
    `select s.*, t.trip_name, t.business_date, t.timezone,
            hp.display_name as helper_display_name
            ${detailColumns}
     from helper_app.settlements s
     join helper_app.trips t on t.id = s.trip_id
     join helper_app.helper_profiles hp on hp.id = s.helper_id
     ${where}
     order by s.created_at desc`,
    params,
  );
  return result.rows;
}

async function listPurchaseTasks(
  database,
  {
    activeOnly = false,
    authUserId = null,
    helperId = null,
    includePhotos = true,
    taskIds = null,
    tripIds = null,
  } = {},
) {
  if (tripIds && tripIds.length === 0) return [];
  if (taskIds && taskIds.length === 0) return [];
  const conditions = [];
  const params = [];
  if (authUserId) {
    params.push(authUserId);
    conditions.push(`hp.auth_user_id = $${params.length}`);
  }
  if (helperId) {
    params.push(helperId);
    conditions.push(`pt.helper_id = $${params.length}`);
  }
  if (tripIds) {
    params.push(tripIds);
    conditions.push(`pt.trip_id = any($${params.length}::uuid[])`);
  }
  if (taskIds) {
    params.push(taskIds);
    conditions.push(`pt.id = any($${params.length}::uuid[])`);
  }
  if (activeOnly) {
    conditions.push("hp.is_active = true");
    conditions.push("t.status = 'active'");
  }
  const where = conditions.length ? `where ${conditions.join(" and ")}` : "";
  if (!includePhotos) {
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
              coalesce(photo_counts.photo_count, 0)::int as photo_count,
              '[]'::jsonb as photos
       from helper_app.purchase_tasks pt
       join helper_app.trips t on t.id = pt.trip_id
       join helper_app.helper_profiles hp on hp.id = pt.helper_id
       left join lateral (
         select count(*)::int as photo_count
         from helper_app.purchase_task_photos ptp
         where ptp.purchase_task_id = pt.id
           and (
             ptp.photo_role <> 'face_check_report'
             or ptp.id = (
               select latest_face.id
               from helper_app.purchase_task_photos latest_face
               where latest_face.purchase_task_id = pt.id
                 and latest_face.photo_role = 'face_check_report'
               order by latest_face.created_at desc, latest_face.id desc
               limit 1
             )
           )
       ) photo_counts on true
       ${where}
       group by pt.id, t.id, hp.id, photo_counts.photo_count
       order by pt.created_at desc`,
      params,
    );
    return result.rows;
  }
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
            coalesce(photos.photo_count, 0)::int as photo_count,
            coalesce(
              photos.items,
              '[]'::jsonb
            ) as photos
     from helper_app.purchase_tasks pt
     join helper_app.trips t on t.id = pt.trip_id
     join helper_app.helper_profiles hp on hp.id = pt.helper_id
     left join lateral (
       select count(*)::int as photo_count,
              jsonb_agg(
                jsonb_build_object(
                  'id', visible_photos.id,
                  'storage_key', visible_photos.storage_key,
                  'photo_role', visible_photos.photo_role,
                  'sort_order', visible_photos.sort_order,
                  'created_at', visible_photos.created_at
                )
                order by visible_photos.photo_role asc, visible_photos.sort_order asc, visible_photos.created_at asc
              ) as items
       from (
         select ptp.id, ptp.storage_key, ptp.photo_role, ptp.sort_order, ptp.created_at
         from helper_app.purchase_task_photos ptp
         where ptp.purchase_task_id = pt.id
           and (
             ptp.photo_role <> 'face_check_report'
             or ptp.id = (
               select latest_face.id
               from helper_app.purchase_task_photos latest_face
               where latest_face.purchase_task_id = pt.id
                 and latest_face.photo_role = 'face_check_report'
               order by latest_face.created_at desc, latest_face.id desc
               limit 1
             )
           )
       ) visible_photos
     ) photos on true
     ${where}
     group by pt.id, t.id, hp.id, photos.photo_count, photos.items
     order by pt.created_at desc`,
    params,
  );
  return result.rows;
}

async function getPurchaseTaskDetail(
  database,
  {
    activeOnly = false,
    authUserId = null,
    purchaseTaskId,
    tripId,
  } = {},
) {
  const conditions = [];
  const params = [];
  params.push(requiredText(purchaseTaskId, "purchaseTaskId"));
  conditions.push(`pt.id = $${params.length}`);
  params.push(requiredText(tripId, "tripId"));
  conditions.push(`pt.trip_id = $${params.length}`);
  if (authUserId) {
    params.push(authUserId);
    conditions.push(`hp.auth_user_id = $${params.length}`);
  }
  if (activeOnly) {
    conditions.push("hp.is_active = true");
    conditions.push("t.status = 'active'");
  }
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
            coalesce(photos.items, '[]'::jsonb) as photos
     from helper_app.purchase_tasks pt
     join helper_app.trips t on t.id = pt.trip_id
     join helper_app.helper_profiles hp on hp.id = pt.helper_id
     left join lateral (
       select jsonb_agg(
                jsonb_build_object(
                  'id', ptp.id,
                  'storage_key', ptp.storage_key,
                  'photo_role', ptp.photo_role,
                  'sort_order', ptp.sort_order,
                  'created_at', ptp.created_at
                )
                order by ptp.photo_role asc, ptp.sort_order asc
              ) as items
       from helper_app.purchase_task_photos ptp
       where ptp.purchase_task_id = pt.id
         and (
           ptp.photo_role <> 'face_check_report'
           or ptp.id = (
             select latest_face.id
             from helper_app.purchase_task_photos latest_face
             where latest_face.purchase_task_id = pt.id
               and latest_face.photo_role = 'face_check_report'
             order by latest_face.created_at desc, latest_face.id desc
             limit 1
           )
         )
     ) photos on true
     where ${conditions.join(" and ")}
     limit 1`,
    params,
  );
  return result.rows[0] || null;
}

async function listRebuyTasks(
  database,
  {
    helperId = null,
    includePhotos = true,
    includePrivateCustomerData = false,
    rebuyTaskIds = null,
    visibility = null,
    statuses = null,
    assignedHelperId = null,
  } = {},
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
  if (rebuyTaskIds) {
    if (rebuyTaskIds.length === 0) {
      conditions.push("false");
    } else {
      params.push(rebuyTaskIds);
      conditions.push(`rt.id = any($${params.length + 1}::uuid[])`);
    }
  }
  if (visibility) {
    params.push(visibility);
    conditions.push(`rt.visibility = $${params.length + 1}`);
  }
  if (statuses) {
    if (statuses.length === 0) {
      conditions.push("false");
    } else {
      params.push(statuses);
      conditions.push(`rt.status = any($${params.length + 1}::text[])`);
    }
  }
  if (assignedHelperId) {
    params.push(assignedHelperId);
    conditions.push(`rt.assigned_helper_id = $${params.length + 1}`);
  }
  const where = conditions.length ? `where ${conditions.join(" and ")}` : "";
  const photoSelect = includePhotos
    ? `coalesce(
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
            )`
    : `'[]'::jsonb`;
  const photoJoin = includePhotos
    ? "left join helper_app.rebuy_task_photos rtp on rtp.rebuy_task_id = rt.id"
    : "";
  const groupBy = includePhotos ? "group by rt.id, ah.id, ch.id" : "";
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
            ${photoSelect} as photos
     from helper_app.rebuy_tasks rt
     left join helper_app.helper_profiles ah on ah.id = rt.assigned_helper_id
     left join helper_app.helper_profiles ch on ch.id = rt.claimed_helper_id
     ${photoJoin}
     ${where}
     ${groupBy}
     order by
       coalesce(rt.public_available_at, rt.created_at) desc,
       rt.created_at desc`,
    [includePrivateCustomerData, ...params],
  );
  return result.rows;
}

async function listAuthorizedHelperRebuyTasks(
  database,
  /**
   * @type {{
   *   authUserId: string,
   *   includePhotos?: boolean,
   *   rebuyTaskIds?: string[] | null,
   * }}
   */
  { authUserId, includePhotos = false, rebuyTaskIds = null } = {},
) {
  const helper = await findActiveHelperProfileForUser(database, authUserId);
  return listRebuyTasks(database, {
    helperId: helper.id,
    includePhotos,
    rebuyTaskIds,
  });
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

async function listStagingMergeJobs(
  database,
  {
    includeOrderPhotos = false,
    includeReviewedOrders = false,
    mergeJobId = null,
    reviewedOrderId = null,
  } = {},
) {
  if (mergeJobId === "") return [];
  const params = [];
  const mergeWhere = [];
  if (mergeJobId) {
    params.push(mergeJobId);
    mergeWhere.push("mj.id = $1");
  }
  const reviewedOrderWhere = ["rso.merge_job_id = mj.id"];
  if (reviewedOrderId) {
    params.push(reviewedOrderId);
    reviewedOrderWhere.push(`rso.id = $${params.length}`);
  }
  const where = mergeWhere.length ? `where ${mergeWhere.join(" and ")}` : "";
  const photoExpression = includeOrderPhotos
    ? "coalesce(photos.items, '[]'::jsonb)"
    : "'[]'::jsonb";
  const photoJoin = includeOrderPhotos
    ? `
              left join lateral (
                select jsonb_agg(jsonb_build_object(
                  'id', rsop.id,
                  'storage_key', rsop.storage_key,
                  'photo_role', rsop.photo_role,
                  'label', rsop.label,
                  'sort_order', rsop.sort_order,
                  'include_in_merge', rsop.include_in_merge
                ) order by rsop.sort_order asc) as items
                from helper_app.reviewed_staging_order_photos rsop
                where rsop.reviewed_order_id = rso.id
              ) photos on true`
    : "";
  const reviewedOrderColumns = includeReviewedOrders
    ? `
            coalesce((
              select jsonb_agg(jsonb_build_object(
                'id', rso.id,
                'staging_order_preview_id', rso.staging_order_preview_id,
                'purchase_task_id', rso.purchase_task_id,
                'line_community_name', rso.line_community_name,
                'product_name', rso.product_name,
                'appearance_notes', rso.appearance_notes,
                'quantity', rso.quantity,
                'original_price_jpy', rso.original_price_jpy,
                'sale_price_twd', rso.sale_price_twd,
                'is_excluded', rso.is_excluded,
                'exclusion_reason', rso.exclusion_reason,
                'customer_exists', rso.customer_exists,
                'customer_confirmed', rso.customer_confirmed,
                'version', rso.version,
                'photos', ${photoExpression}
              ) order by rso.created_at asc)
              from helper_app.reviewed_staging_orders rso
              ${photoJoin}
              where ${reviewedOrderWhere.join(" and ")}
            ), '[]'::jsonb)`
    : `'[]'::jsonb`;
  const unknownCustomerExpression = mergeJobId
    ? `coalesce((
         select jsonb_agg(jsonb_build_object(
           'id', rso.id,
           'line_community_name', rso.line_community_name,
           'product_name', rso.product_name
         ) order by rso.created_at asc)
         from helper_app.reviewed_staging_orders rso
         where rso.merge_job_id = mj.id
           and rso.is_excluded = false
           and rso.customer_exists = false
           and rso.customer_confirmed = false
       ), '[]'::jsonb)`
    : `'[]'::jsonb`;
  const result = await database.query(
    `select mj.*, t.trip_name, t.business_date, t.timezone, t.status as trip_status,
            hp.display_name as helper_display_name,
            (select count(*)::int from helper_app.reviewed_staging_orders rso where rso.merge_job_id = mj.id) as reviewed_order_count,
            (select count(*)::int from helper_app.reviewed_staging_orders rso where rso.merge_job_id = mj.id and rso.is_excluded = false) as included_order_count,
            (select count(*)::int from helper_app.reviewed_staging_orders rso where rso.merge_job_id = mj.id and rso.is_excluded = false and rso.customer_exists = false and rso.customer_confirmed = false) as unknown_customer_count,
            (select count(*)::int
             from helper_app.reviewed_staging_order_photos rsop
             join helper_app.reviewed_staging_orders rso on rso.id = rsop.reviewed_order_id
             where rso.merge_job_id = mj.id and rsop.include_in_merge = true) as selected_photo_count,
            ${unknownCustomerExpression} as unknown_customers,
            ${reviewedOrderColumns} as reviewed_orders
     from helper_app.staging_merge_jobs mj
     join helper_app.trips t on t.id = mj.trip_id
     left join helper_app.helper_profiles hp on hp.id = t.assigned_helper_id
     ${where}
     order by mj.updated_at desc`,
    params,
  );
  return result.rows;
}

/**
 * @param {object} database
 * @param {{
 *   activeOnly?: boolean,
 *   authUserId?: string | null,
 *   helperId?: string | null,
 *   taskIds?: string[] | null,
 *   tripIds?: string[] | null
 * }} [options]
 */
async function listQuoteTasks(
  database,
  options = {},
) {
  const {
    activeOnly = false,
    authUserId = null,
    helperId = null,
    taskIds = null,
    tripIds = null,
  } = options;
  if (
    (tripIds && tripIds.length === 0) ||
    (taskIds && taskIds.length === 0)
  ) return [];
  const conditions = [];
  const params = [];
  if (authUserId) {
    params.push(authUserId);
    conditions.push(`hp.auth_user_id = $${params.length}`);
  }
  if (helperId) {
    params.push(helperId);
    conditions.push(`qt.helper_id = $${params.length}`);
  }
  if (tripIds) {
    params.push(tripIds);
    conditions.push(`qt.trip_id = any($${params.length}::uuid[])`);
  }
  if (taskIds) {
    params.push(taskIds);
    conditions.push(`qt.id = any($${params.length}::uuid[])`);
  }
  if (activeOnly) {
    conditions.push("hp.is_active = true");
    conditions.push("t.status = 'active'");
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

async function listAuthorizedHelperQuoteTaskSummaries(
  database,
  { authUserId, tripId },
) {
  const result = await database.query(
    `select qt.id, qt.task_type, qt.product_name, qt.instruction, qt.status,
            qt.created_at,
            count(qtp.id)::int as photo_count,
            count(qtp.id) filter (
              where qtp.reply_status in ('replied', 'converted_to_purchase')
            )::int as replied_photo_count
     from helper_app.quote_tasks qt
     join helper_app.trips t on t.id = qt.trip_id
     join helper_app.helper_profiles hp on hp.id = qt.helper_id
     left join helper_app.quote_task_photos qtp on qtp.quote_task_id = qt.id
     where qt.trip_id = $1
       and hp.auth_user_id = $2
       and hp.is_active = true
       and t.status = 'active'
     group by qt.id
     order by qt.created_at desc`,
    [
      requiredText(tripId, "tripId"),
      requiredText(authUserId, "authUserId"),
    ],
  );
  return result.rows;
}

async function listAdminQuoteTaskSummaries(
  database,
  { tripId },
) {
  const result = await database.query(
    `select qt.id, qt.trip_id, qt.helper_id, qt.task_type, qt.product_name,
            qt.instruction, qt.status, qt.created_at, qt.updated_at,
            t.trip_name, t.status as trip_status,
            hp.display_name as helper_display_name,
            count(qtp.id)::int as photo_count,
            count(qtp.id) filter (
              where qtp.reply_status in ('replied', 'converted_to_purchase')
            )::int as replied_photo_count,
            count(qtp.id) filter (where qtp.needs_review = true)::int as needs_review_count,
            count(qtp.id) filter (where qtp.reply_status = 'converted_to_purchase')::int as converted_photo_count
     from helper_app.quote_tasks qt
     join helper_app.trips t on t.id = qt.trip_id
     join helper_app.helper_profiles hp on hp.id = qt.helper_id
     left join helper_app.quote_task_photos qtp on qtp.quote_task_id = qt.id
     where qt.trip_id = $1
     group by qt.id, t.id, hp.id
     order by qt.created_at desc`,
    [requiredText(tripId, "tripId")],
  );
  return result.rows;
}

/**
 * @param {{batchId?: string|null, helperId?: string|null, includePhotos?: boolean, tripIds?: string[]|null}} options
 */
async function listSitePhotoBatches(
  database,
  { batchId, helperId, includePhotos = true, tripIds } = {},
) {
  if (tripIds && tripIds.length === 0) return [];
  const conditions = [];
  const params = [];
  if (batchId) {
    params.push(batchId);
    conditions.push(`b.id = $${params.length}`);
  }
  if (helperId) {
    params.push(helperId);
    conditions.push(`b.helper_id = $${params.length}`);
  }
  if (tripIds) {
    params.push(tripIds);
    conditions.push(`b.trip_id = any($${params.length}::uuid[])`);
  }
  const where = conditions.length ? `where ${conditions.join(" and ")}` : "";
  const photoExpression = includePhotos
    ? `coalesce(
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
            )`
    : `'[]'::jsonb`;
  const result = await database.query(
    `select b.id, b.trip_id, b.helper_id, b.submission_id, b.note, b.status,
            b.created_at, b.updated_at,
            t.trip_name, t.business_date, t.timezone, t.status as trip_status,
            hp.display_name as helper_display_name,
            count(p.id)::int as photo_count,
            (row_number() over (
              partition by b.trip_id
              order by b.created_at asc, b.id asc
            ))::int as batch_number,
            ${photoExpression} as photos
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

async function listSitePhotoBatchSummaries(
  database,
  { helperId = null, tripIds = null } = {},
) {
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
    `select b.id, b.trip_id, b.helper_id, b.note, b.status,
            b.created_at, b.updated_at,
            count(p.id)::int as photo_count,
            (row_number() over (
              partition by b.trip_id
              order by b.created_at asc, b.id asc
            ))::int as batch_number
     from helper_app.site_photo_batches b
     left join helper_app.site_photos p on p.batch_id = b.id
     ${where}
     group by b.id
     order by b.created_at desc, b.id desc`,
    params,
  );
  return result.rows;
}

async function listAuthorizedHelperSitePhotoBatchSummaries(
  database,
  { authUserId, tripId },
) {
  const result = await database.query(
    `with authorized_trip as (
       select t.id as trip_id, hp.id as helper_id
       from helper_app.helper_profiles hp
       join helper_app.trips t on t.assigned_helper_id = hp.id
       where hp.auth_user_id = $1
         and hp.is_active = true
         and t.id = $2::uuid
         and t.status = 'active'
     ),
     ranked_batches as (
       select b.id, b.trip_id, b.helper_id, b.note, b.status,
              b.created_at, b.updated_at,
              (row_number() over (
                partition by b.trip_id
                order by b.created_at asc, b.id asc
              ))::int as batch_number
       from helper_app.site_photo_batches b
       join authorized_trip permitted
         on permitted.trip_id = b.trip_id
        and permitted.helper_id = b.helper_id
     ),
     photo_counts as (
       select p.batch_id, count(*)::int as photo_count
       from helper_app.site_photos p
       join authorized_trip permitted on permitted.trip_id = p.trip_id
       group by p.batch_id
     )
     select permitted.trip_id, permitted.helper_id,
            b.id, b.note, b.status, b.created_at, b.updated_at,
            b.batch_number, coalesce(pc.photo_count, 0)::int as photo_count
     from authorized_trip permitted
     left join ranked_batches b
       on b.trip_id = permitted.trip_id
      and b.helper_id = permitted.helper_id
     left join photo_counts pc on pc.batch_id = b.id
     order by b.created_at desc nulls last, b.id desc nulls last`,
    [authUserId, tripId],
  );
  return {
    authorized: result.rows.length > 0,
    batches: result.rows.filter((row) => row.id),
  };
}

async function getAuthorizedHelperSitePhotoBatchDetail(
  database,
  { authUserId, batchId, tripId },
) {
  const result = await database.query(
    `with authorized_batch as (
       select b.*
       from helper_app.site_photo_batches b
       join helper_app.trips t on t.id = b.trip_id
       join helper_app.helper_profiles hp
         on hp.id = b.helper_id
        and hp.id = t.assigned_helper_id
       where b.id = $1::uuid
         and b.trip_id = $2::uuid
         and hp.auth_user_id = $3
         and hp.is_active = true
         and t.status = 'active'
     ),
     ranked_batches as (
       select source.id,
              (row_number() over (
                partition by source.trip_id
                order by source.created_at asc, source.id asc
              ))::int as batch_number
       from helper_app.site_photo_batches source
       join authorized_batch selected on selected.trip_id = source.trip_id
     )
     select b.id, b.trip_id, b.helper_id, b.note, b.status,
            b.created_at, b.updated_at, ranked.batch_number,
            count(p.id)::int as photo_count,
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
     from authorized_batch b
     join ranked_batches ranked on ranked.id = b.id
     left join helper_app.site_photos p on p.batch_id = b.id
     group by b.id, b.trip_id, b.helper_id, b.note, b.status,
              b.created_at, b.updated_at, ranked.batch_number`,
    [batchId, tripId, authUserId],
  );
  return {
    authorized: result.rows.length > 0,
    batch: result.rows[0] || null,
  };
}

async function listHelperSitePhotoBatchDetail(
  database,
  { batchId, helperId, tripIds = null },
) {
  if (tripIds && tripIds.length === 0) return [];
  const params = [batchId, helperId];
  const conditions = ["b.id = $1", "b.helper_id = $2"];
  if (tripIds) {
    params.push(tripIds);
    conditions.push(`b.trip_id = any($${params.length}::uuid[])`);
  }
  const result = await database.query(
    `with ranked_batches as (
       select source.*,
              (row_number() over (
                partition by source.trip_id
                order by source.created_at asc, source.id asc
              ))::int as batch_number
       from helper_app.site_photo_batches source
       where source.trip_id = (
         select selected.trip_id
         from helper_app.site_photo_batches selected
         where selected.id = $1
       )
     )
     select b.id, b.trip_id, b.helper_id, b.note, b.status,
            b.created_at, b.updated_at, b.batch_number,
            count(p.id)::int as photo_count,
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
     from ranked_batches b
     left join helper_app.site_photos p on p.batch_id = b.id
     where ${conditions.join(" and ")}
     group by b.id, b.trip_id, b.helper_id, b.note, b.status,
              b.created_at, b.updated_at, b.batch_number`,
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

async function attachSignedStagingMergeJobUrls(jobs, r2Store) {
  return Promise.all(
    jobs.map(async (job) => ({
      ...job,
      reviewed_orders: await Promise.all(
        (job.reviewed_orders || []).map(async (order) => ({
          ...order,
          photos: await Promise.all(
            (order.photos || []).map(async (photo) => ({
              ...photo,
              signed_url: await r2Store.signedGetUrl(photo.storage_key),
            })),
          ),
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

    await insertSitePhotoBatchRows(client, {
      batchId: batch.id,
      helperId: helper.id,
      photos: normalized.photos,
      tripId: trip.id,
    });

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
    if (normalized.uploadedPhotos.length > 0) {
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

    if (normalized.uploadedPhotos.length > 0) {
      await upsertQuoteTaskMediaBatch(client, taskPhotos);
    } else {
      await client.query(
        `update helper_app.media_objects
         set media_kind = 'quote_task_photo',
             retention_status = 'task_evidence'
         where storage_key = any($1::text[])`,
        [taskPhotos.map((photo) => photo.storageKey)],
      );
    }
    await insertQuoteTaskPhotosBatch(client, {
      instruction: normalized.instruction,
      photos: taskPhotos,
      productName: normalized.productName,
      taskId: task.id,
      tripId: trip.id,
      helperId: trip.assigned_helper_id,
    });

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
    // The create action only needs the inserted task acknowledgement. Avoid a
    // second aggregate read of every task photo on the publish critical path;
    // the scoped quote-task detail route reads the full task when needed.
    return task;
  });
}

async function createPurchaseTask(database, input) {
  const normalized = normalizePurchaseTaskInput(input);
  const referencePhotos = normalizePurchaseReferencePhotos(input.referencePhotos || input.uploadedPhotos);
  if (!referencePhotos.length) {
    throw new HelperAppServiceError("invalid_input", "At least one purchase reference photo is required.");
  }
  return withTransaction(database, async (client) => {
    const trip = await getActiveAssignedTripForTaskCreation(client, normalized.tripId);
    const task = await insertPurchaseTask(client, {
      ...normalized,
      helperId: trip.assigned_helper_id,
    });
    await upsertPurchaseReferenceMediaBatch(client, referencePhotos);
    await insertPurchasePhotosBatch(client, referencePhotos.map((photo, index) => ({
      helperId: trip.assigned_helper_id,
      photoRole: "manual_reference",
      purchaseTaskId: task.id,
      sortOrder: index,
      storageKey: photo.storageKey,
      tripId: trip.id,
    })));
    return task;
  });
}

async function quickPublishPurchaseTask(database, input) {
  const normalized = normalizePurchaseTaskInput(input, { allowMissingOriginalPriceJpy: true });
  const quoteTaskPhotoId = requiredText(input.quoteTaskPhotoId, "quoteTaskPhotoId");
  return withTransaction(database, async (client) => {
    const quoteResult = await client.query(
      `select qtp.id, qtp.quote_task_id, qtp.trip_id, qtp.helper_id, qtp.storage_key,
              qtp.reply_status, qt.status as quote_task_status, t.status as trip_status,
              reply.id as reply_id,
              reply.price_jpy, reply.detail_photos
       from helper_app.quote_task_photos qtp
       join helper_app.quote_tasks qt on qt.id = qtp.quote_task_id
       join helper_app.trips t on t.id = qtp.trip_id
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
    if (quotePhoto.trip_status !== "active") {
      throw new HelperAppServiceError("trip_not_active", "Purchase tasks can only be created for an active trip.");
    }
    if (normalized.tripId !== quotePhoto.trip_id) {
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
    const purchasePhotos = [{
      helperId: quotePhoto.helper_id,
      photoRole: "source",
      purchaseTaskId: task.id,
      sortOrder: 0,
      storageKey: quotePhoto.storage_key,
      tripId: quotePhoto.trip_id,
    }];
    const detailPhotos = Array.isArray(quotePhoto.detail_photos) ? quotePhoto.detail_photos : [];
    for (const [index, detailPhoto] of detailPhotos.entries()) {
      purchasePhotos.push({
        helperId: quotePhoto.helper_id,
        photoRole: "detail_reply",
        purchaseTaskId: task.id,
        sortOrder: index,
        storageKey: detailPhoto.storage_key,
        tripId: quotePhoto.trip_id,
      });
    }
    await insertPurchasePhotosBatch(client, purchasePhotos);
    await markMediaAsOrderEvidenceBatch(client, purchasePhotos.map((photo) => photo.storageKey));
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
    return task;
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
    await upsertRebuyPhotosBatch(client, {
      helperId: assignedHelperId,
      mediaKind: "rebuy_reference_photo",
      photos: referencePhotos,
      photoRole: "reference",
      rebuyTaskId: task.id,
    });
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
    await upsertRebuyPhotosBatch(client, {
      helperId: helper.id,
      mediaKind: "rebuy_report_photo",
      photos: normalized.reportPhotos,
      photoRole: "report",
      rebuyTaskId: task.id,
    });
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
    const { helper, task } = await lockPurchaseTaskForHelper(client, {
      authUserId: normalized.authUserId,
      purchaseTaskId: normalized.purchaseTaskId,
    });
    if (task.helper_id !== helper.id) {
      throw new HelperAppServiceError("forbidden", "Purchase task is not assigned to this helper.");
    }
    assertTripCanUseLiveWorkspace(
      { status: task.authorized_trip_status },
      "Purchase tasks can be updated only while the trip is active.",
    );
    const cancelingCompletedPurchase = task.status === "completed" && normalized.action === "cancel";
    if (["completed", "canceled", "unavailable", "not_found"].includes(task.status) && !cancelingCompletedPurchase) {
      if (task.idempotency_key && task.idempotency_key === normalized.idempotencyKey) {
        return task;
      }
      throw new HelperAppServiceError("invalid_status", "This purchase task is already closed.");
    }

    const requestedQuantity = Math.max(1, Number(task.quantity || 1));
    const completedQuantity = Math.min(normalized.completedQuantity ?? requestedQuantity, requestedQuantity);
    const cancelsByZeroQuantity = normalized.action === "complete" && completedQuantity === 0;

    if (normalized.action === "cancel" || normalized.action === "unavailable" || normalized.action === "not_found" || cancelsByZeroQuantity) {
      if (!normalized.helperNote) {
        throw new HelperAppServiceError("invalid_input", "A reason is required.");
      }
      const status = normalized.action === "cancel" || cancelsByZeroQuantity ? "canceled" : normalized.action;
      const result = await client.query(
        `update helper_app.purchase_tasks
         set status = $2,
             completed_quantity = 0,
             unavailable_quantity = $3,
             helper_note = $4,
             idempotency_key = $5,
             canceled_at = now(),
             completed_at = null,
             updated_at = now()
         where id = $1
         returning *`,
        [
          task.id,
          status,
          normalized.unavailableQuantity ?? requestedQuantity,
          normalized.helperNote,
          normalized.idempotencyKey,
        ],
      );
      if (task.status === "completed") {
        await removeStagingOrderPreviewForPurchaseTask(client, task.id);
      }
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
      await upsertLatestFaceCheckPurchasePhoto(client, {
        helperId: helper.id,
        purchaseTaskId: task.id,
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
          requestedQuantity - completedQuantity,
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
        requestedQuantity - completedQuantity,
        completedQuantity < requestedQuantity
          ? formatPartialPurchaseNote(
              normalized.helperNote,
              requestedQuantity - completedQuantity,
              "canceled",
            )
          : normalized.helperNote,
        normalized.idempotencyKey,
      ],
    );
    await syncStagingOrderPreview(client, result.rows[0]);
    await insertAuditEvent(client, {
      action: task.requires_face_check ? "helper_purchase_face_check_confirmed" : "helper_purchase_completed",
      actor_helper_id: helper.id,
      actor_role: "helper",
      actor_user_id: normalized.authUserId,
      after_state: {
        completedQuantity,
        purchaseTaskId: task.id,
        remainingQuantity: requestedQuantity - completedQuantity,
        remainingResolution: completedQuantity < requestedQuantity ? "canceled" : null,
      },
      before_state: { status: task.status },
      trip_id: task.trip_id,
    });
    return result.rows[0];
  });
}

function formatPartialPurchaseNote(note, remainingQuantity, remainingResolution) {
  const labels = {
    canceled: "取消",
    not_found: "未找到",
    unavailable: "缺貨",
  };
  const suffix = note ? `。${note}` : "";
  return `未購買 ${remainingQuantity} 件：${labels[remainingResolution] || remainingResolution}${suffix}`;
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
    const photoResult = await client.query(
      `select qtp.*, qt.task_type, hp.id as authorized_helper_id,
              t.status as trip_status,
              latest.detail_photos as previous_detail_photos
       from helper_app.quote_task_photos qtp
       join helper_app.quote_tasks qt on qt.id = qtp.quote_task_id
       join helper_app.trips t on t.id = qtp.trip_id
       join helper_app.helper_profiles hp
         on hp.id = qtp.helper_id
        and hp.auth_user_id = $2
        and hp.is_active = true
       left join lateral (
         select qpr.detail_photos
         from helper_app.quote_photo_replies qpr
         where qpr.quote_task_photo_id = qtp.id
           and qpr.helper_id = hp.id
         order by qpr.updated_at desc
         limit 1
       ) latest on true
       where qtp.id = $1
       for update of qtp, t`,
      [normalized.quoteTaskPhotoId, authUserId],
    );
    const taskPhoto = photoResult.rows[0];
    if (!taskPhoto) throw new HelperAppServiceError("photo_not_found", "Quote task photo was not found.");
    assertTripCanReplyQuote({ status: taskPhoto.trip_status });
    if (taskPhoto.reply_status === "converted_to_purchase") {
      throw new HelperAppServiceError("already_converted", "Converted quote photos can no longer be edited.");
    }
    let replyToSave = normalized;
    if (
      ["detail", "quote_and_detail"].includes(taskPhoto.task_type) &&
      normalized.detailPhotos.length === 0
    ) {
      const previousDetailPhotos = Array.isArray(taskPhoto.previous_detail_photos)
        ? taskPhoto.previous_detail_photos
        : [];
      if (previousDetailPhotos.length) {
        replyToSave = {
          ...normalized,
          detailPhotos: previousDetailPhotos,
        };
      }
    }
    assertReplyMatchesTaskType(taskPhoto.task_type, replyToSave);

    if (normalized.detailPhotos.length) {
      await client.query(
        `insert into helper_app.media_objects
           (storage_key, media_kind, retention_status, original_filename,
            content_type, byte_size, uploaded_by_helper_id)
         select photo.storage_key,
                'quote_detail_reply_photo',
                'task_evidence',
                photo.original_filename,
                photo.content_type,
                photo.byte_size,
                $2
         from jsonb_to_recordset($1::jsonb) as photo(
           storage_key text,
           original_filename text,
           content_type text,
           byte_size bigint
         )
         on conflict (storage_key) do update
         set media_kind = 'quote_detail_reply_photo',
             retention_status = 'task_evidence',
             original_filename = coalesce(excluded.original_filename, helper_app.media_objects.original_filename),
             content_type = coalesce(excluded.content_type, helper_app.media_objects.content_type),
             byte_size = coalesce(excluded.byte_size, helper_app.media_objects.byte_size)`,
        [
          JSON.stringify(normalized.detailPhotos),
          taskPhoto.authorized_helper_id,
        ],
      );
    }

    const replyResult = await client.query(
      `with inserted as (
         insert into helper_app.quote_photo_replies
           (quote_task_photo_id, quote_task_id, trip_id, helper_id, idempotency_key,
            price_jpy, note, detail_photos)
         values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
         on conflict (quote_task_photo_id, helper_id, idempotency_key) do nothing
         returning *
       )
       select * from inserted
       union all
       select *
       from helper_app.quote_photo_replies
       where quote_task_photo_id = $1
         and helper_id = $4
         and idempotency_key = $5
         and not exists (select 1 from inserted)
       limit 1`,
      [
        taskPhoto.id,
        taskPhoto.quote_task_id,
        taskPhoto.trip_id,
        taskPhoto.authorized_helper_id,
        normalized.idempotencyKey,
        replyToSave.priceJpy,
        replyToSave.note,
        JSON.stringify(replyToSave.detailPhotos),
      ],
    );
    const reply = replyResult.rows[0];

    await client.query(
      `with updated_photo as (
         update helper_app.quote_task_photos
         set reply_status = 'replied',
             needs_review = false,
             updated_at = now()
         where id = $1
         returning quote_task_id
       ),
       summary as (
         select u.quote_task_id,
                count(qtp.id)::int as total,
                count(qtp.id) filter (where qtp.reply_status = 'replied')::int as replied,
                bool_or(qtp.needs_review)::boolean as has_review
         from updated_photo u
         join helper_app.quote_task_photos qtp on qtp.quote_task_id = u.quote_task_id
         group by u.quote_task_id
       )
       update helper_app.quote_tasks qt
       set status = case
             when summary.has_review then 'needs_review'
             when summary.total > 0 and summary.total = summary.replied then 'completed'
             else 'open'
           end,
           updated_at = now()
       from summary
       where qt.id = summary.quote_task_id`,
      [taskPhoto.id],
    );
    await insertAuditEvent(client, {
      action: "helper_quote_photo_replied",
      actor_helper_id: taskPhoto.authorized_helper_id,
      actor_role: "helper",
      actor_user_id: authUserId,
      after_state: {
        detailPhotoCount: replyToSave.detailPhotos.length,
        priceJpy: replyToSave.priceJpy,
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
        "尚有未完成的採買任務，請先完成或取消。",
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

async function prepareStagingReview(database, input) {
  const tripId = requiredText(input.tripId, "tripId");
  return withTransaction(database, async (client) => {
    const trip = await lockTrip(client, tripId);
    if (trip.status !== "ended") {
      throw new HelperAppServiceError("trip_not_ended", "Only ended trips can enter staging review.");
    }
    const jobResult = await client.query(
      `insert into helper_app.staging_merge_jobs (trip_id)
       values ($1)
       on conflict (trip_id) do update
       set updated_at = helper_app.staging_merge_jobs.updated_at
       returning *`,
      [trip.id],
    );
    const job = jobResult.rows[0];
    if (["approved", "merging", "merged"].includes(job.status)) {
      return job;
    }

    await client.query(
      `insert into helper_app.reviewed_staging_orders
         (merge_job_id, trip_id, helper_id, staging_order_preview_id,
          purchase_task_id, line_community_name, product_name, quantity,
          original_price_jpy, sale_price_twd, source_quote_task_id,
          source_quote_task_photo_id, source_quote_reply_id, source_rebuy_task_id,
          customer_exists)
       select $1, sop.trip_id, sop.helper_id, sop.id, sop.purchase_task_id,
              sop.line_community_name, sop.product_name, sop.quantity,
              sop.original_price_jpy, sop.sale_price_twd, sop.source_quote_task_id,
              sop.source_quote_task_photo_id, sop.source_quote_reply_id,
              sop.source_rebuy_task_id,
              exists (
                select 1 from main.customers c
                where lower(btrim(c.line_community_name)) = lower(btrim(sop.line_community_name))
              )
       from helper_app.staging_order_previews sop
       where sop.trip_id = $2
       on conflict (staging_order_preview_id) do nothing`,
      [job.id, trip.id],
    );
    await client.query(
      `insert into helper_app.reviewed_staging_order_photos
         (reviewed_order_id, trip_id, source_purchase_task_photo_id, storage_key,
          photo_role, sort_order)
       select rso.id, rso.trip_id, ptp.id, ptp.storage_key, ptp.photo_role, ptp.sort_order
       from helper_app.reviewed_staging_orders rso
       join helper_app.purchase_task_photos ptp on ptp.purchase_task_id = rso.purchase_task_id
       where rso.merge_job_id = $1
       on conflict (reviewed_order_id, photo_role, sort_order) do nothing`,
      [job.id],
    );
    await insertAuditEvent(client, {
      action: "admin_staging_review_prepared",
      actor_role: "admin",
      actor_user_id: input.actorUserId || null,
      after_state: { mergeJobId: job.id },
      before_state: {},
      trip_id: trip.id,
    });
    return job;
  });
}

async function editReviewedStagingOrder(database, input) {
  const reviewedOrderId = requiredText(input.reviewedOrderId, "reviewedOrderId");
  return withTransaction(database, async (client) => {
    const current = await lockReviewedStagingOrder(client, reviewedOrderId);
    const job = await lockStagingMergeJob(client, current.merge_job_id);
    if (["merging", "merged"].includes(job.status)) {
      throw new HelperAppServiceError("invalid_status", "Merged staging rows can no longer be edited here.");
    }
    const patch = normalizeReviewedOrderPatch(input);
    const excluded = patch.isExcluded;
    if (excluded && !patch.exclusionReason) {
      throw new HelperAppServiceError("invalid_input", "Excluded staging rows require a reason.");
    }
    const result = await client.query(
      `update helper_app.reviewed_staging_orders
       set line_community_name = $2,
           product_name = $3,
           appearance_notes = $4,
           quantity = $5,
           original_price_jpy = $6,
           sale_price_twd = $7,
           is_excluded = $8,
           exclusion_reason = $9,
           customer_confirmed = $10,
           customer_exists = exists (
             select 1 from main.customers c
             where lower(btrim(c.line_community_name)) = lower(btrim($2))
           ),
           version = version + 1,
           updated_at = now()
       where id = $1
       returning *`,
      [
        current.id,
        patch.lineCommunityName,
        patch.productName,
        patch.appearanceNotes,
        patch.quantity,
        patch.originalPriceJpy,
        patch.salePriceTwd,
        excluded,
        excluded ? patch.exclusionReason : null,
        patch.customerConfirmed,
      ],
    );
    await revokeMergeApprovalForEdit(client, job);
    await insertAuditEvent(client, {
      action: "admin_reviewed_staging_order_edited",
      actor_role: "admin",
      actor_user_id: input.actorUserId || null,
      after_state: { reviewedOrderId: current.id },
      before_state: { status: job.status },
      trip_id: current.trip_id,
    });
    return result.rows[0];
  });
}

async function editReviewedStagingOrderPhotos(database, input) {
  const reviewedOrderId = requiredText(input.reviewedOrderId, "reviewedOrderId");
  const photos = Array.isArray(input.photos) ? input.photos : [];
  return withTransaction(database, async (client) => {
    const current = await lockReviewedStagingOrder(client, reviewedOrderId);
    const job = await lockStagingMergeJob(client, current.merge_job_id);
    if (["merging", "merged"].includes(job.status)) {
      throw new HelperAppServiceError("invalid_status", "Merged staging photos can no longer be edited here.");
    }
    const existing = await client.query(
      `select id
       from helper_app.reviewed_staging_order_photos
       where reviewed_order_id = $1
       for update`,
      [current.id],
    );
    const existingIds = new Set(existing.rows.map((row) => row.id));
    for (const photo of photos) {
      const photoId = requiredText(photo.id, "photoId");
      if (!existingIds.has(photoId)) {
        throw new HelperAppServiceError("invalid_input", "Reviewed staging photo does not belong to this order.");
      }
    }
    if (photos.length) {
      await client.query(
        `update helper_app.reviewed_staging_order_photos target
         set label = source.label,
             include_in_merge = source.include_in_merge,
             updated_at = now()
         from jsonb_to_recordset($2::jsonb) as source(
           id uuid,
           label text,
           include_in_merge boolean
         )
         where target.id = source.id
           and target.reviewed_order_id = $1`,
        [
          current.id,
          JSON.stringify(photos.map((photo) => ({
            id: requiredText(photo.id, "photoId"),
            label: String(photo.label || "").trim(),
            include_in_merge: Boolean(photo.includeInMerge),
          }))),
        ],
      );
    }
    await revokeMergeApprovalForEdit(client, job);
    await insertAuditEvent(client, {
      action: "admin_reviewed_staging_order_photos_edited",
      actor_role: "admin",
      actor_user_id: input.actorUserId || null,
      after_state: { photoCount: photos.length, reviewedOrderId: current.id },
      before_state: { status: job.status },
      trip_id: current.trip_id,
    });
    return { mergeJobId: job.id };
  });
}

async function setReviewedStagingOrderSelection(database, input) {
  const mergeJobId = requiredText(input.mergeJobId, "mergeJobId");
  const expectedVersion = Number(requiredText(input.expectedVersion, "expectedVersion"));
  const selectedOrderIds = Array.from(new Set(
    (Array.isArray(input.selectedOrderIds) ? input.selectedOrderIds : [])
      .map((id) => String(id || "").trim())
      .filter(Boolean),
  ));
  const exclusionReason = optionalText(input.exclusionReason);

  return withTransaction(database, async (client) => {
    const job = await lockStagingMergeJob(client, mergeJobId);
    if (Number(job.version) !== expectedVersion) {
      throw new HelperAppServiceError("version_conflict", "審核批次已更新，請重新載入後再選取。");
    }
    if (["merging", "merged"].includes(job.status)) {
      throw new HelperAppServiceError("invalid_status", "這個審核批次已進入合併流程，不能再修改選取。");
    }
    const counts = await client.query(
      `select count(*)::int as total_count,
              count(*) filter (where id = any($2::uuid[]))::int as selected_count
       from helper_app.reviewed_staging_orders
       where merge_job_id = $1`,
      [job.id, selectedOrderIds],
    );
    const totalCount = Number(counts.rows[0]?.total_count || 0);
    const selectedCount = Number(counts.rows[0]?.selected_count || 0);
    if (selectedCount !== selectedOrderIds.length) {
      throw new HelperAppServiceError("invalid_input", "選取的訂單不屬於這個審核批次。");
    }
    if (selectedOrderIds.length < totalCount && !exclusionReason) {
      throw new HelperAppServiceError("invalid_input", "未選取的訂單需要填寫排除原因。");
    }
    const updated = await client.query(
      `update helper_app.reviewed_staging_orders
       set is_excluded = not (id = any($2::uuid[])),
           exclusion_reason = case
             when id = any($2::uuid[]) then null
             else $3
           end,
           version = version + 1,
           updated_at = now()
       where merge_job_id = $1
         and (
           is_excluded is distinct from not (id = any($2::uuid[]))
           or exclusion_reason is distinct from case
             when id = any($2::uuid[]) then null
             else $3
           end
         )
       returning id`,
      [job.id, selectedOrderIds, exclusionReason],
    );
    const changedCount = updated.rowCount ?? updated.rows.length;
    const approvalRevoked = job.status === "approved" && changedCount > 0;
    if (approvalRevoked) await revokeMergeApprovalForEdit(client, job);
    if (changedCount > 0) {
      await insertAuditEvent(client, {
        action: "admin_reviewed_staging_order_selection_changed",
        actor_role: "admin",
        actor_user_id: input.actorUserId || null,
        after_state: {
          excludedCount: totalCount - selectedOrderIds.length,
          selectedCount: selectedOrderIds.length,
          mergeJobId: job.id,
        },
        before_state: { status: job.status },
        reason: exclusionReason,
        trip_id: job.trip_id,
      });
    }
    return {
      approvalRevoked,
      changedCount,
      excludedCount: totalCount - selectedOrderIds.length,
      mergeJobId: job.id,
      selectedCount: selectedOrderIds.length,
    };
  });
}

async function approveStagingMergeJob(database, input) {
  const mergeJobId = requiredText(input.mergeJobId, "mergeJobId");
  const expectedVersion = Number(requiredText(input.expectedVersion, "expectedVersion"));
  return withTransaction(database, async (client) => {
    const job = await lockStagingMergeJob(client, mergeJobId);
    if (Number(job.version) !== expectedVersion) {
      throw new HelperAppServiceError("version_conflict", "Staging review changed. Please refresh.");
    }
    if (!["pending_review", "failed", "rejected"].includes(job.status)) {
      throw new HelperAppServiceError("invalid_status", "This staging batch cannot be approved now.");
    }
    const trip = await lockTrip(client, job.trip_id);
    if (trip.status !== "ended") {
      throw new HelperAppServiceError("trip_not_ended", "Only ended trips can be approved for merge.");
    }
    const blocking = await client.query(
      `select id, line_community_name, product_name
       from helper_app.reviewed_staging_orders
       where merge_job_id = $1
         and is_excluded = false
         and customer_exists = false
         and customer_confirmed = false
       order by created_at asc
       limit 20`,
      [job.id],
    );
    if (blocking.rows.length > 0) {
      const labels = blocking.rows
        .slice(0, 5)
        .map((row) => `「${row.line_community_name}」／${row.product_name}`)
        .join("、");
      const more = blocking.rows.length > 5 ? ` 等 ${blocking.rows.length} 筆` : "";
      throw new HelperAppServiceError(
        "unknown_customer",
        `以下訂單的客戶暱稱尚未特別確認：${labels}${more}。請逐筆確認「仍允許合併」或排除後再核准。`,
      );
    }
    const snapshot = await buildReviewedSnapshot(client, job.id);
    const result = await client.query(
      `update helper_app.staging_merge_jobs
       set status = 'approved',
           version = version + 1,
           approved_snapshot = $2::jsonb,
           approved_by_user_id = $3,
           approved_at = now(),
           last_error = null,
           updated_at = now()
       where id = $1
       returning *`,
      [job.id, JSON.stringify(snapshot), input.actorUserId || null],
    );
    await insertAuditEvent(client, {
      action: "admin_staging_merge_approved",
      actor_role: "admin",
      actor_user_id: input.actorUserId || null,
      after_state: { mergeJobId: job.id, orderCount: snapshot.orders.length },
      before_state: { status: job.status },
      trip_id: job.trip_id,
    });
    return result.rows[0];
  });
}

async function rejectStagingMergeJob(database, input) {
  const mergeJobId = requiredText(input.mergeJobId, "mergeJobId");
  const note = requiredText(input.rejectionNote, "rejectionNote");
  return withTransaction(database, async (client) => {
    const job = await lockStagingMergeJob(client, mergeJobId);
    if (["merging", "merged"].includes(job.status)) {
      throw new HelperAppServiceError("invalid_status", "This staging batch can no longer be rejected.");
    }
    const result = await client.query(
      `update helper_app.staging_merge_jobs
       set status = 'rejected',
           version = version + 1,
           rejected_by_user_id = $2,
           rejected_at = now(),
           rejection_note = $3,
           approved_snapshot = null,
           approved_at = null,
           approved_by_user_id = null,
           updated_at = now()
       where id = $1
       returning *`,
      [job.id, input.actorUserId || null, note],
    );
    await insertAuditEvent(client, {
      action: "admin_staging_merge_rejected",
      actor_role: "admin",
      actor_user_id: input.actorUserId || null,
      after_state: { mergeJobId: job.id, status: "rejected" },
      before_state: { status: job.status },
      reason: note,
      trip_id: job.trip_id,
    });
    return result.rows[0];
  });
}

async function mergeApprovedStagingJob(database, input) {
  const mergeJobId = requiredText(input.mergeJobId, "mergeJobId");
  const expectedVersion = Number(requiredText(input.expectedVersion, "expectedVersion"));
  const idempotencyKey = requiredText(input.idempotencyKey, "idempotencyKey");
  const r2Store = input.r2Store || null;
  const preparation = await withTransaction(database, async (client) => {
    const job = await lockStagingMergeJob(client, mergeJobId);
    if (job.status === "merged" && job.merge_idempotency_key === idempotencyKey) {
      return { alreadyMerged: true, job };
    }
    if (!["approved", "failed", "merging"].includes(job.status)) {
      throw new HelperAppServiceError("invalid_status", "Only approved staging batches can be merged.");
    }
    if (job.status !== "approved" && job.merge_idempotency_key !== idempotencyKey) {
      throw new HelperAppServiceError("merge_conflict", "Staging merge is already being processed with another key.");
    }
    if (job.status === "approved" && Number(job.version) !== expectedVersion) {
      throw new HelperAppServiceError("version_conflict", "Approved staging batch changed. Please refresh.");
    }
    const snapshot = job.approved_snapshot || await buildReviewedSnapshot(client, job.id);
    await client.query(
      `update helper_app.staging_merge_jobs
       set status = 'merging',
           merge_idempotency_key = $2,
           last_error = null,
           updated_at = now()
       where id = $1
         and status in ('approved', 'failed', 'merging')`,
      [job.id, idempotencyKey],
    );
    return { alreadyMerged: false, job, snapshot };
  });
  if (preparation.alreadyMerged) return preparation.job;

  const { job, snapshot } = preparation;
  const { mainOrderIds, orderRows, photoRows, sourceLinkRows } = buildMergeRows(job, snapshot);
  try {
    if (photoRows.length && r2Store) {
      await Promise.all(photoRows.map((photo) => r2Store.copyObject(
        photo.source_storage_key,
        photo.final_storage_key,
      )));
    }

    return await withTransaction(database, async (client) => {
      const currentJob = await lockStagingMergeJob(client, job.id);
      if (currentJob.status === "merged" && currentJob.merge_idempotency_key === idempotencyKey) {
        return currentJob;
      }
      if (currentJob.status !== "merging" || currentJob.merge_idempotency_key !== idempotencyKey) {
        throw new HelperAppServiceError("merge_conflict", "Staging merge is already being processed with another key.");
      }
      await writeMergeRows(client, {
        copyAuditRows: r2Store ? photoRows : [],
        job,
        orderRows,
        photoRows,
        sourceLinkRows,
      });
      const result = await client.query(
        `update helper_app.staging_merge_jobs
         set status = 'merged',
             version = version + 1,
             main_order_ids = $2::jsonb,
             merged_by_user_id = $3,
             merged_at = now(),
             recovery_until = now() + interval '7 days',
             last_error = null,
             updated_at = now()
         where id = $1
         returning *`,
        [job.id, JSON.stringify(mainOrderIds), input.actorUserId || null],
      );
      await insertAuditEvent(client, {
        action: "admin_staging_merge_completed",
        actor_role: "admin",
        actor_user_id: input.actorUserId || null,
        after_state: { mainOrderIds, mergeJobId: job.id },
        before_state: { status: job.status },
        trip_id: job.trip_id,
      });
      return result.rows[0];
    });
  } catch (error) {
    await withTransaction(database, async (client) => {
      await client.query(
        `update helper_app.staging_merge_jobs
         set status = 'failed',
             last_error = $2,
             updated_at = now()
         where id = $1
           and status = 'merging'
           and merge_idempotency_key = $3`,
        [job.id, String(error.message || error).slice(0, 2000), idempotencyKey],
      );
    }).catch(() => {});
    throw error;
  }
}

function buildMergeRows(job, snapshot) {
  const mainOrderIds = [];
  const orderRows = (snapshot.orders || []).map((order) => {
    const orderId = deterministicId("helper_order", job.id, order.reviewedOrderId);
    mainOrderIds.push(orderId);
    return {
      appearance_notes: order.appearanceNotes || "",
      helper_id: order.helperId,
      line_community_name: order.lineCommunityName,
      merge_job_id: job.id,
      notes: order.customerConfirmed && !order.customerExists
        ? "Unknown customer explicitly confirmed during helper staging review."
        : null,
      order_date: snapshot.trip?.business_date,
      order_id: orderId,
      price_jpy: order.originalPriceJpy || 0,
      price_twd: order.salePriceTwd,
      product_name: order.productName,
      quantity: order.quantity,
      receivable_total_twd: order.quantity * order.salePriceTwd,
      source_purchase_task_id: order.purchaseTaskId,
      source_quote_photo_id: order.sourceQuoteTaskPhotoId,
      source_quote_task_id: order.sourceQuoteTaskId,
      source_rebuy_task_id: order.sourceRebuyTaskId,
      source_trip: snapshot.trip?.trip_name || "",
      staging_order_id: order.reviewedOrderId,
      total_price: order.quantity * order.salePriceTwd,
      trip_id: job.trip_id,
    };
  });
  const sourceLinkRows = orderRows.map((order, index) => {
    const sourceOrder = snapshot.orders[index];
    return {
      detail: { stagingOrderPreviewId: sourceOrder.stagingOrderPreviewId },
      helper_id: order.helper_id,
      merge_job_id: job.id,
      order_id: order.order_id,
      source_link_id: deterministicId("helper_source", job.id, sourceOrder.reviewedOrderId),
      source_purchase_task_id: order.source_purchase_task_id,
      source_quote_photo_id: order.source_quote_photo_id,
      source_quote_task_id: order.source_quote_task_id,
      source_rebuy_task_id: order.source_rebuy_task_id,
      staging_order_id: order.staging_order_id,
      trip_id: job.trip_id,
    };
  });
  const photoRows = [];
  for (const order of snapshot.orders || []) {
    const orderId = deterministicId("helper_order", job.id, order.reviewedOrderId);
    for (const photo of order.photos || []) {
      const photoId = deterministicId("helper_photo", job.id, order.reviewedOrderId, photo.id);
      photoRows.push({
        final_storage_key: deterministicMainPhotoKey({
          mergeJobId: job.id,
          orderId,
          photoId,
          sourceStorageKey: photo.storageKey,
        }),
        label: photo.label || "",
        order_id: orderId,
        photo_id: photoId,
        photo_role: photo.photoRole,
        source_photo_id: photo.sourcePurchaseTaskPhotoId,
        source_task_id: order.purchaseTaskId,
        source_storage_key: photo.storageKey,
        staging_order_photo_id: photo.id,
      });
    }
  }
  return { mainOrderIds, orderRows, photoRows, sourceLinkRows };
}

async function writeMergeRows(client, { copyAuditRows, job, orderRows, photoRows, sourceLinkRows }) {
    if (orderRows.length) {
      await client.query(
        `insert into main.orders
           (order_id, staging_order_id, merge_job_id, source_purchase_task_id,
            source_quote_task_id, source_quote_photo_id, source_rebuy_task_id,
            trip_id, helper_id, order_date, line_community_name, product_name,
            appearance_notes, quantity, price_jpy, price_twd, total_price,
            search_keywords, source_trip, order_status, source_type,
            receivable_total_twd, processing_status, notes)
         select order_id, staging_order_id, merge_job_id, source_purchase_task_id,
                source_quote_task_id, source_quote_photo_id, source_rebuy_task_id,
                trip_id, helper_id, order_date, line_community_name, product_name,
                appearance_notes, quantity, price_jpy, price_twd, total_price,
                '', source_trip, '商品訂購成功', 'helper_merge',
                receivable_total_twd, '商品訂購成功', notes
         from jsonb_to_recordset($1::jsonb) as input(
           order_id text, staging_order_id text, merge_job_id text,
           source_purchase_task_id text, source_quote_task_id text,
           source_quote_photo_id text, source_rebuy_task_id text,
           trip_id text, helper_id text, order_date date,
           line_community_name text, product_name text, appearance_notes text,
           quantity integer, price_jpy integer, price_twd integer,
           total_price integer, source_trip text,
           receivable_total_twd integer, notes text
         )
         on conflict (order_id) do update
         set line_community_name = excluded.line_community_name,
             product_name = excluded.product_name,
             appearance_notes = excluded.appearance_notes,
             quantity = excluded.quantity,
             price_jpy = excluded.price_jpy,
             price_twd = excluded.price_twd,
             total_price = excluded.total_price,
             receivable_total_twd = excluded.receivable_total_twd,
             updated_at = now()`,
        [JSON.stringify(orderRows)],
      );
      await client.query(
        `insert into main.order_source_links
           (source_link_id, order_id, source_type, staging_order_id, merge_job_id,
            source_purchase_task_id, source_quote_task_id, source_quote_photo_id,
            source_rebuy_task_id, trip_id, helper_id, detail)
         select source_link_id, order_id, 'helper_merge', staging_order_id,
                merge_job_id, source_purchase_task_id, source_quote_task_id,
                source_quote_photo_id, source_rebuy_task_id, trip_id, helper_id,
                detail
         from jsonb_to_recordset($1::jsonb) as input(
           source_link_id text, order_id text, staging_order_id text,
           merge_job_id text, source_purchase_task_id text,
           source_quote_task_id text, source_quote_photo_id text,
           source_rebuy_task_id text, trip_id text, helper_id text,
           detail jsonb
         )
         on conflict (order_id) do update
         set detail = excluded.detail, updated_at = now()`,
        [JSON.stringify(sourceLinkRows)],
      );
    }
    if (copyAuditRows.length) {
      await client.query(
        `insert into audit.merge_object_copies
           (merge_job_id, order_photo_id, source_key, destination_key, action)
         select $1, photo_id, source_storage_key, final_storage_key, 'copied'
         from jsonb_to_recordset($2::jsonb) as input(
           photo_id text, source_storage_key text, final_storage_key text
         )
         on conflict (merge_job_id, order_photo_id, destination_key) do nothing`,
        [job.id, JSON.stringify(copyAuditRows)],
      );
    }
    if (photoRows.length) {
      await client.query(
        `insert into main.order_photos
           (order_photo_id, order_id, staging_order_photo_id, photo_type,
            staging_storage_key, storage_key, url, source_task_id, source_photo_id,
            uploaded_by, label, original_name, content_type)
         select photo_id, order_id, staging_order_photo_id, photo_role,
                source_storage_key, final_storage_key, '', source_task_id,
                source_photo_id, 'helper_app', label, null, null
         from jsonb_to_recordset($1::jsonb) as input(
           photo_id text, order_id text, staging_order_photo_id text,
           photo_role text, source_storage_key text, final_storage_key text,
           source_task_id text, source_photo_id text, label text
         )
         on conflict (order_photo_id) do update
         set storage_key = excluded.storage_key,
             staging_storage_key = excluded.staging_storage_key,
             label = excluded.label,
             updated_at = now()`,
        [JSON.stringify(photoRows)],
      );
    }
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

async function findActiveHelperProfileForUser(database, authUserId) {
  const result = await database.query(
    `select *
     from helper_app.helper_profiles
     where auth_user_id = $1`,
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

async function getActiveAssignedTripForTaskCreation(client, tripId) {
  const result = await client.query(
    `select id, assigned_helper_id, status
     from helper_app.trips
     where id = $1`,
    [requiredText(tripId, "tripId")],
  );
  const trip = result.rows[0];
  if (!trip) throw new HelperAppServiceError("trip_not_found", "Trip was not found.");
  if (!trip.assigned_helper_id) {
    throw new HelperAppServiceError("invalid_trip", "Trip must have an assigned helper.");
  }
  if (trip.status !== "active") {
    throw new HelperAppServiceError("trip_not_active", "Purchase tasks can only be created for an active trip.");
  }
  return trip;
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
  if (!settlements.some((settlement) => (settlement.evidence || []).some((item) => item.storage_key))) {
    return settlements;
  }
  return Promise.all(
    settlements.map(async (settlement) => {
      const evidence = settlement.evidence || [];
      if (!evidence.some((item) => item.storage_key)) return settlement;
      return {
        ...settlement,
        evidence: await Promise.all(
          evidence.map(async (item) => {
            if (!item.storage_key) return item;
            return {
              ...item,
              signed_url: await r2Store.signedGetUrl(item.storage_key),
            };
          }),
        ),
      };
    }),
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
    await upsertSettlementEvidenceBatch(client, {
      evidenceItems: [
        { evidence: receipt, evidenceType: "daily_receipt" },
        ...(transportProof ? [{ evidence: transportProof, evidenceType: "transport_proof" }] : []),
      ],
      helperId: helper.id,
      settlementId: settlement.id,
    });
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
  const settlementId = requiredText(input.settlementId, "settlementId");
  const itemAdvanceTwdExpression = `round(coalesce(target.product_total_jpy, 0) * $2::numeric)::int`;
  const result = await database.query(
    `with target as (
       select id, trip_id, status, product_total_jpy, jpy_to_twd_rate, item_advance_twd
       from helper_app.settlements
       where id = $1
     ),
     updated as (
       update helper_app.settlements s
       set jpy_to_twd_rate = $2,
           item_advance_twd = ${itemAdvanceTwdExpression},
           updated_at = now()
       from target
       where s.id = target.id
         and target.status <> 'completed'
       returning s.*,
         target.jpy_to_twd_rate as previous_jpy_to_twd_rate,
         target.item_advance_twd as previous_item_advance_twd
     ),
     audit as (
       insert into helper_app.trip_audit_events
         (trip_id, actor_user_id, actor_role, action, before_state, after_state)
       select trip_id, $3, 'admin', 'admin_settlement_exchange_rate_set',
              jsonb_build_object(
                'settlementId', id,
                'jpyToTwdRate', previous_jpy_to_twd_rate,
                'itemAdvanceTwd', previous_item_advance_twd
              ),
              jsonb_build_object(
                'settlementId', id,
                'jpyToTwdRate', jpy_to_twd_rate,
                'itemAdvanceTwd', item_advance_twd
              )
       from updated
       returning id
     )
     select *
     from updated`,
    [settlementId, jpyToTwdRate, input.actorUserId || null],
  );
  if (!result.rows[0]) {
    throw new HelperAppServiceError("invalid_status", "Settlement rate cannot be changed.");
  }
  return result.rows[0];
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
    await upsertSettlementEvidenceBatch(client, {
      evidenceItems: [{ evidence: proof, evidenceType: "warehouse_proof", note: optionalText(input.note) }],
      helperId: helper.id,
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

async function lockStagingMergeJob(client, mergeJobId) {
  const result = await client.query(
    `select * from helper_app.staging_merge_jobs where id = $1 for update`,
    [mergeJobId],
  );
  if (!result.rows[0]) throw new HelperAppServiceError("merge_job_not_found", "Staging merge job was not found.");
  return result.rows[0];
}

async function getStagingMergeJobById(client, mergeJobId) {
  const result = await client.query(
    `select * from helper_app.staging_merge_jobs where id = $1`,
    [mergeJobId],
  );
  if (!result.rows[0]) throw new HelperAppServiceError("merge_job_not_found", "Staging merge job was not found.");
  return result.rows[0];
}

async function lockReviewedStagingOrder(client, reviewedOrderId) {
  const result = await client.query(
    `select * from helper_app.reviewed_staging_orders where id = $1 for update`,
    [reviewedOrderId],
  );
  if (!result.rows[0]) throw new HelperAppServiceError("reviewed_order_not_found", "Reviewed staging order was not found.");
  return result.rows[0];
}

async function revokeMergeApprovalForEdit(client, job) {
  if (job.status !== "approved") return;
  await client.query(
    `update helper_app.staging_merge_jobs
     set status = 'pending_review',
         version = version + 1,
         approved_snapshot = null,
         approved_at = null,
         approved_by_user_id = null,
         updated_at = now()
     where id = $1`,
    [job.id],
  );
}

async function buildReviewedSnapshot(client, mergeJobId) {
  const result = await client.query(
    `select mj.id as merge_job_id, t.id as trip_id, t.trip_name, t.business_date,
            t.timezone, rso.*, coalesce(photos.items, '[]'::jsonb) as photos
     from helper_app.staging_merge_jobs mj
     join helper_app.trips t on t.id = mj.trip_id
     join helper_app.reviewed_staging_orders rso on rso.merge_job_id = mj.id
     left join lateral (
       select jsonb_agg(jsonb_build_object(
         'id', rsop.id,
         'sourcePurchaseTaskPhotoId', rsop.source_purchase_task_photo_id,
         'storageKey', rsop.storage_key,
         'photoRole', rsop.photo_role,
         'label', rsop.label,
         'sortOrder', rsop.sort_order
       ) order by rsop.sort_order asc) filter (where rsop.include_in_merge) as items
       from helper_app.reviewed_staging_order_photos rsop
       where rsop.reviewed_order_id = rso.id
     ) photos on true
     where mj.id = $1
     order by rso.created_at asc`,
    [mergeJobId],
  );
  const first = result.rows[0];
  return {
    frozenAt: new Date().toISOString(),
    trip: first
      ? {
          business_date: dateOnly(first.business_date, first.timezone || "Asia/Tokyo"),
          timezone: first.timezone,
          trip_id: first.trip_id,
          trip_name: first.trip_name,
        }
      : null,
    orders: result.rows
      .filter((row) => !row.is_excluded)
      .map((row) => ({
        appearanceNotes: row.appearance_notes || "",
        customerConfirmed: row.customer_confirmed,
        customerExists: row.customer_exists,
        helperId: row.helper_id,
        lineCommunityName: row.line_community_name,
        originalPriceJpy: row.original_price_jpy,
        photos: row.photos || [],
        productName: row.product_name,
        purchaseTaskId: row.purchase_task_id,
        quantity: row.quantity,
        reviewedOrderId: row.id,
        salePriceTwd: row.sale_price_twd,
        sourceQuoteReplyId: row.source_quote_reply_id,
        sourceQuoteTaskId: row.source_quote_task_id,
        sourceQuoteTaskPhotoId: row.source_quote_task_photo_id,
        sourceRebuyTaskId: row.source_rebuy_task_id,
        stagingOrderPreviewId: row.staging_order_preview_id,
      })),
  };
}

function assertHelperOwnsSettlement(settlement, helper) {
  if (settlement.helper_id !== helper.id) {
    throw new HelperAppServiceError("forbidden", "Settlement does not belong to this helper.");
  }
}

async function upsertSettlementEvidenceBatch(
  client,
  { evidenceItems, helperId, settlementId },
) {
  const items = evidenceItems.filter((item) => item?.evidence?.storageKey);
  if (!items.length) return;
  const mediaKinds = items.map(({ evidenceType }) => settlementEvidenceMediaKind(evidenceType));
  const retentionStatuses = items.map(({ evidenceType }) =>
    evidenceType === "warehouse_proof" ? "warehouse_evidence" : "order_evidence"
  );
  await client.query(
    `insert into helper_app.media_objects
       (storage_key, media_kind, retention_status, original_filename,
        content_type, byte_size, uploaded_by_helper_id)
     select *
     from unnest(
       $1::text[],
       $2::text[],
       $3::text[],
       $4::text[],
       $5::text[],
       $6::bigint[],
       $7::uuid[]
     )
     on conflict (storage_key) do update
     set media_kind = excluded.media_kind, retention_status = excluded.retention_status`,
    [
      items.map(({ evidence }) => evidence.storageKey),
      mediaKinds,
      retentionStatuses,
      items.map(({ evidence }) => evidence.originalFilename),
      items.map(({ evidence }) => evidence.contentType),
      items.map(({ evidence }) => evidence.byteSize),
      items.map(() => helperId),
    ],
  );
  await client.query(
    `insert into helper_app.settlement_evidence
       (settlement_id, storage_key, evidence_type, note)
     select *
     from unnest($1::uuid[], $2::text[], $3::text[], $4::text[])
     on conflict (settlement_id, evidence_type) do update
     set storage_key = excluded.storage_key, note = excluded.note, updated_at = now()`,
    [
      items.map(() => settlementId),
      items.map(({ evidence }) => evidence.storageKey),
      items.map(({ evidenceType }) => evidenceType),
      items.map(({ note }) => note || null),
    ],
  );
}

function settlementEvidenceMediaKind(evidenceType) {
  const mediaKind = evidenceType === "daily_receipt"
    ? "settlement_receipt"
    : evidenceType === "transport_proof"
      ? "transport_proof"
      : "warehouse_evidence";
  return mediaKind;
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
  if (photoIds.length === 0 && uploadedPhotos.length === 0) {
    throw new HelperAppServiceError("invalid_input", "At least one task photo is required.");
  }
  if (taskType === "detail" && photoIds.length > 0) {
    throw new HelperAppServiceError("invalid_input", "Detail tasks must use uploaded task photos.");
  }
  if (photoIds.length > 0 && uploadedPhotos.length > 0) {
    throw new HelperAppServiceError("invalid_input", "Use either selected site photos or uploaded task photos, not both.");
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
  const remainingResolution = optionalText(input.remainingResolution);
  if (completedQuantity != null && (!Number.isInteger(completedQuantity) || completedQuantity < 0)) {
    throw new HelperAppServiceError("invalid_input", "Completed quantity must be a non-negative integer.");
  }
  if (unavailableQuantity != null && (!Number.isInteger(unavailableQuantity) || unavailableQuantity < 0)) {
    throw new HelperAppServiceError("invalid_input", "Unavailable quantity must be a non-negative integer.");
  }
  if (
    remainingResolution != null &&
    !["canceled", "not_found", "unavailable"].includes(remainingResolution)
  ) {
    throw new HelperAppServiceError("invalid_input", "Invalid remaining quantity resolution.");
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
    remainingResolution,
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

function normalizeReviewedOrderPatch(input) {
  const quantity = Number(requiredText(input.quantity, "quantity"));
  const salePriceTwd = Number(requiredText(input.salePriceTwd, "salePriceTwd"));
  const originalPriceText = optionalText(input.originalPriceJpy);
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
    appearanceNotes: optionalText(input.appearanceNotes) || "",
    customerConfirmed: Boolean(input.customerConfirmed),
    exclusionReason: optionalText(input.exclusionReason),
    isExcluded: Boolean(input.isExcluded),
    lineCommunityName: requiredText(input.lineCommunityName, "lineCommunityName"),
    originalPriceJpy,
    productName: requiredText(input.productName, "productName"),
    quantity,
    salePriceTwd,
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

async function insertSitePhotoBatchRows(client, { batchId, helperId, photos, tripId }) {
  if (!photos.length) return;
  await client.query(
    `insert into helper_app.media_objects
       (storage_key, media_kind, retention_status, original_filename,
        content_type, byte_size, uploaded_by_helper_id)
     select input.storage_key, 'site_photo', 'temporary_work_media',
            input.original_filename, input.content_type, input.byte_size,
            input.uploaded_by_helper_id
     from unnest($1::text[], $2::text[], $3::text[], $4::int[], $5::uuid[])
       as input(storage_key, original_filename, content_type, byte_size, uploaded_by_helper_id)
     on conflict (storage_key) do update
     set original_filename = coalesce(excluded.original_filename, helper_app.media_objects.original_filename),
         content_type = coalesce(excluded.content_type, helper_app.media_objects.content_type),
         byte_size = coalesce(excluded.byte_size, helper_app.media_objects.byte_size)`,
    [
      photos.map((photo) => photo.storageKey),
      photos.map((photo) => photo.originalFilename || null),
      photos.map((photo) => photo.contentType || null),
      photos.map((photo) => Number.isFinite(Number(photo.byteSize)) ? Number(photo.byteSize) : null),
      photos.map(() => helperId),
    ],
  );
  await client.query(
    `insert into helper_app.site_photos
       (batch_id, trip_id, helper_id, client_photo_id, storage_key,
        original_filename, content_type, byte_size, sort_order)
     select $1, $2, $3, input.client_photo_id, input.storage_key,
            input.original_filename, input.content_type, input.byte_size,
            input.sort_order
     from unnest($4::text[], $5::text[], $6::text[], $7::text[], $8::int[], $9::int[])
       as input(client_photo_id, storage_key, original_filename, content_type, byte_size, sort_order)`,
    [
      batchId,
      tripId,
      helperId,
      photos.map((photo) => photo.clientPhotoId),
      photos.map((photo) => photo.storageKey),
      photos.map((photo) => photo.originalFilename || null),
      photos.map((photo) => photo.contentType || null),
      photos.map((photo) => Number.isFinite(Number(photo.byteSize)) ? Number(photo.byteSize) : null),
      photos.map((photo) => photo.sortOrder),
    ],
  );
}

async function upsertQuoteTaskMediaBatch(client, photos) {
  if (!photos.length) return;
  await client.query(
    `insert into helper_app.media_objects
       (storage_key, media_kind, retention_status, original_filename, content_type, byte_size)
     select input.storage_key, 'quote_task_photo', 'task_evidence',
            input.original_filename, input.content_type, input.byte_size
     from unnest($1::text[], $2::text[], $3::text[], $4::int[])
       as input(storage_key, original_filename, content_type, byte_size)
     on conflict (storage_key) do update
     set media_kind = 'quote_task_photo',
         retention_status = 'task_evidence',
         original_filename = excluded.original_filename,
         content_type = excluded.content_type,
         byte_size = excluded.byte_size`,
    [
      photos.map((photo) => photo.storageKey),
      photos.map((photo) => photo.originalFilename || null),
      photos.map((photo) => photo.contentType || null),
      photos.map((photo) => Number.isFinite(Number(photo.byteSize)) ? Number(photo.byteSize) : null),
    ],
  );
}

async function insertQuoteTaskPhotosBatch(
  client,
  { instruction, photos, productName, taskId, tripId, helperId },
) {
  if (!photos.length) return;
  await client.query(
    `insert into helper_app.quote_task_photos
       (quote_task_id, trip_id, helper_id, source_site_photo_id, storage_key,
        product_name, instruction, sort_order)
     select $1, $2, $3, input.source_site_photo_id, input.storage_key,
            $4, $5, input.sort_order
     from unnest($6::uuid[], $7::text[], $8::int[])
       as input(source_site_photo_id, storage_key, sort_order)`,
    [
      taskId,
      tripId,
      helperId,
      productName,
      instruction,
      photos.map((photo) => photo.sourceSitePhotoId || null),
      photos.map((photo) => photo.storageKey),
      photos.map((photo, index) => Number.isInteger(photo.sortOrder) ? photo.sortOrder : index),
    ],
  );
}

async function upsertPurchaseReferenceMediaBatch(client, photos) {
  if (!photos.length) return;
  await client.query(
    `insert into helper_app.media_objects
       (storage_key, media_kind, retention_status, original_filename,
        content_type, byte_size)
     select input.storage_key,
            'purchase_reference_photo',
            'order_evidence',
            input.original_filename,
            input.content_type,
            input.byte_size
     from unnest($1::text[], $2::text[], $3::text[], $4::bigint[])
       as input(storage_key, original_filename, content_type, byte_size)
     on conflict (storage_key) do update
     set media_kind = 'purchase_reference_photo',
         retention_status = 'order_evidence',
         original_filename = coalesce(excluded.original_filename, helper_app.media_objects.original_filename),
         content_type = coalesce(excluded.content_type, helper_app.media_objects.content_type),
         byte_size = coalesce(excluded.byte_size, helper_app.media_objects.byte_size)`,
    [
      photos.map((photo) => photo.storageKey),
      photos.map((photo) => photo.originalFilename || null),
      photos.map((photo) => photo.contentType || null),
      photos.map((photo) => Number.isFinite(Number(photo.byteSize)) ? Number(photo.byteSize) : null),
    ],
  );
}

async function insertPurchasePhotosBatch(client, photos) {
  if (!photos.length) return;
  await client.query(
    `insert into helper_app.purchase_task_photos
       (purchase_task_id, trip_id, helper_id, storage_key, photo_role, sort_order)
     select *
     from unnest($1::uuid[], $2::uuid[], $3::uuid[], $4::text[], $5::text[], $6::int[])
       as input(purchase_task_id, trip_id, helper_id, storage_key, photo_role, sort_order)
     on conflict (purchase_task_id, photo_role, sort_order) do nothing`,
    [
      photos.map((photo) => photo.purchaseTaskId),
      photos.map((photo) => photo.tripId),
      photos.map((photo) => photo.helperId),
      photos.map((photo) => photo.storageKey),
      photos.map((photo) => photo.photoRole),
      photos.map((photo) => photo.sortOrder),
    ],
  );
}

async function upsertLatestFaceCheckPurchasePhoto(client, input) {
  await client.query(
    `insert into helper_app.purchase_task_photos
       (purchase_task_id, trip_id, helper_id, storage_key, photo_role, sort_order, created_at)
     values ($1, $2, $3, $4, 'face_check_report', 0, now())
     on conflict (purchase_task_id, photo_role, sort_order) do update
     set storage_key = excluded.storage_key,
         created_at = now()`,
    [
      input.purchaseTaskId,
      input.tripId,
      input.helperId,
      input.storageKey,
    ],
  );
}

async function markMediaAsOrderEvidenceBatch(client, storageKeys) {
  const keys = [...new Set(storageKeys.filter(Boolean))];
  if (!keys.length) return;
  await client.query(
    `update helper_app.media_objects
     set retention_status = 'order_evidence'
     where storage_key = any($1::text[])`,
    [keys],
  );
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

async function lockPurchaseTaskForHelper(client, { authUserId, purchaseTaskId }) {
  const result = await client.query(
    `select pt.*,
            hp.id as authorized_helper_id,
            hp.is_active as authorized_helper_is_active,
            t.status as authorized_trip_status
     from helper_app.purchase_tasks pt
     join helper_app.trips t on t.id = pt.trip_id
     join helper_app.helper_profiles hp on hp.auth_user_id = $2
     where pt.id = $1
     for update of pt, t, hp`,
    [purchaseTaskId, authUserId],
  );
  const row = result.rows[0];
  if (!row) throw new HelperAppServiceError("purchase_task_not_found", "Purchase task was not found.");
  const helper = {
    id: row.authorized_helper_id,
    is_active: row.authorized_helper_is_active,
  };
  if (!helper.id) throw new HelperAppServiceError("helper_not_found", "Helper profile was not found.");
  if (!helper.is_active) throw new HelperAppServiceError("helper_inactive", "Helper profile is inactive.");
  return { helper, task: row };
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

async function removeStagingOrderPreviewForPurchaseTask(client, purchaseTaskId) {
  await client.query(
    `delete from helper_app.staging_order_previews
     where purchase_task_id = $1`,
    [purchaseTaskId],
  );
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

async function upsertRebuyPhotosBatch(client, { helperId, mediaKind, photos, photoRole, rebuyTaskId }) {
  if (!photos.length) return;
  await client.query(
    `insert into helper_app.media_objects
       (storage_key, media_kind, retention_status, original_filename,
        content_type, byte_size, uploaded_by_helper_id)
     select input.storage_key, $5, 'order_evidence', input.original_filename,
            input.content_type, input.byte_size, $6
     from unnest($1::text[], $2::text[], $3::text[], $4::int[])
       as input(storage_key, original_filename, content_type, byte_size)
     on conflict (storage_key) do update
     set media_kind = excluded.media_kind,
         retention_status = 'order_evidence',
         original_filename = coalesce(excluded.original_filename, helper_app.media_objects.original_filename),
         content_type = coalesce(excluded.content_type, helper_app.media_objects.content_type),
         byte_size = coalesce(excluded.byte_size, helper_app.media_objects.byte_size)`,
    [
      photos.map((photo) => photo.storageKey),
      photos.map((photo) => photo.originalFilename || null),
      photos.map((photo) => photo.contentType || null),
      photos.map((photo) => Number.isFinite(Number(photo.byteSize)) ? Number(photo.byteSize) : null),
      mediaKind,
      helperId || null,
    ],
  );
  await client.query(
    `insert into helper_app.rebuy_task_photos
       (rebuy_task_id, storage_key, photo_role, sort_order)
     select $1, input.storage_key, $2, input.sort_order
     from unnest($3::text[], $4::int[])
       as input(storage_key, sort_order)
     on conflict (rebuy_task_id, photo_role, sort_order) do update
     set storage_key = excluded.storage_key`,
    [
      rebuyTaskId,
      photoRole,
      photos.map((photo) => photo.storageKey),
      photos.map((photo, index) => Number.isInteger(photo.sortOrder) ? photo.sortOrder : index),
    ],
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
  const purchasePhotos = photos.rows.map((photo) => ({
    helperId: input.helperId,
    photoRole: photo.photo_role === "reference" ? "manual_reference" : "detail_reply",
    purchaseTaskId: input.purchaseTaskId,
    sortOrder: photo.sort_order,
    storageKey: photo.storage_key,
    tripId: input.tripId,
  }));
  await insertPurchasePhotosBatch(client, purchasePhotos);
  await markMediaAsOrderEvidenceBatch(client, purchasePhotos.map((photo) => photo.storageKey));
}

async function authorizePhotoAnnotationSource(database, {
  actorRole,
  authUserId,
  sourceStorageKey,
}) {
  const storageKey = requiredText(sourceStorageKey, "sourceStorageKey");
  const result = await database.query(
    `select mo.id, mo.storage_key, mo.media_kind, mo.content_type, mo.original_filename,
            case when $2 = 'admin' then true else (
              exists (
                select 1
                from helper_app.site_photos sp
                join helper_app.trips t on t.id = sp.trip_id
                join helper_app.helper_profiles hp on hp.id = sp.helper_id
                where sp.storage_key = mo.storage_key
                  and hp.auth_user_id = $1
                  and hp.is_active = true
                  and t.assigned_helper_id = hp.id
              )
              or exists (
                select 1
                from helper_app.quote_task_photos qtp
                join helper_app.trips t on t.id = qtp.trip_id
                join helper_app.helper_profiles hp on hp.id = qtp.helper_id
                where qtp.storage_key = mo.storage_key
                  and hp.auth_user_id = $1
                  and hp.is_active = true
                  and t.assigned_helper_id = hp.id
              )
              or exists (
                select 1
                from helper_app.quote_photo_replies qpr
                join helper_app.trips t on t.id = qpr.trip_id
                join helper_app.helper_profiles hp on hp.id = qpr.helper_id
                where qpr.detail_photos @> jsonb_build_array(jsonb_build_object('storageKey', mo.storage_key))
                  and hp.auth_user_id = $1
                  and hp.is_active = true
                  and t.assigned_helper_id = hp.id
              )
              or exists (
                select 1
                from helper_app.purchase_task_photos ptp
                join helper_app.trips t on t.id = ptp.trip_id
                join helper_app.helper_profiles hp on hp.id = ptp.helper_id
                where ptp.storage_key = mo.storage_key
                  and hp.auth_user_id = $1
                  and hp.is_active = true
                  and t.assigned_helper_id = hp.id
              )
              or exists (
                select 1
                from helper_app.settlement_evidence se
                join helper_app.settlements s on s.id = se.settlement_id
                join helper_app.helper_profiles hp on hp.id = s.helper_id
                where se.storage_key = mo.storage_key
                  and hp.auth_user_id = $1
                  and hp.is_active = true
              )
              or exists (
                select 1
                from helper_app.rebuy_task_photos rtp
                join helper_app.rebuy_tasks rt on rt.id = rtp.rebuy_task_id
                left join helper_app.helper_profiles hp
                  on hp.id = coalesce(rt.claimed_helper_id, rt.assigned_helper_id)
                where rtp.storage_key = mo.storage_key
                  and (
                    (rt.visibility = 'public' and rt.status = 'open')
                    or (hp.auth_user_id = $1 and hp.is_active = true)
                  )
              )
              or exists (
                select 1
                from helper_app.media_variants mv
                where mv.storage_key = mo.storage_key
                  and mv.created_by_user_id = $1
              )
            ) end as can_access
     from helper_app.media_objects mo
     where mo.storage_key = $3`,
    [authUserId, actorRole, storageKey],
  );
  const source = result.rows[0];
  if (!source) throw new HelperAppServiceError("photo_not_found", "照片不存在或已被移除。");
  if (!source.can_access) {
    throw new HelperAppServiceError("forbidden", "你沒有編輯這張照片的權限。");
  }
  return source;
}

async function createPhotoAnnotation(database, {
  actorRole,
  annotationManifest,
  authUserId,
  byteSize,
  contentType,
  idempotencyKey,
  originalFilename,
  sourceStorageKey,
  storageKey,
}) {
  const normalizedIdempotencyKey = requiredText(idempotencyKey, "idempotencyKey");
  const normalizedStorageKey = requiredText(storageKey, "storageKey");
  const normalizedContentType = requiredText(contentType, "contentType");
  const normalizedManifest = annotationManifest && typeof annotationManifest === "object"
    ? annotationManifest
    : {};
  if (JSON.stringify(normalizedManifest).length > 200_000) {
    throw new HelperAppServiceError("invalid_input", "標註資料過大，請減少標註內容後重試。");
  }

  return withTransaction(database, async (client) => {
    const helper = actorRole === "helper"
      ? await findActiveHelperForUser(client, authUserId)
      : null;
    const source = await authorizePhotoAnnotationSource(client, {
      actorRole,
      authUserId,
      sourceStorageKey,
    });
    const existingResult = await client.query(
      `select mv.*, mo.original_filename as media_original_filename,
              mo.content_type as media_content_type, mo.byte_size as media_byte_size
       from helper_app.media_variants mv
       join helper_app.media_objects mo on mo.storage_key = mv.storage_key
       where mv.created_by_user_id = $1 and mv.idempotency_key = $2`,
      [authUserId, normalizedIdempotencyKey],
    );
    if (existingResult.rows[0]) return existingResult.rows[0];

    await client.query(
      `insert into helper_app.media_objects
         (storage_key, media_kind, retention_status, original_filename,
          content_type, byte_size, uploaded_by_helper_id)
       values ($1, 'photo_annotation', 'temporary_work_media', $2, $3, $4, $5)
       on conflict (storage_key) do nothing`,
      [
        normalizedStorageKey,
        optionalText(originalFilename),
        normalizedContentType,
        Number.isFinite(Number(byteSize)) ? Number(byteSize) : null,
        helper?.id || null,
      ],
    );
    const variantResult = await client.query(
      `insert into helper_app.media_variants
         (source_media_object_id, source_storage_key, storage_key,
          annotation_manifest, original_filename, content_type, byte_size,
          created_by_user_id, created_by_helper_id, idempotency_key)
       values ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10)
       on conflict (created_by_user_id, idempotency_key) do nothing
       returning *`,
      [
        source.id,
        source.storage_key,
        normalizedStorageKey,
        JSON.stringify(normalizedManifest),
        optionalText(originalFilename),
        normalizedContentType,
        Number.isFinite(Number(byteSize)) ? Number(byteSize) : null,
        authUserId,
        helper?.id || null,
        normalizedIdempotencyKey,
      ],
    );
    const variant = variantResult.rows[0] || (await client.query(
      `select * from helper_app.media_variants
       where created_by_user_id = $1 and idempotency_key = $2`,
      [authUserId, normalizedIdempotencyKey],
    )).rows[0];
    if (!variant) throw new HelperAppServiceError("save_failed", "編輯照片保存失敗，請重試。");

    await client.query(
      `insert into helper_app.media_variant_audit_events
         (variant_id, actor_user_id, actor_role, action, details)
       values ($1, $2, $3, 'photo_annotation_saved', $4::jsonb)`,
      [
        variant.id,
        authUserId,
        actorRole,
        JSON.stringify({ sourceStorageKey: source.storage_key }),
      ],
    );
    return variant;
  });
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

function deterministicId(prefix, ...parts) {
  return `${prefix}_${crypto.createHash("sha256").update(parts.join(":")).digest("hex").slice(0, 24)}`;
}

function deterministicMainPhotoKey({ mergeJobId, orderId, photoId, sourceStorageKey }) {
  const extension = String(sourceStorageKey || "").match(/\.[A-Za-z0-9]+$/)?.[0] || ".jpg";
  return [
    "main-orders",
    cleanStorageKeyPart(mergeJobId),
    cleanStorageKeyPart(orderId),
    `${cleanStorageKeyPart(photoId)}${extension.toLowerCase()}`,
  ].join("/");
}

function cleanStorageKeyPart(value) {
  return String(value || "unknown")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown";
}

function isHelperAppServiceError(error) {
  return error instanceof HelperAppServiceError;
}

module.exports = {
  HelperAppServiceError,
  activateTrip,
  approveStagingMergeJob,
  authorizePhotoAnnotationSource,
  attachSignedSettlementUrls,
  attachSignedQuoteTaskUrls,
  attachSignedPurchaseTaskUrls,
  attachSignedPhotoUrls,
  attachSignedRebuyTaskUrls,
  attachSignedStagingMergeJobUrls,
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
  createPhotoAnnotation,
  createPurchaseTask,
  createQuoteTask,
  createRebuyTask,
  createTrip,
  dateInTimezone,
  dateOnly,
  deactivateHelperProfile,
  editReviewedStagingOrder,
  editReviewedStagingOrderPhotos,
  updateHelperProfile,
  getPurchaseTaskDetail,
  getHelperWorkspace,
  groupTripsByLocalDate,
  isHelperAppServiceError,
  listPurchaseTasks,
  listAuthorizedHelperRebuyTasks,
  listAuthorizedHelperQuoteTaskSummaries,
  listAdminQuoteTaskSummaries,
  listQuoteTasks,
  listRebuyTasks,
  listSettlements,
  listAuthorizedHelperSitePhotoBatchSummaries,
  getAuthorizedHelperSitePhotoBatchDetail,
  listSitePhotoBatches,
  listSitePhotoBatchSummaries,
  listStagingMergeJobs,
  listStagingOrderPreviews,
  listAdminDashboard,
  listCustomerNicknames,
  markSitePhotoSaved,
  markHelperArrived,
  markHelperDeparted,
  markHelperEnded,
  mergeApprovedStagingJob,
  prepareStagingReview,
  repairTrip,
  recordSettlementPayment,
  respondPurchaseTask,
  searchCustomerNicknames,
  reviewSettlement,
  rejectStagingMergeJob,
  setReviewedStagingOrderSelection,
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
