"use client";

import { CircleCheck, KeyRound, Search, UserCog } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { permissionLabel, roleLabel } from "./account-model";
import { describeFailure, failureText, getJson } from "./admin-errors";
import { DataTable } from "./data-table";
import { formatWib } from "./format";
import { FormDialog, FormField } from "./form";
import { send, useOperationKey } from "./ops-api";
import { ErrorState, LoadingState } from "./states";
import { StatusBadge } from "./status";
import {
	GRANTABLE_ROLES,
	grantProblem,
	isFinancePermission,
	PERMISSION_GROUPS,
	ROLE_HINT,
	STAFF_MESSAGES,
	type StaffMember,
} from "./staff-model";
import { useKeysetList } from "./use-keyset-list";

// S137 (spec 17 B20, DEC-018 Q2): the owner's staff directory. Roles, delegated permissions and warehouse scope are
// replaced through the existing grantStaffRoles route; a lost authenticator is reset through staff-mfa-resets. Both
// need a fresh single-use proof (password plus MFA within five minutes), issued here and spent at once. Everything on
// this screen is also enforced by the API: hiding a button is never the authorization.

const PAGE_SIZE = 25;
type Warehouse = { id: string; name: string; city: string };
type WarehousePage = { data: Warehouse[]; pagination: { next_cursor: string | null } };

