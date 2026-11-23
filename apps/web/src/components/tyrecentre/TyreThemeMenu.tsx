"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { applyThemeChoice, currentTheme, savedChoice, THEME_EVENT, type Theme, type ThemeChoice } from "@/lib/theme";

function subscribe(onChange: () => void) {
  window.addEventListener(THEME_EVENT, onChange);
  return () => window.removeEventListener(THEME_EVENT, onChange);
}

const CHOICES: { value: ThemeChoice; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "Match my computer", icon: Monitor },
];

/** Light / dark / follow-the-computer for the tyre-centre back office. With no saved choice the
 *  computer decides, and a change there (e.g. its evening switch) is followed live. */
export function TyreThemeMenu() {
  const theme = useSyncExternalStore<Theme>(subscribe, currentTheme, () => "light");
  const [choice, setChoice] = useState<ThemeChoice>("system");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one read of browser storage after hydration
    setChoice(savedChoice());
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystem = () => {
      if (savedChoice() === "system") applyThemeChoice("system");
    };
    mq.addEventListener("change", onSystem);
    return () => mq.removeEventListener("change", onSystem);
  }, []);

  const pick = (c: ThemeChoice) => {
    setChoice(c);
    applyThemeChoice(c);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Theme: ${theme}`}
        title="Light or dark"
        className="grid size-8 place-items-center rounded-full border border-tc-line-2 bg-tc-card text-tc-body hover:border-tc-dot hover:text-tc-ink sm:size-9"
      >
        {theme === "dark" ? <Moon className="size-[17px]" /> : <Sun className="size-[17px]" />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52 rounded-[14px] p-1.5">
        <DropdownMenuLabel className="text-[12px] font-semibold text-tc-faint">Appearance</DropdownMenuLabel>
        {CHOICES.map((c) => (
          <DropdownMenuItem key={c.value} onSelect={() => pick(c.value)} className="gap-2.5 rounded-[10px] py-2 text-[13px]">
            <c.icon className="size-4" />
            <span className="flex-1">{c.label}</span>
            {choice === c.value && <Check className="size-4 text-tc-ink" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
