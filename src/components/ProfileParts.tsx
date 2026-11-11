import type { ReactNode } from "react";
import { ProfileLink as Link, BackToResults } from "../navigation";
import { formatInteger, formatScore, rankText } from "../data";
import type {
  CoachReference,
  RankedPerson,
  RankingPoint,
  ResultRecord,
  StudentResult,
} from "../types";
import { Avatar, isStudent, personProvinces, SelectField } from "./ui";
import { RankChart } from "./RankChart";

export function ProfileHeader({
  person,
  extra,
}: {
  person: RankedPerson;
  extra?: ReactNode;
}) {
  const student = isStudent(person);
  return (
    <>
      <BackToResults student={student} />
      <section className="profile-cover">
        <div className="cover-inscription">
          <span>{personProvinces(person).join(" · ") || "地区待补充"}</span>
          <span>OIer Coach</span>
        </div>
        <div className="profile-intro">
          <Avatar name={person.name} id={person.id} large />
          <div>
            <h1>{person.name}</h1>
            <p>{student ? "学生个人主页" : "信奥教练个人空间"}</p>
          </div>
          {extra && <div className="profile-extra">{extra}</div>}
        </div>
      </section>
      <dl className="profile-metrics surface">
        <div className="primary-metric">
          <dt>当前积分</dt>
          <dd>{formatScore(person.score)}</dd>
        </div>
        <div>
          <dt>当前全国名次</dt>
          <dd>{rankText(person.currentRank)}</dd>
        </div>
        <div>
          <dt>历史最高名次</dt>
          <dd>
            {rankText(person.peakRank)}
            <small>
              {person.peakYear
                ? `${person.peakYear} 年 · ${formatInteger(person.peakPopulation!)} 人中`
                : "待补充"}
            </small>
          </dd>
        </div>
        <div>
          <dt>{student ? "指导教练" : "指导学生"}</dt>
          <dd>
            {formatInteger(student ? person.coachCount : person.studentCount)}
            <small>{formatInteger(person.resultCount)} 场成绩</small>
          </dd>
        </div>
      </dl>
    </>
  );
}

export function YearPicker({
  years,
  year,
  onChange,
}: {
  years: number[];
  year: number;
  onChange: (year: number) => void;
}) {
  return (
    <div className="profile-period">
      <h2>历年成绩</h2>
      <div className="year-picker">
        <span>截至</span>
        <SelectField
          label="查看年份"
          value={String(year)}
          onChange={(value) => onChange(Number(value))}
          options={years.map((value) => ({
            value: String(value),
            label: `${value} 年`,
          }))}
        />
      </div>
    </div>
  );
}

export function TrendPanel({
  history,
  year,
  population,
  onChange,
  error,
  retry,
}: {
  history: RankingPoint[];
  year: number;
  population?: number;
  onChange: (year: number) => void;
  error?: string;
  retry: () => void;
}) {
  const selected = history.find((row) => row.year === year);
  return (
    <section className="trend-panel surface">
      <h2>全国名次轨迹</h2>
      <div className="year-summary">
        <strong>{rankText(selected?.rank ?? null)}</strong>
        <span>
          {year} 年 · {formatScore(selected?.score ?? null)} 分
        </span>
        {population !== undefined && (
          <span>当年 {formatInteger(population)} 人参与排名</span>
        )}
        {error && (
          <button className="text-button" onClick={retry}>
            重新加载年度排名
          </button>
        )}
      </div>
      <RankChart history={history} selectedYear={year} onSelect={onChange} />
    </section>
  );
}

export function AwardStats({ results }: { results: ResultRecord[] }) {
  const counts = ["NOI", "NOIP", "WC", "APIO", "IOI"].map((event) => ({
    event,
    counts: [0, 0, 0],
  }));
  for (const result of results) {
    if (!result.core) continue;
    const row = counts.find((item) => item.event === result.event);
    const index = /金|一等奖/.test(result.award)
      ? 0
      : /银|二等奖/.test(result.award)
        ? 1
        : /铜|三等奖/.test(result.award)
          ? 2
          : -1;
    if (row && index >= 0) row.counts[index] += 1;
  }
  return (
    <section className="awards-panel surface">
      <h2>分类获奖</h2>
      <table>
        <thead>
          <tr>
            <th scope="col">赛事</th>
            <th scope="col">
              <span className="medal gold">金 / 一</span>
            </th>
            <th scope="col">
              <span className="medal silver">银 / 二</span>
            </th>
            <th scope="col">
              <span className="medal bronze">铜 / 三</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {counts.map((row) => (
            <tr key={row.event}>
              <th scope="row">{row.event}</th>
              {row.counts.map((count, index) => (
                <td className="num" key={index}>
                  {count}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function ResultList({
  results,
  coaches,
}: {
  results: (ResultRecord | StudentResult)[];
  coaches?: CoachReference[];
}) {
  return (
    <div className="result-list">
      {results.map((result) => (
        <article className="result-row" key={result.id}>
          <div className="result-heading">
            <strong>{result.contest}</strong>
            <span>{result.grade || "年级待补充"}</span>
            <span
              className={`medal ${/金|一等奖/.test(result.award) ? "gold" : /银|二等奖/.test(result.award) ? "silver" : /铜|三等奖/.test(result.award) ? "bronze" : ""}`}
            >
              {result.award || "荣誉记录"}
            </span>
          </div>
          <div className="result-values">
            <div>
              <span className="muted">名次 / 人数</span>
              <strong className="num">
                {result.rank === null
                  ? "待补充"
                  : `${formatInteger(result.rank)} / ${formatInteger(result.population!)}`}
              </strong>
            </div>
            <div>
              <span className="muted">{coaches ? "积分" : "指导贡献"}</span>
              <strong className="num">
                {result.core ? formatScore(result.score) : "附属记录"}
              </strong>
            </div>
          </div>
          {coaches && (
            <div className="result-coaches">
              <span className="muted">指导教练</span>
              {"coachIds" in result && result.coachIds.length ? (
                result.coachIds.map((id) => (
                  <Link key={id} to={`/coach/${id}`}>
                    {coaches.find((coach) => coach.id === id)?.name ?? "教练"}
                  </Link>
                ))
              ) : (
                <span className="muted">教练待补充</span>
              )}
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
