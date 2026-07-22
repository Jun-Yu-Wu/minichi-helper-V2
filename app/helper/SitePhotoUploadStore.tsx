"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export type PhotoUploadStatus = "pending" | "uploading" | "uploaded" | "failed";
export type BatchStatus = "uploading" | "ready" | "submitting" | "completed" | "failed";

export type SelectedPhoto = {
  byteSize: number;
  clientPhotoId: string;
  contentType: string;
  error?: string;
  file: File;
  objectUrl: string;
  originalFilename: string;
  sortOrder: number;
  storageKey?: string;
  uploadError?: string;
  uploadStatus: PhotoUploadStatus;
};

export type LocalBatch = {
  error?: string;
  errorStage?: "submit" | "upload";
  id: string;
  note: string;
  photos: SelectedPhoto[];
  status: BatchStatus;
};

export type SitePhotoUploadSession = {
  batches: LocalBatch[];
  note: string;
  photos: SelectedPhoto[];
};

type SitePhotoUploadStore = {
  sessions: Record<string, SitePhotoUploadSession | undefined>;
  updateSession: (
    tripId: string,
    patch: Partial<SitePhotoUploadSession>,
  ) => void;
};

const SitePhotoUploadStoreContext = createContext<SitePhotoUploadStore | null>(null);

export function SitePhotoUploadProvider({ children }: { children: React.ReactNode }) {
  const [sessions, setSessions] = useState<Record<string, SitePhotoUploadSession | undefined>>({});
  const sessionsRef = useRef(sessions);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(
    () => () => {
      for (const session of Object.values(sessionsRef.current)) {
        if (!session) continue;
        for (const photo of session.photos) URL.revokeObjectURL(photo.objectUrl);
        for (const batch of session.batches) {
          for (const photo of batch.photos) URL.revokeObjectURL(photo.objectUrl);
        }
      }
    },
    [],
  );

  const updateSession = useCallback(
    (tripId: string, patch: Partial<SitePhotoUploadSession>) => {
      setSessions((current) => {
        const previous = current[tripId] || { batches: [], note: "", photos: [] };
        return {
          ...current,
          [tripId]: { ...previous, ...patch },
        };
      });
    },
    [],
  );

  const value = useMemo(
    () => ({ sessions, updateSession }),
    [sessions, updateSession],
  );

  return (
    <SitePhotoUploadStoreContext.Provider value={value}>
      {children}
    </SitePhotoUploadStoreContext.Provider>
  );
}

export function useSitePhotoUploadStore() {
  const store = useContext(SitePhotoUploadStoreContext);
  if (!store) {
    throw new Error("SitePhotoUploadProvider is required around SitePhotoUploader.");
  }
  return store;
}
