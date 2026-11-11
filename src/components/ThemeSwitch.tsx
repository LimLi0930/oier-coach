import { useEffect, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check, Monitor, Moon, Sun } from "lucide-react";

export type ThemePreference = "system" | "light" | "dark";
const choices = [
  { value: "system", label: "跟随系统", Icon: Monitor },
  { value: "light", label: "浅色", Icon: Sun },
  { value: "dark", label: "深色", Icon: Moon },
] as const;

export function ThemeSwitch() {
  const [preference, setPreference] = useState<ThemePreference>(() => {
    try {
      const saved = localStorage.getItem("oier-coach-theme");
      return saved === "light" || saved === "dark" ? saved : "system";
    } catch {
      return "system";
    }
  });
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    function apply() {
      const theme =
        preference === "system"
          ? media.matches
            ? "dark"
            : "light"
          : preference;
      document.documentElement.dataset.theme = theme;
      document.documentElement.style.colorScheme = theme;
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute("content", theme === "dark" ? "#111111" : "#fafafa");
    }
    apply();
    try {
      localStorage.setItem("oier-coach-theme", preference);
    } catch {
      /* Theme still applies when storage is unavailable. */
    }
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [preference]);
  const Icon = choices.find((choice) => choice.value === preference)!.Icon;
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button className="theme-trigger" aria-label="切换主题">
          <Icon size={18} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="theme-menu"
          align="end"
          sideOffset={8}
          collisionPadding={12}
        >
          <div role="group" aria-label="外观主题">
            {choices.map((choice) => (
              <button
                key={choice.value}
                aria-pressed={preference === choice.value}
                onClick={() => {
                  setPreference(choice.value);
                  setOpen(false);
                }}
              >
                <choice.Icon size={16} />
                <span>{choice.label}</span>
                {preference === choice.value && <Check size={15} />}
              </button>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
