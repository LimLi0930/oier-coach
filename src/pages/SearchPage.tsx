import { directoryUrl } from "../data";
import { PersonLink } from "../components/PersonPreview";
import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { ArrowRight, Github, Search, X } from "lucide-react";
import {
  formatInteger,
  formatScore,
  rankText,
  repositoryUrl,
  useResource,
} from "../data";
import type { Entity, Manifest, RankedPerson } from "../types";
import {
  Avatar,
  External,
  LoadState,
  Pagination,
  personPath,
  personProvinces,
  ProvinceSelect,
} from "../components/ui";

export default function SearchPage({ manifest }: { manifest: Manifest }) {
  const [params, setParams] = useSearchParams();
  const entity: Entity =
    params.get("type") === "students" ? "students" : "coaches";
  const query = params.get("q") ?? "";
  const province = params.get("province") ?? "";
  const [draft, setDraft] = useState(query);
  const [composing, setComposing] = useState(false);
  const resource = useResource<RankedPerson[]>(directoryUrl(manifest, entity));
  useEffect(() => {
    setDraft(query);
  }, [query]);
  useEffect(() => {
    if (composing || draft === query) return;
    const timer = window.setTimeout(() => {
      const next = new URLSearchParams(params);
      draft.trim() ? next.set("q", draft.trim()) : next.delete("q");
      next.delete("page");
      setParams(next, { replace: true });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [draft, query, composing, params, setParams]);
  const active = Boolean(query.trim() || province);
  const filtered = useMemo(() => {
    if (!active) return [];
    const prefix = query.trim().normalize("NFKC").toLowerCase();
    const rows = (resource.data ?? []).filter((person) => {
      const name = person.name.normalize("NFKC").toLowerCase();
      return (
        (!province || personProvinces(person).includes(province)) &&
        (!prefix ||
          name.startsWith(prefix) ||
          person.initials.toLowerCase().startsWith(prefix))
      );
    });
    return rows.sort(
      (a, b) =>
        (a.currentRank ?? Infinity) - (b.currentRank ?? Infinity) ||
        a.name.localeCompare(b.name, "zh-CN-u-co-pinyin") ||
        a.id.localeCompare(b.id),
    );
  }, [active, resource.data, query, province]);
  const pages = Math.max(1, Math.ceil(filtered.length / 30));
  const page = Math.min(
    pages,
    Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1),
  );
  function update(values: Record<string, string>, replace = false) {
    const next = new URLSearchParams(params);
    next.delete("page");
    next.delete("board");
    for (const [key, value] of Object.entries(values))
      value ? next.set(key, value) : next.delete(key);
    setParams(next, { replace });
  }
  if (!query && params.has("board")) {
    const legacy = new URLSearchParams(params);
    legacy.delete("type");
    return <Navigate replace to={`/rankings/coaches?${legacy}`} />;
  }
  return (
    <>
      <section className={`search-intro ${active ? "has-results" : ""}`}>
        <h1>搜索教练与学生</h1>
      </section>
      <section
        className={`search-workspace ${active ? "has-results" : ""}`}
        aria-label="人物搜索"
      >
        <div className="entity-tabs" aria-label="搜索对象">
          <button
            aria-pressed={entity === "coaches"}
            onClick={() => update({ type: "coaches", q: draft.trim() })}
          >
            教练
          </button>
          <button
            aria-pressed={entity === "students"}
            onClick={() => update({ type: "students", q: draft.trim() })}
          >
            学生
          </button>
        </div>
        <div className="search-controls">
          <form
            role="search"
            className="instant-search"
            onSubmit={(event) => {
              event.preventDefault();
              if (!composing) update({ q: draft.trim() }, true);
            }}
          >
            <Search size={20} aria-hidden="true" />
            <label htmlFor="person-search" className="sr-only">
              姓名或拼音首字母
            </label>
            <input
              id="person-search"
              value={draft}
              placeholder={
                entity === "coaches"
                  ? "输入教练姓名或拼音首字母"
                  : "输入学生姓名或拼音首字母"
              }
              autoComplete="off"
              onChange={(event) => {
                setDraft(event.target.value);
                if (!event.target.value && !composing) update({ q: "" }, true);
              }}
              onCompositionStart={() => setComposing(true)}
              onCompositionEnd={(event) => {
                setDraft(event.currentTarget.value);
                setComposing(false);
              }}
            />
            {draft && (
              <button
                type="button"
                aria-label="清除搜索"
                onClick={() => {
                  setDraft("");
                  setComposing(false);
                  update({ q: "" }, true);
                }}
              >
                <X size={18} />
              </button>
            )}
          </form>
          <ProvinceSelect
            value={province}
            provinces={
              entity === "coaches"
                ? manifest.provinces
                : manifest.studentProvinces
            }
            onChange={(value) => update({ province: value, q: draft.trim() })}
          />
        </div>
        {!active && (
          <div className="search-start">
            <p>支持姓名与首字母前缀，也可以先选择省份。</p>
            <div>
              <Link to="/rankings/coaches">
                浏览教练榜
                <ArrowRight size={15} />
              </Link>
              <Link to="/rankings/students">
                浏览学生榜
                <ArrowRight size={15} />
              </Link>
            </div>
            {repositoryUrl && (
              <section className="open-source-note" aria-label="开源项目">
                <h2>一起完善信奥的师生档案</h2>
                <p>
                  OIer Coach 已在 GitHub 开源。欢迎提交资料、反馈问题，也欢迎
                  Star 支持项目。
                </p>
                <External href={repositoryUrl}>
                  <Github size={17} aria-hidden="true" />在 GitHub 上查看项目
                </External>
              </section>
            )}
          </div>
        )}
      </section>
      {active &&
        (resource.data ? (
          <section className="search-results" aria-label="搜索结果">
            <div className="results-heading">
              <h2>
                搜索结果 <span>{formatInteger(filtered.length)} 人</span>
              </h2>
              <button
                className="text-button"
                onClick={() => {
                  setDraft("");
                  update({ q: "", province: "" });
                }}
              >
                清空筛选
              </button>
            </div>
            {filtered.length ? (
              <>
                <div className="person-grid">
                  {filtered.slice((page - 1) * 30, page * 30).map((person) => (
                    <PersonLink
                      summary={person}
                      key={person.id}
                      className="person-card surface"
                      to={personPath(person)}
                    >
                      <Avatar name={person.name} id={person.id} />
                      <div className="person-card-body">
                        <h3>{person.name}</h3>
                        <p>
                          {personProvinces(person).join(" · ") || "地区待补充"}
                        </p>
                        <div className="person-card-stats">
                          <span>{rankText(person.currentRank)}</span>
                          <span className="num">
                            {formatScore(person.score)}
                            <small> 积分</small>
                          </span>
                        </div>
                      </div>
                      <ArrowRight size={15} className="person-card-arrow" />
                    </PersonLink>
                  ))}
                </div>
                <Pagination
                  page={page}
                  total={filtered.length}
                  onChange={(next) => update({ page: String(next) })}
                />
              </>
            ) : (
              <div className="empty-state surface">
                <Search size={26} />
                <h2>没有找到符合条件的人物</h2>
                <p>试试姓名开头或拼音首字母前缀。</p>
              </div>
            )}
          </section>
        ) : (
          <LoadState
            error={resource.error}
            retry={resource.retry}
            title="正在准备查询资料"
            progress={resource.progress}
          />
        ))}
    </>
  );
}
