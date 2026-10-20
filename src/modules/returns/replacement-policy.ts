import {AccessError} from '../access/policy.ts';
import {array,id,integer,object} from '../catalog/validation.ts';
import {effectReference,financeInstant} from '../finance/ledger.ts';
import {returnText} from './policy.ts';

function distinctUnits(value:unknown){
 const selected=array(value,id,1,100).sort();
 if(new Set(selected).size!==selected.length)throw new AccessError(422,'DUPLICATE_REPLACEMENT_QUANTITY');
 return selected;
}

// The original case owns the offer definition and monetary entitlement. Staff
// select complete claimed units and an authorized physical origin only.
export function replacementRequest(value:unknown){
 const input=object(value,['return_item_ids','warehouse_id','expected_version','reason']);
 return {return_item_ids:distinctUnits(input.return_item_ids),warehouse_id:id(input.warehouse_id),
  expected_version:integer(input.expected_version,1),reason:returnText(input.reason,500)};
}

export function replacementActionRequest(value:unknown,action:'reserve'|'prepare'|'book'|'handover'){
 const input=object(value,action==='handover'?['expected_version','reason','handover_reference']:['expected_version','reason']);
 return {expected_version:integer(input.expected_version,1),reason:returnText(input.reason,500),
  ...(action==='handover'?{handover_reference:returnText(input.handover_reference,200)}:{})};
}

// Host source input; buyer HTTP never accepts an asserted receipt timestamp.
export function replacementReceiptRequest(value:unknown){
 const input=object(value,['reference','booking_id','unit_ids','occurred_at']);
 return {reference:effectReference(input.reference),booking_id:id(input.booking_id),unit_ids:distinctUnits(input.unit_ids),
  ...(input.occurred_at===undefined?{}:{occurred_at:financeInstant(input.occurred_at)})};
}
