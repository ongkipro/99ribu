import { createHash, randomUUID } from "node:crypto";
import postgres from "postgres";
import type { LocalAuth } from "../../access/auth.ts";
import { consumeAccessProof } from "../../access/grants.ts";
import { assertOrigin, privateJson, problem } from "../../access/http.ts";
import {
	AccessError,
	getPrincipal,
	type Principal,
} from "../../access/policy.ts";
import { id, integer, invalid, object } from "../../catalog/validation.ts";
import { financeAuthority } from "../../finance/costs.ts";
import {
	assertInventoryWarehouse,
	lockInventoryClock,
	postMovement,
} from "../../inventory/state.ts";
import {
	assertReturnInspection,
	returnAuthority,
} from "../../returns/authority.ts";
import { returnText } from "../../returns/policy.ts";
import { refundFinanceAuthority } from "../../returns/refunds.ts";
import { type CommerceActor, commerceActor } from "../access.ts";
import {
	intentHash,
	mutationKey,
	priorOperation,
	recordOperation,
} from "../carts.ts";
import { expireOwnedOrderJob } from "../expiry.ts";
import { authorizeOrder, type OrderRow, projectOrder } from "../orders.ts";
import { applyException } from "./applications.ts";
import {
	advanceException,
	type ExceptionHead,
	type ExceptionKind,
	type ExceptionStatus,
	finishExceptionOperation,
	insertExceptionOperation,
	lockException,
} from "./core.ts";
import {
	buyerRecoveryRequest,
	exceptionIntakeRequest,
	recoveryFinanceRequest,
} from "./policy.ts";
import { projectException } from "./projection.ts";
import { chooseExceptionProposal, decideException } from "./proposals.ts";
import { recoverRecoveryCallbacks } from "./refund-worker.ts";
import {
	acceptRecoveryDestination,
	queueRecoveryRefund,
	retryRecoveryRefund,
} from "./refunds.ts";
import { labelExceptions, numberException } from "./read-labels.ts";
import { reportStockDiscrepancy } from "./stock.ts";

const adminRoot = "/api/v1/admin/commerce-exceptions";

const EXCEPTION_KINDS: readonly ExceptionKind[] = [
	"late_collection",
	"unallocated_collection",
	"stock_discrepancy",
	"cod_refusal",
	"delivery_failure",
	"replacement_stock",
	"waybill_uncertain",
];

const EXCEPTION_STATUSES: readonly ExceptionStatus[] = [
	"open",
	"awaiting_source",
	"awaiting_buyer",
	"awaiting_stock",
	"awaiting_return",
	"ready_for_refund",
	"refunding",
	"unknown",
	"resolved",
	"escalated",
];

function parseListLimit(url: URL) {
	const raw = url.searchParams.get("limit") ?? "20";
	if (!/^(?:[1-9]|[1-9][0-9]|100)$/.test(raw)) throw invalid();
	return integer(Number(raw), 1, 100);
}

async function exceptionWarehouses(
	tx: postgres.TransactionSql,
	head: Pick<
		ExceptionHead,
		"id" | "order_id" | "kind" | "source_kind" | "source_id"
	>,
) {
	const rows = await tx<{ warehouse_id: string }[]>`
    select distinct scoped.warehouse_id from (
      select coalesce(replacement.warehouse_id,original.warehouse_id) warehouse_id from app.exception_unit u
       join app.fulfillment_item f on f.id=u.fulfillment_item_id join app.order_shipment original on original.id=f.shipment_id
       left join app.replacement_link link on link.id=u.replacement_link_id left join app.replacement_shipment replacement on replacement.id=link.shipment_id
       where u.exception_id=${head.id}
      union all
      select s.warehouse_id from app.order_shipment s where s.order_id=${head.order_id} and ${head.kind}='unallocated_collection'
       and (${head.source_kind}='payment_event' or (${head.source_kind}='cod_event' and exists(
        select 1 from app.local_cod_event e join app.local_cod_operation operation on operation.id=e.operation_id
         where e.id=${head.source_id} and operation.shipment_id=s.id)))
    ) scoped order by scoped.warehouse_id`;
	return rows.map((row) => String(row.warehouse_id));
}

async function authorizeExceptionRead(
	tx: postgres.TransactionSql,
	principal: Principal,
	head: Pick<
		ExceptionHead,
		"id" | "order_id" | "kind" | "source_kind" | "source_id"
	>,
) {
	const warehouses = await exceptionWarehouses(tx, head);
	const access = await returnAuthority(tx, principal);
	if (!warehouses.length) throw new AccessError(404, "NOT_FOUND");
	if (
		!access.owner &&
		!access.finance &&
		warehouses.some((w) => !access.warehouseIds.includes(w))
	) {
		throw new AccessError(404, "NOT_FOUND");
	}
	return { access, warehouses };
}

