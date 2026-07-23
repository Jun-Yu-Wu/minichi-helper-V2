"use client";

import {
  ArrowUpRight,
  Check,
  Circle,
  Download,
  Eraser,
  Highlighter,
  Loader2,
  Minus,
  Palette,
  Pencil,
  Redo2,
  RotateCcw,
  Share2,
  Square,
  Trash2,
  Type,
  Undo2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cn } from "../../src/lib/utils";

export type EditablePhoto = {
  id?: string;
  storage_key?: string | null;
  signed_url: string;
  original_filename?: string | null;
  content_type?: string | null;
};

type Tool = "select" | "text" | "pen" | "highlighter" | "line" | "arrow" | "rectangle" | "ellipse" | "eraser";
type Point = { x: number; y: number };
type Annotation = {
  color: string;
  end?: Point;
  points?: Point[];
  start?: Point;
  text?: string;
  type: Exclude<Tool, "select">;
  width: number;
};
type TextDraft = { editingIndex: number | null; x: number; y: number; value: string };
type AnnotationDrag = {
  before: Annotation[];
  index: number;
  moved: boolean;
  pointerId: number;
  start: Point;
};
type GestureState = {
  distance: number;
  focal: Point;
  scale: number;
};

const COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#2563eb", "#9333ea", "#ffffff", "#111827"];
const DEFAULT_WIDTH = 19;
const sourcePhotoCache = new Map<string, Promise<string>>();
const SOURCE_CACHE_LIMIT = 8;

function preloadPhotoSource(storageKey: string) {
  if (!storageKey) return Promise.resolve("");
  const cached = sourcePhotoCache.get(storageKey);
  if (cached) return cached;
  const request = fetch(
    `/api/media/photo-annotations/source?storageKey=${encodeURIComponent(storageKey)}`,
    { cache: "no-store" },
  )
    .then(async (response) => {
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "原始照片無法載入編輯器。");
      }
      return URL.createObjectURL(await response.blob());
    })
    .catch((error) => {
      sourcePhotoCache.delete(storageKey);
      throw error;
    });
  sourcePhotoCache.set(storageKey, request);
  while (sourcePhotoCache.size > SOURCE_CACHE_LIMIT) {
    const oldestKey = sourcePhotoCache.keys().next().value;
    if (!oldestKey || oldestKey === storageKey) break;
    const oldestRequest = sourcePhotoCache.get(oldestKey);
    sourcePhotoCache.delete(oldestKey);
    void oldestRequest?.then((url) => URL.revokeObjectURL(url)).catch(() => {});
  }
  return request;
}

