"use client";

import { useRef, useState } from "react";
import { FinanceIntent, type MoneyProof } from "./finance-intent-core";

export type { FinanceProofAction, MoneyProof } from "./finance-intent-core";

export function useFinanceIntent() {
	const intent = useRef<FinanceIntent | null>(null);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [uncertain, setUncertain] = useState(false);

	async function run<T>(
		url: string,
		build: () => Record<string, unknown>,
		options: {
			money?: MoneyProof;
			onUncertain?: () => void;
			onConflict?: () => void;
		} = {},
	): Promise<T | null> {
		intent.current ??= new FinanceIntent();
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
