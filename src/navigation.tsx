import { useEffect, useLayoutEffect, useRef } from "react";
import { ArrowLeft } from "lucide-react";
import {
  Link,
  useLocation,
  useNavigate,
  useNavigationType,
  type LinkProps,
} from "react-router-dom";

export interface ListSource {
  url: string;
  key: string;
  y: number;
  focus: string;
}
export interface PreviewSession {
  source: ListSource;
  trail: string[];
  pushed: boolean;
}
export interface ReturnTarget extends ListSource {
  index: number;
  previewSession?: PreviewSession;
}
export interface NavigationState {
  previewSession?: PreviewSession;
  returnTo?: ReturnTarget;
  restore?: { y: number; focus: string };
}
const storageKey = "oier-coach-scroll-v1";
interface Position {
  y: number;
  focus?: string;
}
const positions = new Map<string, Position>();
try {
  for (const [key, position] of Object.entries(
    JSON.parse(sessionStorage.getItem(storageKey) || "{}") as Record<
      string,
      Position
    >,
  ))
    positions.set(key, position);
} catch {
  /* The browser may disable session storage. */
}
function persist() {
  try {
    sessionStorage.setItem(
      storageKey,
      JSON.stringify(Object.fromEntries([...positions].slice(-150))),
    );
  } catch {
    /* In-memory history remains available. */
  }
}
export function savePosition(key: string, position: Position) {
  positions.set(key, position);
  persist();
}
export function focusPerson(path: string) {
  const element = document.querySelector<HTMLElement>(
    `[data-current="true"] [data-person-path="${CSS.escape(path)}"]`,
  );
  element?.focus({ preventScroll: true });
}
export function isLocalReturn(
  value: ReturnTarget | undefined,
): value is ReturnTarget {
  return Boolean(
    value &&
      (value.url === "/" ||
        value.url.startsWith("/?") ||
        /^\/rankings\/(coaches|students)(\?|$)/.test(value.url)),
  );
}

export function ScrollRestoration() {
  useEffect(() => {
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    return () => {
      window.history.scrollRestoration = previous;
    };
  }, []);
  const location = useLocation();
  const navigationType = useNavigationType();
  const lastPath = useRef(location.pathname);
  useLayoutEffect(() => {
    const state = location.state as NavigationState | null;
    const preview = new URLSearchParams(location.search).has("preview");
    const stored = positions.get(location.key);
    const target =
      stored ??
      state?.restore ??
      (preview ? state?.previewSession?.source : undefined);
    const changedPage = lastPath.current !== location.pathname;
    lastPath.current = location.pathname;
    let restoring = true;
    let frame = 0;
    const started = performance.now();
    const y = target?.y ?? (changedPage ? 0 : window.scrollY);
    function restore() {
      const main = document.getElementById("main");
      const loading = main?.querySelector('.load-state[role="status"]');
      const settled = document.querySelectorAll(".route-frame").length === 1;
      const room = document.documentElement.scrollHeight - window.innerHeight;
      if (!loading && (room >= y || performance.now() - started > 4000)) {
        window.scrollTo({
          top: Math.min(y, Math.max(0, room)),
          behavior: "instant",
        });
        if (settled) {
          if (!preview && target?.focus) focusPerson(target.focus);
          restoring = false;
          positions.set(location.key, {
            y: window.scrollY,
            focus: target?.focus,
          });
          return;
        }
      }
      if (performance.now() - started < 5000)
        frame = requestAnimationFrame(restore);
      else restoring = false;
    }
    frame = requestAnimationFrame(restore);
    function save() {
      if (!restoring)
        positions.set(location.key, {
          y: window.scrollY,
          focus: target?.focus,
        });
    }
    window.addEventListener("scroll", save, { passive: true });
    window.addEventListener("pagehide", persist);
    return () => {
      cancelAnimationFrame(frame);
      save();
      persist();
      window.removeEventListener("scroll", save);
      window.removeEventListener("pagehide", persist);
    };
  }, [
    location.key,
    location.pathname,
    location.search,
    location.state,
    navigationType,
  ]);
  return null;
}

export function ProfileLink(props: LinkProps) {
  const location = useLocation();
  const state = location.state as NavigationState | null;
  return (
    <Link
      {...props}
      state={
        props.state ??
        (isLocalReturn(state?.returnTo)
          ? { returnTo: state.returnTo }
          : undefined)
      }
    />
  );
}

export function BackToResults({ student }: { student: boolean }) {
  const location = useLocation();
  const navigate = useNavigate();
  const target = (location.state as NavigationState | null)?.returnTo;
  const valid = isLocalReturn(target);
  const fallback = `/rankings/${student ? "students" : "coaches"}`;
  let label = `返回${student ? "学生" : "教练"}榜`;
  if (valid)
    label = target.url.startsWith("/rankings/coaches")
      ? "返回教练榜"
      : target.url.startsWith("/rankings/students")
        ? "返回学生榜"
        : "返回搜索结果";
  useEffect(() => {
    if (valid) savePosition(target.key, { y: target.y, focus: target.focus });
  }, [valid, target]);
  return (
    <Link
      className="back-link"
      to={valid ? target.url : fallback}
      onClick={(event) => {
        if (
          !valid ||
          event.button !== 0 ||
          event.ctrlKey ||
          event.metaKey ||
          event.shiftKey ||
          event.altKey
        )
          return;
        event.preventDefault();
        if (window.history.state?.idx === target.index + 1) navigate(-1);
        else
          navigate(target.url, {
            replace: true,
            state: {
              previewSession: target.previewSession
                ? { ...target.previewSession, pushed: false }
                : undefined,
              restore: { y: target.y, focus: target.focus },
            },
          });
      }}
    >
      <ArrowLeft size={15} />
      {label}
    </Link>
  );
}
