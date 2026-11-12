import { useEffect, useState } from "react";
import { formatInteger } from "../data";

interface VisitCounts {
  today: number;
  total: number;
  date: string;
  startedAt: string;
}
let pending: Promise<VisitCounts> | undefined;
let cached: VisitCounts | undefined;
let cachedAt = 0;
function todayInChina() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
function visit() {
  if (cached?.date === todayInChina() && Date.now() - cachedAt < 60000)
    return Promise.resolve(cached);
  if (!pending) {
    pending = fetch("/api/visits", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
    })
      .then(async (response) => {
        if (
          !response.ok ||
          !response.headers.get("content-type")?.includes("application/json")
        )
          throw new Error("Statistics unavailable");
        const data = (await response.json()) as VisitCounts;
        if (
          !Number.isSafeInteger(data.today) ||
          !Number.isSafeInteger(data.total) ||
          data.today < 0 ||
          data.total < data.today ||
          !/^\d{4}-\d{2}-\d{2}$/.test(data.date)
        )
          throw new Error("Invalid statistics");
        cached = data;
        cachedAt = Date.now();
        return data;
      })
      .finally(() => {
        pending = undefined;
      });
  }
  return pending;
}

export function VisitorCounts() {
  const [counts, setCounts] = useState<VisitCounts>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    function update() {
      if (document.visibilityState === "hidden") return;
      void visit()
        .then((data) => {
          if (active) {
            setCounts(data);
            setFailed(false);
          }
        })
        .catch(() => {
          if (active) setFailed(true);
        });
    }
    update();
    document.addEventListener("visibilitychange", update);
    const timer = window.setInterval(update, 60000);
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  return (
    <div
      className="visitor-counts"
      aria-label="访问统计"
      title={`按浏览器去重，今日按北京时间统计${counts ? `，自 ${counts.startedAt} 起累计` : ""}。清除 Cookie 或更换浏览器可能重复计数。`}
    >
      <span>
        今日访问 <strong>{counts ? formatInteger(counts.today) : "—"}</strong>{" "}
        人
      </span>
      <span>
        总访问 <strong>{counts ? formatInteger(counts.total) : "—"}</strong> 人
      </span>
      {failed && <span className="visits-unavailable">统计暂不可用</span>}
    </div>
  );
}
