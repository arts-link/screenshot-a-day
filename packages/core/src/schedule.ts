import { CronExpressionParser } from "cron-parser";

export function nextSchedule(expression: string, timezone: string, from = new Date()): Date {
  return CronExpressionParser.parse(expression, { currentDate: from, tz: timezone })
    .next()
    .toDate();
}

export function shouldCoalesce(
  states: Array<"queued" | "leased" | "succeeded" | "failed">,
): boolean {
  return states.some((state) => state === "queued" || state === "leased");
}
