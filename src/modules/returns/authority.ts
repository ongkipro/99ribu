import type {TransactionSql} from 'postgres';
import {AccessError,type Principal} from '../access/policy.ts';

export type ReturnAuthority={principal:Principal;owner:boolean;finance:boolean;warehouseIds:string[]};

export async function returnAuthority(tx:TransactionSql,principal:Principal):Promise<ReturnAuthority>{
 await tx`select id from app.auth_user where id=${principal.id} for update`;
 const [current]=await tx`select g.roles,g.permissions,m.verified_at from app.role_grant g join app.auth_user u on u.id=g.user_id
  join app.auth_session s on s.user_id=u.id join app.mfa_session m on m.session_id=s.id
  where u.id=${principal.id} and s.id=${principal.sessionId} and s.expires_at>clock_timestamp() and u.email_verified and u.two_factor_enabled
  for share of g,s,m`;
 if(!current)throw new AccessError(403,'FORBIDDEN');
 const owner=current.roles.includes('owner'),finance=owner||current.roles.includes('finance')&&current.permissions.includes('finance.refunds.read');
 if(!finance&&!current.roles.some((role:string)=>['customer_service','warehouse'].includes(role)))throw new AccessError(403,'FORBIDDEN');
 const warehouses=await tx`select w.id from app.warehouse_membership m join app.warehouse w on w.id=m.warehouse_id where m.user_id=${principal.id} and w.active order by w.id for share of m,w`;
 // The shared row locks above can wait past expiry. Current wall time is the
 // authority for a replay too, independent of the previously parsed principal.
 if(!(await tx`select s.id from app.auth_session s join app.mfa_session m on m.session_id=s.id where s.id=${principal.sessionId} and s.user_id=${principal.id} and s.expires_at>clock_timestamp()`).length)throw new AccessError(403,'FORBIDDEN');
 const warehouseIds=warehouses.map(row=>String(row.id));
 return {principal:{...principal,roles:current.roles,permissions:current.permissions,mfaAt:new Date(current.verified_at),warehouseIds},owner,finance,warehouseIds};
}

export function canReadReturnWarehouse(authority:ReturnAuthority,warehouseId:string){return authority.owner||authority.finance||authority.warehouseIds.includes(warehouseId);}

export function assertReturnReview(authority:ReturnAuthority,warehouseIds:readonly string[]){
 if(authority.owner)return;
 if(!authority.principal.roles.includes('customer_service'))throw new AccessError(403,'FORBIDDEN');
 if(!warehouseIds.length||warehouseIds.some(id=>!authority.warehouseIds.includes(id)))throw new AccessError(404,'NOT_FOUND');
}

export function assertReturnInspection(authority:ReturnAuthority,warehouseIds:readonly string[]){
 if(authority.owner)return;
 if(!authority.principal.roles.includes('warehouse'))throw new AccessError(403,'FORBIDDEN');
 if(!warehouseIds.length||warehouseIds.some(id=>!authority.warehouseIds.includes(id)))throw new AccessError(404,'NOT_FOUND');
}
