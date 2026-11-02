import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import type { Comparison } from "../../../modules/reporting/metric-math.ts";
import { pillClass } from "../kpi-card";
import { describeDelta } from "./delta-text";

const ICON = { up: ArrowUp, down: ArrowDown, flat: Minus, none: null } as const;

/**
 * Change against the previous period of equal length. Arrow, sign and words carry the meaning;
 * colour only repeats it (green = better, red = worse, and inverted for lower-is-better metrics).
 * Rendered for event-period metrics only; "—" when the comparison has no honest value.
 */
export function DeltaChip({
	metricKey,
	comparison,
	lowerIsBetter = false,
}: {
	metricKey: string;
	comparison: Comparison;
	lowerIsBetter?: boolean;
}) {
	const view = describeDelta(comparison, lowerIsBetter);
	const Icon = ICON[view.direction];
	return (
		<span
			data-testid={`delta-chip-${metricKey}`}
			data-direction={view.direction}
			className={`${pillClass(view.tone)} tabular-nums`}
		>
			{Icon && <Icon aria-hidden="true" className="size-3" />}
			{view.text}
			{view.cue && <span className="font-medium">{view.cue}</span>}
			<span className="sr-only">. {view.srText}</span>
		</span>
	);
}
