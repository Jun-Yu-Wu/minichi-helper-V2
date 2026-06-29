const { createClient } = require("@supabase/supabase-js");
const { Client } = require("pg");

const database = require("../src/server/database");
const { authServerConfig, databaseConfig } = require("../src/server/config");
const service = require("../src/server/helper-app-service");

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64",
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function helperSession(payload) {
  const supabase = createClient(authServerConfig().url, authServerConfig().secretKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
  const { data, error } = await supabase.auth.signInWithPassword({
    email: payload.helper.email,
    password: payload.helper.password,
  });
  if (error) throw error;
  return data.session;
}

async function uploadThroughPresign(payload, evidenceType, settlementId) {
  const session = await helperSession(payload);
  const appBaseUrl = process.env.ACCEPTANCE_APP_BASE_URL || "http://127.0.0.1:4300";
  const response = await fetch(`${appBaseUrl}/api/uploads/presign`, {
    body: JSON.stringify({
      clientPhotoId: `slice5-ui-${evidenceType}-${Date.now()}`,
      contentType: "image/png",
      evidenceType,
      fileName: `${evidenceType}.png`,
      settlementId,
      uploadPurpose: "settlement_evidence",
    }),
    headers: {
      "content-type": "application/json",
      cookie: [
        `minichi_helper_access=${session.access_token}`,
        `minichi_helper_refresh=${session.refresh_token}`,
      ].join("; "),
    },
    method: "POST",
  });
  const body = await response.json();
  assert(response.ok, `Settlement presign failed: ${JSON.stringify(body)}`);

  const preflight = await fetch(body.uploadUrl, {
    headers: {
      "access-control-request-headers": "content-type",
      "access-control-request-method": "PUT",
      origin: appBaseUrl,
    },
    method: "OPTIONS",
  });
  const allowOrigin = preflight.headers.get("access-control-allow-origin") || "";
  const allowMethods = preflight.headers.get("access-control-allow-methods") || "";
  const allowHeaders = preflight.headers.get("access-control-allow-headers") || "";
  assert(preflight.ok, `R2 CORS preflight failed: ${preflight.status}`);
  assert(
    allowOrigin === "*" || allowOrigin.split(",").map((value) => value.trim()).includes(appBaseUrl),
    `R2 CORS did not allow ${appBaseUrl}.`,
  );
  assert(allowMethods.toUpperCase().includes("PUT"), "R2 CORS did not allow PUT.");
  assert(allowHeaders.toLowerCase().includes("content-type"), "R2 CORS did not allow Content-Type.");

  const upload = await fetch(body.uploadUrl, {
    body: PNG,
    headers: { "content-type": "image/png", origin: appBaseUrl },
    method: "PUT",
  });
  assert(upload.ok, `R2 PUT failed: ${upload.status}`);
  return {
    cors: { allowHeaders, allowMethods, allowOrigin },
    photo: {
      byteSize: PNG.length,
      contentType: "image/png",
      originalFilename: `${evidenceType}.png`,
      storageKey: body.storageKey,
    },
  };
}

async function settlementForTrip(tripId) {
  const client = new Client(databaseConfig());
  await client.connect();
  try {
    const result = await client.query(
      "select * from helper_app.settlements where trip_id = $1",
      [tripId],
    );
    if (!result.rows[0]) throw new Error("Slice 5 UI settlement was not found.");
    return result.rows[0];
  } finally {
    await client.end();
  }
}

async function main() {
  const stage = process.argv[2];
  const payload = JSON.parse(process.argv[3] || "{}");
  const settlement = await settlementForTrip(payload.trip.id);
  const pool = database.getDatabasePool();
  try {
    if (stage === "precheck") {
      const uploaded = await uploadThroughPresign(payload, "daily_receipt", settlement.id);
      const updated = await service.submitSettlementPrecheck(pool, {
        authUserId: payload.helper.userId,
        helperNote: "瀏覽器驗收收據",
        idempotencyKey: `slice5-ui-precheck-${settlement.id}`,
        receipt: uploaded.photo,
        settlementId: settlement.id,
      });
      payload.storageKeys = [...(payload.storageKeys || []), uploaded.photo.storageKey];
      console.log(JSON.stringify({ cors: uploaded.cors, payload, status: updated.status }, null, 2));
      return;
    }
    if (stage === "warehouse") {
      const uploaded = await uploadThroughPresign(payload, "warehouse_proof", settlement.id);
      const updated = await service.submitWarehouseProof(pool, {
        authUserId: payload.helper.userId,
        idempotencyKey: `slice5-ui-warehouse-${settlement.id}`,
        note: "瀏覽器驗收送倉",
        proof: uploaded.photo,
        settlementId: settlement.id,
      });
      payload.storageKeys = [...(payload.storageKeys || []), uploaded.photo.storageKey];
      console.log(JSON.stringify({ cors: uploaded.cors, payload, status: updated.status }, null, 2));
      return;
    }
    throw new Error(`Unknown Slice 5 UI fixture stage: ${stage}`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
