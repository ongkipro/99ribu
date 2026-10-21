import type { TransactionSql } from "postgres";
import type { LocalAuth } from "../access/auth.ts";
import { assertOrigin, privateJson, problem } from "../access/http.ts";
import {
	AccessError,
	getPrincipal,
	hasPermission,
	type Principal,
} from "../access/policy.ts";
import { offerCommissionIdr } from "../affiliates/rates.ts";
import { invalid } from "../catalog/validation.ts";
import { resolvePolicy } from "../settings/policies.ts";
import { effectiveComponentCost, effectiveOfferAssumptions } from "./costs.ts";
import { receiptUnitIds } from "./receipt-units.ts";

export type FinancialStatementSection = {
	complete: boolean;
	amount: number | null;
	missing_inputs: string[];
};

export type FinanceSummary = {
	from: string;
	to: string;
	currency: "IDR";
	generated_at: string;
	cash: FinancialStatementSection;
	receivables: FinancialStatementSection;
	refund_liability: FinancialStatementSection;
	affiliate_liability: FinancialStatementSection;
	gross_merchandise: FinancialStatementSection;
	net_merchandise_revenue: FinancialStatementSection;
	recognized_hpp: FinancialStatementSection;
	gross_merchandise_profit: FinancialStatementSection;
	estimated_contribution: FinancialStatementSection;
	realized_contribution: FinancialStatementSection;
	operating_expenses: FinancialStatementSection;
	operating_result: FinancialStatementSection;
};

const MAX_WINDOW_MS = 366 * 86400000;
const ASSUMPTION_FIELDS = [
	"packaging_idr",
	"provider_fee_idr",
	"subsidy_idr",
	"returns_reserve_idr",
] as const;

function parseSummaryInstant(value: string | null) {
	if (
		typeof value !== "string" ||
		!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(value) ||
		value.startsWith("0000")
	) {
		throw invalid();
	}
	const ms = Date.parse(value);
	if (!Number.isFinite(ms)) throw invalid();
	const date = new Date(ms);
	const isoPrefix = value.slice(0, 19);
	if (date.toISOString().slice(0, 19) !== isoPrefix) throw invalid();
	return date.toISOString();
}

function parseSummaryQuery(url: URL) {
	for (const key of url.searchParams.keys()) {
		if (
			!["from", "to"].includes(key) ||
			url.searchParams.getAll(key).length !== 1
		) {
			throw invalid();
		}
	}
	const fromRaw = url.searchParams.get("from");
	const toRaw = url.searchParams.get("to");
	if (fromRaw === null || toRaw === null) throw invalid();
	const from = parseSummaryInstant(fromRaw);
	const to = parseSummaryInstant(toRaw);
	const fromMs = Date.parse(from);
	const toMs = Date.parse(to);
	if (fromMs >= toMs || toMs - fromMs > MAX_WINDOW_MS) throw invalid();
	return { from, to };
}

function safeAmount(value: bigint) {
	if (
		value > BigInt(Number.MAX_SAFE_INTEGER) ||
		value < BigInt(Number.MIN_SAFE_INTEGER)
	) {
		throw new AccessError(422, "COST_CALCULATION_LIMIT");
	}
	return Number(value);
}

function buildSection(
	value: bigint,
	missing: Iterable<string>,
): FinancialStatementSection {
	const list = [...new Set(missing)].sort().slice(0, 20);
	if (list.length > 0) {
		return { complete: false, amount: null, missing_inputs: list };
	}
	return { complete: true, amount: safeAmount(value), missing_inputs: [] };
}