function rejectUnsupportedHeaders(request: Request, names: readonly string[]) {
	if (names.some((name) => request.headers.has(name))) {
		throw new AccessError(401, "UNSUPPORTED_AUTH_TRANSPORT");
	}
}

async function readExceptionBody(
	request: Request,
	maxBytes: 16384 | 131072 = 16384,
): Promise<Record<string, unknown>> {
	if (
		request.headers
			.get("content-type")
			?.split(";", 1)[0]
			.trim()
			.toLowerCase() !== "application/json"
	) {
		throw new AccessError(415, "INVALID_INPUT");
	}
	const reader = request.body?.getReader();
	if (!reader) throw new AccessError(400, "INVALID_INPUT");
	const chunks: Uint8Array[] = [];
	let size = 0;
	while (true) {
		const chunk = await reader.read();
		if (chunk.done) break;
		size += chunk.value.length;
		if (size > maxBytes) {
			await reader.cancel();
			throw new AccessError(413, "BODY_TOO_LARGE");
		}
		chunks.push(chunk.value);
	}
	let value: unknown;
	try {
		value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
	} catch {
		throw new AccessError(400, "INVALID_INPUT");
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new AccessError(400, "INVALID_INPUT");
	}
	return value as Record<string, unknown>;
}

function parseAdminListQuery(url: URL) {
	for (const key of url.searchParams.keys()) {
		if (!["cursor", "limit", "kind", "status"].includes(key)) throw invalid();
	}
	if (
		url.searchParams.getAll("cursor").length > 1 ||
		url.searchParams.getAll("limit").length > 1 ||
		url.searchParams.getAll("kind").length > 1 ||
		url.searchParams.getAll("status").length > 1
	) {
		throw invalid();
	}
	const cursor = url.searchParams.get("cursor");
	const kind = url.searchParams.get("kind");
	const status = url.searchParams.get("status");
	if (kind !== null && !EXCEPTION_KINDS.includes(kind as ExceptionKind)) {
		throw invalid();
	}
	if (
		status !== null &&
		!EXCEPTION_STATUSES.includes(status as ExceptionStatus)
	) {
		throw invalid();
	}
	return {
		cursor: cursor === null ? null : id(cursor),
		limit: parseListLimit(url),
		kind: kind as ExceptionKind | null,
		status: status as ExceptionStatus | null,
	};
}

function parseBuyerRecoveryQuery(url: URL) {
	for (const key of url.searchParams.keys()) {
		if (!["cursor", "limit"].includes(key)) throw invalid();
	}
	if (
		url.searchParams.getAll("cursor").length > 1 ||
		url.searchParams.getAll("limit").length > 1
	) {
		throw invalid();
	}
	const cursor = url.searchParams.get("cursor");
	return {
		cursor: cursor === null ? null : id(cursor),
		limit: parseListLimit(url),
	};
}

