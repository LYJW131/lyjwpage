import NumberFlow from "@number-flow/react";

const COMPACT = { notation: "compact", maximumFractionDigits: 1 } as const;

export function FitNumber({ value }: { value: number }) {
  const fullChars = value.toLocaleString("en-US").length;
  return (
    <span className="fit-number" data-full-ch={fullChars}>
      <span>
        <NumberFlow value={value} locales="en-US" />
      </span>
      <span>
        <NumberFlow value={value} locales="en-US" format={COMPACT} />
      </span>
    </span>
  );
}
