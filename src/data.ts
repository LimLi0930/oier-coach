import { useEffect, useState } from "react";
import Decimal from "decimal.js";
import type {
  AttributedResult,
  Student,
  Manifest,
  Entity,
  RankedPerson,
  PersonPreviewData,
  CoachReference,
} from "./types";

Decimal.set({ precision: 64 });

const resourceCache = new Map<string, unknown>();
const pendingResources = new Map<string, Promise<unknown>>();

export interface ResourceProgress {
  loaded: number;
  total?: number;
}
const resourceProgress = new Map<string, ResourceProgress>();
const progressListeners = new Map<
  string,
  Set<(progress: ResourceProgress) => void>
>();
const expectedBytes = new Map<string, number>();
const cachePrefix = "oier-coach-directory-";

export function directoryUrl(manifest: Manifest, entity: Entity) {
  return (
    manifest.dataPath +
    (entity === "coaches"
      ? (manifest.coachDirectory ?? manifest.index)
      : (manifest.studentDirectory ?? manifest.studentIndex))
  );
}

function decodeResource(data: unknown): unknown {
  const packed = data as {
    format?: string;
    entity?: Entity;
    fields: string[];
    rows: unknown[][];
    coachReferences?: [string, string, string][];
  };
  if (packed?.format !== "person-directory-v1") return data;
  const references: CoachReference[] = (packed.coachReferences ?? []).map(
    ([id, name, province]) => ({ id, name, province }),
  );
  return packed.rows.map((row) => {
    const person = Object.fromEntries(
      packed.fields.map((field, index) => [field, row[index]]),
    );
    const preview: PersonPreviewData = {};
    if (packed.entity === "coaches") {
      preview.students = (
        person.preview as [string, string, string | null][]
      ).map(([id, name, score]) => ({ id, name, score }));
    } else {
      person.coaches = (person.coaches as number[]).map(
        (index) => references[index],
      );
      preview.guidance = (person.preview as [number, string, number[]][]).map(
        ([schoolYear, province, ids]) => ({
          schoolYear,
          province,
          coaches: ids.map((index) => references[index]),
        }),
      );
    }
    return { ...person, preview } as unknown as RankedPerson;
  });
}

async function directoryCache(url: string): Promise<Cache | undefined> {
  const version =
    /^\/data\/([a-f0-9]{16})\/(coaches|students)-directory\.json$/.exec(
      url,
    )?.[1];
  if (!version || !("caches" in window)) return;
  try {
    return await caches.open(cachePrefix + version);
  } catch {
    return;
  }
}

async function fetchResource(url: string): Promise<unknown> {
  const disk = await directoryCache(url);
  if (disk) {
    try {
      const cached = await disk.match(url);
      if (cached) return decodeResource(await cached.json());
    } catch {
      await disk.delete(url).catch(() => {});
    }
  }
  const response = await fetch(url, {
    cache: url.endsWith("/manifest.json") ? "no-cache" : "default",
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const savedResponse = disk ? response.clone() : undefined;
  let data: unknown;
  if (response.body && url.endsWith("-directory.json")) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const chunks: string[] = [];
    let loaded = 0;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      loaded += chunk.value.byteLength;
      chunks.push(decoder.decode(chunk.value, { stream: true }));
      const progress = { loaded, total: expectedBytes.get(url) };
      resourceProgress.set(url, progress);
      progressListeners.get(url)?.forEach((listener) => listener(progress));
    }
    chunks.push(decoder.decode());
    data = JSON.parse(chunks.join(""));
  } else data = await response.json();
  const decoded = decodeResource(data);
  if (disk && savedResponse) {
    // A quota or privacy restriction must not prevent normal online use.
    void disk
      .put(url, savedResponse)
      .then(async () => {
        const names = (await caches.keys()).filter((name) =>
          name.startsWith(cachePrefix),
        );
        const old = names.filter(
          (name) => name !== cachePrefix + url.split("/")[2],
        );
        await Promise.all(
          old
            .slice(0, Math.max(0, names.length - 3))
            .map((name) => caches.delete(name)),
        );
      })
      .catch(() => {});
  }
  return decoded;
}

export function getResource<T>(url: string): Promise<T> {
  if (resourceCache.has(url))
    return Promise.resolve(resourceCache.get(url) as T);
  let request = pendingResources.get(url);
  if (!request) {
    request = fetchResource(url)
      .then((data) => {
        if (url.endsWith("/manifest.json")) {
          const manifest = data as Manifest;
          for (const [filename, size] of Object.entries(
            manifest.directoryBytes ?? {},
          ))
            expectedBytes.set(manifest.dataPath + filename, size);
        }
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
  const [progress, setProgress] = useState<ResourceProgress>();
  useEffect(() => {
    if (!url) return;
    let active = true;
    setProgress(resourceProgress.get(url));
    const listeners = progressListeners.get(url) ?? new Set();
    listeners.add(setProgress);
    progressListeners.set(url, listeners);
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
      listeners.delete(setProgress);
    };
  }, [url, attempt]);
  const visible =
    state.url === url
      ? state
      : {
          url,
          data: url ? (resourceCache.get(url) as T | undefined) : undefined,
        };
  return {
    ...visible,
    progress: state.url === url ? progress : undefined,
    retry: () => setAttempt((value) => value + 1),
  };
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
