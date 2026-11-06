import assert from "node:assert/strict";
import test from "node:test";
import { createLocalAuth } from "../../src/modules/access/auth.ts";
import { ensureDefaultTemplates } from "../../src/modules/documents/label-templates.ts";
import { handleShippingLabels } from "../../src/modules/documents/labels.ts";
import { actor, cleanup, enroll } from "../contract/access-fixture.ts";

// S130 follow-up (R3 audit attribution): the two built-in label templates are created by the first
// reader of a database. Their version 1 must be attributed to the system, never to whichever
// staff member happened to read first, and creation must be idempotent under concurrent first reads.
const DEFAULT_CODES = ["99ribu-thermal-default", "99ribu-a4-default"];

test("S130 default label templates are created once, attributed to the system, whoever reads first", async () => {
	const identity = createLocalAuth("test");
	const sql = identity.sql;
	const users: { id: string; email: string }[] = [];
	const parked = `parked-${crypto.randomUUID()}`;
	// Concurrency gate: released in `finally` so a failed assertion can never leave a transaction
	// holding the default codes while the parked rows are restored.
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const open: Promise<unknown>[] = [];

	// A "fresh database": park any default rows that earlier suites created under their own codes.
	// Everything is restored in `finally`; the rows created here are removed before restoring.
	const removeCreatedDefaults = async () => {
		await sql`delete from app.shipping_label_template_version where template_id in (select id from app.shipping_label_template where code = any(${DEFAULT_CODES}))`;
		await sql`delete from app.shipping_label_template where code = any(${DEFAULT_CODES})`;
	};
	const defaultsRows = async () =>
		sql<{ code: string; revision: number; actor_id: string; reason: string }[]>`
			select t.code, v.revision, v.actor_id, v.reason
			from app.shipping_label_template t
			join app.shipping_label_template_version v on v.template_id = t.id
			where t.code = any(${DEFAULT_CODES})
			order by t.code, v.revision`;

	await sql`update app.shipping_label_template set code = ${`${parked}-`} || code where code = any(${DEFAULT_CODES})`;
	try {
		const finance = await actor(identity, "finance", []);
		const owner = await actor(identity, "owner", []);
		users.push(finance, owner);
		await enroll(finance.browser, finance.password);
		await enroll(owner.browser, owner.password);

		// 1. A read-only finance user is the first reader.
		const first = await handleShippingLabels(
			finance.browser.request("/api/v1/admin/shipping-label-templates"),
			identity,
		);
		assert.equal(first.status, 200);
		const firstJson = await first.json();
		const listed = firstJson.data.filter((t: { name: string }) =>
			DEFAULT_CODES.includes(t.name),
		);
		assert.equal(listed.length, 2);
		for (const t of listed) {
			assert.deepEqual(
				t.history.map((h: { version: number; actor_id: string }) => [
					h.version,
					h.actor_id,
				]),
				[[1, "system"]],
				"history shows the system, not the reader",
			);
		}
		const created = await defaultsRows();
		assert.deepEqual(
			created.map((r) => [r.code, r.revision, r.actor_id]),
			[
				["99ribu-a4-default", 1, "system"],
				["99ribu-thermal-default", 1, "system"],
			],
		);
		const [{ n: staffRefs }] = await sql<{ n: number }[]>`
			select count(*)::int as n from app.shipping_label_template_version
			where actor_id = any(${[finance.id, owner.id]})`;
		assert.equal(staffRefs, 0, "no template version names a staff user");

		// 2. A later reader (another role) changes nothing.
		const before = await sql`select id, template_id, revision from app.shipping_label_template_version where template_id in (select id from app.shipping_label_template where code = any(${DEFAULT_CODES})) order by id`;
		const second = await handleShippingLabels(
			owner.browser.request("/api/v1/admin/shipping-label-templates"),
			identity,
		);
		assert.equal(second.status, 200);
		assert.deepEqual(
			await sql`select id, template_id, revision from app.shipping_label_template_version where template_id in (select id from app.shipping_label_template where code = any(${DEFAULT_CODES})) order by id`,
			before,
		);

		// 3. Concurrent first reads: the second transaction waits on the first one's uncommitted row,
		// then does nothing. One template and one version each, attributed to the system.
		await removeCreatedDefaults();
		let inserted!: () => void;
		const firstInserted = new Promise<void>((resolve) => {
			inserted = resolve;
		});
		let firstPid!: number;
		const tx1 = sql.begin(async (tx) => {
			[{ pid: firstPid }] = await tx<{ pid: number }[]>`select pg_backend_pid() as pid`;
			await ensureDefaultTemplates(tx);
			inserted();
			await gate;
		});
		open.push(tx1);
		// A tx1 failure before it signals must fail the test instead of hanging it.
		await Promise.race([firstInserted, tx1]);
		let secondPid!: number;
		const tx2 = sql.begin(async (tx) => {
			[{ pid: secondPid }] = await tx<{ pid: number }[]>`select pg_backend_pid() as pid`;
			await ensureDefaultTemplates(tx);
		});
		open.push(tx2);
		// tx2 is blocked by tx1 specifically (not by an unrelated waiter in the instance).
		let blocked = false;
		for (let attempt = 0; attempt < 200 && !blocked; attempt++) {
			if (secondPid !== undefined) {
				const [{ blockers }] = await sql<{ blockers: number[] }[]>`
					select pg_blocking_pids(${secondPid}::int) as blockers`;
				blocked = blockers.includes(firstPid);
			}
			if (!blocked) await new Promise((resolve) => setTimeout(resolve, 25));
		}
		assert.ok(blocked, "the second creator waits for the first");
		release();
		await Promise.all([tx1, tx2]);
		assert.deepEqual(
			(await defaultsRows()).map((r) => [r.code, r.revision, r.actor_id]),
			[
				["99ribu-a4-default", 1, "system"],
				["99ribu-thermal-default", 1, "system"],
			],
		);
	} finally {
		release();
		await Promise.allSettled(open);
		await removeCreatedDefaults();
		await sql`update app.shipping_label_template set code = substr(code, ${parked.length + 2}) where code like ${`${parked}-%`}`;
		await cleanup(identity, users);
		await sql.end();
	}
});