async function listCommerceExceptions(
	identity: LocalAuth,
	url: URL,
	principal: Principal,
) {
	const query = parseAdminListQuery(url);
	return identity.sql.begin(async (tx) => {
		const access = await returnAuthority(tx, principal);
		const scope = tx`exists(
      select 1 from (
        select coalesce(replacement.warehouse_id,original.warehouse_id) warehouse_id from app.exception_unit u
         join app.fulfillment_item f on f.id=u.fulfillment_item_id join app.order_shipment original on original.id=f.shipment_id
         left join app.replacement_link link on link.id=u.replacement_link_id left join app.replacement_shipment replacement on replacement.id=link.shipment_id
         where u.exception_id=c.id
        union all
        select s.warehouse_id from app.order_shipment s where s.order_id=c.order_id and c.kind='unallocated_collection'
         and (c.source_kind='payment_event' or (c.source_kind='cod_event' and exists(
          select 1 from app.local_cod_event e join app.local_cod_operation operation on operation.id=e.operation_id
           where e.id=c.source_id and operation.shipment_id=s.id)))
      ) scoped
    ) and (${access.owner || access.finance} or not exists(
      select 1 from (
        select coalesce(replacement.warehouse_id,original.warehouse_id) warehouse_id from app.exception_unit u
         join app.fulfillment_item f on f.id=u.fulfillment_item_id join app.order_shipment original on original.id=f.shipment_id
         left join app.replacement_link link on link.id=u.replacement_link_id left join app.replacement_shipment replacement on replacement.id=link.shipment_id
         where u.exception_id=c.id
        union all
        select s.warehouse_id from app.order_shipment s where s.order_id=c.order_id and c.kind='unallocated_collection'
         and (c.source_kind='payment_event' or (c.source_kind='cod_event' and exists(
          select 1 from app.local_cod_event e join app.local_cod_operation operation on operation.id=e.operation_id
           where e.id=c.source_id and operation.shipment_id=s.id)))
      ) scoped where not (scoped.warehouse_id = any(${access.warehouseIds}::uuid[]))
    ))`;
		const filter = tx`c.status<>'preparing' and ${scope}
      ${query.kind ? tx`and c.kind=${query.kind}` : tx``}
      ${query.status ? tx`and c.status=${query.status}` : tx``}`;
		let after: { id: string; recorded_at: string } | null = null;
		if (query.cursor) {
			const [row] = await tx<{ id: string; recorded_at: string }[]>`
        select c.id,c.recorded_at from app.commerce_exception c where c.id=${query.cursor} and ${filter} for share of c`;
			if (!row) throw invalid();
			after = row;
		}
		const rows = await tx<{ id: string }[]>`
      select c.id from app.commerce_exception c
       where ${filter} ${after ? tx`and (c.recorded_at,c.id)<(${after.recorded_at},${after.id}::uuid)` : tx``}
       order by c.recorded_at desc,c.id desc limit ${query.limit + 1} for share of c`;
		const slice = rows.slice(0, query.limit);
		const data = [];
		for (const row of slice) {
			data.push(await projectException(tx, row.id, false));
		}
		const [now] = await tx`select clock_timestamp() as now`;
		await returnAuthority(tx, principal);
		await tx`insert into app.audit_event (actor_id,action,subject_id,outcome,reason)
      values (${principal.id},'commerce_exception.list',null,'allowed','Listed scoped commerce exceptions')`;
		return {
			data: await labelExceptions(tx, data),
			pagination: {
				next_cursor:
					rows.length > query.limit ? (slice.at(-1)?.id ?? null) : null,
			},
			as_of: new Date(now.now).toISOString(),
		};
	});
}

async function getCommerceException(
	identity: LocalAuth,
	principal: Principal,
	exceptionId: string,
) {
	const selected = id(exceptionId);
	return identity.sql.begin(async (tx) => {
		await returnAuthority(tx, principal);
		const [head] = await tx<
			{
				id: string;
				order_id: string;
				kind: ExceptionKind;
				status: ExceptionStatus;
				source_kind: string;
				source_id: string;
			}[]
		>`
      select id,order_id,kind,status,source_kind,source_id from app.commerce_exception
       where id=${selected} and status<>'preparing' for share`;
		if (!head) throw new AccessError(404, "NOT_FOUND");
		await authorizeExceptionRead(tx, principal, head);
		const [body] = await labelExceptions(tx, [
			await projectException(tx, head.id, false),
		]);
		await authorizeExceptionRead(tx, principal, head);
		await tx`insert into app.audit_event (actor_id,action,subject_id,outcome,reason)
      values (${principal.id},'commerce_exception.read',${head.id},'allowed','Read scoped commerce exception')`;
		return body;
	});
}

// Finance read of every original-source compensation of one case. The case head holds no
// refund ids, so this is the only way a screen can find them again after a reload.
async function listRecoveryRefunds(
	identity: LocalAuth,
	principal: Principal,
	exceptionId: string,
) {
	const selected = id(exceptionId);
	return identity.sql.begin(async (tx) => {
		await returnAuthority(tx, principal);
		await financeAuthority(tx, principal, "finance.refunds.read");
		const [head] = await tx<
			{
				id: string;
				order_id: string;
				kind: ExceptionKind;
				status: ExceptionStatus;
				source_kind: string;
				source_id: string;
				revision: number;
			}[]
		>`
      select id,order_id,kind,status,source_kind,source_id,revision from app.commerce_exception
       where id=${selected} and status<>'preparing' for share`;
		if (!head) throw new AccessError(404, "NOT_FOUND");
		await authorizeExceptionRead(tx, principal, head);
		const rows = await tx<{ value: Record<string, unknown> }[]>`
      select app.recovery_refund_projection(r.id) value from app.recovery_refund r
       where r.exception_id=${head.id} order by r.created_at,r.id`;
		await returnAuthority(tx, principal);
		await financeAuthority(tx, principal, "finance.refunds.read");
		await tx`insert into app.audit_event (actor_id,action,subject_id,outcome,reason)
      values (${principal.id},'commerce_exception.refunds_read',${head.id},'allowed','Listed recovery refunds of one commerce exception')`;
		return {
			exception_id: head.id,
			version: head.revision,
			refunds: rows.map((row) => row.value),
		};
	});
}

