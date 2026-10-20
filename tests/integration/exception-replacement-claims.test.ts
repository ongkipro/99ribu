import assert from 'node:assert/strict';
import test from 'node:test';
import {replacementCancellationStates} from '../../src/modules/checkout/exceptions/replacement-claims.ts';

const first='11111111-1111-4111-8111-111111111111',second='22222222-2222-4222-8222-222222222222',third='33333333-3333-4333-8333-333333333333';

test('retired replacement holds exactly selected original claims and preserves inspection and other outcomes',()=>{
 const items=[{id:first,claim_state:'replacing',inspection_status:'accepted'},{id:second,claim_state:'replacing',inspection_status:'waived'},{id:third,claim_state:'replaced',inspection_status:'accepted'}],before=structuredClone(items);
 assert.deepEqual(replacementCancellationStates(items,[second,first]),[{id:second,claim_state:'held',inspection_status:'waived'},{id:first,claim_state:'held',inspection_status:'accepted'}]);
 assert.deepEqual(items,before);
});

test('retiring every physical replacement never fabricates a refunded, released or received original claim',()=>{
 const states=replacementCancellationStates([{id:first,claim_state:'replacing',inspection_status:'waived'}],[first]);
 assert.deepEqual(states,[{id:first,claim_state:'held',inspection_status:'waived'}]);
});

test('a cancellation cannot select empty, duplicate or another case claim identities',()=>{
 const items=[{id:first,claim_state:'replacing',inspection_status:'accepted'}];
 for(const selected of [[],[first,first],[second],[first,second]])assert.throws(()=>replacementCancellationStates(items,selected),{code:'REPLACEMENT_CLAIM_NOT_CURRENT'});
});

test('a committed replacement or refund outcome cannot be rewound into a held claim',()=>{
 for(const claim_state of ['held','released','replaced','refunded'])assert.throws(()=>replacementCancellationStates([{id:first,claim_state,inspection_status:'accepted'}],[first]),{code:'REPLACEMENT_CLAIM_NOT_CURRENT'});
});

test('retirement cannot grant an unapproved or rejected original inspection',()=>{
 for(const inspection_status of ['pending','rejected','needs_review'])assert.throws(()=>replacementCancellationStates([{id:first,claim_state:'replacing',inspection_status}],[first]),{code:'REPLACEMENT_CLAIM_NOT_CURRENT'});
});
