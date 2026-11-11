import { useEffect, useMemo } from "react";
import { useLocation, useParams, useSearchParams } from "react-router-dom";
import { ProfileLink as Link } from "../navigation";
import Decimal from "decimal.js";
import { ChevronDown } from "lucide-react";
import { formatScore, useResource } from "../data";
import type {
  Manifest,
  StudentDetail,
  StudentRankingSnapshot,
  StudentResult,
} from "../types";
import { Avatar, External, LoadState, NotFound } from "../components/ui";
import {
  AwardStats,
  ProfileHeader,
  ResultList,
  TrendPanel,
  YearPicker,
} from "../components/ProfileParts";

function StudentContent({
  student,
  manifest,
}: {
  student: StudentDetail;
  manifest: Manifest;
}) {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const requested = Number(params.get("year"));
  const year = manifest.studentYears.includes(requested)
    ? requested
    : Number(manifest.asOf.slice(0, 4));
  const annual = useResource<StudentRankingSnapshot>(
    `${manifest.dataPath}student-rankings/${year}.json`,
  );
  useEffect(() => {
    document.title = `${student.name} · OIer Coach`;
  }, [student.name]);
  const results = useMemo(
    () => student.results.filter((result) => result.year <= year),
    [student, year],
  );
  const groups = useMemo(() => {
    const grouped = new Map<
      string,
      { schoolYear: number; province: string; results: StudentResult[] }
    >();
    for (const result of results) {
      const key = `${result.schoolYear}/${result.province}`;
      const group = grouped.get(key) ?? {
        schoolYear: result.schoolYear,
        province: result.province,
        results: [],
      };
      group.results.push(result);
      grouped.set(key, group);
    }
    return [...grouped.values()].sort(
      (a, b) =>
        b.schoolYear - a.schoolYear ||
        a.province.localeCompare(b.province, "zh-CN"),
    );
  }, [results]);
  function chooseYear(value: number) {
    const next = new URLSearchParams(params);
    next.set("year", String(value));
    setParams(next, { state: location.state });
  }
  return (
    <>
      <ProfileHeader
        person={student}
        extra={
          student.uid !== null ? (
            <External href={`https://oier.baoshuo.dev/oier/${student.uid}`}>
              OIerDB 主页
            </External>
          ) : undefined
        }
      />
      <YearPicker
        years={manifest.studentYears}
        year={year}
        onChange={chooseYear}
      />
      <div className="profile-analysis">
        <TrendPanel
          history={student.history}
          year={year}
          population={annual.data?.population}
          error={annual.error}
          retry={annual.retry}
          onChange={chooseYear}
        />
        <AwardStats results={results} />
      </div>
      <section className="guidance-panel surface">
        <div className="section-heading">
          <h2>历学年指导教练</h2>
          <span className="small muted">截至 {year} 年</span>
        </div>
        {groups.length ? (
          groups.map((group) => {
            const ids = [
              ...new Set(group.results.flatMap((result) => result.coachIds)),
            ];
            return (
              <section
                className="guidance-stage"
                key={`${group.schoolYear}/${group.province}`}
              >
                <h3>
                  {group.schoolYear}–{group.schoolYear + 1} 学年
                  <span>{group.province || "地区待补充"}</span>
                </h3>
                {ids.length ? (
                  <div className="guidance-coaches">
                    {ids.map((id) => {
                      const coach = student.coaches.find(
                        (item) => item.id === id,
                      )!;
                      const assigned = group.results.filter((result) =>
                        result.coachIds.includes(id),
                      );
                      const scored = assigned.filter(
                        (result) => result.score !== null,
                      );
                      const score = scored.length
                        ? scored.reduce(
                            (sum, result) => sum.plus(result.score!),
                            new Decimal(0),
                          )
                        : null;
                      return (
                        <details className="guidance-coach" key={id}>
                          <summary>
                            <Avatar name={coach.name} id={coach.id} />
                            <Link
                              to={`/coach/${id}`}
                              onClick={(event) => event.stopPropagation()}
                            >
                              {coach.name}
                            </Link>
                            <span className="num">
                              {formatScore(score)}
                              <small>学年贡献 · {assigned.length} 场</small>
                            </span>
                            <ChevronDown size={16} aria-hidden="true" />
                          </summary>
                          <div className="guidance-results">
                            <ResultList results={assigned} />
                          </div>
                        </details>
                      );
                    })}
                  </div>
                ) : (
                  <p className="muted">教练待补充</p>
                )}
              </section>
            );
          })
        ) : (
          <div className="empty-state compact">
            <p>该年度尚无成绩</p>
          </div>
        )}
      </section>
      <section className="student-results-panel surface">
        <div className="section-heading">
          <h2>
            比赛成绩 <span className="heading-count">{results.length}</span>
          </h2>
          <span className="small muted">截至 {year} 年</span>
        </div>
        {results.length ? (
          <ResultList results={results} coaches={student.coaches} />
        ) : (
          <div className="empty-state compact">
            <p>该年度尚无成绩</p>
          </div>
        )}
      </section>
    </>
  );
}

export default function StudentPage({ manifest }: { manifest: Manifest }) {
  const { id } = useParams();
  const valid = Boolean(
    id && (id.startsWith("oier-") || id.startsWith("pending-")),
  );
  const resource = useResource<StudentDetail>(
    valid
      ? `${manifest.dataPath}students/${encodeURIComponent(encodeURIComponent(id!))}.json`
      : null,
  );
  if (!valid) return <NotFound />;
  if (!resource.data)
    return (
      <>
        <h1 className="loading-title">学生个人主页</h1>
        <LoadState error={resource.error} retry={resource.retry} />
      </>
    );
  return (
    <StudentContent key={id} student={resource.data} manifest={manifest} />
  );
}