async function recordExceptionIntake(
	request: Request,
	identity: LocalAuth,
	principal: Principal,
	exceptionId: string,
	value: unknown,
) {
	const selected = id(exceptionId);
	const input = exceptionIntakeRequest(value);
	const key = mutationKey(request);
	const hash = await intentHash(identity, "commerce_exception.intake", {
		exception_id: selected,
		...input,
	});
	return identity.sql.begin(async (tx) => {
		let access = await returnAuthority(tx, principal);
		const { order, head } = await lockException(tx, selected);
		const warehouses = await exceptionWarehouses(tx, head);
		assertReturnInspection(access, warehouses);
		if (head.kind === "unallocated_collection") {
			throw new AccessError(409, "EXCEPTION_INTAKE_NOT_ELIGIBLE");
		}
		const [prior] = await tx`
      select exception_id,request_hash,response
        from app.exception_operation
       where actor_scope=${`user:${principal.id}`} and action='intake' and key=${key}`;
		if (prior) {
			if (prior.exception_id !== head.id || prior.request_hash !== hash) {
				throw new AccessError(409, "IDEMPOTENCY_CONFLICT");
			}
			access = await returnAuthority(tx, principal);
			assertReturnInspection(access, warehouses);
			return prior.response as Record<string, unknown>;
		}
		if (head.revision !== input.expected_version) {
			throw new AccessError(409, "VERSION_CONFLICT");
		}
		const [outcome] = await tx<
			{
				id: string;
				shipment_id: string;
				status: string;
				occurred_at: string;
				unit_ids: string[];
			}[]
		>`
      select o.id,o.shipment_id,o.status,o.occurred_at,o.unit_ids
        from app.local_parcel_outcome o
        join app.parcel_outcome_result r on r.event_id=o.id
       where o.id=${input.physical_outcome_id}
         and o.status='returned_to_sender'
         and r.outcome='observed'
         and (r.exception_ids ? ${head.id})`;
		if (!outcome) {
			throw new AccessError(409, "EXCEPTION_INTAKE_OUTCOME_INVALID");
		}
		const unitIds = [
			...new Set(input.lines.map((line) => line.exception_unit_id)),
		].sort();
		const units = await tx<
			{
				id: string;
				fulfillment_item_id: string;
				replacement_link_id: string | null;
				shipment_id: string;
				warehouse_id: string;
			}[]
		>`
      select u.id,u.fulfillment_item_id,u.replacement_link_id,f.shipment_id,s.warehouse_id
        from app.exception_unit u
        join app.fulfillment_item f on f.id=u.fulfillment_item_id
        join app.order_shipment s on s.id=f.shipment_id
       where u.exception_id=${head.id} and u.id in ${tx(unitIds)}
       order by u.id`;
		if (
			units.length !== unitIds.length ||
			units.some(
				(u) =>
					u.replacement_link_id !== null ||
					u.shipment_id !== outcome.shipment_id ||
					!outcome.unit_ids.includes(u.fulfillment_item_id),
			)
		) {
			throw new AccessError(409, "EXCEPTION_INTAKE_SCOPE_INVALID");
		}
		const lineWarehouses = [
			...new Set(units.map((u) => u.warehouse_id)),
		].sort();
		assertReturnInspection(access, lineWarehouses);
		await lockInventoryClock(tx, order.clock_namespace, lineWarehouses);
		const fulfillmentIds = [
			...new Set(units.map((u) => u.fulfillment_item_id)),
		].sort();
		await tx`select id from app.fulfillment_item where id in ${tx(fulfillmentIds)} order by id for update`;
		const unitById = new Map(units.map((u) => [u.id, u]));
		const incomingByUnitBalance = new Map<string, number>();
		for (const line of input.lines) {
			const unit = unitById.get(line.exception_unit_id);
			if (!unit) throw new AccessError(409, "EXCEPTION_INTAKE_SCOPE_INVALID");
			if (line.identity_confirmed) {
				if (!line.stock_item_id || !line.expected_balance_id) throw invalid();
				await assertInventoryWarehouse(tx, unit.warehouse_id, {
					owner: access.owner,
					roles: access.principal.roles,
					warehouseIds: access.warehouseIds,
				});
				const [allocated] = await tx<{ quantity: string }[]>`
          select a.quantity
            from app.fulfillment_component_allocation a
            join app.inventory_balance b on b.id=a.balance_id
           where a.fulfillment_item_id=${unit.fulfillment_item_id}
             and a.balance_id=${line.expected_balance_id}
             and a.stock_item_id=${line.stock_item_id}
             and b.warehouse_id=${unit.warehouse_id}
           for update of b`;
				if (!allocated) {
					throw new AccessError(409, "EXCEPTION_INTAKE_COMPONENT_INVALID");
				}
				const [basis] = await tx<{ known_quantity: string }[]>`
          select known_quantity from app.physical_intake_basis(${unit.fulfillment_item_id}::uuid,null,${line.expected_balance_id}::uuid)`;
				const keyPair = `${unit.fulfillment_item_id}:${line.expected_balance_id}`;
				const nextKnown =
					Number(basis?.known_quantity ?? 0) +
					(incomingByUnitBalance.get(keyPair) ?? 0) +
					line.quantity;
				if (nextKnown > Number(allocated.quantity)) {
					throw new AccessError(409, "EXCEPTION_INTAKE_QUANTITY_EXCEEDED");
				}
				incomingByUnitBalance.set(
					keyPair,
					(incomingByUnitBalance.get(keyPair) ?? 0) + line.quantity,
				);
			}
		}
		access = await returnAuthority(tx, principal);
		assertReturnInspection(access, lineWarehouses);
		const operation = await insertExceptionOperation(
			tx,
			head,
			{ kind: "user", id: principal.id, principal: access.principal },
			key,
			"intake",
			head.id,
			hash,
			input,
		);
		if (Date.parse(outcome.occurred_at) > Date.parse(operation.occurred_at)) {
			throw new AccessError(409, "EXCEPTION_INTAKE_TIME_INVALID");
		}
		let nextStatus: ExceptionStatus = head.status as ExceptionStatus;
		if (head.status === "awaiting_return") {
			const consumedComponents = await tx<
				{
					fulfillment_item_id: string;
					balance_id: string;
					quantity: string;
					known_quantity: string;
				}[]
			>`
        select c.fulfillment_item_id,a.balance_id,a.quantity,intake.known_quantity
          from app.exception_cancellation c
          join app.fulfillment_component_allocation a on a.fulfillment_item_id=c.fulfillment_item_id
          cross join lateral app.physical_intake_basis(c.fulfillment_item_id,null,a.balance_id) intake
         where c.exception_id=${head.id} and c.stock_disposition='consumed'`;
			if (
				consumedComponents.length > 0 &&
				consumedComponents.every(
					(row) =>
						Number(row.known_quantity) +
							(incomingByUnitBalance.get(
								`${row.fulfillment_item_id}:${row.balance_id}`,
							) ?? 0) >=
						Number(row.quantity),
				)
			) {
				nextStatus = "resolved";
			}
		}
		const event = await advanceException(tx, head, {
			kind: "intake",
			status: nextStatus,
			source_kind: "operation",
			source_id: operation.id,
			actor_id: principal.id,
			reason: input.reason,
			occurred_at: operation.occurred_at,
			proposal_event_id:
				nextStatus === "resolved" ? null : head.proposal_event_id,
		});
		const intakeId = randomUUID();
		await tx`
      insert into app.exception_goods_intake (id,exception_id,operation_id,event_id,physical_outcome_id,occurred_at)
      values (${intakeId},${head.id},${operation.id},${event.eventId},${outcome.id},${operation.occurred_at})`;
		for (const line of input.lines) {
			const lineId = randomUUID();
			let movementId: string | null = null;
			if (
				line.identity_confirmed &&
				line.expected_balance_id &&
				line.stock_item_id
			) {
				const movement = await postMovement(tx, {
					balanceId: line.expected_balance_id,
					kind: "receive",
					quantity: line.quantity,
					onHand: line.quantity,
					reserved: 0,
					quarantined: line.quantity,
					sourceRef: `exception-goods:${lineId}`,
					actorId: principal.id,
					reason: input.reason,
				});
				movementId = movement.id;
			}
			await tx`
        insert into app.exception_goods_line (id,exception_id,intake_id,exception_unit_id,stock_item_id,balance_id,quantity,identity_confirmed,stock_movement_id)
        values (${lineId},${head.id},${intakeId},${line.exception_unit_id},${line.stock_item_id},${line.expected_balance_id},${line.quantity},${line.identity_confirmed},${movementId})`;
		}
		access = await returnAuthority(tx, principal);
		assertReturnInspection(access, lineWarehouses);
		return finishExceptionOperation(
			tx,
			operation.id,
			await projectException(tx, head.id, false),
		);
	});
}

