"use client";

import { Plus, Search, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getJson } from "./admin-errors";
import { FormField } from "./form";
import { LINE_CAP, type Line, newLine, type Picked } from "./product-create-model";

// S152: the contents of one offer, one row per component SKU with its quantity. A row is either a SKU created with the
// product ("Barang baru") or an existing SKU found through the server search GET /api/v1/admin/stock-items?q= (debounced,
// whole dictionary, not a preloaded page). Native controls only.

const DEBOUNCE_MS = 300;
const SEARCH_MAX = 100;
// Cut by code point (the server counts characters), so an emoji is never split into half a surrogate pair.
const clipSearch = (value: string) => Array.from(value).slice(0, SEARCH_MAX).join("");

function SkuSearch({ id, disabled, invalid, onPick }: { id: string; disabled: boolean; invalid: boolean; onPick: (picked: Picked) => void }) {
	const [text, setText] = useState("");
	const [state, setState] = useState<{ q: string; rows: Picked[] | null; failed: boolean }>({ q: "", rows: null, failed: false });
	const q = text.trim();
	useEffect(() => {
		if (!q) return;
		const controller = new AbortController();
		const timer = setTimeout(async () => {
			const res = await getJson<{ data: Picked[] }>(`/api/v1/admin/stock-items?q=${encodeURIComponent(q)}&limit=8`, controller.signal);
			if (controller.signal.aborted) return;
			setState({ q, rows: res.ok ? res.data.data : null, failed: !res.ok });
		}, DEBOUNCE_MS);
		return () => {
			clearTimeout(timer);
			controller.abort();
		};
	}, [q]);
	const fresh = q !== "" && state.q === q;
	return (
		<div className="flex flex-col gap-1.5">
			<div className="relative">
				<Search aria-hidden="true" className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
				<Input id={id} value={text} disabled={disabled} className="pl-8" placeholder="Cari kode atau nama SKU" autoComplete="off" maxLength={SEARCH_MAX}
					onChange={(e) => setText(clipSearch(e.target.value))} aria-invalid={invalid} aria-describedby={invalid ? `${id}-hint` : undefined} />
			</div>
			<div role="status" className="text-xs text-muted-foreground" id={`${id}-status`}>
				{q === "" ? "" : state.failed && fresh ? "Pencarian gagal. Coba lagi." : !fresh ? "Mencari…" : state.rows?.length ? "" : "SKU tidak ditemukan."}
			</div>
			{fresh && state.rows && state.rows.length > 0 && (
				<ul className="flex flex-col divide-y rounded-md border" data-testid="sku-results">
					{state.rows.map((row) => (
						<li key={row.id}>
							<button type="button" className="flex min-h-9 w-full flex-col items-start px-3 py-1.5 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none max-md:min-h-11"
								onClick={() => onPick(row)}>
								<span className="font-medium">{row.name}</span>
								<span className="font-mono text-xs text-muted-foreground">{row.sku}</span>
							</button>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}

export function OfferContentsPicker({ offerIndex, lines, nextLine, disabled, structureLocked, errors, onChange, hppField }: {
	offerIndex: number;
	lines: Line[];
	/** Hands out the next unique line number and key. */
	nextLine: () => { n: number; key: string };
	/** Nothing may change once the SKU steps were sent (the retry sends the same body). */
	disabled: boolean;
	structureLocked: boolean;
	errors: Record<string, string>;
	onChange: (lines: Line[]) => void;
	/** The HPP control of a new SKU; absent without finance.costs.write. */
	hppField?: (line: Line, index: number) => React.ReactNode;
}) {
	const set = (index: number, patch: Partial<Line>) => onChange(lines.map((l, i) => (i === index ? { ...l, ...patch } : l)));
	return (
		<div id={`offer-contents-${offerIndex}`} tabIndex={-1} className="flex flex-col gap-3 outline-none md:col-span-full" data-testid={`offer-contents-${offerIndex}`}>
			<p className="text-sm font-medium" id={`contents-${offerIndex}-title`}>Isi penawaran</p>
			<ul className="flex flex-col gap-3" aria-labelledby={`contents-${offerIndex}-title`}>
				{lines.map((line, j) => {
					const cid = `component-${offerIndex}-${j}`, qid = `quantity-${offerIndex}-${j}`;
					const err = errors[cid];
					const ro = disabled || structureLocked;
					return (
						<li key={line.key} className="grid gap-3 rounded-md border p-3 md:grid-cols-[minmax(0,2.2fr)_minmax(0,0.7fr)_minmax(0,0.9fr)_auto] md:items-start">
							<div className="flex flex-col gap-1.5">
								<fieldset aria-label={`Sumber barang ${j + 1}`} className="m-0 inline-flex w-fit min-w-0 overflow-hidden rounded-md border p-0 text-sm max-md:w-full">
									{(["new", "existing"] as const).map((mode) => (
										<button key={mode} type="button" disabled={ro} aria-pressed={line.mode === mode}
											className="min-h-9 flex-1 px-3 font-medium disabled:opacity-60 aria-pressed:bg-primary aria-pressed:text-primary-foreground max-md:min-h-11"
											onClick={() => set(j, { mode, picked: null })}>
											{mode === "new" ? "Barang baru" : "SKU yang ada"}
										</button>
									))}
								</fieldset>
								{line.mode === "new" ? (
									<FormField id={cid} label={`Nama barang ${j + 1}`} invalid={Boolean(err)}
										hint={err ?? (lines.length > 1 ? "Wajib untuk paket berisi lebih dari satu barang." : "Kosongkan untuk memakai nama produk dan penawaran.")}>
										<Input id={cid} value={line.newName} maxLength={200} disabled={ro} onChange={(e) => set(j, { newName: e.target.value })}
											aria-invalid={Boolean(err)} aria-describedby={`${cid}-hint`} />
									</FormField>
								) : line.picked ? (
									<div className="flex flex-col gap-1 text-sm">
										<span className="font-medium">{line.picked.name}</span>
										<span className="font-mono text-xs text-muted-foreground">{line.picked.sku}</span>
										<Button type="button" variant="link" className="h-auto w-fit p-0" disabled={ro} onClick={() => set(j, { picked: null })}>Ganti SKU</Button>
										{err && <span className="text-xs text-destructive" role="alert">{err}</span>}
									</div>
								) : (
									<FormField id={cid} label={`SKU ${j + 1}`} invalid={Boolean(err)} hint={err}>
										<SkuSearch id={cid} disabled={ro} invalid={Boolean(err)} onPick={(picked) => set(j, { picked })} />
									</FormField>
								)}
							</div>
							<FormField id={qid} label="Jumlah" invalid={Boolean(errors[qid])} hint={errors[qid]}>
								<Input id={qid} inputMode="numeric" value={line.quantity} disabled={ro} onChange={(e) => set(j, { quantity: e.target.value.replace(/\D/g, "") })}
									aria-invalid={Boolean(errors[qid])} aria-describedby={errors[qid] ? `${qid}-hint` : undefined} />
							</FormField>
							{hppField ? hppField(line, j) : <span className="hidden md:block" />}
							<Button type="button" variant="ghost" size="icon" className="md:mt-6" disabled={ro || lines.length === 1}
								onClick={() => onChange(lines.filter((_, i) => i !== j))} aria-label={`Hapus barang ${j + 1} dari penawaran ${offerIndex + 1}`}>
								<Trash2 aria-hidden="true" />
							</Button>
						</li>
					);
				})}
			</ul>
			<Button type="button" variant="outline" className="self-start max-md:self-stretch" disabled={disabled || structureLocked || lines.length >= LINE_CAP}
				onClick={() => {
					const { n, key } = nextLine();
					onChange([...lines, newLine(n, key)]);
				}}>
				<Plus aria-hidden="true" data-icon="inline-start" />
				Tambah barang
			</Button>
		</div>
	);
}
