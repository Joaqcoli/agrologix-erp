import { useState, useEffect } from "react";

const KEY = "agrologix-dark-mode";

export function useDarkMode() {
  const [dark, setDark] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(KEY);
      if (stored !== null) return stored === "true";
      return window.matchMedia("(prefers-color-scheme: dark)").matches;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const root = document.documentElement;
    if (dark) {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
    try {
      localStorage.setItem(KEY, String(dark));
    } catch {}
  }, [dark]);

  return { dark, toggle: () => setDark(d => !d) };
}
