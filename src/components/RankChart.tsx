import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { formatInteger, formatScore } from "../data";
import type { RankingPoint } from "../types";

export function RankChart({
  history,
  selectedYear,
  onSelect,
}: {
  history: RankingPoint[];
  selectedYear: number;
  onSelect: (year: number) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const tooltip = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [tooltipTop, setTooltipTop] = useState(8);
  const tooltipId = useId();
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) =>
      setWidth(Math.max(240, entries[0].contentRect.width)),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setActiveIndex(null);
  }, [history]);
  useLayoutEffect(() => {
    if (activeIndex === null) return;
    function placeTooltip() {
      if (!container.current || !tooltip.current) return;
      const bounds = container.current.getBoundingClientRect();
      const availableBottom =
        window.innerHeight - tooltip.current.offsetHeight - 12;
      setTooltipTop(
        Math.max(12, Math.min(availableBottom, bounds.top + 8)) - bounds.top,
      );
    }
    placeTooltip();
    window.addEventListener("resize", placeTooltip);
    window.addEventListener("scroll", placeTooltip, true);
    return () => {
      window.removeEventListener("resize", placeTooltip);
      window.removeEventListener("scroll", placeTooltip, true);
    };
  }, [activeIndex, width]);
  const height = 180,
    left = 38,
    right = 16,
    top = 16,
    bottom = 30;
  const worst = Math.max(2, ...history.map((row) => row.rank));
  const x = (index: number) =>
    left + (index * (width - left - right)) / Math.max(1, history.length - 1);
  const y = (rank: number) =>
    top + ((rank - 1) / (worst - 1)) * (height - top - bottom);
  const selectedIndex = Math.max(
    0,
    history.findIndex((row) => row.year === selectedYear),
  );
  const active = activeIndex === null ? null : history[activeIndex];
  function nearest(event: PointerEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const cursor = ((event.clientX - bounds.left) * width) / bounds.width;
    return Math.max(
      0,
      Math.min(
        history.length - 1,
        Math.round(
          ((cursor - left) / (width - left - right)) * (history.length - 1),
        ),
      ),
    );
  }
  function onKeyDown(event: KeyboardEvent<SVGSVGElement>) {
    let next = activeIndex ?? selectedIndex;
    if (event.key === "Escape") {
      setActiveIndex(null);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(history[next].year);
      setActiveIndex(next);
      return;
    }
    if (event.key === "ArrowLeft") next -= 1;
    else if (event.key === "ArrowRight") next += 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = history.length - 1;
    else return;
    event.preventDefault();
    setActiveIndex(Math.max(0, Math.min(history.length - 1, next)));
  }
  const ticks = [...new Set([1, Math.round((worst + 1) / 2), worst])];
  const labels = [
    ...new Set([0, Math.floor((history.length - 1) / 2), history.length - 1]),
  ];
  const path = history
    .map((row, index) => `${index ? "L" : "M"}${x(index)},${y(row.rank)}`)
    .join(" ");
  return (
    <div className="chart-container" ref={container}>
      {history.length ? (
        <>
          <svg
            className="rank-chart"
            viewBox={`0 0 ${width} ${height}`}
            tabIndex={0}
            role="group"
            aria-label="历年名次曲线，左右方向键浏览年份，回车选择"
            aria-describedby={active ? tooltipId : undefined}
            onFocus={() => setActiveIndex(selectedIndex)}
            onBlur={() => setActiveIndex(null)}
            onKeyDown={onKeyDown}
            onPointerMove={(event) => setActiveIndex(nearest(event))}
            onPointerLeave={(event) => {
              if (event.pointerType !== "touch") setActiveIndex(null);
            }}
            onPointerDown={(event) => {
              const index = nearest(event);
              setActiveIndex(index);
              onSelect(history[index].year);
            }}
          >
            {ticks.map((tick) => (
              <g key={tick}>
                <line
                  className="chart-grid"
                  x1={left}
                  x2={width - right}
                  y1={y(tick)}
                  y2={y(tick)}
                />
                <text x={left - 9} y={y(tick) + 4} textAnchor="end">
                  {tick}
                </text>
              </g>
            ))}
            <path className="chart-line" d={path} />
            {history.map((row, index) =>
              row.year === selectedYear || history.length === 1 ? (
                <circle
                  key={row.year}
                  className="chart-dot"
                  cx={x(index)}
                  cy={y(row.rank)}
                  r={4}
                />
              ) : null,
            )}
            {active && activeIndex !== null && (
              <g>
                <line
                  className="chart-crosshair"
                  x1={x(activeIndex)}
                  x2={x(activeIndex)}
                  y1={top}
                  y2={height - bottom}
                />
                <circle
                  className="chart-dot"
                  cx={x(activeIndex)}
                  cy={y(active.rank)}
                  r={5}
                />
              </g>
            )}
            {labels.map((index) => (
              <text
                key={index}
                x={x(index)}
                y={height - 5}
                textAnchor={index === history.length - 1 ? "end" : "middle"}
              >
                {history[index].year}
              </text>
            ))}
          </svg>
          {active && activeIndex !== null && (
            <div
              ref={tooltip}
              id={tooltipId}
              role="tooltip"
              className="chart-tooltip"
              style={{
                left: Math.max(
                  0,
                  Math.min(
                    width - 212,
                    x(activeIndex) + (x(activeIndex) > width / 2 ? -224 : 12),
                  ),
                ),
                top: tooltipTop,
              }}
            >
              <strong>{active.year} 年</strong>
              <dl>
                <div>
                  <dt>全国名次</dt>
                  <dd>#{formatInteger(active.rank)}</dd>
                </div>
                <div>
                  <dt>累计积分</dt>
                  <dd>{formatScore(active.score)}</dd>
                </div>
                <div>
                  <dt>排名人数</dt>
                  <dd>{formatInteger(active.population)}</dd>
                </div>
              </dl>
            </div>
          )}
        </>
      ) : (
        <div className="chart-empty">
          <p>暂无可计分的历史成绩</p>
        </div>
      )}
    </div>
  );
}