async function getRecoveryRefund(
	identity: LocalAuth,
	principal: Principal,
	exceptionId: string,
	refundId: string,
) {
	const selectedException = id(exceptionId);
	const selectedRefund = id(refundId);
	return identity.sql.begin(async (tx) => {
		await returnAuthority(tx, principal);
		await financeAuthority(tx, principal, "finance.refunds.read");
		const [head] = await tx`
      select id from app.recovery_refund
       where id=${selectedRefund} and exception_id=${selectedException}
       for share`;
		if (!head) throw new AccessError(404, "NOT_FOUND");
		const [row] =
			await tx`select app.recovery_refund_projection(${selectedRefund}::uuid) value`;
		await returnAuthority(tx, principal);
		await financeAuthority(tx, principal, "finance.refunds.read");
		await tx`insert into app.audit_event (actor_id,action,subject_id,outcome,reason)
      values (${principal.id},'commerce_exception.refund_read',${selectedRefund},'allowed','Read recovery refund obligation')`;
		return row.value as Record<string, unknown>;
	});
}

async function reconcileRecoveryRefund(
	request: Request,
	identity: LocalAuth,
	principal: Principal,
	exceptionId: string,
	refundId: string,
	value: unknown,
) {
	const selectedException = id(exceptionId);
	const selectedRefund = id(refundId);
	const input = recoveryFinanceRequest(value);
	const key = mutationKey(request);
	const storedInput = {
		expected_version: input.expected_version,
		reason: input.reason,
	};
	const hash = await intentHash(
		identity,
		"commerce_exception.refund_reconcile",
		{
			exception_id: selectedException,
			refund_id: selectedRefund,
			...storedInput,
		},
	);
	const proofDigest = createHash("sha256")
		.update(input.reauthentication_proof)
		.digest("hex");
	return identity.sql.begin(async (tx) => {
		await refundFinanceAuthority(tx, principal, true);
		const { head } = await lockException(tx, selectedException);
		const [refund] = await tx<
			{
				id: string;
				revision: number;
				status: string;
				current_job_id: string | null;
			}[]
		>`
      select id,revision,status,current_job_id from app.recovery_refund
       where id=${selectedRefund} and exception_id=${head.id}
       for update`;
		if (!refund) throw new AccessError(404, "NOT_FOUND");
		const [prior] = await tx`
      select subject_id,request_hash,response
        from app.exception_operation
       where actor_scope=${`user:${principal.id}`} and action='refund_reconcile' and key=${key}`;
		if (prior) {
			if (prior.subject_id !== refund.id || prior.request_hash !== hash) {
				throw new AccessError(409, "IDEMPOTENCY_CONFLICT");
			}
			await refundFinanceAuthority(tx, principal, true);
			return prior.response as Record<string, unknown>;
		}
		if (refund.revision !== integer(input.expected_version, 1, 1000000000)) {
			throw new AccessError(409, "VERSION_CONFLICT");
		}
		await refundFinanceAuthority(tx, principal, true);
		const operation = await insertExceptionOperation(
			tx,
			head,
			{ kind: "user", id: principal.id, principal },
			key,
			"refund_reconcile",
			refund.id,
			hash,
			storedInput,
			proofDigest,
		);
		// Same callback owner as the host path: re-registers committed bank
		// events and re-arms a failed callback without an applied result (S71).
		await recoverRecoveryCallbacks(tx, refund.id, principal.id, operation.id);
		if (refund.current_job_id) {
			await tx`
        update app.outbox_job
           set run_at=clock_timestamp()
         where id=${refund.current_job_id} and status='pending'`;
		}
		await consumeAccessProof(
			tx,
			principal,
			"finance.recovery_refund",
			refund.id,
			input.reauthentication_proof,
		);
		await refundFinanceAuthority(tx, principal, true);
		const [projected] =
			await tx`select app.recovery_refund_projection(${refund.id}::uuid) value`;
		return finishExceptionOperation(
			tx,
			operation.id,
			projected.value as Record<string, unknown>,
		);
	});
}

