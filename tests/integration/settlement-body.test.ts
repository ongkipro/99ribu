import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {readBody} from '../../src/modules/access/http.ts';
import {AccessError} from '../../src/modules/access/policy.ts';

const request=(body:string)=>new Request('http://127.0.0.1:3099/api/v1/admin/reconciliation',{method:'POST',headers:{'Content-Type':'application/json'},body});
const tooLarge=(error:unknown)=>error instanceof AccessError&&error.status===413&&error.code==='BODY_TOO_LARGE';
test('100 reopening allocations fit the finance cap while existing endpoints keep 16KiB',async()=>{
 const body=JSON.stringify({action:'match',expected_version:1,expected_match_id:null,source_reference:randomUUID(),reason:'界'.repeat(500),reauthentication_proof:'p'.repeat(100),allocations:Array.from({length:100},()=>({receivable_transaction_id:randomUUID(),gross_amount:Number.MAX_SAFE_INTEGER,reopens_allocation_id:randomUUID()}))});
 assert.ok(Buffer.byteLength(body)>16384);assert.ok(Buffer.byteLength(body)<32768);
 await assert.rejects(readBody(request(body)),tooLarge);assert.deepEqual(await readBody(request(body),32768),JSON.parse(body));
});
test('body limits count streamed bytes without trusting Content-Length',async()=>{
 for(const limit of [16384,32768] as const){
  const body=JSON.stringify({reason:'界'.repeat(Math.floor((limit-13)/3))});assert.ok(Buffer.byteLength(body)<=limit);
  assert.deepEqual(await readBody(request(body),limit),JSON.parse(body));
  const chunks=[new TextEncoder().encode(body),new TextEncoder().encode(' '.repeat(10))];let cancelled=false;
  const stream=new ReadableStream<Uint8Array>({pull(controller){const chunk=chunks.shift();if(chunk)controller.enqueue(chunk);else controller.close();},cancel(){cancelled=true;}});
  const input=new Request('http://127.0.0.1:3099',{method:'POST',headers:{'Content-Type':'application/json','Content-Length':'2'},body:stream,duplex:'half'} as RequestInit);
  await assert.rejects(readBody(input,limit),tooLarge);assert.equal(cancelled,true);
 }
});
