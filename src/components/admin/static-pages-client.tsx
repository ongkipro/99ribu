"use client";

import { CircleCheck, ExternalLink, Pencil } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { failureText, getJson } from "./admin-errors";
import { DataTable } from "./data-table";
import { formatWib } from "./format";
import { FormDialog, FormField } from "./form";
import { send, sentText, useOperationKey } from "./ops-api";
import { AdminPage, PageHeader } from "./page-blocks";
import { ErrorState } from "./states";
import { StatusBadge } from "./status";

// S-C1: the four store pages in the footer. Each save appends a version that the storefront shows at once (edge cache
// up to a minute); an empty page stays the "sedang disiapkan" placeholder, kept out of search engines.

type Row = { slug: string; path: string; default_title: string; version: number; title: string | null; updated_at: string | null; actor_name: string | null };
type Detail = { slug: string; path: string; default_title: string; current: { version: number; title: string; body: string } | null;
	versions: { version: number; title: string; reason: string; updated_at: string; actor_name: string | null }[] };

export function StaticPagesClient() {
	const [rows, setRows] = useState<Row[] | null>(null);
	const [failure, setFailure] = useState<string | null>(null);
	const [editing, setEditing] = useState<Row | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const noticeRef = useRef<HTMLDivElement>(null);
	const load = useCallback(async () => {
		setFailure(null);
		const result = await getJson<{ data: Row[] }>("/api/v1/admin/static-pages");
		if (result.ok) setRows(result.data.data);
		else setFailure(failureText(result.failure));
	}, []);
	useEffect(() => {
		void load();
	}, [load]);
	useEffect(() => {
		if (notice) noticeRef.current?.focus();
	}, [notice]);
	return (
		<AdminPage testId="static-pages">
			<PageHeader
				title="Halaman Toko"
				description="Isi halaman yang ditautkan di footer toko. Halaman tanpa isi tampil sebagai “sedang disiapkan” dan tidak diindeks mesin pencari."
			/>
			{notice && (
				<Alert ref={noticeRef} tabIndex={-1} role="status" className="border-success/30 bg-success-surface outline-none" data-testid="static-page-notice">
					<CircleCheck aria-hidden="true" />
					<AlertDescription className="text-foreground">{notice}</AlertDescription>
				</Alert>
			)}
			{failure ? (
				<ErrorState message={failure} onRetry={() => void load()} />
			) : (
				<DataTable
					testId="static-page-list"
					caption="Halaman toko"
					rows={rows ?? []}
					rowKey={(row) => row.slug}
					rowTestId={(row) => `static-page-${row.slug}`}
					status={rows ? { kind: "ready" } : { kind: "loading" }}
					loadingLabel="Memuat halaman…"
					empty="Belum ada halaman."
					stack
					columns={[
						{ id: "title", header: "Halaman", stack: "title", cellClassName: "whitespace-normal", cell: (row) => <span className="font-medium">{row.title ?? row.default_title}</span> },
						{
							id: "status",
							header: "Status",
							stack: "meta",
							cell: (row) => (
								<StatusBadge tone={row.version ? "success" : "problem"} data-status={row.version ? "live" : "empty"}>
									{row.version ? `Tayang · versi ${row.version}` : "Belum diisi"}
								</StatusBadge>
							),
						},
						{ id: "updated", header: "Terakhir diubah", hideBelow: "5xl", cell: (row) => (row.updated_at ? `${formatWib(row.updated_at)}${row.actor_name ? ` · ${row.actor_name}` : ""}` : "—") },
						{
							id: "actions",
							header: <span className="sr-only">Tindakan</span>,
							className: "text-right",
							cell: (row) => (
								<span className="flex justify-end gap-2">
									<Button asChild variant="ghost" size="sm">
										<a href={row.path} target="_blank" rel="noopener">
											Lihat<span className="sr-only"> {row.default_title}</span>
											<ExternalLink aria-hidden="true" data-icon="inline-end" />
										</a>
									</Button>
									<Button type="button" variant="outline" size="sm" onClick={() => { setNotice(null); setEditing(row); }} data-testid={`static-page-edit-${row.slug}`}>
										<Pencil aria-hidden="true" data-icon="inline-start" />
										Ubah<span className="sr-only"> {row.default_title}</span>
									</Button>
								</span>
							),
						},
					]}
				/>
			)}
			{editing && (
				<EditDialog
					row={editing}
					onClose={() => setEditing(null)}
					onSaved={(title, version) => {
						setEditing(null);
						setNotice(`${title} tersimpan sebagai versi ${version} dan sudah tayang di toko.`);
						void load();
					}}
				/>
			)}
		</AdminPage>
	);
}