async function listOrderRecoveryActions(
	request: Request,
	url: URL,
	identity: LocalAuth,
	actor: CommerceActor | null,
	orderId: string,
) {
	const selectedOrder = id(orderId);
	const query = parseBuyerRecoveryQuery(url);
	return identity.sql.begin(async (tx) => {
		const order = await authorizeOrder(
			tx,
			request,
			identity,
			actor,
			selectedOrder,
		);
		let after: { id: string; recorded_at: string } | null = null;
		if (query.cursor) {
			const [row] = await tx<{ id: string; recorded_at: string }[]>`
        select id,recorded_at from app.commerce_exception
         where id=${query.cursor} and order_id=${order.id} and status<>'preparing'
         for share`;
			if (!row) throw invalid();
			after = row;
		}
		const rows = await tx<{ id: string }[]>`
      select id from app.commerce_exception
       where order_id=${order.id} and status<>'preparing'
         ${after ? tx`and (recorded_at,id)<(${after.recorded_at},${after.id}::uuid)` : tx``}
       order by recorded_at desc,id desc limit ${query.limit + 1} for share`;
		const slice = rows.slice(0, query.limit);
		const data = [];
		for (const row of slice) {
			data.push(await projectException(tx, row.id, true));
		}
		const [now] = await tx`select clock_timestamp() as now`;
		await authorizeOrder(tx, request, identity, actor, selectedOrder);
		return {
			data,
			pagination: {
				next_cursor:
					rows.length > query.limit ? (slice.at(-1)?.id ?? null) : null,
			},
			as_of: new Date(now.now).toISOString(),
		};
	});
}

