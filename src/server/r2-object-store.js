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

function createR2ObjectStore(config = r2Config()) {
  async function client() {
    const { S3Client } = await loadSdk();
    return new S3Client({
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      endpoint: config.endpoint,
      region: config.region,
    });
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
      const { GetObjectCommand, getSignedUrl } = await loadSdk();
      const s3 = await client();
      return getSignedUrl(
        s3,
        new GetObjectCommand({ Bucket: config.bucket, Key: storageKey }),
        { expiresIn },
      );
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
