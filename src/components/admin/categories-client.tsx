"use client";

import { CircleCheck, Plus, Trash2 } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type Category, categoryPath } from "./catalog-model";
import { DataTable } from "./data-table";
import { FormDialog, FormField, nativeSelectClass } from "./form";
import { send, useOperationKey } from "./ops-api";
import { AdminPage, PageHeader } from "./page-blocks";
import { StatusBadge } from "./status";
import { useKeysetList } from "./use-keyset-list";

// S134 / spec 17 B10: the category dictionary. The API has no rename or retire (DEC-011: a change is a new category)
// and lists only categories used by a product's draft or live publication plus their parents, so a category created here
// is shown in this session as "Belum dipakai produk" until a product uses it. Create is owner/ecommerce_admin (API-enforced).

type Rule = NonNullable<Category["attribute_definitions"]>[number] & {
	value_type?: string;
	required?: boolean;
	allowed_values?: string[];
};
type Row = Omit<Category, "attribute_definitions"> & { attribute_definitions?: Rule[] };

const TYPE_LABELS = { text: "Teks", number: "Angka", boolean: "Ya/tidak", enum: "Pilihan" } as const;
type ValueType = keyof typeof TYPE_LABELS;
const MAX_RULES = 20;
const MESSAGES: Record<string, string> = {
	INVALID_TAXONOMY: "Kategori paling dalam 3 tingkat, dan kunci atribut tidak boleh sama dengan atribut kategori induk.",
	CATALOG_IDENTITY_CONFLICT: "Slug ini sudah dipakai kategori lain. Gunakan slug berbeda.",
	NOT_FOUND: "Kategori induk tidak ditemukan.",
};

function slugOf(name: string) {
	return name
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 100)
		.replace(/-+$/, "");
}

export function CategoriesClient() {
	const list = useKeysetList<Row>("/api/v1/admin/categories?limit=100", (row) => row.id);
	const [created, setCreated] = useState<Row[]>([]);
	const [dialog, setDialog] = useState(false);
	const [notice, setNotice] = useState<string | null>(null);
	const noticeRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (notice) noticeRef.current?.focus();
	}, [notice]);
	const all = useMemo(() => [...created, ...list.rows.filter((row) => !created.some((c) => c.id === row.id))], [created, list.rows]);
	const rows = useMemo(
		() => all.map((row) => ({ row, path: categoryPath(row.id, all) ?? row.name })).sort((a, b) => a.path.localeCompare(b.path, "id")),
		[all],
	);
	const fresh = new Set(created.map((c) => c.id));
	const unused = (row: Row) => fresh.has(row.id) && !list.rows.some((r) => r.id === row.id);
	return (
		<AdminPage testId="categories-page">
			<PageHeader
				title="Kategori"
				back={{ href: "/admin/catalog", label: "Produk" }}
				description="Kamus kategori produk, paling dalam 3 tingkat. Kategori tidak diganti nama atau dihapus: perubahan dibuat sebagai kategori baru. Daftar memuat kategori yang dipakai produk; kategori baru muncul di sini setelah dipakai."
				actions={
					<Button type="button" data-testid="category-new" onClick={() => setDialog(true)}>
						<Plus aria-hidden="true" />
						Tambah kategori
					</Button>
				}
			/>
			{notice && (
				<Alert ref={noticeRef} tabIndex={-1} role="status" className="border-success/30 bg-success-surface outline-none" data-testid="category-notice">
					<CircleCheck aria-hidden="true" />
					<AlertDescription className="text-foreground">{notice}</AlertDescription>
				</Alert>
			)}
			<DataTable
				testId="categories"
				caption="Daftar kategori"
				rows={rows}
				rowKey={({ row }) => row.id}
				rowTestId={({ row }) => `category-row-${row.slug}`}
				status={list.status}
				loadingLabel="Memuat kategori…"
				empty="Belum ada kategori yang dipakai produk. Tambah kategori dengan tombol di atas."
				emptyTestId="categories-empty"
				stack
				paging={{ ...list.paging, testId: "categories-more", summary: `${list.rows.length} kategori dimuat` }}
				columns={[
					{
						id: "name",
						header: "Kategori",
						stack: "title",
						cellClassName: "whitespace-normal",
						cell: ({ row, path }) => (
							<span className="flex flex-col">
								<span className="font-medium">{row.name}</span>
								{row.depth > 1 && <span className="text-xs text-muted-foreground">{path}</span>}
							</span>
						),
					},
					{
						id: "status",
						header: "Status",
						stack: "status",
						cell: ({ row }) => (unused(row) ? <StatusBadge tone="open">Belum dipakai produk</StatusBadge> : null),
					},
					{ id: "slug", header: "Slug", className: "font-mono", cell: ({ row }) => row.slug },
					{ id: "depth", header: "Tingkat", className: "tabular-nums", cell: ({ row }) => row.depth },
					{
						id: "rules",
						header: "Atribut wajib dan pilihan",
						cellClassName: "max-w-72 whitespace-normal",
						cell: ({ row }) =>
							row.attribute_definitions?.length ? (
								<span className="flex flex-wrap gap-x-2 text-xs">
									{row.attribute_definitions.map((rule) => (
										<span key={rule.key}>
											{rule.label}
											{rule.required ? " *" : ""}
										</span>
									))}
								</span>
							) : (
								<span className="text-xs text-muted-foreground">Tanpa aturan atribut</span>
							),
					},
				]}
			/>
			{dialog && (
				<CreateDialog
					parents={all}
					onClose={() => setDialog(false)}
					onDone={(row) => {
						setDialog(false);
						setCreated((current) => [row, ...current]);
						setNotice(`Kategori ${row.name} dibuat. Kategori ini muncul di daftar produk setelah dipakai sebuah produk.`);
					}}
				/>
			)}
		</AdminPage>
	);
}