async function requestOrderCancellation(
	request: Request,
	identity: LocalAuth,
	actor: CommerceActor | null,
	orderId: string,
	value: unknown,
) {
	const selectedOrder = id(orderId);
	const input = object(value, ["reason"]);
	const reason = returnText(input.reason, 1000);
	const key = mutationKey(request);
	return identity.sql.begin(async (tx) => {
		const initial = await authorizeOrder(
			tx,
			request,
			identity,
			actor,
			selectedOrder,
		);
		const owner: CommerceActor = initial.owner_user_id
			? {
					kind: "user",
					id: initial.owner_user_id,
					principal:
						actor?.kind === "user"
							? actor.principal
							: {
									id: initial.owner_user_id,
									sessionId: "",
									roles: ["buyer"],
									warehouseIds: [],
									permissions: [],
									mfaAt: null,
								},
				}
			: { kind: "guest", id: String(initial.owner_guest_id) };
		const hash = await intentHash(identity, "order.cancel", {
			order_id: initial.id,
			reason,
		});
		const prior = await priorOperation(tx, owner, key, "order.cancel", hash);
		if (prior) return prior.result;
		const shipments =
			await tx`select warehouse_id from app.order_shipment where order_id=${initial.id}`;
		await lockInventoryClock(
			tx,
			initial.clock_namespace,
			shipments.map((s) => String(s.warehouse_id)),
		);
		const [order] = await tx<
			OrderRow[]
		>`select * from app.commerce_order where id=${initial.id} for update`;
		if (
			order.status === "pending" &&
			order.payment_status === "pending" &&
			!order.actionable_at
		) {
			const [expiry] = await tx`
        select id,kind,payload from app.outbox_job
         where kind='checkout.order.expire' and payload->>'orderId'=${order.id}`;
			if (expiry) {
				const expired = await expireOwnedOrderJob(tx, {
					id: String(expiry.id),
					kind: String(expiry.kind),
					payload: expiry.payload,
				});
				if (expired?.status === "cancelled") {
					await authorizeOrder(tx, request, identity, actor, selectedOrder);
					const response = await projectOrder(tx, order.id);
					await recordOperation(
						tx,
						owner,
						key,
						"order.cancel",
						hash,
						order.id,
						response,
					);
					return response;
				}
			}
		}
		throw new AccessError(409, "ORDER_CANCELLATION_NOT_ELIGIBLE");
	});
}

