import dayjs from "dayjs";

export function isTimeDiffWithinThreshold(
  d1: dayjs.ConfigType,
  d2: dayjs.ConfigType,
  thresholdInMilliseconds: number
) {
  return Math.abs(dayjs(d1).diff(d2)) <= thresholdInMilliseconds;
}

export function sortByTimeDiff(
  d1: dayjs.ConfigType,
  d2: dayjs.ConfigType,
  ref: dayjs.ConfigType,
  ascending = true
) {
  return (
    (!ascending ? -1 : 1) *
    (Math.abs(dayjs(d1).diff(ref)) - Math.abs(dayjs(d2).diff(ref)))
  );
}

export function sortDatesAscending(
  a: Date | undefined,
  b: Date | undefined
): number {
  return a?.getTime() ?? 0 - (b?.getTime() ?? 0);
}