async function financeSummaryAuthority(
	tx: TransactionSql,
	principal: Principal,
) {
	await tx`select id from app.auth_user where id=${principal.id} for update`;
	const [grant] = await tx`
    select g.roles,g.permissions
      from app.role_grant g
      join app.auth_user u on u.id=g.user_id
      join app.auth_session s on s.user_id=u.id
      join app.mfa_session m on m.session_id=s.id
     where u.id=${principal.id}
       and s.id=${principal.sessionId}
       and s.expires_at>clock_timestamp()
       and u.email_verified
       and u.two_factor_enabled
     for share of g,s,m`;
	if (
		!grant ||
		!(
			grant.roles.includes("owner") ||
			(grant.roles.includes("finance") &&
				grant.permissions.includes("finance.summary.read"))
		)
	) {
		throw new AccessError(403, "FORBIDDEN");
	}
	const [current] = await tx`
    select s.id
      from app.auth_session s
      join app.mfa_session m on m.session_id=s.id
     where s.id=${principal.sessionId}
       and s.user_id=${principal.id}
       and s.expires_at>clock_timestamp()`;
	if (!current) throw new AccessError(403, "FORBIDDEN");
}

type FinancialSourceDoc = {
	line_id?: string;
	policy_version_id?: string | null;
	assumption_version_id?: string | null;
	component_cost_version_ids?: (string | null)[];
	commission_bps?: number;
	commission_idr?: number;
};