export async function handleCommerceExceptions(
	request: Request,
	identity: LocalAuth,
) {
	try {
		assertOrigin(request);
		const url = new URL(request.url);
		const buyerRecovery = /^\/api\/v1\/orders\/([^/]+)\/recovery-actions$/.exec(
			url.pathname,
		);
		const buyerCancel = /^\/api\/v1\/orders\/([^/]+)\/cancellations$/.exec(
			url.pathname,
		);
		if (buyerRecovery || buyerCancel) {
			rejectUnsupportedHeaders(request, ["authorization", "x-cart-token"]);
			if (request.method !== "GET" && url.search) throw invalid();
			const actor = await commerceActor(request, identity);
			if (buyerRecovery && request.method === "GET") {
				return privateJson(
					await listOrderRecoveryActions(
						request,
						url,
						identity,
						actor,
						buyerRecovery[1],
					),
				);
			}
			if (buyerRecovery && request.method === "POST") {
				const body = await readExceptionBody(request, 16384);
				const parsed = buyerRecoveryRequest(body);
				if (parsed.action === "accept_destination") {
					return privateJson(
						await acceptRecoveryDestination(
							request,
							identity,
							actor,
							buyerRecovery[1],
							body,
						),
						201,
					);
				}
				return privateJson(
					await chooseExceptionProposal(
						request,
						identity,
						actor,
						buyerRecovery[1],
						body,
					),
					201,
				);
			}
			if (buyerCancel && request.method === "POST") {
				return privateJson(
					await requestOrderCancellation(
						request,
						identity,
						actor,
						buyerCancel[1],
						await readExceptionBody(request, 16384),
					),
					201,
				);
			}
			throw new AccessError(404, "NOT_FOUND");
		}

		rejectUnsupportedHeaders(request, [
			"authorization",
			"x-cart-token",
			"x-order-token",
		]);
		if (request.method !== "GET" && url.search) throw invalid();
		const principal = await getPrincipal(request, identity);
		if (url.pathname === adminRoot && request.method === "GET") {
			return privateJson(
				await listCommerceExceptions(identity, url, principal),
			);
		}
		if (url.pathname === adminRoot && request.method === "POST") {
			return privateJson(
				await numberException(
					identity.sql,
					await reportStockDiscrepancy(
						request,
						identity,
						principal,
						await readExceptionBody(request, 131072),
					),
				),
				201,
			);
		}
		const detail = new RegExp(`^${adminRoot}/([^/]+)$`).exec(url.pathname);
		if (detail && request.method === "GET") {
			if (url.search) throw invalid();
			return privateJson(
				await getCommerceException(identity, principal, detail[1]),
			);
		}
		const decision = new RegExp(`^${adminRoot}/([^/]+)/decisions$`).exec(
			url.pathname,
		);
		if (decision && request.method === "POST") {
			const body = await readExceptionBody(request, 16384);
			const isApply =
				Boolean(body) &&
				typeof body === "object" &&
				!Array.isArray(body) &&
				"proposal_id" in body &&
				!("decision" in body);
			return privateJson(
				isApply
					? await applyException(
							request,
							identity,
							principal,
							decision[1],
							body,
						)
					: await decideException(
							request,
							identity,
							principal,
							decision[1],
							body,
						),
				201,
			);
		}
		const intake = new RegExp(`^${adminRoot}/([^/]+)/intakes$`).exec(
			url.pathname,
		);
		if (intake && request.method === "POST") {
			return privateJson(
				await recordExceptionIntake(
					request,
					identity,
					principal,
					intake[1],
					await readExceptionBody(request, 131072),
				),
				201,
			);
		}
		const refunds = new RegExp(`^${adminRoot}/([^/]+)/refunds$`).exec(
			url.pathname,
		);
		if (refunds && request.method === "GET") {
			if (url.search) throw invalid();
			return privateJson(
				await listRecoveryRefunds(identity, principal, refunds[1]),
			);
		}
		if (refunds && request.method === "POST") {
			return privateJson(
				await queueRecoveryRefund(
					request,
					identity,
					principal,
					refunds[1],
					await readExceptionBody(request, 16384),
				),
				201,
			);
		}
		const refundDetail = new RegExp(
			`^${adminRoot}/([^/]+)/refunds/([^/]+)$`,
		).exec(url.pathname);
		if (refundDetail && request.method === "GET") {
			if (url.search) throw invalid();
			return privateJson(
				await getRecoveryRefund(
					identity,
					principal,
					refundDetail[1],
					refundDetail[2],
				),
			);
		}
		const reconcile = new RegExp(
			`^${adminRoot}/([^/]+)/refunds/([^/]+)/reconciliations$`,
		).exec(url.pathname);
		if (reconcile && request.method === "POST") {
			return privateJson(
				await reconcileRecoveryRefund(
					request,
					identity,
					principal,
					reconcile[1],
					reconcile[2],
					await readExceptionBody(request, 16384),
				),
				201,
			);
		}
		const retry = new RegExp(
			`^${adminRoot}/([^/]+)/refunds/([^/]+)/retries$`,
		).exec(url.pathname);
		if (retry && request.method === "POST") {
			return privateJson(
				await retryRecoveryRefund(
					request,
					identity,
					principal,
					retry[1],
					retry[2],
					await readExceptionBody(request, 16384),
				),
				201,
			);
		}
		throw new AccessError(404, "NOT_FOUND");
	} catch (error) {
		if (
			error instanceof postgres.PostgresError &&
			["23505", "23514", "40001", "40P01"].includes(error.code ?? "")
		) {
			return problem(new AccessError(409, "EXCEPTION_CONFLICT"));
		}
		return problem(error);
	}
}
