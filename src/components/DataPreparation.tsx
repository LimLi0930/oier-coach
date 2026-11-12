import { useEffect, useState } from "react";
import { directoryUrl, useResource } from "../data";
import type { Manifest, RankedPerson } from "../types";

export function DataPreparation({ manifest }: { manifest: Manifest }) {
  const [started, setStarted] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setStarted(true), 250);
    return () => window.clearTimeout(timer);
  }, []);
  const coaches = useResource<RankedPerson[]>(
    started ? directoryUrl(manifest, "coaches") : null,
  );
  const students = useResource<RankedPerson[]>(
    started ? directoryUrl(manifest, "students") : null,
  );
  const active = coaches.data ? students : coaches;
  if (!started || (coaches.data && students.data)) return null;
  if (active.error)
    return (
      <button className="data-preparation" onClick={active.retry}>
        查询资料准备失败，点击重试
      </button>
    );
  const percent = active.progress?.total
    ? Math.min(
        100,
        Math.floor((active.progress.loaded / active.progress.total) * 100),
      )
    : null;
  return (
    <div className="data-preparation" role="status">
      正在准备{coaches.data ? "学生" : "教练"}查询资料
      {percent !== null ? ` · ${percent}%` : "…"}
    </div>
  );
}
