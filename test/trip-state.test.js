const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildTransition,
  repairTrip,
} = require("../src/domain/trip-state");

function trip(overrides = {}) {
  return {
    id: "trip-1",
    status: "scheduled",
    version: 1,
    departed_at: null,
    arrived_at: null,
    admin_activated_at: null,
    ended_at: null,
    canceled_at: null,
    ...overrides,
  };
}

test("helper departure moves scheduled trip to departed and increments version", () => {
  const result = buildTransition({
    action: "helper_departed",
    actorRole: "helper",
    expectedVersion: 1,
    now: "2026-06-23T02:00:00.000Z",
    trip: trip(),
  });

  assert.equal(result.trip.status, "departed");
  assert.equal(result.trip.version, 2);
  assert.equal(result.trip.departed_at, "2026-06-23T02:00:00.000Z");
  assert.equal(result.event.action, "helper_departed");
  assert.equal(result.event.before_state.status, "scheduled");
  assert.equal(result.event.after_state.status, "departed");
});

test("helper departure can start draft trips", () => {
  const result = buildTransition({
    action: "helper_departed",
    actorRole: "helper",
    expectedVersion: 1,
    now: "2026-06-23T02:00:00.000Z",
    trip: trip({ status: "draft" }),
  });

  assert.equal(result.trip.status, "departed");
  assert.equal(result.event.before_state.status, "draft");
});

test("helper arrival only works after departure", () => {
  assert.throws(
    () =>
      buildTransition({
        action: "helper_arrived",
        actorRole: "helper",
        expectedVersion: 1,
        trip: trip(),
      }),
    /Only departed trips/,
  );

  const result = buildTransition({
    action: "helper_arrived",
    actorRole: "helper",
    expectedVersion: 3,
    now: "2026-06-23T03:00:00.000Z",
    trip: trip({ status: "departed", version: 3 }),
  });

  assert.equal(result.trip.status, "arrived");
  assert.equal(result.trip.arrived_at, "2026-06-23T03:00:00.000Z");
});

test("admin activation only works after arrival", () => {
  assert.throws(
    () =>
      buildTransition({
        action: "admin_activated",
        actorRole: "admin",
        expectedVersion: 1,
        trip: trip({ status: "departed" }),
      }),
    /Only arrived trips/,
  );

  const result = buildTransition({
    action: "admin_activated",
    actorRole: "admin",
    expectedVersion: 4,
    now: "2026-06-23T04:00:00.000Z",
    trip: trip({ status: "arrived", version: 4 }),
  });

  assert.equal(result.trip.status, "active");
  assert.equal(result.trip.admin_activated_at, "2026-06-23T04:00:00.000Z");
});

test("helper end moves in-progress trips to ended", () => {
  for (const status of ["departed", "arrived", "active"]) {
    const result = buildTransition({
      action: "helper_ended",
      actorRole: "helper",
      expectedVersion: 2,
      now: "2026-06-23T05:00:00.000Z",
      trip: trip({ status, version: 2 }),
    });

    assert.equal(result.trip.status, "ended");
    assert.equal(result.trip.ended_at, "2026-06-23T05:00:00.000Z");
    assert.equal(result.event.action, "helper_ended");
  }

  assert.throws(
    () =>
      buildTransition({
        action: "helper_ended",
        actorRole: "helper",
        expectedVersion: 1,
        trip: trip(),
      }),
    /Only in-progress trips/,
  );
});

test("stale expectedVersion is rejected", () => {
  assert.throws(
    () =>
      buildTransition({
        action: "helper_departed",
        actorRole: "helper",
        expectedVersion: 1,
        trip: trip({ version: 2 }),
      }),
    /Trip has changed/,
  );
});

test("admin repair requires a reason and records before after state", () => {
  assert.throws(
    () =>
      repairTrip({
        expectedVersion: 2,
        patch: { status: "scheduled" },
        reason: "",
        trip: trip({ status: "arrived", version: 2 }),
      }),
    /requires a reason/,
  );

  const result = repairTrip({
    expectedVersion: 2,
    patch: { status: "scheduled", arrived_at: "" },
    reason: "Correct accidental arrival",
    trip: trip({ arrived_at: "2026-06-23T03:00:00.000Z", status: "arrived", version: 2 }),
  });

  assert.equal(result.trip.status, "scheduled");
  assert.equal(result.trip.arrived_at, null);
  assert.equal(result.event.action, "admin_repaired");
  assert.equal(result.event.before_state.status, "arrived");
  assert.equal(result.event.after_state.status, "scheduled");
});
