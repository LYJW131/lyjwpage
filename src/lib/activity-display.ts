export type ActivityCounts = {
  steps: number | null;
  distanceMeters: number | null;
  flightsClimbed: number | null;
};

export type ActivityExtra = {
  label: string;
  value: number | null;
  digits: number;
  unit: string | null;
};

function finiteCount(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) ? value : null;
}

export function activityExtras(
  data: ActivityCounts | null | undefined,
  current: boolean,
): ActivityExtra[] {
  const count = (value: number | null | undefined) => (data && current ? finiteCount(value) : null);
  const meters = count(data?.distanceMeters);
  return [
    { label: "Steps", value: count(data?.steps), digits: 0, unit: null },
    { label: "Distance", value: meters == null ? null : meters / 1000, digits: 2, unit: "km" },
    { label: "Flights", value: count(data?.flightsClimbed), digits: 0, unit: null },
  ];
}

export function formatActivityExtra(extra: ActivityExtra): string | null {
  if (extra.value == null) return null;
  const text =
    extra.digits > 0
      ? extra.value.toFixed(extra.digits)
      : Math.round(extra.value).toLocaleString("en-US");
  return extra.unit ? `${text} ${extra.unit}` : text;
}
