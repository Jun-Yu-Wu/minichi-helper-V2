const MAX_UPLOAD_DIMENSION = 1800;
const COMPRESS_THRESHOLD_BYTES = 1.5 * 1024 * 1024;
const JPEG_QUALITY = 0.82;

/** Reduce large phone photos before sending them to R2. */
export async function preparePhotoForUpload(file: File): Promise<File> {
  if (
    !file.type.startsWith("image/") ||
    file.type === "image/gif" ||
    (file.size <= COMPRESS_THRESHOLD_BYTES && file.type !== "image/heic" && file.type !== "image/heif")
  ) {
    return file;
  }

  try {
    const bitmap = await decodeImage(file);
    const scale = Math.min(1, MAX_UPLOAD_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    if (scale === 1 && file.size <= COMPRESS_THRESHOLD_BYTES) {
      closeBitmap(bitmap);
      return file;
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      closeBitmap(bitmap);
      return file;
    }
    context.drawImage(bitmap as CanvasImageSource, 0, 0, width, height);
    closeBitmap(bitmap);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
    );
    if (!blob || blob.size >= file.size) return file;

    const filename = file.name.replace(/\.[^.]+$/, "") || "photo";
    return new File([blob], `${filename}.jpg`, {
      lastModified: file.lastModified,
      type: "image/jpeg",
    });
  } catch {
    return file;
  }
}

function closeBitmap(bitmap: ImageBitmap | HTMLImageElement) {
  if ("close" in bitmap && typeof bitmap.close === "function") bitmap.close();
}

async function decodeImage(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") return createImageBitmap(file);
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("圖片無法讀取"));
    };
    image.src = objectUrl;
  });
}
