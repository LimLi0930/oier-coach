import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import * as Select from "@radix-ui/react-select";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
} from "lucide-react";
import { formatInteger, safeExternal } from "../data";
import type { RankedPerson, StudentSummary } from "../types";

export const isStudent = (person: RankedPerson): person is StudentSummary =>
  "provinces" in person;
export const personPath = (person: RankedPerson) =>
  `/${isStudent(person) ? "student" : "coach"}/${encodeURIComponent(person.id)}`;
export const personProvinces = (person: RankedPerson) =>
  isStudent(person) ? person.provinces : [person.province].filter(Boolean);

export function External({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  const safeUrl = safeExternal(href);
  return safeUrl ? (
    <a href={safeUrl} className={className} target="_blank" rel="noreferrer">
      {children}
      <ExternalLink size={13} aria-hidden="true" />
    </a>
  ) : (
    <span>{children}</span>
  );
}

export function Avatar({
  name,
  large = false,
}: {
  name: string;
  id: string;
  large?: boolean;
}) {
  return (
    <span
      className={`avatar${large ? " avatar-large" : ""}`}
      aria-hidden="true"
    >
      {name.slice(-2)}
    </span>
  );
}

export function SelectField({
  label,
  value,
  onChange,
  options,
  className = "",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  className?: string;
}) {
  return (
    <Select.Root value={value} onValueChange={onChange}>
      <Select.Trigger
        aria-label={label}
        className={`select-trigger ${className}`}
      >
        <Select.Value />
        <Select.Icon>
          <ChevronDown size={16} />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          className="select-content"
          position="popper"
          sideOffset={6}
          collisionPadding={12}
        >
          <Select.ScrollUpButton className="select-scroll">
            <ChevronDown className="rotated" size={14} />
          </Select.ScrollUpButton>
          <Select.Viewport className="select-viewport">
            {options.map((option) => (
              <Select.Item
                key={option.value}
                value={option.value}
                className="select-option"
              >
                <Select.ItemText>{option.label}</Select.ItemText>
                <Select.ItemIndicator>
                  <Check size={15} />
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
          <Select.ScrollDownButton className="select-scroll">
            <ChevronDown size={14} />
          </Select.ScrollDownButton>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

export { ProvinceSelect } from "./ProvinceSelect";

export function LoadState({
  error,
  retry,
  title = "正在加载资料",
}: {
  error?: string;
  retry: () => void;
  title?: string;
}) {
  return (
    <section className="load-state surface" role={error ? "alert" : "status"}>
      <h2>{error ? "资料暂时加载失败" : title}</h2>
      {error ? (
        <>
          <p>请检查网络连接后重试。</p>
          <button onClick={retry}>重新加载</button>
        </>
      ) : (
        <div className="skeleton-rows" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      )}
    </section>
  );
}

export function Pagination({
  page,
  total,
  onChange,
}: {
  page: number;
  total: number;
  onChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / 30));
  return (
    <div className="pagination">
      <span>
        {total ? `${(page - 1) * 30 + 1}–${Math.min(page * 30, total)}` : "0"} /{" "}
        {formatInteger(total)} 人
      </span>
      <div>
        <button
          aria-label="上一页"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
        >
          <ChevronLeft size={16} />
        </button>
        <span>
          {page} / {pages}
        </span>
        <button
          aria-label="下一页"
          disabled={page >= pages}
          onClick={() => onChange(page + 1)}
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}

export function RankingTabs({
  mode,
  onChange,
}: {
  mode: "current" | "peak";
  onChange: (mode: "current" | "peak") => void;
}) {
  return (
    <div className="tabs" aria-label="榜单模式">
      <button
        aria-pressed={mode === "current"}
        onClick={() => onChange("current")}
      >
        当前榜
      </button>
      <button aria-pressed={mode === "peak"} onClick={() => onChange("peak")}>
        巅峰榜
      </button>
    </div>
  );
}

export function NotFound() {
  return (
    <section className="empty-state surface">
      <h1>没有找到这个页面</h1>
      <p>可以按姓名重新查找。</p>
      <Link to="/" className="button">
        返回搜索
      </Link>
    </section>
  );
}