export async function readFinanceSummary(
	identity: LocalAuth,
	principal: Principal,
	url: URL,
): Promise<FinanceSummary> {
	const { from, to } = parseSummaryQuery(url);
	return identity.sql.begin(async (tx) => {
		await financeSummaryAuthority(tx, principal);

		// 1. Closing balances as of `to`
		const [balances] = await tx<
			{
				cash: string;
				receivables: string;
				refund_liability: string;
			}[]
		>`
      select
        coalesce(sum(case when p.account='company_cash' then case when p.side='debit' then p.amount else -p.amount end else 0 end),0)::text as cash,
        coalesce(sum(case when p.account='provider_receivable' then case when p.side='debit' then p.amount else -p.amount end else 0 end),0)::text as receivables,
        coalesce(sum(case when p.account='refund_payable' then case when p.side='credit' then p.amount else -p.amount end else 0 end),0)::text as refund_liability
      from app.finance_posting p
      join app.finance_transaction t on t.id=p.transaction_id
      where t.occurred_at<${to}::timestamptz`;

		const [commissionSchema] = await tx`
      select
        to_regclass('app.commission_entry') is not null as has_commissions,
        to_regclass('app.finance_expense') is not null as has_expenses,
        to_regclass('app.refund') is not null as has_returns,
        to_regclass('app.recovery_refund') is not null as has_recovery,
        to_regclass('app.settlement_allocation') is not null as has_settlements`;

		let affiliateLiability = 0n;
		if (commissionSchema.has_commissions) {
			const [affRow] = await tx<{ total: string }[]>`
        select coalesce(sum(ce.amount_idr),0)::text as total
          from app.commission_entry ce
         where ce.created_at<${to}::timestamptz
           and (
             ce.status in ('pending','available','reserved')
             or (
               ce.status='paid'
               and exists(
                 select 1
                   from app.affiliate_payout_entry pe
                   join app.affiliate_payout ap on ap.id=pe.payout_id
                  where pe.commission_entry_id=ce.id
                    and coalesce(ap.transferred_at,ap.verified_at,ap.updated_at)>=${to}::timestamptz
               )
             )
           )`;
			affiliateLiability = BigInt(affRow?.total ?? "0");
		}

		// 2. Active economic receipts in [from, to)
		const receipts = await tx<
			{
				id: string;
				transaction_id: string;
				order_id: string;
				shipment_id: string | null;
				amount: string;
				merchandise_amount: string;
				buyer_shipping: string;
				occurred_at: string;
			}[]
		>`
      select r.id,r.transaction_id,r.order_id,r.shipment_id,r.amount,r.merchandise_amount,r.buyer_shipping,r.occurred_at
        from app.economic_receipt r
       where r.occurred_at>=${from}::timestamptz
         and r.occurred_at<${to}::timestamptz
         and not exists(
           select 1 from app.finance_transaction rev
            where rev.reverses_id=r.transaction_id
              and rev.occurred_at<${to}::timestamptz
         )
       order by r.occurred_at,r.id`;

		const grossMerchandise = receipts.reduce(
			(sum, r) => sum + BigInt(r.merchandise_amount),
			0n,
		);
		const grossBuyerShipping = receipts.reduce(
			(sum, r) => sum + BigInt(r.buyer_shipping),
			0n,
		);

		// 3. Refunded merchandise & shipping in [from, to)
		let refundedMerchandise = 0n;
		let refundedShipping = 0n;
		const refundedUnitIds = new Set<string>();

		if (commissionSchema.has_returns) {
			const returnRefundRows = await tx<
				{
					fulfillment_item_id: string;
					merchandise_amount: string;
					buyer_shipping: string;
				}[]
			>`
        select distinct on (rf.id,ra.return_item_id)
          ri.fulfillment_item_id,
          ra.merchandise_amount,
          ra.buyer_shipping
          from app.refund rf
          join app.refund_allocation ra on ra.refund_id=rf.id
          join app.return_item ri on ri.id=ra.return_item_id
          left join app.finance_transaction cash on cash.id=rf.cash_transaction_id
         where rf.status<>'failed'
           and (
             (rf.created_at>=${from}::timestamptz and rf.created_at<${to}::timestamptz)
             or (cash.occurred_at>=${from}::timestamptz and cash.occurred_at<${to}::timestamptz)
           )`;
			for (const row of returnRefundRows) {
				refundedMerchandise += BigInt(row.merchandise_amount);
				refundedShipping += BigInt(row.buyer_shipping);
				refundedUnitIds.add(String(row.fulfillment_item_id));
			}
		}

		if (commissionSchema.has_recovery) {
			const recoveryRefundRows = await tx<
				{
					fulfillment_item_id: string | null;
					merchandise_amount: string;
					buyer_shipping: string;
				}[]
			>`
        select distinct on (rr.id,rra.id)
          rra.fulfillment_item_id,
          rra.merchandise_amount,
          rra.buyer_shipping
          from app.recovery_refund rr
          join app.recovery_refund_allocation rra on rra.refund_id=rr.id
          left join app.finance_transaction cash on cash.id=rr.cash_transaction_id
         where rr.status<>'failed'
           and (
             (rr.created_at>=${from}::timestamptz and rr.created_at<${to}::timestamptz)
             or (cash.occurred_at>=${from}::timestamptz and cash.occurred_at<${to}::timestamptz)
           )`;
			for (const row of recoveryRefundRows) {
				refundedMerchandise += BigInt(row.merchandise_amount);
				refundedShipping += BigInt(row.buyer_shipping);
				if (row.fulfillment_item_id) {
					refundedUnitIds.add(String(row.fulfillment_item_id));
				}
			}
		}

		const netMerchandiseRevenue = grossMerchandise - refundedMerchandise;
		const netBuyerShipping = grossBuyerShipping - refundedShipping;

		// 4. Recognized units, HPP, Estimated Contribution, Realized Contribution
		const hppMissing = new Set<string>();
		const estimatedMissing = new Set<string>();
		const realizedMissing = new Set<string>();

		let recognizedHppTotal = 0n;
		let estimatedContributionTotal = 0n;
		let actualShippingSubsidyTotal = 0n;
		let packagingCostTotal = 0n;

		for (const receipt of receipts) {
			const entitledIds = await receiptUnitIds(tx, receipt.id);
			const survivingIds = entitledIds.filter(
				(uid) => !refundedUnitIds.has(uid),
			);
			if (!survivingIds.length) continue;

			const unitRows = await tx<
				{
					unit_id: string;
					subsidy_amount: string;
					line_id: string;
					offer_id: string;
					quote_doc: { financial_sources?: FinancialSourceDoc[] };
					released: boolean;
				}[]
			>`
        select
          f.id as unit_id,
          f.subsidy_amount,
          i.line_id,
          i.offer_id,
          q.document as quote_doc,
          exists(
            select 1 from app.exception_cancellation ec
             where ec.fulfillment_item_id=f.id
               and ec.replacement_link_id is null
               and ec.stock_disposition='released'
          ) as released
          from app.fulfillment_item f
          join app.order_item i on i.id=f.order_item_id
          join app.commerce_order o on o.id=i.order_id
          join app.checkout_quote q on q.id=o.quote_id
         where f.id in ${tx(survivingIds)}
         order by f.id`;

			for (const unit of unitRows) {
				if (unit.released) continue;
				actualShippingSubsidyTotal += BigInt(unit.subsidy_amount);

				const sources = Array.isArray(unit.quote_doc?.financial_sources)
					? unit.quote_doc.financial_sources
					: [];
				const lineSource =
					sources.find((s) => s.line_id === unit.line_id) ?? null;

				const allocations = await tx<
					{
						stock_item_id: string;
						quantity: number;
					}[]
				>`
          select stock_item_id,quantity
            from app.fulfillment_component_allocation
           where fulfillment_item_id=${unit.unit_id}
           order by stock_item_id,balance_id`;

				const costVersionIds = (
					lineSource?.component_cost_version_ids ?? []
				).filter((cid): cid is string => typeof cid === "string");
				const frozenCosts = costVersionIds.length
					? await tx<{ stock_item_id: string; unit_cost: number | null }[]>`
              select stock_item_id,unit_cost
                from app.component_cost_version
               where id in ${tx(costVersionIds)}`
					: [];
				const frozenCostByStock = new Map(
					frozenCosts.map((c) => [String(c.stock_item_id), c.unit_cost]),
				);

				let unitHpp = 0n;
				let unitHppComplete = true;
				for (const alloc of allocations) {
					let unitCost = frozenCostByStock.get(String(alloc.stock_item_id));
					if (unitCost === undefined) {
						const eff = await effectiveComponentCost(
							tx,
							String(alloc.stock_item_id),
							receipt.occurred_at,
						);
						unitCost = eff?.unit_cost ?? null;
					}
					if (unitCost === null || unitCost === undefined) {
						const tag = `hpp:${alloc.stock_item_id}`;
						hppMissing.add(tag);
						estimatedMissing.add(tag);
						realizedMissing.add(tag);
						unitHppComplete = false;
					} else {
						const partCost = BigInt(unitCost) * BigInt(alloc.quantity);
						unitHpp += partCost;
						recognizedHppTotal += partCost;
					}
				}

				// Offer cost assumptions (frozen version first, then effective at receipt time)
				let assumptionRow: {
					packaging_idr: number | null;
					provider_fee_idr: number | null;
					subsidy_idr: number | null;
					returns_reserve_idr: number | null;
				} | null = null;
				if (lineSource?.assumption_version_id) {
					const [row] = await tx<
						{
							packaging_idr: number | null;
							provider_fee_idr: number | null;
							subsidy_idr: number | null;
							returns_reserve_idr: number | null;
						}[]
					>`
            select packaging_idr,provider_fee_idr,subsidy_idr,returns_reserve_idr
              from app.offer_cost_assumption_version
             where id=${lineSource.assumption_version_id}`;
					assumptionRow = row ?? null;
				} else {
					const eff = await effectiveOfferAssumptions(
						tx,
						unit.offer_id,
						receipt.occurred_at,
					);
					assumptionRow = eff
						? {
								packaging_idr: eff.packaging_idr ?? null,
								provider_fee_idr: eff.provider_fee_idr ?? null,
								subsidy_idr: eff.subsidy_idr ?? null,
								returns_reserve_idr: eff.returns_reserve_idr ?? null,
							}
						: null;
				}

				let unitVariableAssumptions = 0n;
				let unitAssumptionsComplete = true;
				for (const field of ASSUMPTION_FIELDS) {
					const val = assumptionRow?.[field] ?? null;
					if (val === null || val === undefined) {
						estimatedMissing.add(field);
						unitAssumptionsComplete = false;
						if (field === "packaging_idr") {
							realizedMissing.add("packaging_idr");
						}
					} else {
						unitVariableAssumptions += BigInt(val);
						if (field === "packaging_idr") {
							packagingCostTotal += BigInt(val);
						}
					}
				}

				let commissionEstimate = lineSource?.commission_idr;
				if (commissionEstimate === undefined) {
					if (lineSource?.policy_version_id) {
						const [pol] = await tx<
							{ values: { default_commission_bps?: number } }[]
						>`
              select values from app.policy_version where id=${lineSource.policy_version_id}`;
						commissionEstimate = offerCommissionIdr(
							pol?.values?.default_commission_bps ?? 0,
						);
					} else {
						const pol = await resolvePolicy(
							tx,
							"commercial",
							null,
							new Date(receipt.occurred_at),
						);
						const bps =
							"default_commission_bps" in pol.values
								? pol.values.default_commission_bps
								: 0;
						commissionEstimate = offerCommissionIdr(bps);
					}
				}

				if (unitHppComplete && unitAssumptionsComplete) {
					estimatedContributionTotal +=
						99000n -
						unitHpp -
						unitVariableAssumptions -
						BigInt(commissionEstimate);
				}
			}
		}

		// 5. Quarantine releases back to sellable stock in [from, to) reduce recognized HPP
		const quarantineReleases = await tx<
			{
				stock_item_id: string;
				quantity: number;
				created_at: string;
			}[]
		>`
      select ib.stock_item_id,sm.quantity,sm.created_at
        from app.stock_movement sm
        join app.inventory_balance ib on ib.id=sm.balance_id
       where sm.kind='release_quarantine'
         and sm.created_at>=${from}::timestamptz
         and sm.created_at<${to}::timestamptz
         and (
           exists(select 1 from app.return_goods rg where rg.expected_balance_id=ib.id and rg.identity_confirmed)
           or exists(select 1 from app.exception_goods_line eg where eg.balance_id=ib.id and eg.identity_confirmed)
         )`;
		for (const rel of quarantineReleases) {
			const eff = await effectiveComponentCost(
				tx,
				String(rel.stock_item_id),
				new Date(rel.created_at).toISOString(),
			);
			if (eff?.unit_cost == null) {
				const tag = `hpp:${rel.stock_item_id}`;
				hppMissing.add(tag);
				realizedMissing.add(tag);
			} else {
				recognizedHppTotal -= BigInt(eff.unit_cost) * BigInt(rel.quantity);
			}
		}

		// 6. Return/damage/write-off cost in [from, to)
		let writeOffCostTotal = 0n;
		const writeOffMovements = await tx<
			{
				stock_item_id: string;
				quantity: number;
				created_at: string;
			}[]
		>`
      select ib.stock_item_id,sm.quantity,sm.created_at
        from app.stock_movement sm
        join app.inventory_balance ib on ib.id=sm.balance_id
       where (sm.kind='write_off' or sm.source_ref like 'exception-loss:%')
         and sm.created_at>=${from}::timestamptz
         and sm.created_at<${to}::timestamptz`;
		for (const loss of writeOffMovements) {
			const eff = await effectiveComponentCost(
				tx,
				String(loss.stock_item_id),
				new Date(loss.created_at).toISOString(),
			);
			if (eff?.unit_cost == null) {
				realizedMissing.add(`hpp:${loss.stock_item_id}`);
			} else {
				writeOffCostTotal += BigInt(eff.unit_cost) * BigInt(loss.quantity);
			}
		}

		// 7. Settlement carrier cost & payment/COD provider fees for receipts in [from, to)
		let actualCarrierCostTotal = 0n;
		let actualProviderFeeTotal = 0n;
		if (commissionSchema.has_settlements) {
			for (const receipt of receipts) {
				const entitledIds = await receiptUnitIds(tx, receipt.id);
				const survivingIds = entitledIds.filter(
					(uid) => !refundedUnitIds.has(uid),
				);
				if (!survivingIds.length) continue;

				const [settled] = await tx<
					{
						gross: string;
						carrier: string;
						provider: string;
					}[]
				>`
          select
            coalesce(sum(sa.gross_amount),0)::text as gross,
            coalesce(sum(sa.carrier_fee),0)::text as carrier,
            coalesce(sum(sa.provider_fee),0)::text as provider
            from app.settlement_allocation sa
            join app.settlement_match sm on sm.id=sa.match_id
           where sa.receivable_transaction_id=${receipt.transaction_id}
             and sm.reversal_transaction_id is null
             and sm.occurred_at<${to}::timestamptz`;
				const settledGross = BigInt(settled?.gross ?? "0");
				if (settledGross < BigInt(receipt.amount)) {
					realizedMissing.add(`settlement:${receipt.id}`);
				} else {
					actualCarrierCostTotal += BigInt(settled?.carrier ?? "0");
					actualProviderFeeTotal += BigInt(settled?.provider ?? "0");
				}
			}
		}

		// 8. Earned affiliate commissions in [from, to)
		let earnedCommissionTotal = 0n;
		if (commissionSchema.has_commissions) {
			const [commRow] = await tx<{ total: string }[]>`
        select coalesce(sum(ce.amount_idr),0)::text as total
          from app.commission_entry ce
         where ce.created_at>=${from}::timestamptz
           and ce.created_at<${to}::timestamptz
           and ce.status in ('pending','available','reserved','paid')`;
			earnedCommissionTotal = BigInt(commRow?.total ?? "0");
		}

		// 9. Operating expenses in [from, to)
		let operatingExpensesTotal = 0n;
		if (commissionSchema.has_expenses) {
			const [expRow] = await tx<{ total: string }[]>`
        select coalesce(sum(fe.amount_idr),0)::text as total
          from app.finance_expense fe
         where fe.status='posted'
           and fe.occurred_at>=${from}::timestamptz
           and fe.occurred_at<${to}::timestamptz`;
			operatingExpensesTotal = BigInt(expRow?.total ?? "0");
		}

		const realizedContributionValue =
			netMerchandiseRevenue +
			netBuyerShipping -
			recognizedHppTotal -
			actualCarrierCostTotal -
			actualShippingSubsidyTotal -
			actualProviderFeeTotal -
			packagingCostTotal -
			writeOffCostTotal -
			earnedCommissionTotal;

		const operatingResultValue =
			realizedContributionValue - operatingExpensesTotal;

		const [clock] = await tx`select clock_timestamp() as now`;
		await financeSummaryAuthority(tx, principal);
		await tx`
      insert into app.audit_event (actor_id,action,subject_id,outcome,reason,details)
      values (${principal.id},'finance.summary.read',null,'allowed','Read period financial summary',${JSON.stringify({ from, to })}::jsonb)`;

		return {
			from,
			to,
			currency: "IDR",
			generated_at: new Date(clock.now).toISOString(),
			cash: buildSection(BigInt(balances?.cash ?? "0"), []),
			receivables: buildSection(BigInt(balances?.receivables ?? "0"), []),
			refund_liability: buildSection(
				BigInt(balances?.refund_liability ?? "0"),
				[],
			),
			affiliate_liability: buildSection(affiliateLiability, []),
			gross_merchandise: buildSection(grossMerchandise, []),
			net_merchandise_revenue: buildSection(netMerchandiseRevenue, []),
			recognized_hpp: buildSection(recognizedHppTotal, hppMissing),
			gross_merchandise_profit: buildSection(
				netMerchandiseRevenue - recognizedHppTotal,
				hppMissing,
			),
			estimated_contribution: buildSection(
				estimatedContributionTotal,
				estimatedMissing,
			),
			realized_contribution: buildSection(
				realizedContributionValue,
				realizedMissing,
			),
			operating_expenses: buildSection(operatingExpensesTotal, []),
			operating_result: buildSection(operatingResultValue, realizedMissing),
		};
	});
}

export async function handleFinanceSummary(
	request: Request,
	identity: LocalAuth,
) {
	try {
		assertOrigin(request);
		if (
			["authorization", "x-cart-token", "x-order-token"].some((name) =>
				request.headers.has(name),
			)
		) {
			throw new AccessError(401, "UNSUPPORTED_AUTH_TRANSPORT");
		}
		const url = new URL(request.url);
		if (
			url.pathname !== "/api/v1/admin/finance/summary" ||
			request.method !== "GET"
		) {
			throw new AccessError(404, "NOT_FOUND");
		}
		const principal = await getPrincipal(request, identity);
		if (!hasPermission(principal, "finance.summary.read")) {
			throw new AccessError(403, "FORBIDDEN");
		}
		return privateJson(await readFinanceSummary(identity, principal, url));
	} catch (error) {
		return problem(error);
	}
}
