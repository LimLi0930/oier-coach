import { useEffect, useRef, useState, type ReactNode } from "react";

export function PreviewCards({
  cardKey,
  depth,
  children,
}: {
  cardKey: string;
  depth: number;
  children: ReactNode;
}) {
  const latest = useRef({ key: cardKey, node: children });
  const [transition, setTransition] = useState<{
    key: string;
    depth: number;
    previous: { key: string; node: ReactNode } | null;
    direction: "forward" | "backward";
  }>({ key: cardKey, depth, previous: null, direction: "forward" });
  if (transition.key !== cardKey) {
    setTransition({
      key: cardKey,
      depth,
      previous: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? null
        : latest.current,
      direction: depth < transition.depth ? "backward" : "forward",
    });
  }
  latest.current = { key: cardKey, node: children };
  useEffect(() => {
    if (!transition.previous) return;
    const timer = window.setTimeout(
      () => setTransition((current) => ({ ...current, previous: null })),
      420,
    );
    return () => window.clearTimeout(timer);
  }, [transition.previous]);
  const frames = transition.previous
    ? [transition.previous, { key: cardKey, node: children }]
    : [{ key: cardKey, node: children }];
  return (
    <div className="preview-deck" data-direction={transition.direction}>
      {frames.map((frame) => {
        const current = frame.key === cardKey;
        return (
          <div
            key={frame.key}
            className={`preview-card ${transition.previous ? (current ? "card-arriving" : "card-retreating") : ""}`}
            data-card-current={current}
            inert={!current}
            aria-hidden={current ? undefined : true}
            onAnimationEnd={(event) => {
              if (current && event.target === event.currentTarget)
                setTransition((value) => ({ ...value, previous: null }));
            }}
          >
            {frame.node}
          </div>
        );
      })}
    </div>
  );
}
