import { useEffect, useState } from "react";

export function useAppearance() {
  const [dark, setDark] = useState(() => {
    try {
      return localStorage.getItem("process-guide-theme") === "dark";
    } catch {
      return document.documentElement.classList.contains("dark");
    }
  });
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    try {
      localStorage.setItem("process-guide-theme", dark ? "dark" : "light");
    } catch {
      // The appearance still works when browser storage is restricted.
    }
  }, [dark]);
  return [dark, setDark] as const;
}
