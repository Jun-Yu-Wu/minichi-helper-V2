"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type CacheEntry<T> = {
  data: T;
  updatedAt: number;
};

type ResourceFetcher<T> = (signal: AbortSignal) => Promise<T>;

type UseStaleResourceOptions<T> = {
  enabled?: boolean;
  fetcher: ResourceFetcher<T>;
  initialData?: T;
  key: string;
  refreshIntervalMs?: number;
  staleTimeMs?: number;
};

type UseStaleResourceResult<T> = {
  data: T | undefined;
  error: string;
  isLoading: boolean;
  isRefreshing: boolean;
  refresh: () => Promise<T | undefined>;
  setData: (updater: T | ((current: T | undefined) => T)) => void;
};

const resourceCache = new Map<string, CacheEntry<unknown>>();
const inFlightRequests = new Map<string, Promise<unknown>>();

export function clearClientResourceCache() {
  resourceCache.clear();
  inFlightRequests.clear();
}

function getCached<T>(key: string) {
  return resourceCache.get(key) as CacheEntry<T> | undefined;
}

function setCached<T>(key: string, data: T) {
  resourceCache.set(key, { data, updatedAt: Date.now() });
}

async function fetchResource<T>(key: string, fetcher: ResourceFetcher<T>) {
  const existing = inFlightRequests.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const controller = new AbortController();
  const request = fetcher(controller.signal)
    .then((data) => {
      setCached(key, data);
      return data;
    })
    .finally(() => {
      inFlightRequests.delete(key);
    });
  inFlightRequests.set(key, request);
  return request;
}

export function useStaleResource<T>({
  enabled = true,
  fetcher,
  initialData,
  key,
  refreshIntervalMs = 0,
  staleTimeMs = 5_000,
}: UseStaleResourceOptions<T>): UseStaleResourceResult<T> {
  const initialEntry = getCached<T>(key);
  const [state, setState] = useState<{
    data: T | undefined;
    error: string;
    isLoading: boolean;
    isRefreshing: boolean;
    key: string;
  }>(() => ({
    data: initialEntry?.data ?? initialData,
    error: "",
    isLoading: !initialEntry && initialData === undefined,
    isRefreshing: false,
    key,
  }));
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const refresh = useCallback(async () => {
    if (!enabled) return undefined;

    const cached = getCached<T>(key);
    setState((current) => ({
      ...current,
      data: cached?.data ?? (current.key === key ? current.data : undefined),
      error: "",
      isLoading: !cached && current.key !== key && current.data === undefined,
      isRefreshing: Boolean(cached || current.data),
      key,
    }));

    try {
      const next = await fetchResource(key, (signal) => fetcherRef.current(signal));
      setState((current) => ({
        ...current,
        data: next,
        error: "",
        isLoading: false,
        isRefreshing: false,
        key,
      }));
      return next;
    } catch (error) {
      if ((error as { name?: string })?.name === "AbortError") return undefined;
      setState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "資料載入失敗。",
        isLoading: false,
        isRefreshing: false,
        key,
      }));
      return undefined;
    }
  }, [enabled, key]);

  useEffect(() => {
    if (!enabled) return undefined;

    const cached = getCached<T>(key);
    if (!cached && initialData !== undefined) setCached(key, initialData);
    setState((current) => ({
      ...current,
      data: cached?.data ?? initialData,
      isLoading: !cached && initialData === undefined,
      isRefreshing: false,
      key,
    }));

    const shouldRefresh = !cached || Date.now() - cached.updatedAt >= staleTimeMs;
    if (shouldRefresh) void refresh();

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const latest = getCached<T>(key);
      if (!latest || Date.now() - latest.updatedAt >= staleTimeMs) void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);

    const interval = refreshIntervalMs > 0
      ? window.setInterval(onVisible, refreshIntervalMs)
      : undefined;
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      if (interval) window.clearInterval(interval);
    };
  }, [enabled, initialData, key, refresh, refreshIntervalMs, staleTimeMs]);

  const setData = useCallback(
    (updater: T | ((current: T | undefined) => T)) => {
      setState((current) => {
        const next = typeof updater === "function"
          ? (updater as (current: T | undefined) => T)(current.data)
          : updater;
        setCached(key, next);
        return {
          ...current,
          data: next,
          error: "",
          key,
        };
      });
    },
    [key],
  );

  return {
    data: state.key === key ? state.data : getCached<T>(key)?.data ?? initialData,
    error: state.key === key ? state.error : "",
    isLoading: state.key === key ? state.isLoading : false,
    isRefreshing: state.key === key ? state.isRefreshing : false,
    refresh,
    setData,
  };
}
