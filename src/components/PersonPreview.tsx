import { PreviewCards } from "./PreviewCards";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import {
  Link,
  useLocation,
  useNavigate,
  type LinkProps,
} from "react-router-dom";
import {
  getResource,
  formatInteger,
  formatScore,
  rankText,
  studentContributions,
  useResource,
} from "../data";
import {
  focusPerson,
  savePosition,
  type NavigationState,
  type PreviewSession,
  type ReturnTarget,
} from "../navigation";
import type {
  CoachDetail,
  Manifest,
  RankedPerson,
  StudentDetail,
} from "../types";
import { Avatar, isStudent, LoadState, personProvinces } from "./ui";

const PreviewContext = createContext<
  (path: string, summary?: RankedPerson) => void
>(() => {});
function targetFromPath(path: string) {
  const match = /^\/(coach|student)\/([^/?#]+)$/.exec(path);
  return match ? `${match[1]}:${decodeURIComponent(match[2])}` : null;
}
function pathFromTarget(target: string) {
  const colon = target.indexOf(":");
  return `/${target.slice(0, colon)}/${encodeURIComponent(target.slice(colon + 1))}`;
}
export function PersonLink({
  summary,
  onClick,
  ...props
}: LinkProps & { summary?: RankedPerson }) {
  const open = useContext(PreviewContext);
  const path = String(props.to);
  return (
    <Link
      {...props}
      data-person-path={path}
      onClick={(event) => {
        onClick?.(event);
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.ctrlKey ||
          event.metaKey ||
          event.altKey ||
          event.shiftKey ||
          props.target === "_blank"
        )
          return;
        if (!targetFromPath(path)) return;
        event.preventDefault();
        open(path, summary);
      }}
    />
  );
}

export function PersonPreview({
  manifest,
  children,
}: {
  manifest?: Manifest;
  children: ReactNode;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const requested = params.get("preview") ?? "";
  const match =
    /^(coach|student):((?:coach-[a-f0-9]{16})|(?:oier-\d+)|(?:pending-.+))$/.exec(
      requested,
    );
  const listPage =
    location.pathname === "/" ||
    /^\/rankings\/(coaches|students)$/.test(location.pathname);
  const open = Boolean(listPage && match);
  const kind = match?.[1];
  const id = match?.[2];
  const state = location.state as
    | (NavigationState & { previewSummary?: RankedPerson })
    | null;
  const session = state?.previewSession;
  const resource = useResource<CoachDetail | StudentDetail>(
    open && manifest
      ? `${manifest.dataPath}${kind === "coach" ? "coaches" : "students"}/${encodeURIComponent(encodeURIComponent(id!))}.json`
      : null,
  );
  const person =
    resource.data ??
    (state?.previewSummary?.id === id ? state?.previewSummary : undefined);
  const [pendingTarget, setPendingTarget] = useState<string | null>(null);
  const switchRequest = useRef(0);
  const lastFocus = useRef("");
  if (session) lastFocus.current = session.source.focus;
  useEffect(() => {
    switchRequest.current += 1;
    setPendingTarget(null);
  }, [location.key]);
  async function show(path: string, summary?: RankedPerson) {
    const target = targetFromPath(path);
    if (!target || target === requested) return;
    if (open && manifest) {
      const request = ++switchRequest.current;
      setPendingTarget(target);
      const separator = target.indexOf(":");
      const targetId = target.slice(separator + 1);
      const folder = target.startsWith("coach:") ? "coaches" : "students";
      try {
        await getResource(
          `${manifest.dataPath}${folder}/${encodeURIComponent(encodeURIComponent(targetId))}.json`,
        );
      } catch {
        /* The destination preview provides a retry action. */
      }
      if (request !== switchRequest.current) return;
      setPendingTarget(null);
    }
    const next = new URLSearchParams(location.search);
    const sourceUrl = location.pathname + (location.search || "");
    const source = session?.source ?? {
      url: sourceUrl,
      key: location.key,
      y: window.scrollY,
      focus: path,
    };
    let nextSession: PreviewSession;
    if (open) {
      const base = session ?? {
        source: {
          ...source,
          url:
            location.pathname +
            (next.size > 1
              ? `?${new URLSearchParams([...next].filter(([key]) => key !== "preview"))}`
              : ""),
        },
        trail: [requested],
        pushed: false,
      };
      nextSession = { ...base, trail: [...base.trail, target] };
    } else {
      nextSession = {
        source: {
          url: sourceUrl,
          key: location.key,
          y: window.scrollY,
          focus: path,
        },
        trail: [target],
        pushed: true,
      };
      savePosition(location.key, { y: window.scrollY, focus: path });
    }
    next.set("preview", target);
    navigate(
      { pathname: location.pathname, search: `?${next}` },
      {
        replace: open,
        state: { previewSession: nextSession, previewSummary: summary },
      },
    );
  }
  function close() {
    switchRequest.current += 1;
    setPendingTarget(null);
    if (session?.pushed) navigate(-1);
    else {
      const next = new URLSearchParams(location.search);
      next.delete("preview");
      navigate(
        { pathname: location.pathname, search: next.size ? `?${next}` : "" },
        {
          replace: true,
          state: {
            restore: {
              y: session?.source.y ?? window.scrollY,
              focus: session?.source.focus ?? "",
            },
          },
        },
      );
    }
  }
  function previousPerson() {
    switchRequest.current += 1;
    setPendingTarget(null);
    if (!session || session.trail.length < 2) return;
    const trail = session.trail.slice(0, -1);
    const next = new URLSearchParams(location.search);
    next.set("preview", trail[trail.length - 1]);
    navigate(
      { pathname: location.pathname, search: `?${next}` },
      { replace: true, state: { previewSession: { ...session, trail } } },
    );
  }
  const returnTo: ReturnTarget = {
    url: location.pathname + location.search,
    key: location.key,
    y: session?.source.y ?? window.scrollY,
    focus: session?.source.focus ?? "",
    index: window.history.state?.idx ?? 0,
    previewSession: session,
  };
  return (
    <PreviewContext.Provider value={show}>
      {children}
      <Dialog.Root
        open={open}
        onOpenChange={(value) => {
          if (!value) close();
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="preview-overlay" />
          <Dialog.Content
            className="person-preview"
            aria-describedby={undefined}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              if (!new URLSearchParams(window.location.search).has("preview"))
                requestAnimationFrame(() => focusPerson(lastFocus.current));
            }}
          >
            <Dialog.Title className="sr-only">
              {person?.name ?? "人物资料"}
            </Dialog.Title>
            <div className="preview-toolbar">
              {session && session.trail.length > 1 ? (
                <button className="preview-back" onClick={previousPerson}>
                  <ArrowLeft size={16} />
                  返回上一位
                </button>
              ) : (
                <span>{kind === "coach" ? "教练预览" : "学生预览"}</span>
              )}
              <Dialog.Close asChild>
                <button className="icon-button" aria-label="关闭预览">
                  <X size={20} />
                </button>
              </Dialog.Close>
            </div>
            {pendingTarget && (
              <span className="preview-switch-status" role="status">
                正在加载人物资料
              </span>
            )}
            <PreviewCards
              cardKey={requested}
              depth={session?.trail.length ?? 1}
            >
              <div className="preview-body">
                <div className="preview-person">
                  {person && <Avatar name={person.name} id={person.id} large />}
                  <div>
                    <h2>{person?.name ?? "人物资料"}</h2>
                    {person && (
                      <p>
                        {personProvinces(person).join(" · ") || "地区待补充"}
                      </p>
                    )}
                  </div>
                </div>
                {person && (
                  <dl className="preview-metrics">
                    <div>
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
                          {person.peakYear ? `${person.peakYear} 年` : "待补充"}
                        </small>
                      </dd>
                    </div>
                    <div>
                      <dt>{isStudent(person) ? "指导教练" : "指导学生"}</dt>
                      <dd>
                        {formatInteger(
                          isStudent(person)
                            ? person.coachCount
                            : person.studentCount,
                        )}
                      </dd>
                    </div>
                  </dl>
                )}
                {resource.data ? (
                  <PreviewRelations person={resource.data} />
                ) : (
                  <LoadState
                    title="正在加载师生信息"
                    error={resource.error}
                    retry={resource.retry}
                  />
                )}
              </div>
              <div className="preview-footer">
                <Link
                  className="button preview-expand"
                  to={match ? pathFromTarget(requested) : "/"}
                  state={{ returnTo }}
                  onClick={() =>
                    savePosition(location.key, {
                      y: returnTo.y,
                      focus: returnTo.focus,
                    })
                  }
                >
                  查看完整主页
                  <ArrowRight size={16} />
                </Link>
              </div>
            </PreviewCards>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </PreviewContext.Provider>
  );
}

function PreviewRelations({ person }: { person: CoachDetail | StudentDetail }) {
  if (!("provinces" in person)) {
    const students = studentContributions(
      person.students,
      person.results,
      Infinity,
    ).slice(0, 3);
    return (
      <section className="preview-relations">
        <h3>代表学生</h3>
        {students.length ? (
          students.map((student) => (
            <PersonLink
              key={student.id}
              className="preview-related"
              to={`/student/${encodeURIComponent(student.id)}`}
            >
              <span>{student.name}</span>
              <span className="num">
                {formatScore(student.score)}
                <small>指导贡献</small>
              </span>
              <ArrowRight size={14} />
            </PersonLink>
          ))
        ) : (
          <p className="muted">学生资料待补充</p>
        )}
      </section>
    );
  }
  const groups = new Map<string, { label: string; ids: Set<string> }>();
  for (const result of person.results) {
    const key = `${result.schoolYear}/${result.province}`;
    const group = groups.get(key) ?? {
      label: `${result.schoolYear}–${result.schoolYear + 1} 学年 · ${result.province || "地区待补充"}`,
      ids: new Set<string>(),
    };
    result.coachIds.forEach((id) => group.ids.add(id));
    groups.set(key, group);
  }
  return (
    <section className="preview-relations">
      <h3>指导教练</h3>
      {[...groups]
        .sort(
          ([a], [b]) =>
            Number(b.split("/")[0]) - Number(a.split("/")[0]) ||
            a.localeCompare(b, "zh-CN"),
        )
        .map(([key, group]) => (
          <div key={key} className="preview-stage">
            <h4>{group.label}</h4>
            <div>
              {group.ids.size ? (
                [...group.ids].map((id) => (
                  <PersonLink key={id} to={`/coach/${id}`}>
                    {person.coaches.find((coach) => coach.id === id)?.name ??
                      "教练"}
                    <ArrowRight size={13} />
                  </PersonLink>
                ))
              ) : (
                <span className="muted">教练待补充</span>
              )}
            </div>
          </div>
        ))}
    </section>
  );
}
