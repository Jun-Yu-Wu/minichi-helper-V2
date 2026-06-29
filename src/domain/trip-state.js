const TRIP_STATUSES = Object.freeze([
  "draft",
  "scheduled",
  "departed",
  "arrived",
  "active",
  "ended",
  "canceled",
]);

const SNAPSHOT_FIELDS = [
  "id",
  "status",
  "departed_at",
  "arrived_at",
  "admin_activated_at",
  "ended_at",
  "canceled_at",
  "version",
];

class TripStateError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "TripStateError";
    this.code = code;
  }
}

function snapshotTrip(trip) {
  const snapshot = {};
  for (const field of SNAPSHOT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(trip, field)) {
      snapshot[field] = trip[field];
    }
  }
  return snapshot;
}

function assertExpectedVersion(trip, expectedVersion) {
  if (Number(trip.version) !== Number(expectedVersion)) {
    throw new TripStateError(
      "stale_version",
      "Trip has changed. Refresh before submitting again.",
    );
  }
}

function nowIso(now) {
  if (now instanceof Date) return now.toISOString();
  return new Date(now || Date.now()).toISOString();
}

function buildTransition({ trip, expectedVersion, action, actorRole, reason, now }) {
  assertExpectedVersion(trip, expectedVersion);
  const before = snapshotTrip(trip);
  const timestamp = nowIso(now);
  const next = {
    ...trip,
    updated_at: timestamp,
    version: Number(trip.version) + 1,
  };

  if (action === "helper_departed") {
    if (!["draft", "scheduled"].includes(trip.status)) {
      throw new TripStateError("invalid_transition", "Only not-started trips can be marked departed.");
    }
    next.status = "departed";
    next.departed_at = timestamp;
  } else if (action === "helper_arrived") {
    if (trip.status !== "departed") {
      throw new TripStateError("invalid_transition", "Only departed trips can be marked arrived.");
    }
    next.status = "arrived";
    next.arrived_at = timestamp;
  } else if (action === "admin_activated") {
    if (trip.status !== "arrived") {
      throw new TripStateError("invalid_transition", "Only arrived trips can be activated.");
    }
    next.status = "active";
    next.admin_activated_at = timestamp;
  } else if (action === "helper_ended") {
    if (!["departed", "arrived", "active"].includes(trip.status)) {
      throw new TripStateError("invalid_transition", "Only in-progress trips can be ended.");
    }
    next.status = "ended";
    next.ended_at = timestamp;
  } else if (action === "admin_canceled") {
    if (trip.status === "ended" || trip.status === "canceled") {
      throw new TripStateError("invalid_transition", "Ended or canceled trips cannot be canceled again.");
    }
    next.status = "canceled";
    next.canceled_at = timestamp;
  } else {
    throw new TripStateError("unknown_action", `Unknown trip action: ${action}`);
  }

  return {
    event: {
      action,
      actor_role: actorRole,
      after_state: snapshotTrip(next),
      before_state: before,
      reason: reason || null,
    },
    trip: next,
  };
}

function repairTrip({ trip, expectedVersion, patch, reason, now }) {
  assertExpectedVersion(trip, expectedVersion);
  if (!reason || !String(reason).trim()) {
    throw new TripStateError("reason_required", "Admin repair requires a reason.");
  }
  const before = snapshotTrip(trip);
  const timestamp = nowIso(now);
  const next = {
    ...trip,
    ...normalizeRepairPatch(patch),
    updated_at: timestamp,
    version: Number(trip.version) + 1,
  };

  return {
    event: {
      action: "admin_repaired",
      actor_role: "admin",
      after_state: snapshotTrip(next),
      before_state: before,
      reason: String(reason).trim(),
    },
    trip: next,
  };
}

function normalizeRepairPatch(patch) {
  const normalized = {};
  const allowedFields = new Set([
    "status",
    "departed_at",
    "arrived_at",
    "admin_activated_at",
    "ended_at",
    "canceled_at",
  ]);
  for (const [key, value] of Object.entries(patch || {})) {
    if (!allowedFields.has(key)) continue;
    if (key === "status") {
      if (!TRIP_STATUSES.includes(value)) {
        throw new TripStateError("invalid_status", "Repair status is not a valid trip status.");
      }
      normalized[key] = value;
      continue;
    }
    normalized[key] = value || null;
  }
  if (Object.keys(normalized).length === 0) {
    throw new TripStateError("empty_repair", "Repair requires at least one changed field.");
  }
  return normalized;
}

function isTripStateError(error) {
  return error instanceof TripStateError;
}

module.exports = {
  TRIP_STATUSES,
  TripStateError,
  buildTransition,
  isTripStateError,
  repairTrip,
  snapshotTrip,
};
