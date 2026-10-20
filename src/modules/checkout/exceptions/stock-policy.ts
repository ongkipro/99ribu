import {AccessError} from '../../access/policy.ts';
import type {ExceptionProposal} from './core.ts';
import type {stockDiscrepancyRequest} from './policy.ts';

export type StockReportComponent={balance_id:string;stock_item_id:string;quantity:number;revision:number;on_hand:number;reserved:number;quarantined:number};

// All component lots of every selected complete unit are observed, including
// zeroes. A report records facts; only a later consented remedy can post loss.
export function stockReportPlan(input:ReturnType<typeof stockDiscrepancyRequest>,components:readonly StockReportComponent[],existing:boolean,acceptedRemedy:Pick<ExceptionProposal,'id'|'action'>|null=null){
 if(!components.length||components.length!==input.observed_components.length||new Set(components.map(row=>row.balance_id)).size!==components.length)throw new AccessError(409,'EXCEPTION_COMPONENT_SCOPE_MISMATCH');
 let missing=0;
 for(const component of components){
  const observed=input.observed_components.find(row=>row.balance_id===component.balance_id);
  if(!observed||observed.stock_item_id!==component.stock_item_id)throw new AccessError(409,'EXCEPTION_COMPONENT_SCOPE_MISMATCH');
  if(observed.expected_balance_version!==component.revision)throw new AccessError(409,'STOCK_VERSION_CONFLICT');
  if(component.reserved<component.quantity)throw new AccessError(409,'FULFILLMENT_STOCK_INVALID');
  if(observed.missing_quantity>component.quantity||observed.missing_quantity>component.on_hand)throw new AccessError(409,'EXCEPTION_SHORTAGE_EXCEEDS_SCOPE');
  missing+=observed.missing_quantity;
 }
 if(!existing&&!missing)throw new AccessError(409,'EXCEPTION_SHORTAGE_REQUIRED');
 if(acceptedRemedy){
  if(!existing||!['cancel_affected_units','refund_original_entitlement'].includes(acceptedRemedy.action))throw new AccessError(409,'RECOVERY_PROPOSAL_NOT_CURRENT');
  return {kind:'stock_report' as const,status:'awaiting_source' as const,proposal_event_id:acceptedRemedy.id};
 }
 return {kind:'stock_report' as const,status:missing?'awaiting_stock' as const:'resolved' as const,proposal_event_id:null};
}
