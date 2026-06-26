const {
  buildTransition,
  repairTrip: buildRepairTransition,
} = require("../domain/trip-state");
const { withTransaction } = require("./database");

class HelperAppServiceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "HelperAppServiceError";
    this.code = code;
  }
}

async function listAdminDashboard(database) {
  const [helpers, trips, sitePhotoBatches, quoteTasks] = await Promise.all([
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
  ]);
  return { helpers: helpers.rows, quoteTasks, sitePhotoBatches, trips: trips.rows };
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
    return { groups: { history: [], today: [], upcoming: [] }, profile };
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
    sitePhotoBatchesByTripId: groupBatchesByTripId(
      await listSitePhotoBatches(database, {
        helperId: profile.id,
        tripIds: tripsResult.rows.map((trip) => trip.id),
      }),
    ),
  };
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

function groupTripsByLocalDate(trips, now = new Date()) {
  const groups = { history: [], today: [], upcoming: [] };
  for (const trip of trips) {
    const today = dateInTimezone(now, trip.timezone || "Asia/Tokyo");
    const businessDate = dateOnly(trip.business_date, trip.timezone || "Asia/Tokyo");
    if (trip.status === "ended" || businessDate < today) {
      groups.history.push(trip);
    } else if (businessDate === today) {
      groups.today.push(trip);
    } else {
      groups.upcoming.push(trip);
    }
  }
  return groups;
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

function assertTripIsToday(trip, message) {
  const timezone = trip.timezone || "Asia/Tokyo";
  const today = dateInTimezone(new Date(), timezone);
  const businessDate = dateOnly(trip.business_date, timezone);
  if (businessDate !== today) {
    throw new HelperAppServiceError("trip_not_today", message);
  }
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
  assertTripIsToday(row, "Site photos can be uploaded only for today's trip.");
  if (row.status !== "active") {
    throw new HelperAppServiceError("trip_not_active", "Site photos can be uploaded only after the trip is active.");
  }
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
    assertTripIsToday(trip, "Site photo batches can be submitted only for today's trip.");
    if (trip.status !== "active") {
      throw new HelperAppServiceError("trip_not_active", "Site photo batches can be submitted only for active trips.");
    }

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

async function createQuoteTask(database, { actorUserId, instruction, photoIds, productName, taskType, tripId }) {
  const normalized = normalizeQuoteTaskInput({ instruction, photoIds, productName, taskType, tripId });
  return withTransaction(database, async (client) => {
    const trip = await lockTrip(client, normalized.tripId);
    if (!trip.assigned_helper_id) {
      throw new HelperAppServiceError("invalid_trip", "Trip must have an assigned helper.");
    }
    if (["ended", "canceled"].includes(trip.status)) {
      throw new HelperAppServiceError("trip_not_active", "Quote tasks cannot be created for ended or canceled trips.");
    }

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

    for (const [index, photo] of photosResult.rows.entries()) {
      await client.query(
        `update helper_app.media_objects
         set media_kind = 'quote_task_photo',
             retention_status = 'task_evidence'
         where storage_key = $1`,
        [photo.storage_key],
      );
      await client.query(
        `insert into helper_app.quote_task_photos
           (quote_task_id, trip_id, helper_id, source_site_photo_id, storage_key,
            product_name, instruction, sort_order)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          task.id,
          trip.id,
          trip.assigned_helper_id,
          photo.id,
          photo.storage_key,
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
        photoCount: photosResult.rows.length,
        taskId: task.id,
        taskType: task.task_type,
      },
      before_state: {},
      trip_id: trip.id,
    });
    return getQuoteTaskById(client, task.id);
  });
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
  assertTripIsToday(row, "Quote reply photos can be uploaded only for today's trip.");
  if (row.status !== "active") {
    throw new HelperAppServiceError("trip_not_active", "Quote reply photos can be uploaded only while the trip is active.");
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
    assertTripIsToday(trip, "Quote replies can be submitted only for today's trip.");
    if (trip.status !== "active") {
      throw new HelperAppServiceError("trip_not_active", "Quote replies can be submitted only while the trip is active.");
    }
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
    assertTripIsToday(trip, "Helper trip actions are available only for today's trip.");
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
  if (photoIds.length === 0) {
    throw new HelperAppServiceError("invalid_input", "At least one task photo is required.");
  }
  if (new Set(photoIds).size !== photoIds.length) {
    throw new HelperAppServiceError("invalid_input", "Task photos must be unique.");
  }
  if (photoIds.length > 40) {
    throw new HelperAppServiceError("invalid_input", "A quote task can include at most 40 photos.");
  }
  return {
    instruction: optionalText(input.instruction),
    photoIds,
    productName: optionalText(input.productName),
    taskType,
    tripId: requiredText(input.tripId, "tripId"),
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
  attachSignedQuoteTaskUrls,
  attachSignedPhotoUrls,
  authorizeQuoteReplyUpload,
  authorizeSitePhotoUpload,
  cancelTrip,
  createHelperProfile,
  createQuoteTask,
  createTrip,
  dateInTimezone,
  dateOnly,
  deactivateHelperProfile,
  getHelperWorkspace,
  groupTripsByLocalDate,
  isHelperAppServiceError,
  listQuoteTasks,
  listSitePhotoBatches,
  listAdminDashboard,
  markSitePhotoSaved,
  markHelperArrived,
  markHelperDeparted,
  repairTrip,
  submitQuotePhotoReply,
  submitSitePhotoBatch,
};
