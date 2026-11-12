import { directoryUrl } from "../data";
import { PersonLink } from "../components/PersonPreview";
import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { formatInteger, formatScore, rankText, useResource } from "../data";
import type { Entity, Manifest, RankedPerson } from "../types";
import {
  Avatar,
  isStudent,
  LoadState,
  Pagination,
  personPath,
  personProvinces,
  ProvinceSelect,
  RankingTabs,
} from "../components/ui";

export default function RankingsPage({
  entity,
  manifest,
}: {
  entity: Entity;
  manifest: Manifest;
}) {
  const [params, setParams] = useSearchParams();
  const mode = params.get("board") === "peak" ? "peak" : "current";
  const province = params.get("province") ?? "";
  const resource = useResource<RankedPerson[]>(directoryUrl(manifest, entity));
  const filtered = useMemo(() => {
    const rows = (resource.data ?? []).filter(
      (person) => !province || personProvinces(person).includes(province),
    );
    if (mode === "peak")
      rows.sort(
        (a, b) =>
          (a.peakRank ?? Infinity) - (b.peakRank ?? Infinity) ||
          (a.currentRank ?? Infinity) - (b.currentRank ?? Infinity) ||
          a.id.localeCompare(b.id),
      );
    return rows;
  }, [resource.data, province, mode]);
  const page = Math.min(
    Math.max(1, Math.ceil(filtered.length / 30)),
    Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1),
  );
  function update(values: Record<string, string>) {
    const next = new URLSearchParams(params);
    next.delete("page");
    for (const [key, value] of Object.entries(values))
      value ? next.set(key, value) : next.delete(key);
    setParams(next);
  }
  const studentBoard = entity === "students";
  return (
    <>
      <section className="page-heading">
        <div>
          <h1>{studentBoard ? "学生榜" : "教练榜"}</h1>
        </div>
        <Link className="button find-person" lang="en" to={`/?type=${entity}`}>
          Find {studentBoard ? "students" : "coaches"}
        </Link>
      </section>
      <section
        className={`leaderboard surface ${studentBoard ? "student-board" : ""}`}
      >
        <div className="board-top">
          <RankingTabs
            mode={mode}
            onChange={(value) =>
              update({ board: value === "current" ? "" : value })
            }
          />
          <ProvinceSelect
            provinces={
              studentBoard ? manifest.studentProvinces : manifest.provinces
            }
            value={province}
            onChange={(value) => update({ province: value })}
          />
        </div>
        <div className="list-caption">
          <p>
            {mode === "current" ? "当前全国排名" : "历史最佳名次"}
            <span className="caption-divider">/</span>
            {formatInteger(filtered.length)} 人
          </p>
        </div>
        {resource.data ? (
          <>
            {filtered.length ? (
              <div className="ranking-list">
                <div className="coach-table-head coach-grid" aria-hidden="true">
                  <span>{mode === "current" ? "当前名次" : "巅峰名次"}</span>
                  <span>{studentBoard ? "学生" : "教练"}</span>
                  <span className="num">积分</span>
                  <span className="num">
                    {studentBoard ? "指导教练" : "指导学生"}
                  </span>
                  <span className="num">
                    {mode === "current" ? "历史最高" : "当前名次"}
                  </span>
                  <span />
                </div>
                {filtered.slice((page - 1) * 30, page * 30).map((person) => (
                  <article className="coach-row coach-grid" key={person.id}>
                    <span
                      className={`rank num ${(mode === "current" ? person.currentRank : person.peakRank) !== null && (mode === "current" ? person.currentRank! : person.peakRank!) <= 3 ? "leading-rank" : ""}`}
                    >
                      {rankText(
                        mode === "current"
                          ? person.currentRank
                          : person.peakRank,
                      )}
                      {mode === "peak" && (
                        <small>
                          {person.peakYear ? `${person.peakYear} 年` : ""}
                        </small>
                      )}
                    </span>
                    <PersonLink
                      summary={person}
                      to={personPath(person)}
                      className="coach-identity"
                    >
                      <Avatar name={person.name} id={person.id} />
                      <span>
                        <strong>{person.name}</strong>
                        <small>
                          {personProvinces(person).join(" · ") || "地区待补充"}
                        </small>
                      </span>
                    </PersonLink>
                    <span className="score num">
                      {formatScore(person.score)}
                      <small className="mobile-label">积分</small>
                    </span>
                    <div
                      className={`student-count ${studentBoard ? "related-coaches" : "num"}`}
                    >
                      {isStudent(person) ? (
                        person.coaches.length ? (
                          <>
                            <div className="coach-names">
                              {person.coaches.map((coach) => (
                                <PersonLink
                                  key={coach.id}
                                  to={`/coach/${coach.id}`}
                                >
                                  {coach.name}
                                </PersonLink>
                              ))}
                            </div>
                            <PersonLink
                              className="coach-total"
                              summary={person}
                              to={personPath(person)}
                            >
                              共 {person.coachCount} 位
                            </PersonLink>
                          </>
                        ) : (
                          <span className="coach-names">教练待补充</span>
                        )
                      ) : (
                        <>
                          {formatInteger(person.studentCount)}
                          <small className="mobile-label"> 位学生</small>
                        </>
                      )}
                    </div>
                    <span className="peak num">
                      {mode === "current" ? (
                        <>
                          <span className="mobile-label">最高 </span>
                          {rankText(person.peakRank)}
                          <small>
                            {person.peakYear
                              ? `${person.peakYear} 年 · ${formatInteger(person.peakPopulation!)} 人中`
                              : ""}
                          </small>
                        </>
                      ) : (
                        <>
                          <span className="mobile-label">当前 </span>
                          {rankText(person.currentRank)}
                          <small>
                            {person.peakPopulation
                              ? `巅峰当年 ${formatInteger(person.peakPopulation)} 人`
                              : ""}
                          </small>
                        </>
                      )}
                    </span>
                    <PersonLink
                      className="row-arrow"
                      summary={person}
                      to={personPath(person)}
                      aria-label={`查看${person.name}主页`}
                    >
                      <ChevronRight size={16} />
                    </PersonLink>
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <h2>该省份暂无收录档案</h2>
                <button onClick={() => update({ province: "" })}>
                  查看全国排名
                </button>
              </div>
            )}
            <Pagination
              total={filtered.length}
              page={page}
              onChange={(value) => update({ page: String(value) })}
            />
          </>
        ) : (
          <LoadState
            error={resource.error}
            retry={resource.retry}
            progress={resource.progress}
          />
        )}
      </section>
    </>
  );
}