type RuleDraft = { key: string; label: string; type: ValueType; required: boolean; allowed: string };

function CreateDialog({ parents, onClose, onDone }: { parents: Row[]; onClose: () => void; onDone: (row: Row) => void }) {
	const id = useId();
	const key = useOperationKey();
	const [name, setName] = useState("");
	const [slug, setSlug] = useState("");
	const [slugTouched, setSlugTouched] = useState(false);
	const [parent, setParent] = useState("");
	const [rules, setRules] = useState<RuleDraft[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const options = parents.filter((row) => row.depth < 3);
	const setRule = (index: number, patch: Partial<RuleDraft>) => setRules((current) => current.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)));

	async function submit() {
		if (!name.trim()) return setError("Nama kategori wajib diisi.");
		if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return setError("Slug hanya berisi huruf kecil, angka dan tanda hubung, tanpa tanda hubung di awal, akhir, atau berurutan.");
		const definitions = [];
		for (const [index, rule] of rules.entries()) {
			const at = `Atribut ${index + 1}`;
			if (!/^[a-z][a-z0-9_]{0,99}$/.test(rule.key)) return setError(`${at}: kunci diawali huruf kecil dan hanya berisi huruf kecil, angka atau garis bawah.`);
			if (!rule.label.trim()) return setError(`${at}: label wajib diisi.`);
			const allowed = rule.type === "enum" ? [...new Set(rule.allowed.split(/[\n,]/).map((v) => v.trim()).filter(Boolean))] : [];
			if (rule.type === "enum" && allowed.length === 0) return setError(`${at}: isi minimal satu pilihan, dipisah koma.`);
			definitions.push({ key: rule.key, label: rule.label.trim(), value_type: rule.type, required: rule.required, allowed_values: allowed });
		}
		if (new Set(definitions.map((d) => d.key)).size !== definitions.length) return setError("Kunci atribut tidak boleh kembar.");
		setPending(true);
		setError(null);
		const result = await send<Row>(
			"POST",
			"/api/v1/admin/categories",
			{ name: name.trim(), slug, parent_id: parent || null, attribute_definitions: definitions },
			key,
		);
		setPending(false);
		if (!result.ok) return setError(result.code && MESSAGES[result.code] ? `${MESSAGES[result.code]} (kode: ${result.code})` : result.text);
		onDone(result.data);
	}
	return (
		<FormDialog
			title="Tambah kategori"
			description="Nama, slug dan induk tidak bisa diubah setelah dibuat. Aturan atribut diwariskan ke kategori di bawahnya."
			pending={pending}
			error={error}
			submitLabel="Tambah kategori"
			onClose={onClose}
			onSubmit={() => void submit()}
			className="md:max-w-xl"
		>
			<FormField id={`${id}-name`} label="Nama kategori">
				<Input
					id={`${id}-name`}
					data-testid="category-name"
					value={name}
					maxLength={200}
					autoComplete="off"
					onChange={(event) => {
						setName(event.target.value);
						if (!slugTouched) setSlug(slugOf(event.target.value));
					}}
				/>
			</FormField>
			<FormField id={`${id}-slug`} label="Slug" hint="Dipakai di alamat toko. Terisi otomatis dari nama.">
				<Input
					id={`${id}-slug`}
					data-testid="category-slug"
					className="font-mono"
					value={slug}
					maxLength={100}
					autoComplete="off"
					aria-describedby={`${id}-slug-hint`}
					onChange={(event) => {
						setSlugTouched(true);
						setSlug(event.target.value);
					}}
				/>
			</FormField>
			<FormField id={`${id}-parent`} label="Induk (opsional)" hint="Hanya kategori yang sudah dipakai produk dan kurang dari 3 tingkat.">
				<select id={`${id}-parent`} data-testid="category-parent" className={`${nativeSelectClass} w-full`} aria-describedby={`${id}-parent-hint`} value={parent} onChange={(event) => setParent(event.target.value)}>
					<option value="">Tanpa induk (tingkat 1)</option>
					{options.map((row) => (
						<option key={row.id} value={row.id}>
							{categoryPath(row.id, parents) ?? row.name}
						</option>
					))}
				</select>
			</FormField>
			<fieldset className="flex flex-col gap-3">
				<legend className="mb-1 text-sm font-medium">Aturan atribut produk (opsional)</legend>
				{rules.map((rule, index) => (
					// Rows are positional drafts without identity; removal re-keys by index on purpose.
					// biome-ignore lint/suspicious/noArrayIndexKey: draft rows have no stable id
					<div key={index} className="flex flex-col gap-2 rounded-md border p-3" data-testid="category-rule">
						<div className="grid gap-2 sm:grid-cols-2">
							<FormField id={`${id}-rk-${index}`} label="Kunci">
								<Input id={`${id}-rk-${index}`} className="font-mono" value={rule.key} maxLength={100} autoComplete="off" onChange={(event) => setRule(index, { key: event.target.value })} />
							</FormField>
							<FormField id={`${id}-rl-${index}`} label="Label">
								<Input id={`${id}-rl-${index}`} value={rule.label} maxLength={200} autoComplete="off" onChange={(event) => setRule(index, { label: event.target.value })} />
							</FormField>
							<FormField id={`${id}-rt-${index}`} label="Jenis nilai">
								<select id={`${id}-rt-${index}`} className={`${nativeSelectClass} w-full`} value={rule.type} onChange={(event) => setRule(index, { type: event.target.value as ValueType })}>
									{(Object.keys(TYPE_LABELS) as ValueType[]).map((type) => (
										<option key={type} value={type}>
											{TYPE_LABELS[type]}
										</option>
									))}
								</select>
							</FormField>
							<label className="flex min-h-9 items-center gap-2 self-end text-sm pointer-coarse:min-h-11">
								<input type="checkbox" className="size-4 accent-primary" checked={rule.required} onChange={(event) => setRule(index, { required: event.target.checked })} />
								Wajib diisi produk
							</label>
						</div>
						{rule.type === "enum" && (
							<FormField id={`${id}-ra-${index}`} label="Pilihan" hint="Pisahkan dengan koma.">
								<Input id={`${id}-ra-${index}`} aria-describedby={`${id}-ra-${index}-hint`} value={rule.allowed} autoComplete="off" onChange={(event) => setRule(index, { allowed: event.target.value })} />
							</FormField>
						)}
						<Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => setRules((current) => current.filter((_, i) => i !== index))}>
							<Trash2 aria-hidden="true" />
							Hapus atribut {index + 1}
						</Button>
					</div>
				))}
				{rules.length < MAX_RULES && (
					<Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setRules((current) => [...current, { key: "", label: "", type: "text", required: false, allowed: "" }])}>
						<Plus aria-hidden="true" />
						Tambah atribut
					</Button>
				)}
			</fieldset>
		</FormDialog>
	);
}