export function PhotoLightbox({
  alt,
  onClose,
  photo: initialPhoto,
}: {
  alt: string;
  onClose: () => void;
  photo: EditablePhoto;
}) {
  const [photo, setPhoto] = useState(initialPhoto);
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setPhoto(initialPhoto);
  }, [initialPhoto]);

  const download = useCallback(async () => {
    const nav = navigator as Navigator & {
      canShare?: (data: ShareData) => boolean;
      share?: (data: ShareData) => Promise<void>;
    };
    if (nav.share) {
      try {
        const response = await fetch(photo.signed_url);
        const blob = await response.blob();
        const file = new File([blob], photo.original_filename || "minichi-photo.jpg", {
          type: blob.type || photo.content_type || "image/jpeg",
        });
        if (nav.canShare?.({ files: [file] })) {
          await nav.share({ files: [file], title: "儲存 MINICHI 照片" });
          setMessage("已開啟手機系統選單，可選擇儲存到照片或分享至 LINE。");
          return;
        }
      } catch (error) {
        if ((error as DOMException)?.name === "AbortError") return;
      }
    }
    const link = document.createElement("a");
    link.href = photo.signed_url;
    link.download = photo.original_filename || "minichi-photo.jpg";
    link.rel = "noreferrer";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setMessage("已送出儲存。若手機沒有直接存入圖庫，請從系統分享選單選擇儲存圖片。");
  }, [photo]);

  const share = useCallback(async () => {
    const nav = navigator as Navigator & {
      canShare?: (data: ShareData) => boolean;
      share?: (data: ShareData) => Promise<void>;
    };
    try {
      if (nav.share) {
        const response = await fetch(photo.signed_url);
        const blob = await response.blob();
        const file = new File([blob], photo.original_filename || "minichi-photo.jpg", {
          type: blob.type || photo.content_type || "image/jpeg",
        });
        if (nav.canShare?.({ files: [file] })) {
          await nav.share({ files: [file], title: "MINICHI 照片" });
          return;
        }
        await nav.share({ text: photo.signed_url, title: "MINICHI 照片" });
        return;
      }
      await navigator.clipboard?.writeText(photo.signed_url);
      setMessage("已複製照片分享連結。");
    } catch (error) {
      if ((error as DOMException)?.name === "AbortError") return;
      await navigator.clipboard?.writeText(photo.signed_url);
      setMessage("照片分享被瀏覽器阻擋，已複製暫時分享連結。");
    }
  }, [photo]);

  return (
    <div className="fixed inset-0 z-50 bg-black text-white" role="dialog" aria-modal="true" aria-label="照片檢視器">
      {editing ? (
        <PhotoAnnotationEditor
          alt={alt}
          fileName={photo.original_filename || "minichi-photo.jpg"}
          imageUrl={photo.signed_url}
          sourceStorageKey={photo.storage_key || ""}
          onCancel={() => setEditing(false)}
          onSaved={(savedPhoto) => {
            setPhoto(savedPhoto);
            setEditing(false);
            setMessage("編輯版本已保存；原始照片保持不變。");
          }}
        />
      ) : (
        <div className="flex h-full flex-col">
          <div className="flex h-14 shrink-0 items-center justify-between px-3">
            <button aria-label="關閉照片檢視器" className="grid size-10 place-items-center rounded-full hover:bg-white/10" onClick={onClose} type="button">
              <X className="size-6" />
            </button>
            <p className="max-w-[55%] truncate text-sm font-medium">照片</p>
            <button aria-label="編輯照片" className="grid size-10 place-items-center rounded-full hover:bg-white/10" onClick={() => setEditing(true)} onPointerDown={() => void preloadPhotoSource(photo.storage_key || "").catch(() => {})} type="button">
              <Pencil className="size-5" />
            </button>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center px-3 py-4">
            <img alt={alt} className="max-h-full max-w-full object-contain" onError={() => setMessage("原照片目前無法顯示，請重新整理後再試。")} src={photo.signed_url} />
          </div>
          <div className="flex shrink-0 items-center justify-center gap-8 border-t border-white/10 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
            <button aria-label="儲存照片" className="grid size-11 place-items-center rounded-full text-white/80 hover:bg-white/10" onClick={() => void download()} type="button">
              <Download className="size-5" />
            </button>
            <button aria-label="分享照片" className="grid size-11 place-items-center rounded-full text-white/80 hover:bg-white/10" onClick={() => void share()} type="button">
              <Share2 className="size-5" />
            </button>
            <button aria-label="編輯照片" className="grid size-11 place-items-center rounded-full text-white/80 hover:bg-white/10" onClick={() => setEditing(true)} onPointerDown={() => void preloadPhotoSource(photo.storage_key || "").catch(() => {})} type="button">
              <Pencil className="size-5" />
            </button>
          </div>
        </div>
      )}
      {message ? <p aria-live="polite" className="mx-auto mt-3 max-w-xl text-center text-sm text-white/80" role="status">{message}</p> : null}
    </div>
  );
}

export function PhotoViewerTrigger({
  alt,
  className,
  photo,
  onClick,
}: {
  alt: string;
  className?: string;
  onClick?: () => void;
  photo: EditablePhoto;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className={cn("block w-full overflow-hidden rounded-md", className)}
        onClick={() => {
          onClick?.();
          setOpen(true);
        }}
        type="button"
      >
        <img alt={alt} className="size-full object-cover" loading="lazy" src={photo.signed_url} />
      </button>
      {open ? <PhotoLightbox alt={alt} onClose={() => setOpen(false)} photo={photo} /> : null}
    </>
  );
}

