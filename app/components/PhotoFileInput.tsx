"use client";

import { useCallback, useEffect, useRef } from "react";
import type React from "react";

type PhotoFileInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "type"> & {
  onFiles: (files: FileList | null) => void | Promise<void>;
};

/**
 * File pickers can keep a stale native selection after a mobile app switch.
 * Clear before opening and whenever the document returns to the foreground so
 * the same album button remains usable after canceling or backgrounding it.
 */
export function PhotoFileInput({ onFiles, ...props }: PhotoFileInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const resetValue = useCallback(() => {
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  useEffect(() => {
    window.addEventListener("pagehide", resetValue);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") resetValue();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", resetValue);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [resetValue]);

  return (
    <input
      {...props}
      ref={inputRef}
      type="file"
      onClick={resetValue}
      onChange={(event) => {
        const files = event.currentTarget.files;
        void onFiles(files);
        resetValue();
      }}
    />
  );
}
