import { useEffect, useState } from "react";
import Decimal from "decimal.js";
import type { AttributedResult, Student } from "./types";

Decimal.set({ precision: 64 });

const resourceCache = new Map<string, unknown>();
const pendingResources = new Map<string, Promise<unknown>>();

export function getResource<T>(url: string): Promise<T> {
  if (resourceCache.has(url))
    return Promise.resolve(resourceCache.get(url) as T);
  let request = pendingResources.get(url);
  if (!request) {
    request = fetch(url, {
      cache: url.endsWith("/manifest.json") ? "no-cache" : "default",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data: unknown = await response.json();
        resourceCache.set(url, data);
        return data;
      })
      .finally(() => pendingResources.delete(url));
    pendingResources.set(url, request);
  }
  return request as Promise<T>;
}

export function useResource<T>(url: string | null) {
  const [state, setState] = useState<{
    url: string | null;
    data?: T;
    error?: string;
  }>({ url: null });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!url) return;
    let active = true;
    setState({ url, data: resourceCache.get(url) as T | undefined });
    getResource<T>(url)
      .then((data) => {
        if (active) setState({ url, data });
      })
      .catch((error: unknown) => {
        if (active)
          setState({
            url,
            error: error instanceof Error ? error.message : "网络异常",
          });
      });
    return () => {
      active = false;
    };
  }, [url, attempt]);
  const visible =
    state.url === url
      ? state
      : {
          url,
          data: url ? (resourceCache.get(url) as T | undefined) : undefined,
        };
  return { ...visible, retry: () => setAttempt((value) => value + 1) };
}

export function formatScore(value: string | Decimal | null): string {
  if (value === null) return "待补充";
  const [integer, fraction] = new Decimal(value).toFixed(2).split(".");
  return `${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction}`;
}

export const formatInteger = (value: number) => value.toLocaleString("zh-CN");
export const rankText = (rank: number | null) =>
  rank === null ? "待补充" : `#${formatInteger(rank)}`;
export const stages = {
  primary: "小学",
  junior: "初中",
  senior: "高中",
  unknown: "学段待核对",
};
export function studentContributions(
  students: Student[],
  results: AttributedResult[],
  year: number,
) {
  const grouped = new Map<string, AttributedResult[]>();
  for (const result of results) {
    if (result.year > year) continue;
    const rows = grouped.get(result.studentId) ?? [];
    rows.push(result);
    grouped.set(result.studentId, rows);
  }
  return students
    .filter((student) => grouped.has(student.id))
    .map((student) => {
      const rows = grouped.get(student.id)!;
      const scored = rows.filter((row) => row.score !== null);
      const score = scored.length
        ? scored.reduce((sum, row) => sum.plus(row.score!), new Decimal(0))
        : null;
      return { ...student, results: rows, score };
    })
    .sort((a, b) => {
      if (a.score === null && b.score !== null) return 1;
      if (b.score === null && a.score !== null) return -1;
      return (
        (b.score?.comparedTo(a.score ?? 0) ?? 0) || a.id.localeCompare(b.id)
      );
    });
}

export function safeExternal(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return ["https:", "http:"].includes(parsed.protocol)
      ? parsed.href
      : undefined;
  } catch {
    return undefined;
  }
}

const configuredRepository = import.meta.env.VITE_GITHUB_REPOSITORY as
  | string
  | undefined;
export const repositoryUrl =
  configuredRepository &&
  /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/.test(configuredRepository)
    ? configuredRepository.replace(/\/$/, "")
    : undefined;
