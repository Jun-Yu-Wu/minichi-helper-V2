"use client";

import { useState } from "react";
import { ImageIcon } from "lucide-react";

import { Button } from "../components/ui/button";

export function AdminPurchasePhotos({
  endpoint,
  photoCount,
}: {
  endpoint: string;
  photoCount: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [photos, setPhotos] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function loadPhotos() {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (photos.length || !photoCount) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(endpoint, { headers: { accept: "application/json" } });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "無法載入採買照片。");
      setPhotos(body.task?.photos || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "無法載入採買照片。");
    } finally {
      setLoading(false);
    }
  }

  if (!photoCount) return null;

  return (
    <div className="mt-3 grid gap-2">
      <Button className="w-fit" size="sm" type="button" variant="outline" onClick={loadPhotos}>
        <ImageIcon className="mr-2 size-4" />
        {expanded ? "收合照片" : `查看照片 ${photoCount}`}
      </Button>
      {expanded ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {loading ? (
            <span className="col-span-full rounded-md border bg-muted px-3 py-2 text-sm text-muted-foreground">載入照片中...</span>
          ) : error ? (
            <span className="col-span-full rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</span>
          ) : (
            photos.map((photo) => (
              <a href={photo.signed_url} key={photo.id} target="_blank" rel="noreferrer">
                <img
                  alt={photo.photo_role}
                  className="aspect-square w-full rounded-md object-cover"
                  loading="lazy"
                  src={photo.signed_url}
                />
              </a>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
