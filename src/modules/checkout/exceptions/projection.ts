import type {TransactionSql} from 'postgres';
import {AccessError} from '../../access/policy.ts';
import {id} from '../../catalog/validation.ts';

// Internal only: callers authorize the current buyer or complete staff scope.
// Native operation seals compare this same closed projection before commit.
export async function projectException(tx:TransactionSql,exceptionId:string,buyer=false):Promise<Record<string,unknown>>{
 const [row]=await tx`select app.exception_projection(${id(exceptionId)},${buyer}) value`;
 if(!row?.value)throw new AccessError(404,'NOT_FOUND');
 return row.value;
}