function PhotoAnnotationEditor({
  alt,
  fileName,
  imageUrl,
  onCancel,
  onSaved,
  sourceStorageKey,
}: {
  alt: string;
  fileName: string;
  imageUrl: string;
  onCancel: () => void;
  onSaved: (photo: EditablePhoto) => void;
  sourceStorageKey: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [canvasSize, setCanvasSize] = useState({ height: 0, width: 0 });
  const [tool, setTool] = useState<Tool | null>(null);
  const [color, setColor] = useState(COLORS[0]);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [future, setFuture] = useState<Annotation[][]>([]);
  const [draft, setDraft] = useState<Annotation | null>(null);
  const [textDraft, setTextDraft] = useState<TextDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [viewport, setViewport] = useState({ scale: 1, x: 0, y: 0 });
  const [selectedAnnotationIndex, setSelectedAnnotationIndex] = useState<number | null>(null);
  const [frameSize, setFrameSize] = useState({ height: 0, width: 0 });
  const stageRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const pointersRef = useRef(new Map<number, Point>());
  const gestureRef = useRef<GestureState | null>(null);
  const annotationDragRef = useRef<AnnotationDrag | null>(null);
  const textSizeBeforeRef = useRef<Annotation[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const image = new Image();
    let proxyAttempted = false;
    const showLoadError = (caught?: unknown) => {
      if (cancelled) return;
      setError(caught instanceof Error ? caught.message : "原始照片無法載入編輯器，請重新開啟照片後再試。");
      setLoading(false);
    };
    const loadProxySource = () => {
      if (!sourceStorageKey || proxyAttempted) {
        showLoadError();
        return;
      }
      proxyAttempted = true;
      void preloadPhotoSource(sourceStorageKey)
        .then((url) => {
          if (cancelled) return;
          image.onload = handleLoad;
          image.onerror = () => showLoadError();
          image.src = url;
        })
        .catch((caught) => showLoadError(caught));
    };
    const handleLoad = () => {
      if (cancelled) return;
      imageRef.current = image;
      setCanvasSize({ height: image.naturalHeight, width: image.naturalWidth });
      setLoading(false);
    };
    image.onload = () => {
      handleLoad();
    };
    image.onerror = () => {
      loadProxySource();
    };
    async function loadImage() {
      try {
        if (imageUrl) {
          image.crossOrigin = "anonymous";
          image.src = imageUrl;
          return;
        }
        loadProxySource();
      } catch (caught) {
        showLoadError(caught);
      }
    }
    void loadImage();
    return () => {
      cancelled = true;
      image.onload = null;
      image.onerror = null;
    };
  }, [imageUrl, sourceStorageKey]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !canvasSize.width || !canvasSize.height) return;
    const updateFrameSize = () => {
      const ratio = canvasSize.width / canvasSize.height;
      const maxWidth = stage.clientWidth;
      const maxHeight = stage.clientHeight;
      if (!maxWidth || !maxHeight) return;
      const width = Math.min(maxWidth, maxHeight * ratio);
      setFrameSize({ height: width / ratio, width });
    };
    updateFrameSize();
    const observer = new ResizeObserver(updateFrameSize);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [canvasSize]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image || !canvasSize.width || !canvasSize.height) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    canvas.width = canvasSize.width;
    canvas.height = canvasSize.height;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    [...annotations, ...(draft ? [draft] : [])].forEach((annotation) => drawAnnotation(context, annotation));
  }, [annotations, canvasSize, draft]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  const pushAnnotation = useCallback((annotation: Annotation) => {
    setAnnotations((current) => [...current, annotation]);
    setFuture([]);
  }, []);

  function pointFromEvent(event: React.PointerEvent<HTMLCanvasElement>): Point {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function currentGesture() {
    const points = [...pointersRef.current.values()];
    if (points.length < 2) return null;
    const [first, second] = points;
    return {
      center: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 },
      distance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
    };
  }

  function annotationIndexAt(point: Point) {
    for (let index = annotations.length - 1; index >= 0; index -= 1) {
      const annotation = annotations[index];
      if (annotationHit(annotation, point, Math.max(18, annotation.width * 3))) return index;
    }
    return -1;
  }

  function beginTextEdit(index: number) {
    const annotation = annotations[index];
    if (!annotation || annotation.type !== "text" || !annotation.start) return;
    setSelectedAnnotationIndex(index);
    setWidth(annotation.width);
    setTextDraft({
      editingIndex: index,
      value: annotation.text || "",
      x: annotation.start.x,
      y: annotation.start.y,
    });
  }

  function finishAnnotationDrag() {
    const drag = annotationDragRef.current;
    if (!drag) return;
    if (drag.moved) setFuture([drag.before]);
    annotationDragRef.current = null;
  }

  function pointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (loading || saving) return;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture(event.pointerId);
    if (pointersRef.current.size >= 2) {
      finishAnnotationDrag();
      const gesture = currentGesture();
      const frame = frameRef.current;
      if (gesture && frame) {
        const frameRect = frame.getBoundingClientRect();
        const frameCenter = {
          x: frameRect.left + frameRect.width / 2,
          y: frameRect.top + frameRect.height / 2,
        };
        gestureRef.current = {
          distance: gesture.distance,
          focal: {
            x: (gesture.center.x - frameCenter.x - viewport.x) / viewport.scale,
            y: (gesture.center.y - frameCenter.y - viewport.y) / viewport.scale,
          },
          scale: viewport.scale,
        };
      }
      setDraft(null);
      setTextDraft(null);
      return;
    }
    const point = pointFromEvent(event);
    if (tool === "text") {
      const existingIndex = annotationIndexAt(point);
      if (existingIndex >= 0 && annotations[existingIndex]?.type === "text") {
        beginTextEdit(existingIndex);
      } else {
        setTextDraft({ ...point, editingIndex: null, value: "" });
      }
      return;
    }
    if (tool === "eraser") {
      eraseAt(point);
      return;
    }
    if (!tool) {
      const index = annotationIndexAt(point);
      if (index >= 0) {
        setSelectedAnnotationIndex(index);
        if (annotations[index].type === "text") setWidth(annotations[index].width);
        annotationDragRef.current = {
          before: annotations,
          index,
          moved: false,
          pointerId: event.pointerId,
          start: point,
        };
      }
      return;
    }
    const type = tool === "select" ? "pen" : tool;
    const annotation: Annotation = type === "pen" || type === "highlighter"
      ? { color, points: [point], type, width }
      : { color, end: point, start: point, type, width };
    setDraft(annotation);
  }

  function pointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (pointersRef.current.has(event.pointerId)) {
      pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }
    if (pointersRef.current.size >= 2 && gestureRef.current) {
      const gesture = currentGesture();
      if (!gesture) return;
      const initial = gestureRef.current;
      const frame = frameRef.current;
      if (!frame) return;
      const frameRect = frame.getBoundingClientRect();
      const frameCenter = {
        x: frameRect.left + frameRect.width / 2,
        y: frameRect.top + frameRect.height / 2,
      };
      const scale = clamp(initial.scale * (gesture.distance / initial.distance), 1, 4);
      const nextPan = {
        x: gesture.center.x - frameCenter.x - initial.focal.x * scale,
        y: gesture.center.y - frameCenter.y - initial.focal.y * scale,
      };
      const maxPanX = Math.max(0, (frameRect.width * (scale - 1)) / 2);
      const maxPanY = Math.max(0, (frameRect.height * (scale - 1)) / 2);
      setViewport({
        scale,
        x: clamp(nextPan.x, -maxPanX, maxPanX),
        y: clamp(nextPan.y, -maxPanY, maxPanY),
      });
      return;
    }
    const annotationDrag = annotationDragRef.current;
    if (annotationDrag && annotationDrag.pointerId === event.pointerId) {
      const point = pointFromEvent(event);
      const delta = { x: point.x - annotationDrag.start.x, y: point.y - annotationDrag.start.y };
      if (Math.abs(delta.x) > 0.5 || Math.abs(delta.y) > 0.5) annotationDrag.moved = true;
      const original = annotationDrag.before[annotationDrag.index];
      if (original) {
        setAnnotations((current) => current.map((annotation, index) => index === annotationDrag.index ? moveAnnotation(original, delta) : annotation));
      }
      return;
    }
    if (tool === "eraser") {
      eraseAt(pointFromEvent(event));
      return;
    }
    if (!draft) return;
    const point = pointFromEvent(event);
    setDraft((current) => {
      if (!current) return current;
      if (current.type === "pen" || current.type === "highlighter") {
        return { ...current, points: [...(current.points || []), point] };
      }
      return { ...current, end: point };
    });
  }

  function pointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) gestureRef.current = null;
    const drag = annotationDragRef.current;
    const shouldEditText = drag?.pointerId === event.pointerId
      && !drag.moved
      && drag.before[drag.index]?.type === "text";
    if (drag?.pointerId === event.pointerId) finishAnnotationDrag();
    if (shouldEditText) beginTextEdit(drag.index);
    if (!draft) return;
    if (draft.type === "pen" || draft.type === "highlighter" ? (draft.points?.length || 0) > 1 : true) {
      pushAnnotation(draft);
    }
    setDraft(null);
  }

  function eraseAt(point: Point) {
    const tolerance = Math.max(18, width * 3);
    setAnnotations((current) => {
      const next = current.filter((annotation) => !annotationHit(annotation, point, tolerance));
      if (next.length === current.length) return current;
      setFuture((items) => [...items, current]);
      return next;
    });
  }

  function resetViewport() {
    setViewport({ scale: 1, x: 0, y: 0 });
  }

  function commitText() {
    if (!textDraft?.value.trim()) {
      setTextDraft(null);
      return;
    }
    if (textDraft.editingIndex !== null) {
      const editingIndex = textDraft.editingIndex;
      const before = annotations;
      setAnnotations((current) => current.map((annotation, index) => index === editingIndex && annotation.type === "text"
        ? { ...annotation, text: textDraft.value.trim(), width }
        : annotation));
      setFuture([before]);
    } else {
      pushAnnotation({ color, start: { x: textDraft.x, y: textDraft.y }, text: textDraft.value.trim(), type: "text", width });
    }
    setTextDraft(null);
  }

  function updateWidth(value: number) {
    setWidth(value);
    const index = selectedAnnotationIndex;
    if (index === null || annotations[index]?.type !== "text") return;
    if (!textSizeBeforeRef.current) textSizeBeforeRef.current = annotations;
    setAnnotations((current) => current.map((annotation, annotationIndex) => annotationIndex === index && annotation.type === "text"
      ? { ...annotation, width: value }
      : annotation));
  }

  function finishTextSizeChange() {
    if (!textSizeBeforeRef.current) return;
    setFuture([textSizeBeforeRef.current]);
    textSizeBeforeRef.current = null;
  }

  function undo() {
    setAnnotations((current) => {
      if (!current.length) return current;
      setFuture((items) => [...items, current]);
      return current.slice(0, -1);
    });
  }

  function redo() {
    setFuture((current) => {
      const next = current.at(-1);
      if (!next) return current;
      setAnnotations(next);
      return current.slice(0, -1);
    });
  }

  function clearAnnotations() {
    if (!annotations.length) return;
    setFuture((items) => [...items, annotations]);
    setAnnotations([]);
    setSelectedAnnotationIndex(null);
  }

  async function save() {
    if (!sourceStorageKey) {
      setError("這張照片缺少來源識別，暫時無法保存編輯版本。");
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    setSaving(true);
    setError("");
    try {
      const blob = await exportCanvasBlob(canvas, imageRef.current, annotations, canvasSize, viewport);
      const clientPhotoId = crypto.randomUUID();
      const idempotencyKey = crypto.randomUUID();
      const outputFileName = `${fileNameWithoutExtension(fileName)}-annotated.png`;
      const presignResponse = await fetch("/api/media/photo-annotations/presign", {
        body: JSON.stringify({
          byteSize: blob.size,
          clientPhotoId,
          contentType: "image/png",
          fileName: outputFileName,
          sourceStorageKey,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const presign = await presignResponse.json();
      if (!presignResponse.ok) throw new Error(presign.error || "無法建立編輯照片上傳。 ");
      const uploadResponse = await fetch(presign.uploadUrl, {
        body: blob,
        headers: { "content-type": "image/png" },
        method: "PUT",
      });
      if (!uploadResponse.ok) throw new Error("編輯照片上傳失敗，請重試。");
      const commitResponse = await fetch("/api/media/photo-annotations/commit", {
        body: JSON.stringify({
          annotationManifest: {
            version: 1,
            canvas: canvasSize,
            annotations,
            viewport,
          },
          byteSize: blob.size,
          contentType: "image/png",
          idempotencyKey,
          originalFilename: outputFileName,
          sourceStorageKey,
          storageKey: presign.storageKey,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const committed = await commitResponse.json();
      if (!commitResponse.ok) throw new Error(committed.error || "編輯照片保存失敗，請重試。");
      onSaved({
        content_type: committed.media.content_type,
        id: committed.media.id,
        original_filename: committed.media.original_filename,
        signed_url: committed.media.signed_url,
        storage_key: committed.media.storage_key,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "編輯照片保存失敗，請重試。");
    } finally {
      setSaving(false);
    }
  }

  const toolButtons = useMemo(() => [
    ["text", Type, "文字"],
    ["pen", Pencil, "手繪"],
    ["highlighter", Highlighter, "螢光筆"],
    ["line", Minus, "直線"],
    ["arrow", ArrowUpRight, "箭頭"],
    ["rectangle", Square, "框框"],
    ["ellipse", Circle, "圈選"],
    ["eraser", Eraser, "橡皮擦"],
  ] as const, []);

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-black text-white">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-white/10 px-2">
        <button aria-label="取消編輯" className="grid size-11 place-items-center rounded-full text-white hover:bg-white/10" onClick={onCancel} type="button">
          <X className="size-6" />
        </button>
        <div className="flex items-center gap-1">
          <button aria-label="上一動" className="grid size-11 place-items-center rounded-full hover:bg-white/10 disabled:opacity-30" disabled={!annotations.length} onClick={undo} type="button"><Undo2 className="size-5" /></button>
          <button aria-label="重做" className="grid size-11 place-items-center rounded-full hover:bg-white/10 disabled:opacity-30" disabled={!future.length} onClick={redo} type="button"><Redo2 className="size-5" /></button>
        </div>
        <button aria-label="完成並保存編輯版本" className="grid size-11 place-items-center rounded-full text-[#00c300] hover:bg-white/10 disabled:opacity-40" disabled={saving || loading} onClick={() => void save()} type="button">
          <Check className="size-6" />
        </button>
      </header>

      <main className="relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden bg-[#111] px-2 py-3">
        <div className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden w-full" ref={stageRef}>
        <div
          className="relative shrink-0 overflow-hidden border border-white/30 bg-[#090909] will-change-transform"
          ref={frameRef}
          style={{ height: frameSize.height || "100%", width: frameSize.width || "100%" }}
        >
        <div
          className="absolute inset-0 will-change-transform"
          style={{ transform: `translate3d(${viewport.x}px, ${viewport.y}px, 0) scale(${viewport.scale})` }}
        >
          {loading ? <div className="absolute inset-0 z-10 grid place-items-center text-sm text-white/80"><Loader2 className="mr-2 size-5 animate-spin" />載入照片中...</div> : null}
          <canvas
            aria-label={alt}
            className={cn("block size-full touch-none", loading ? "opacity-0" : "opacity-100")}
            onPointerDown={pointerDown}
            onPointerMove={pointerMove}
            onPointerUp={pointerUp}
            onPointerCancel={pointerUp}
            ref={canvasRef}
          />
          {textDraft ? (
            <input
              autoFocus
              className="absolute h-11 w-52 max-w-[calc(100vw-2rem)] rounded-md border-2 border-[#00c300] bg-black/80 px-3 text-base text-white outline-none"
              onBlur={commitText}
              onChange={(event) => setTextDraft((current) => current ? { ...current, value: event.target.value } : current)}
              onKeyDown={(event) => {
                if (event.key === "Enter") commitText();
                if (event.key === "Escape") setTextDraft(null);
              }}
              placeholder="輸入文字"
              style={{
                left: `${(textDraft.x / Math.max(canvasSize.width, 1)) * 100}%`,
                top: `${(textDraft.y / Math.max(canvasSize.height, 1)) * 100}%`,
              }}
              value={textDraft.value}
            />
          ) : null}
        </div>
        </div>
        </div>
        {error ? <div className="absolute inset-x-4 top-4 z-20 rounded-xl bg-black/85 p-4 text-center text-sm text-red-300" role="alert">{error}</div> : null}
      </main>

      <footer className="shrink-0 border-t border-white/10 bg-[#171717] pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2">
        <div className="grid grid-cols-8 gap-1 px-2 pb-2">
          {toolButtons.map(([value, Icon, label]) => (
            <button
              aria-label={label}
              className={cn("grid h-10 min-w-0 place-items-center rounded-xl text-white/65", tool === value ? "bg-white/15 text-white" : "hover:bg-white/10")}
              key={value}
              onClick={() => setTool((current) => current === value ? null : value)}
              type="button"
            >
              <Icon className="size-5" />
            </button>
          ))}
        </div>
        <div className="relative flex items-center gap-2 border-t border-white/10 px-2 pt-2">
          <div className="relative shrink-0">
            <button
              aria-expanded={paletteOpen}
              aria-label="開啟色盤"
              className="grid size-10 place-items-center rounded-full border-2 border-white/60 hover:bg-white/10"
              onClick={() => setPaletteOpen((current) => !current)}
              style={{ color }}
              type="button"
            >
              <Palette className="size-5" />
            </button>
            {paletteOpen ? (
              <div className="absolute bottom-12 left-0 z-30 grid w-44 grid-cols-4 gap-3 rounded-2xl border border-white/15 bg-[#242424] p-3 shadow-2xl" role="dialog" aria-label="色盤">
                {COLORS.map((item) => (
                  <button
                    aria-label={`選擇顏色 ${item}`}
                    className={cn("size-8 rounded-full border-2", color === item ? "border-white ring-2 ring-white/40" : "border-white/30")}
                    key={item}
                    onClick={() => {
                      setColor(item);
                      setPaletteOpen(false);
                    }}
                    style={{ backgroundColor: item }}
                    type="button"
                  />
                ))}
              </div>
            ) : null}
          </div>
          <input
            aria-label="調整線條粗細"
            className="h-10 min-w-0 flex-1 accent-white"
            max="32"
            min="1"
            onBlur={finishTextSizeChange}
            onChange={(event) => updateWidth(Number(event.target.value))}
            onPointerCancel={finishTextSizeChange}
            onPointerUp={finishTextSizeChange}
            type="range"
            value={width}
          />
          <button aria-label="移動與縮放重置" className="grid size-10 shrink-0 place-items-center rounded-full hover:bg-white/10" onClick={resetViewport} type="button"><RotateCcw className="size-5" /></button>
          <button aria-label="清除目前標註" className="grid size-10 shrink-0 place-items-center rounded-full hover:bg-white/10 disabled:opacity-30" disabled={!annotations.length} onClick={clearAnnotations} type="button"><Trash2 className="size-5" /></button>
        </div>
      </footer>
    </div>
  );
}

function drawAnnotation(context: CanvasRenderingContext2D, annotation: Annotation) {
  context.save();
  context.strokeStyle = annotation.color;
  context.fillStyle = annotation.color;
  context.lineWidth = annotation.width;
  context.lineCap = "round";
  context.lineJoin = "round";
  if (annotation.type === "highlighter") context.globalAlpha = 0.35;
  const start = annotation.start;
  const end = annotation.end;
  if (annotation.type === "pen" || annotation.type === "highlighter") {
    const points = annotation.points || [];
    if (points.length > 1) {
      context.beginPath();
      context.moveTo(points[0].x, points[0].y);
      points.slice(1).forEach((point) => context.lineTo(point.x, point.y));
      context.stroke();
    }
  } else if (annotation.type === "text" && start) {
    context.font = `${Math.max(22, annotation.width * 7)}px sans-serif`;
    context.fillText(annotation.text || "", start.x, start.y);
  } else if (start && end) {
    if (annotation.type === "rectangle") {
      context.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y);
    } else if (annotation.type === "ellipse") {
      context.beginPath();
      context.ellipse((start.x + end.x) / 2, (start.y + end.y) / 2, Math.abs(end.x - start.x) / 2, Math.abs(end.y - start.y) / 2, 0, 0, Math.PI * 2);
      context.stroke();
    } else {
      context.beginPath();
      context.moveTo(start.x, start.y);
      context.lineTo(end.x, end.y);
      context.stroke();
      if (annotation.type === "arrow") {
        const angle = Math.atan2(end.y - start.y, end.x - start.x);
        const size = Math.max(12, annotation.width * 4);
        context.beginPath();
        context.moveTo(end.x, end.y);
        context.lineTo(end.x - size * Math.cos(angle - Math.PI / 6), end.y - size * Math.sin(angle - Math.PI / 6));
        context.moveTo(end.x, end.y);
        context.lineTo(end.x - size * Math.cos(angle + Math.PI / 6), end.y - size * Math.sin(angle + Math.PI / 6));
        context.stroke();
      }
    }
  }
  context.restore();
}

function moveAnnotation(annotation: Annotation, delta: Point): Annotation {
  if ((annotation.type === "pen" || annotation.type === "highlighter") && annotation.points) {
    return {
      ...annotation,
      points: annotation.points.map((point) => ({ x: point.x + delta.x, y: point.y + delta.y })),
    };
  }
  return {
    ...annotation,
    end: annotation.end ? { x: annotation.end.x + delta.x, y: annotation.end.y + delta.y } : undefined,
    start: annotation.start ? { x: annotation.start.x + delta.x, y: annotation.start.y + delta.y } : undefined,
  };
}

function annotationHit(annotation: Annotation, point: Point, tolerance: number) {
  if (annotation.type === "text" && annotation.start) {
    const fontSize = Math.max(22, annotation.width * 7);
    const textWidth = Math.max(fontSize, (annotation.text?.length || 1) * fontSize * 0.6);
    return point.x >= annotation.start.x - tolerance
      && point.x <= annotation.start.x + textWidth + tolerance
      && point.y >= annotation.start.y - fontSize - tolerance
      && point.y <= annotation.start.y + tolerance;
  }
  if ((annotation.type === "pen" || annotation.type === "highlighter") && annotation.points) {
    return annotation.points.some((item) => Math.hypot(point.x - item.x, point.y - item.y) <= tolerance);
  }
  if (!annotation.start || !annotation.end) return false;
  const left = Math.min(annotation.start.x, annotation.end.x) - tolerance;
  const right = Math.max(annotation.start.x, annotation.end.x) + tolerance;
  const top = Math.min(annotation.start.y, annotation.end.y) - tolerance;
  const bottom = Math.max(annotation.start.y, annotation.end.y) + tolerance;
  return point.x >= left && point.x <= right && point.y >= top && point.y <= bottom;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("無法產生編輯照片。")), "image/png");
  });
}

function exportCanvasBlob(
  sourceCanvas: HTMLCanvasElement,
  image: HTMLImageElement | null,
  annotations: Annotation[],
  canvasSize: { height: number; width: number },
  viewport: { scale: number; x: number; y: number },
) {
  if (!image || !canvasSize.width || !canvasSize.height) return Promise.reject(new Error("照片尚未載入完成。"));
  const output = document.createElement("canvas");
  output.width = canvasSize.width;
  output.height = canvasSize.height;
  const context = output.getContext("2d");
  if (!context) return Promise.reject(new Error("無法建立編輯照片畫布。"));

  const displayedWidthWithoutTransform = sourceCanvas.getBoundingClientRect().width / Math.max(viewport.scale, 1);
  const canvasPixelRatio = displayedWidthWithoutTransform / canvasSize.width;
  const panX = viewport.x / Math.max(canvasPixelRatio, 0.001);
  const panY = viewport.y / Math.max(canvasPixelRatio, 0.001);

  context.save();
  context.beginPath();
  context.rect(0, 0, output.width, output.height);
  context.clip();
  context.translate(canvasSize.width / 2 + panX, canvasSize.height / 2 + panY);
  context.scale(viewport.scale, viewport.scale);
  context.translate(-canvasSize.width / 2, -canvasSize.height / 2);
  context.drawImage(image, 0, 0, output.width, output.height);
  annotations.forEach((annotation) => drawAnnotation(context, annotation));
  context.restore();
  return canvasBlob(output);
}

function fileNameWithoutExtension(value: string) {
  return value.replace(/\.[^/.]+$/, "") || "minichi-photo";
}
