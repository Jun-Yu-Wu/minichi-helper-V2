const crypto = require("node:crypto");
const path = require("node:path");

const { r2Config } = require("./config");

const CONTENT_TYPE_EXTENSIONS = {
  "image/gif": ".gif",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

let sdkPromise = null;
const signedGetUrlCache = new Map();
const signedGetUrlRequests = new Map();
const SIGNED_GET_URL_CACHE_MAX = 2000;
const SIGNED_GET_URL_CACHE_MAX_AGE_MS = 60_000;

async function loadSdk() {
  if (!sdkPromise) {
    sdkPromise = Promise.all([
      import("@aws-sdk/client-s3"),
      import("@aws-sdk/s3-request-presigner"),
    ]);
  }
  const [s3, presigner] = await sdkPromise;
  return { ...s3, ...presigner };
}

function signedGetUrlCacheKey(storageKey, expiresIn) {
  return `${storageKey}:${expiresIn}`;
}

function signedGetUrlCacheAge(expiresIn) {
  return Math.max(
    1_000,
    Math.min(SIGNED_GET_URL_CACHE_MAX_AGE_MS, expiresIn * 1_000 - 30_000),
  );
}

function trimSignedGetUrlCache() {
  while (signedGetUrlCache.size > SIGNED_GET_URL_CACHE_MAX) {
    const oldestKey = signedGetUrlCache.keys().next().value;
    if (!oldestKey) break;
    signedGetUrlCache.delete(oldestKey);
  }
}

function createR2ObjectStore(config = r2Config()) {
  let clientPromise = null;

  async function client() {
    if (!clientPromise) {
      clientPromise = loadSdk().then(({ S3Client }) =>
        new S3Client({
          credentials: {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
          },
          endpoint: config.endpoint,
          region: config.region,
        }),
      );
    }
    return clientPromise;
  }

  return {
    buildSitePhotoKey({ contentType, fileName, photoId, tripId }) {
      const extension = extensionFor(contentType, fileName);
      return [
        "helper-app",
        cleanKeyPart(tripId, "unknown-trip"),
        "site-photos",
        `${cleanKeyPart(photoId || crypto.randomUUID(), "photo")}${extension}`,
      ].join("/");
    },

    async signedGetUrl(storageKey, expiresIn = config.signedUrlTtlSeconds) {
      const cacheKey = signedGetUrlCacheKey(storageKey, expiresIn);
      const cached = signedGetUrlCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) return cached.url;
      if (cached) signedGetUrlCache.delete(cacheKey);

      const inFlight = signedGetUrlRequests.get(cacheKey);
      if (inFlight) return inFlight;

      const { GetObjectCommand, getSignedUrl } = await loadSdk();
      const s3 = await client();
      const request = getSignedUrl(
        s3,
        new GetObjectCommand({ Bucket: config.bucket, Key: storageKey }),
        { expiresIn },
      )
        .then((url) => {
          signedGetUrlCache.set(cacheKey, {
            expiresAt: Date.now() + signedGetUrlCacheAge(expiresIn),
            url,
          });
          trimSignedGetUrlCache();
          return url;
        })
        .finally(() => {
          signedGetUrlRequests.delete(cacheKey);
        });
      signedGetUrlRequests.set(cacheKey, request);
      return request;
    },

    async signedPutUrl(storageKey, contentType, expiresIn = config.signedUrlTtlSeconds) {
      const { PutObjectCommand, getSignedUrl } = await loadSdk();
      const s3 = await client();
      return getSignedUrl(
        s3,
        new PutObjectCommand({
          Bucket: config.bucket,
          ContentType: contentType,
          Key: storageKey,
        }),
        { expiresIn },
      );
    },

    async copyObject(sourceKey, destinationKey) {
      const { CopyObjectCommand } = await loadSdk();
      const s3 = await client();
      await s3.send(
        new CopyObjectCommand({
          Bucket: config.bucket,
          CopySource: `${config.bucket}/${sourceKey.split("/").map(encodeURIComponent).join("/")}`,
          Key: destinationKey,
        }),
      );
    },

    async deleteObject(storageKey) {
      const { DeleteObjectCommand } = await loadSdk();
      const s3 = await client();
      await s3.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: storageKey }));
    },

    ttlSeconds: config.signedUrlTtlSeconds,
  };
}

function extensionFor(contentType, fileName = "") {
  return CONTENT_TYPE_EXTENSIONS[contentType] || path.extname(fileName).toLowerCase() || ".jpg";
}

function cleanKeyPart(value, fallback) {
  return String(value || fallback)
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || fallback;
}

module.exports = {
  createR2ObjectStore,
  extensionFor,
};
