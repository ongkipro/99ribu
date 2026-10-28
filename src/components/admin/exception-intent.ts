"use client";

import { useRef, useState } from "react";
import { Intent, type MoneyProof } from "./exception-intent-core";

// S133: one operator intent = one open dialog. The money-safety rules (one Idempotency-Key per
// intent, a frozen request and proof after an unknown answer, a new key only after a definitive
// refusal) live in exception-intent-core.ts, which a test drives without React.

export type { MoneyProof } from "./exception-intent-core";

export function useIntent() {
	const intent = useRef<Intent | null>(null);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [uncertain, setUncertain] = useState(false);

	async function run<T>(
		url: string,
		build: () => Record<string, unknown>,
		options: { money?: MoneyProof; onUncertain?: () => void } = {},
	): Promise<T | null> {
		intent.current ??= new Intent();
		setPending(true);
		setError(null);
		try {
			const sent = await intent.current.send<T>(url, build, options);
			setUncertain(sent.uncertain);
			setError(sent.error);
			return sent.data;
		} finally {
			setPending(false);
		}
	}
	return { pending, error, setError, uncertain, run };
}
