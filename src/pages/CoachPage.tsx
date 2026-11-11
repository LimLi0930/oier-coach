import { useEffect, useMemo, useState } from "react";
import { useLocation, useParams, useSearchParams } from "react-router-dom";
import { ProfileLink as Link } from "../navigation";
import { ChevronDown } from "lucide-react";
import {
  formatScore,
  stages,
  studentContributions,
  useResource,
} from "../data";
import type { CoachDetail, Manifest, RankingSnapshot } from "../types";
import { LoadState, NotFound } from "../components/ui";
import {
  AwardStats,
  ProfileHeader,
  ResultList,
  TrendPanel,
  YearPicker,
} from "../components/ProfileParts";

function CoachContent({
  coach,
  manifest,
}: {
  coach: CoachDetail;
  manifest: Manifest;
}) {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const requested = Number(params.get("year"));
  const year = manifest.years.includes(requested)
    ? requested
    : Number(manifest.asOf.slice(0, 4));
  const [showAll, setShowAll] = useState(false);
  const annual = useResource<RankingSnapshot>(
    `${manifest.dataPath}rankings/${year}.json`,
  );
  const students = useMemo(
    () => studentContributions(coach.students, coach.results, year),
    [coach, year],
  );
  useEffect(() => {
    document.title = `${coach.name} · OIer Coach`;
  }, [coach.name]);
  function chooseYear(value: number) {
    const next = new URLSearchParams(params);
    next.set("year", String(value));
    setParams(next, { state: location.state });
    setShowAll(false);
  }
  return (
    <>
      <ProfileHeader person={coach} />
      <YearPicker years={manifest.years} year={year} onChange={chooseYear} />
      <div className="profile-analysis">
        <TrendPanel
          history={coach.history}
          year={year}
          population={annual.data?.population}
          error={annual.error}
          retry={annual.retry}
          onChange={chooseYear}
        />
        <AwardStats
          results={coach.results.filter((result) => result.year <= year)}
        />
      </div>
      <section className="students-panel surface">
        <div className="section-heading">
          <div>
            <h2>
              代表学生 <span className="heading-count">{students.length}</span>
            </h2>
            <p className="small muted">截至 {year} 年的指导贡献</p>
          </div>
          {students.length > 6 && (
            <button
              className="text-button"
              onClick={() => setShowAll((value) => !value)}
            >
              {showAll ? "收起列表" : "查看全部学生"}
              <ChevronDown size={15} className={showAll ? "rotated" : ""} />
            </button>
          )}
        </div>
        {students.length ? (
          <div className="student-list">
            {students
              .slice(0, showAll ? undefined : 6)
              .map((student, index) => (
                <details key={student.id} className="student-disclosure">
                  <summary>
                    <span className="student-position num">{index + 1}</span>
                    <span className="student-info">
                      <Link
                        onClick={(event) => event.stopPropagation()}
                        to={`/student/${encodeURIComponent(student.id)}`}
                      >
                        <strong>{student.name}</strong>
                      </Link>
                      <small>
                        {[
                          ...new Set(
                            student.results.map(
                              (result) => stages[result.stage],
                            ),
                          ),
                        ].join("、")}{" "}
                        · {student.results.length} 场成绩
                      </small>
                    </span>
                    <span className="student-score num">
                      {formatScore(student.score)}
                      <small>指导贡献</small>
                    </span>
                    <ChevronDown size={16} />
                  </summary>
                  <div className="student-details">
                    <ResultList results={student.results} />
                  </div>
                </details>
              ))}
          </div>
        ) : (
          <div className="empty-state compact">
            <p>该年度尚无学生成绩</p>
          </div>
        )}
      </section>
    </>
  );
}

export default function CoachPage({ manifest }: { manifest: Manifest }) {
  const { id } = useParams();
  const valid = Boolean(id && /^coach-[a-f0-9]{16}$/.test(id));
  const resource = useResource<CoachDetail>(
    valid ? `${manifest.dataPath}coaches/${id}.json` : null,
  );
  if (!valid) return <NotFound />;
  if (!resource.data)
    return (
      <>
        <h1 className="loading-title">教练个人空间</h1>
        <LoadState error={resource.error} retry={resource.retry} />
      </>
    );
  return <CoachContent key={id} coach={resource.data} manifest={manifest} />;
}
