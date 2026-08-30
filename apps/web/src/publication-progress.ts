import { useEffect, useState } from "react";
import { formatPublicationElapsed } from "./publication-status";

export const PUBLICATION_PHASES = ["queued", "building", "deploying"] as const;

export function usePublicationElapsed(
  startedAt: string | number | undefined,
  active: boolean,
): string {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  useEffect(() => {
    if (!active || startedAt === undefined) return;
    const start = typeof startedAt === "number" ? startedAt : Date.parse(startedAt);
    const update = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - start) / 1000)));
    const initial = window.setTimeout(update, 0);
    const timer = window.setInterval(update, 1000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [active, startedAt]);
  return formatPublicationElapsed(elapsedSeconds);
}