function EditDialog({ row, onClose, onSaved }: { row: Row; onClose: () => void; onSaved: (title: string, version: number) => void }) {
	const [detail, setDetail] = useState<Detail | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [title, setTitle] = useState("");
	const [body, setBody] = useState("");
	const [reason, setReason] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const key = useOperationKey();
	useEffect(() => {
		void (async () => {
			const result = await getJson<Detail>(`/api/v1/admin/static-pages/${row.slug}`);
			if (!result.ok) return setLoadError(failureText(result.failure));
			setDetail(result.data);
			setTitle(result.data.current?.title ?? result.data.default_title);
			setBody(result.data.current?.body ?? "");
		})();
	}, [row.slug]);
	async function submit() {
		if (!detail) return;
		if (!title.trim() || !body.trim() || !reason.trim()) return setError("Isi judul, isi halaman dan alasan perubahan.");
		setBusy(true);
		setError(null);
		const result = await send<{ version: number; title: string }>("POST", `/api/v1/admin/static-pages/${row.slug}/versions`,
			{ expected_version: detail.current?.version ?? 0, title: title.trim(), body: body.trim(), reason: reason.trim() }, key);
		setBusy(false);
		if (result.ok) return onSaved(result.data.title, result.data.version);
		setError(result.code === "VERSION_CONFLICT" ? "Halaman ini baru diubah orang lain. Tutup lalu buka lagi untuk memuat versi terbaru." : sentText(result.status, result.code));
	}
	return (
		<FormDialog
			title={`Ubah ${row.default_title}`}
			description="Baris kosong memisahkan paragraf. Awali baris dengan “## ” untuk subjudul dan “- ” untuk daftar."
			submitLabel="Simpan dan tayangkan"
			onClose={onClose}
			onSubmit={() => void submit()}
			pending={busy || !detail}
			error={error ?? loadError}
			dirty={Boolean(detail) && (body !== (detail?.current?.body ?? "") || reason !== "")}
			className="sm:max-w-2xl"
		>
			{detail && (
				<>
					<FormField id="static-page-title" label="Judul">
						<Input id="static-page-title" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} data-testid="static-page-title" />
					</FormField>
					<FormField id="static-page-body" label="Isi halaman" hint={`${body.length.toLocaleString("id-ID")} / 20.000 karakter`}>
						<Textarea id="static-page-body" value={body} maxLength={20000} rows={14} onChange={(e) => setBody(e.target.value)}
							aria-describedby="static-page-body-hint" data-testid="static-page-body" />
					</FormField>
					<FormField id="static-page-reason" label="Alasan perubahan">
						<Input id="static-page-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="Contoh: alamat kantor baru" data-testid="static-page-reason" />
					</FormField>
					{detail.versions.length > 0 && (
						<details className="text-sm">
							<summary className="cursor-pointer font-medium">Riwayat ({detail.versions.length} versi terakhir)</summary>
							<ol className="mt-2 flex flex-col gap-1 text-muted-foreground">
								{detail.versions.map((v) => (
									<li key={v.version}>Versi {v.version} · {formatWib(v.updated_at)}{v.actor_name ? ` · ${v.actor_name}` : ""} · {v.reason}</li>
								))}
							</ol>
						</details>
					)}
				</>
			)}
		</FormDialog>
	);
}
