import { useEffect, useId, useMemo, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown } from "lucide-react";

const spellings: Record<string, [string, string]> = {
  安徽: ["anhui", "ah"],
  北京: ["beijing", "bj"],
  福建: ["fujian", "fj"],
  甘肃: ["gansu", "gs"],
  广东: ["guangdong", "gd"],
  广西: ["guangxi", "gx"],
  贵州: ["guizhou", "gz"],
  海南: ["hainan", "hn"],
  河北: ["hebei", "hb"],
  河南: ["henan", "hn"],
  黑龙江: ["heilongjiang", "hlj"],
  湖北: ["hubei", "hb"],
  湖南: ["hunan", "hn"],
  吉林: ["jilin", "jl"],
  江苏: ["jiangsu", "js"],
  江西: ["jiangxi", "jx"],
  辽宁: ["liaoning", "ln"],
  内蒙古: ["neimenggu", "nmg"],
  宁夏: ["ningxia", "nx"],
  青海: ["qinghai", "qh"],
  山东: ["shandong", "sd"],
  山西: ["shanxi", "sx"],
  陕西: ["shaanxi", "sx"],
  上海: ["shanghai", "sh"],
  四川: ["sichuan", "sc"],
  天津: ["tianjin", "tj"],
  西藏: ["xizang", "xz"],
  新疆: ["xinjiang", "xj"],
  云南: ["yunnan", "yn"],
  浙江: ["zhejiang", "zj"],
  重庆: ["chongqing", "cq"],
  香港: ["xianggang", "xg"],
  澳门: ["aomen", "am"],
  台湾: ["taiwan", "tw"],
};

export function ProvinceSelect({
  provinces,
  value,
  onChange,
}: {
  provinces: string[];
  value: string;
  onChange: (province: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const composing = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const options = useMemo(() => {
    const sorted = [...new Set([...provinces, ...(value ? [value] : [])])].sort(
      (a, b) => a.localeCompare(b, "zh-CN-u-co-pinyin"),
    );
    const prefix = query.trim().normalize("NFKC").toLowerCase();
    return [
      { value: "", label: "全国 · 全部省份", keys: ["quanguo", "qg", "all"] },
      ...sorted.map((province) => ({
        value: province,
        label: province,
        keys: spellings[province] ?? [],
      })),
    ].filter(
      (option) =>
        !prefix ||
        option.label.includes(prefix) ||
        option.keys.some((key) => key.startsWith(prefix)),
    );
  }, [provinces, value, query]);
  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active, open]);
  function changeOpen(next: boolean) {
    setOpen(next);
    setQuery("");
    setActive(0);
  }
  function choose(next: string) {
    onChange(next);
    changeOpen(false);
    input.current?.focus({ preventScroll: true });
  }
  return (
    <Popover.Root open={open} onOpenChange={changeOpen}>
      <Popover.Anchor asChild>
        <div
          ref={anchor}
          className="province-control select-trigger"
          data-state={open ? "open" : "closed"}
        >
          <input
            ref={input}
            role="combobox"
            aria-label="省份"
            aria-expanded={open}
            aria-controls={`${id}-list`}
            aria-autocomplete="list"
            aria-activedescendant={
              open && options[active] ? `${id}-${active}` : undefined
            }
            value={open ? query : value || "全国 · 全部省份"}
            placeholder="中文 / 拼音 / 首字母"
            autoComplete="off"
            onFocus={() => changeOpen(true)}
            onClick={() => {
              if (!open) changeOpen(true);
            }}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
              setOpen(true);
            }}
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionEnd={() => {
              composing.current = false;
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || composing.current) return;
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                changeOpen(false);
              }
              if (event.key === "Tab") changeOpen(false);
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                if (!open) changeOpen(true);
                else
                  setActive((index) =>
                    Math.max(
                      0,
                      Math.min(
                        options.length - 1,
                        index + (event.key === "ArrowDown" ? 1 : -1),
                      ),
                    ),
                  );
              }
              if (event.key === "Enter" && open) {
                event.preventDefault();
                if (options[active]) choose(options[active].value);
              }
            }}
          />
          <button
            type="button"
            tabIndex={-1}
            aria-label={open ? "收起省份" : "展开省份"}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => {
              if (open) changeOpen(false);
              else {
                input.current?.focus();
                changeOpen(true);
              }
            }}
          >
            <ChevronDown size={16} aria-hidden="true" />
          </button>
        </div>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          className="province-popup"
          sideOffset={6}
          collisionPadding={12}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={(event) => {
            if (anchor.current?.contains(event.target as Node))
              event.preventDefault();
          }}
        >
          <div
            ref={list}
            id={`${id}-list`}
            role="listbox"
            aria-label="省份候选"
            className="province-options"
          >
            {options.map((option, index) => (
              <div
                key={option.value}
                role="option"
                id={`${id}-${index}`}
                aria-selected={value === option.value}
                data-index={index}
                data-active={active === index}
                className="province-option"
                onPointerMove={() => setActive(index)}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => choose(option.value)}
              >
                <span>{option.label}</span>
                {value === option.value && <Check size={15} />}
              </div>
            ))}
          </div>
          {!options.length && (
            <p className="province-empty" role="status">
              没有匹配的省份
            </p>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
