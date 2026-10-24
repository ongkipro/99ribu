import {id,invalid,object} from '../catalog/validation.ts';

// Keyset position (time, id) of a finance queue page (S113). Microsecond UTC strings keep ties
// exact; the cursor is opaque and carries no authority (every page re-checks the grant).
export const STAMP_FORMAT='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
const STAMP=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/;
export type PagePosition={t:string;id:string};

export function readPageCursor(value:string|null):PagePosition|null{
 if(value===null)return null;if(!/^[A-Za-z0-9_-]{1,400}$/.test(value))throw invalid();
 try{const p=object(JSON.parse(Buffer.from(value,'base64url').toString()),['t','id']);
  if(typeof p.t!=='string'||!STAMP.test(p.t))throw invalid();return {t:p.t,id:id(p.id)};}
 catch{throw invalid();}
}
/** next_cursor of a page fetched with limit+1 rows ({k: stamp, id}); null on the last page. */
export function nextPageCursor(rows:readonly {k:string;id:string}[],limit:number){
 const last=rows.length>limit?rows[limit-1]:null;
 return last?Buffer.from(JSON.stringify({t:last.k,id:String(last.id)})).toString('base64url'):null;
}