const warehousePage = (cursor: string | null) =>
	getJson<WarehousePage>(`/api/v1/admin/warehouses?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);

const text = (status: number, code: string | null) =>
	code && STAFF_MESSAGES[code] ? `${STAFF_MESSAGES[code]} (kode: ${code})` : failureText(describeFailure(status, code));

/** One proof for one purpose and target; the idempotency key is per call because a proof is single use. */
async function issueProof(password: string, action: "staff_roles.replace" | "staff_mfa.reset", subject: string) {
	const result = await send<{ proof: string }>(
		"POST",
		"/api/v1/me/reauthentication-proofs",
		{ password, action, subject_id: subject },
		{ get: () => crypto.randomUUID(), rotate: () => {} },
	);
	return result.ok ? result : { ...result, text: text(result.status, result.code) };
}

const checkboxClass = "size-4 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
function Check({
	id,
	label,
	hint,
	checked,
	disabled,
	testId,
	onChange,
}: {
	id: string;
	label: string;
	hint?: string;
	checked: boolean;
	disabled?: boolean;
	testId: string;
	onChange: (next: boolean) => void;
}) {
	return (
		<label htmlFor={id} className="flex items-start gap-3 py-1 text-sm pointer-coarse:min-h-11 pointer-coarse:items-center">
			<input
				id={id}
				type="checkbox"
				data-testid={testId}
				className={`${checkboxClass} mt-0.5 pointer-coarse:mt-0`}
				checked={checked}
				disabled={disabled}
				onChange={(event) => onChange(event.target.checked)}
			/>
			<span className="flex min-w-0 flex-col">
				<span className={disabled ? "text-muted-foreground" : "font-medium"}>{label}</span>
				{hint && <span className="text-xs text-muted-foreground">{hint}</span>}
			</span>
		</label>
	);
}

/** Active warehouses an owner may assign (the warehouses route lists every active warehouse for an owner). */
function useWarehouses() {
	const [state, setState] = useState<{ kind: "loading" } | { kind: "ready"; items: Warehouse[] } | { kind: "error"; message: string }>({ kind: "loading" });
	const load = useCallback(async () => {
		setState({ kind: "loading" });
		const items: Warehouse[] = [];
		let cursor: string | null = null;
		for (let page = 0; page < 30; page++) {
			const result = await warehousePage(cursor);
			if (!result.ok) return setState({ kind: "error", message: failureText(result.failure) });
			items.push(...result.data.data);
			cursor = result.data.pagination.next_cursor;
			if (!cursor) return setState({ kind: "ready", items });
		}
		setState({ kind: "error", message: "Daftar gudang terlalu panjang untuk dimuat." });
	}, []);
	useEffect(() => {
		void load();
	}, [load]);
	return { state, reload: load };
}

function RolesDialog({
	member,
	self,
	onClose,
	onDone,
}: {
	member: StaffMember;
	self: boolean;
	onClose: () => void;
	onDone: (message: string, endedOwnSession: boolean) => void;
}) {
	const ids = useId();
	const isOwner = member.roles.includes("owner");
	const [roles, setRoles] = useState<string[]>(member.roles.filter((role) => GRANTABLE_ROLES.includes(role)));
	const [granted, setGranted] = useState<string[]>(member.permissions);
	const [scope, setScope] = useState<string[]>(member.warehouses.filter((w) => w.active).map((w) => w.id));
	const [reason, setReason] = useState("");
	const [password, setPassword] = useState("");
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const warehouses = useWarehouses();
	const key = useOperationKey();
	const dropped = member.warehouses.filter((w) => !w.active).length;
	const toggle = (list: string[], set: (next: string[]) => void, value: string, on: boolean) =>
		set(on ? [...new Set([...list, value])] : list.filter((item) => item !== value));

	async function submit() {
		const problem = grantProblem(roles, granted, scope);
		if (problem) return setError(problem);
		if (!reason.trim()) return setError("Isi alasan perubahan.");
		if (!password) return setError("Isi kata sandi Anda.");
		if (warehouses.state.kind !== "ready") return setError("Daftar gudang belum dimuat.");
		setPending(true);
		setError(null);
		const proof = await issueProof(password, "staff_roles.replace", member.user_id);
		if (!proof.ok) {
			setPending(false);
			return setError(proof.text);
		}
		const result = await send<{ version: number }>(
			"POST",
			"/api/v1/admin/role-grants",
			{
				user_id: member.user_id,
				roles,
				permissions: granted,
				warehouse_ids: scope,
				expected_version: member.version,
				reason: reason.trim(),
				reauthentication_proof: proof.data.proof,
			},
			key,
		);
		setPending(false);
		if (!result.ok) return setError(text(result.status, result.code));
		setPassword("");
		onDone(
			isOwner
				? `${member.name} tidak lagi Super Admin. Semua sesinya berakhir.`
				: `Peran ${member.name} tersimpan (versi ${result.data.version}). Sesi ${member.name} berakhir; ia perlu masuk lagi.`,
			self,
		);
	}

	return (
		<FormDialog
			title={isOwner ? `Turunkan ${member.name} dari Super Admin` : `Atur peran ${member.name}`}
			description={`${member.email}. Menyimpan mengakhiri semua sesi akun ini.`}
			className="md:max-w-2xl"
			pending={pending}
			error={error}
			submitLabel={isOwner ? "Turunkan dan simpan" : "Simpan peran"}
			onClose={onClose}
			onSubmit={() => void submit()}
		>
			{isOwner && (
				<p className="rounded-md border border-warning/40 bg-warning-surface p-3 text-sm" data-testid="staff-owner-warning">
					{self
						? "Ini akun Anda. Setelah disimpan Anda tidak lagi Super Admin dan harus masuk lagi. Super Admin terakhir tidak bisa diturunkan."
						: "Akun ini Super Admin. Menyimpan menurunkannya; peran Super Admin tidak bisa diberikan lagi dari layar ini. Super Admin terakhir tidak bisa diturunkan."}
				</p>
			)}
			<fieldset className="flex flex-col gap-1">
				<legend className="mb-1 text-sm font-medium">Peran</legend>
				{GRANTABLE_ROLES.map((role) => (
					<Check
						key={role}
						id={`${ids}-role-${role}`}
						testId={`staff-role-${role}`}
						label={roleLabel(role)}
						hint={ROLE_HINT[role]}
						checked={roles.includes(role)}
						onChange={(on) => {
							toggle(roles, setRoles, role, on);
							// Finance permissions need the finance role; clearing the role clears them.
							if (role === "finance" && !on) setGranted(granted.filter((p) => !isFinancePermission(p)));
						}}
					/>
				))}
			</fieldset>
			<div className="flex flex-col gap-3">
				<p className="text-sm font-medium">Izin tambahan</p>
				{PERMISSION_GROUPS.map((group) => {
					const locked = group.needsFinance && !roles.includes("finance");
					return (
						<fieldset key={group.id} className="flex flex-col gap-0.5 rounded-md border p-3">
							<legend className="px-1 text-sm font-medium">{group.title}</legend>
							<p className="mb-1 text-xs text-muted-foreground">
								{locked ? "Aktifkan peran Keuangan untuk memberi izin ini." : group.hint}
							</p>
							{group.items.map((permission) => (
								<Check
									key={permission}
									id={`${ids}-perm-${permission}`}
									testId={`staff-perm-${permission}`}
									label={permissionLabel(permission)}
									checked={granted.includes(permission)}
									disabled={locked}
									onChange={(on) => toggle(granted, setGranted, permission, on)}
								/>
							))}
						</fieldset>
					);
				})}
			</div>
			<fieldset className="flex flex-col gap-1" data-testid="staff-warehouses">
				<legend className="mb-1 text-sm font-medium">Cakupan gudang</legend>
				<p className="text-xs text-muted-foreground">
					Berlaku untuk Gudang dan Admin E-Commerce. Wajib bila peran Gudang dipilih.
					{dropped > 0 && ` ${dropped} gudang nonaktif akan dilepas.`}
				</p>
				{warehouses.state.kind === "loading" ? (
					<LoadingState label="Memuat gudang…" lines={2} className="h-8 w-full" />
				) : warehouses.state.kind === "error" ? (
					<ErrorState message={warehouses.state.message} onRetry={() => void warehouses.reload()} />
				) : warehouses.state.items.length === 0 ? (
					<p className="text-sm text-muted-foreground">Belum ada gudang aktif.</p>
				) : (
					<div className="flex max-h-48 flex-col overflow-y-auto overscroll-contain rounded-md border p-2">
						{warehouses.state.items.map((warehouse) => (
							<Check
								key={warehouse.id}
								id={`${ids}-wh-${warehouse.id}`}
								testId={`staff-wh-${warehouse.id}`}
								label={warehouse.name}
								hint={warehouse.city}
								checked={scope.includes(warehouse.id)}
								onChange={(on) => toggle(scope, setScope, warehouse.id, on)}
							/>
						))}
					</div>
				)}
			</fieldset>
			<FormField id={`${ids}-reason`} label="Alasan perubahan (wajib)">
				<Input id={`${ids}-reason`} data-testid="staff-reason" value={reason} maxLength={500} autoComplete="off" onChange={(e) => setReason(e.target.value)} />
			</FormField>
			<FormField id={`${ids}-password`} label="Kata sandi Anda" hint="Dipakai satu kali untuk konfirmasi. Verifikasi dua langkah Anda harus masih berlaku (maksimal 5 menit).">
				<Input
					id={`${ids}-password`}
					data-testid="staff-password"
					type="password"
					autoComplete="current-password"
					maxLength={128}
					aria-describedby={`${ids}-password-hint`}
					value={password}
					onChange={(e) => setPassword(e.target.value)}
				/>
			</FormField>
		</FormDialog>
	);
}

function ResetDialog({ member, onClose, onDone }: { member: StaffMember; onClose: () => void; onDone: (message: string) => void }) {
	const ids = useId();
	const [reason, setReason] = useState("");
	const [password, setPassword] = useState("");
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const key = useOperationKey();
	async function submit() {
		if (!reason.trim()) return setError("Isi alasan reset.");
		if (!password) return setError("Isi kata sandi Anda.");
		setPending(true);
		setError(null);
		const proof = await issueProof(password, "staff_mfa.reset", member.user_id);
		if (!proof.ok) {
			setPending(false);
			return setError(proof.text);
		}
		const result = await send(
			"POST",
			"/api/v1/admin/staff-mfa-resets",
			{ user_id: member.user_id, reason: reason.trim(), reauthentication_proof: proof.data.proof },
			key,
		);
		setPending(false);
		if (!result.ok) return setError(text(result.status, result.code));
		setPassword("");
		onDone(`Verifikasi dua langkah ${member.name} direset. Semua sesinya berakhir; ia masuk dengan kata sandi lalu mendaftarkan autentikator baru.`);
	}
	return (
		<FormDialog
			title={`Reset verifikasi dua langkah ${member.name}`}
			description="Untuk autentikator yang hilang atau rusak. Kunci autentikator dan kode cadangan dihapus, semua sesi akun ini berakhir, dan ia harus mendaftarkan autentikator baru sebelum membuka layar staf."
			pending={pending}
			error={error}
			submitLabel="Reset verifikasi"
			pendingLabel="Mereset…"
			onClose={onClose}
			onSubmit={() => void submit()}
		>
			<FormField id={`${ids}-reason`} label="Alasan reset (wajib)">
				<Input id={`${ids}-reason`} data-testid="staff-reset-reason" value={reason} maxLength={500} autoComplete="off" onChange={(e) => setReason(e.target.value)} />
			</FormField>
			<FormField id={`${ids}-password`} label="Kata sandi Anda">
				<Input id={`${ids}-password`} data-testid="staff-reset-password" type="password" autoComplete="current-password" maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} />
			</FormField>
		</FormDialog>
	);
}

function RoleBadges({ roles }: { roles: string[] }) {
	if (roles.length === 0) return <span className="text-muted-foreground">Belum ada peran staf</span>;
	return (
		<span className="flex flex-wrap gap-1">
			{roles.map((role) => (
				<StatusBadge key={role} tone="neutral">
					{roleLabel(role)}
				</StatusBadge>
			))}
		</span>
	);
}

function MemberActions({
	member,
	self,
	onEdit,
	onReset,
}: {
	member: StaffMember;
	self: boolean;
	onEdit: (member: StaffMember) => void;
	onReset: (member: StaffMember) => void;
}) {
	return (
		// One line from md: two stacked buttons doubled the row height.
		<span className="flex flex-wrap gap-2 max-md:*:flex-1 md:flex-nowrap md:justify-end">
			<Button type="button" size="sm" variant="outline" data-testid="staff-edit" onClick={() => onEdit(member)}>
				<UserCog data-icon="inline-start" aria-hidden="true" />
				{member.roles.includes("owner") ? "Turunkan" : "Atur peran"}
				<span className="sr-only"> {member.name}</span>
			</Button>
			{!self && member.mfa_enabled && (
				<Button type="button" size="sm" variant="outline" data-testid="staff-reset" onClick={() => onReset(member)}>
					<KeyRound data-icon="inline-start" aria-hidden="true" />
					Reset MFA
					<span className="sr-only"> {member.name}</span>
				</Button>
			)}
		</span>
	);
}

function Lookup({ onEdit }: { onEdit: (member: StaffMember) => void }) {
	const id = useId();
	const [email, setEmail] = useState("");
	const [pending, setPending] = useState(false);
	const [found, setFound] = useState<StaffMember | null>(null);
	const [error, setError] = useState<string | null>(null);
	async function search() {
		const value = email.trim();
		if (!/^[^\s@]+@[^\s@]+$/.test(value)) {
			setFound(null);
			return setError("Isi alamat email lengkap, misalnya nama@contoh.id.");
		}
		setPending(true);
		setError(null);
		setFound(null);
		const result = await getJson<StaffMember>(`/api/v1/admin/staff/lookup?email=${encodeURIComponent(value)}`);
		setPending(false);
		if (result.ok) return setFound(result.data);
		setError(result.failure.status === 404 ? "Tidak ada akun dengan email itu. Email harus persis sama dengan yang didaftarkan." : failureText(result.failure));
	}
	return (
		<section aria-labelledby={`${id}-title`} className="flex flex-col gap-3 rounded-lg border p-4" data-testid="staff-lookup">
			<div className="flex flex-col gap-1">
				<h2 id={`${id}-title`} className="text-base font-semibold">
					Beri peran staf pada akun terdaftar
				</h2>
				<p className="text-sm text-muted-foreground">Cari akun dengan email yang persis sama. Pencarian ini tercatat di log audit.</p>
			</div>
			<form
				noValidate
				className="flex flex-col gap-2 md:flex-row md:items-start"
				onSubmit={(event) => {
					event.preventDefault();
					if (!pending) void search();
				}}
			>
				<div className="md:w-80">
					<FormField id={`${id}-email`} label="Email akun" hint={error ?? undefined}>
						<Input
							id={`${id}-email`}
							data-testid="staff-lookup-email"
							type="email"
							inputMode="email"
							autoComplete="off"
							maxLength={254}
							aria-invalid={error ? true : undefined}
							aria-describedby={error ? `${id}-email-hint` : undefined}
							value={email}
							onChange={(event) => setEmail(event.target.value)}
						/>
					</FormField>
				</div>
				<Button type="submit" disabled={pending} className="max-md:w-full md:mt-6" data-testid="staff-lookup-submit">
					<Search data-icon="inline-start" aria-hidden="true" />
					{pending ? "Mencari…" : "Cari akun"}
				</Button>
			</form>
			{found && (
				<div className="flex flex-col gap-2 rounded-md border bg-muted/40 p-3 md:flex-row md:items-center md:justify-between" data-testid="staff-lookup-result">
					<span className="flex min-w-0 flex-col gap-1">
						<span className="font-medium">{found.name}</span>
						<span className="text-sm break-all text-muted-foreground">{found.email}</span>
						<RoleBadges roles={found.roles} />
					</span>
					<Button type="button" data-testid="staff-lookup-open" className="max-md:w-full" onClick={() => onEdit(found)}>
						<UserCog data-icon="inline-start" aria-hidden="true" />
						{found.roles.includes("owner") ? "Turunkan" : found.roles.length ? "Atur peran" : "Jadikan staf"}
					</Button>
				</div>
			)}
		</section>
	);
}

export function StaffRolesClient() {
	const [selfId, setSelfId] = useState<string | null>(null);
	const list = useKeysetList<StaffMember>(`/api/v1/admin/staff?limit=${PAGE_SIZE}`, (row) => row.user_id);
	const [editing, setEditing] = useState<StaffMember | null>(null);
	const [resetting, setResetting] = useState<StaffMember | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [ended, setEnded] = useState(false);
	// A saved change makes the looked-up account stale (roles, version): the lookup starts empty again.
	const [lookupRun, setLookupRun] = useState(0);
	const noticeRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		void getJson<{ id: string }>("/api/v1/me").then((result) => result.ok && setSelfId(result.data.id));
	}, []);
	useEffect(() => {
		if (notice) noticeRef.current?.focus();
	}, [notice]);
	const done = (message: string, endedOwnSession = false) => {
		setEditing(null);
		setResetting(null);
		setNotice(message);
		setLookupRun((run) => run + 1);
		if (endedOwnSession) return setEnded(true);
		void list.reload();
	};
	if (ended)
		return (
			<Alert ref={noticeRef} tabIndex={-1} role="status" className="outline-none" data-testid="staff-ended">
				<CircleCheck aria-hidden="true" />
				<AlertDescription className="flex flex-col gap-3 text-foreground">
					<span>{notice}</span>
					<Button asChild className="self-start max-md:self-stretch">
						<a href="/masuk?next=%2Fadmin">Masuk lagi</a>
					</Button>
				</AlertDescription>
			</Alert>
		);
	return (
		<div className="flex flex-col gap-4">
			{notice && (
				<Alert ref={noticeRef} tabIndex={-1} role="status" className="outline-none" data-testid="staff-notice">
					<CircleCheck aria-hidden="true" />
					<AlertDescription className="text-foreground">{notice}</AlertDescription>
				</Alert>
			)}
			<Lookup key={lookupRun} onEdit={setEditing} />
			<DataTable
				testId="staff-table"
				caption="Staf dan peran"
				rows={list.rows}
				rowKey={(row) => row.user_id}
				rowTestId={() => "staff-row"}
				status={list.status}
				loadingLabel="Memuat daftar staf…"
				empty="Belum ada staf. Cari akun terdaftar di atas untuk memberinya peran."
				emptyTestId="staff-empty"
				stack
				paging={{ ...list.paging, testId: "staff-more", summary: `${list.rows.length} staf ditampilkan` }}
				columns={[
					{
						id: "name",
						header: "Staf",
						stack: "title",
						// The long sign-in email wraps instead of widening the table.
						cellClassName: "whitespace-normal md:min-w-56",
						cell: (row) => (
							<span className="flex min-w-0 flex-col">
								<span className="font-medium">
									{row.name}
									{row.user_id === selfId && <span className="font-normal text-muted-foreground"> (Anda)</span>}
								</span>
								<span className="text-xs font-normal break-all text-muted-foreground">{row.email}</span>
							</span>
						),
					},
					{ id: "roles", header: "Peran", stack: "status", cell: (row) => <RoleBadges roles={row.roles} /> },
					{
						id: "permissions",
						header: "Izin tambahan",
						cellClassName: "whitespace-normal",
						cell: (row) =>
							row.permissions.length ? (
								<span className="text-xs">{row.permissions.map(permissionLabel).join(", ")}</span>
							) : (
								<span className="text-muted-foreground">—</span>
							),
					},
					{
						id: "warehouses",
						header: "Gudang",
						cellClassName: "whitespace-normal",
						cell: (row) =>
							row.roles.includes("owner") ? (
								"Semua gudang"
							) : row.warehouses.length ? (
								<span className="text-xs">
									{row.warehouses.map((w) => (w.active ? w.name : `${w.name} (nonaktif)`)).join(", ")}
								</span>
							) : (
								<span className="text-muted-foreground">—</span>
							),
					},
					{
						id: "mfa",
						header: "MFA",
						stack: "aside",
						cell: (row) =>
							row.mfa_enabled ? (
								<StatusBadge tone="success">Aktif</StatusBadge>
							) : (
								<StatusBadge tone="problem">Belum aktif</StatusBadge>
							),
					},
					{
						id: "last",
						header: "Sesi terakhir",
						stack: "meta",
						kind: "datetime",
						hideBelow: "5xl",
						cell: (row) => (row.last_sign_in_at ? formatWib(row.last_sign_in_at) : "Tidak ada sesi aktif"),
					},
					{
						id: "actions",
						header: <span className="sr-only">Aksi</span>,
						className: "text-right",
						cell: (row) => <MemberActions member={row} self={row.user_id === selfId} onEdit={setEditing} onReset={setResetting} />,
					},
				]}
			/>
			{editing && (
				<RolesDialog member={editing} self={editing.user_id === selfId} onClose={() => setEditing(null)} onDone={done} />
			)}
			{resetting && <ResetDialog member={resetting} onClose={() => setResetting(null)} onDone={done} />}
		</div>
	);
}
