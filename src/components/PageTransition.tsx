import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  useLocation,
  useNavigationType,
  type Location,
} from "react-router-dom";

const navigationOrder = ["/", "/rankings/coaches", "/rankings/students"];

export function PageTransition({
  children,
}: {
  children: (location: Location, current: boolean) => ReactNode;
}) {
  const location = useLocation();
  const navigationType = useNavigationType();
  const positions = useRef(new Map([[location.key, 0]]));
  const [pages, setPages] = useState<{
    current: Location;
    previous: Location | null;
    direction: "forward" | "backward";
  }>({ current: location, previous: null, direction: "forward" });

  if (pages.current !== location) {
    const previousPosition = positions.current.get(pages.current.key) ?? 0;
    const position =
      navigationType === "REPLACE"
        ? previousPosition
        : (positions.current.get(location.key) ??
          previousPosition + (navigationType === "POP" ? -1 : 1));
    if (navigationType === "REPLACE")
      positions.current.delete(pages.current.key);
    positions.current.set(location.key, position);
    const changedPage = pages.current.pathname !== location.pathname;
    const from = navigationOrder.indexOf(pages.current.pathname);
    const to = navigationOrder.indexOf(location.pathname);
    const movement =
      from >= 0 && to >= 0 ? to - from : position - previousPosition;
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const next = { ...pages, current: location };
    if (changedPage) {
      next.previous = reducedMotion ? null : pages.current;
      next.direction = movement < 0 ? "backward" : "forward";
    }
    setPages(next);
  }

  useEffect(() => {
    if (!pages.previous) return;
    // Cleanup also runs when a background tab or reduced-motion change suppresses animationend.
    const timer = window.setTimeout(
      () => setPages((current) => ({ ...current, previous: null })),
      380,
    );
    return () => window.clearTimeout(timer);
  }, [pages.previous]);

  const frames = pages.previous
    ? [pages.previous, pages.current]
    : [pages.current];
  return (
    <div className="page-viewport" data-direction={pages.direction}>
      {frames.map((frame) => {
        const current = frame === pages.current;
        const animation = pages.previous
          ? current
            ? "is-entering"
            : "is-exiting"
          : "";
        return (
          <div
            key={frame.pathname}
            className={`route-frame ${animation}`}
            data-current={current}
            aria-hidden={current ? undefined : true}
            inert={!current}
            onAnimationEnd={(event) => {
              if (current && event.target === event.currentTarget) {
                setPages((value) => ({ ...value, previous: null }));
              }
            }}
          >
            {children(frame, current)}
          </div>
        );
      })}
    </div>
  );
}
