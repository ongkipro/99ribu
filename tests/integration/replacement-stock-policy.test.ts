import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {allocateReplacementComponents} from '../../src/modules/returns/replacement-stock.ts';

test('replacement allocation conserves a multi-component complete offer across units and new physical lots',()=>{
 const skuA=randomUUID(),skuB=randomUUID(),unitA=randomUUID(),unitB=randomUUID(),lotA=randomUUID(),lotB=randomUUID(),lotC=randomUUID();
 const units=[unitA,unitB].map(id=>({id,components:[{stock_item_id:skuA,quantity:2},{stock_item_id:skuB,quantity:1}]}));
 const stock=[{balance_id:lotA,stock_item_id:skuA,quantity:1},{balance_id:lotB,stock_item_id:skuA,quantity:3},{balance_id:lotC,stock_item_id:skuB,quantity:2}];
 const result=allocateReplacementComponents(units,stock);
 assert.deepEqual(allocateReplacementComponents([...units].reverse(),[...stock].reverse()),result);
 for(const unit of units)for(const component of unit.components)assert.equal(result.filter(row=>row.replacement_link_id===unit.id&&row.stock_item_id===component.stock_item_id).reduce((sum,row)=>sum+row.quantity,0),component.quantity);
 for(const position of stock)assert.equal(result.filter(row=>row.balance_id===position.balance_id).reduce((sum,row)=>sum+row.quantity,0),position.quantity);
 assert.equal(result.every(row=>row.quantity>0),true);
});

test('replacement allocation rejects partial contents, surplus pieces, wrong SKUs and duplicate physical identities',()=>{
 const unit={id:randomUUID(),components:[{stock_item_id:randomUUID(),quantity:2}]},position={balance_id:randomUUID(),stock_item_id:unit.components[0].stock_item_id,quantity:2};
 for(const stock of [[{...position,quantity:1}],[{...position,quantity:3}],[{...position,stock_item_id:randomUUID()}],[position,position],[]])assert.throws(()=>allocateReplacementComponents([unit],stock),{code:'REPLACEMENT_ALLOCATION_INVALID'});
 assert.throws(()=>allocateReplacementComponents([unit,unit],[position]),{code:'REPLACEMENT_ALLOCATION_INVALID'});
 assert.throws(()=>allocateReplacementComponents([{...unit,components:[...unit.components,...unit.components]}],[position]),{code:'REPLACEMENT_ALLOCATION_INVALID'});
 assert.throws(()=>allocateReplacementComponents([{...unit,components:[]}],[position]),{code:'REPLACEMENT_ALLOCATION_INVALID'});
});

test('a shared lot can cover several maximum-sized units without narrowing the original int32 stock quantity',()=>{
 const sku=randomUUID(),units=Array.from({length:3},()=>({id:randomUUID(),components:[{stock_item_id:sku,quantity:1000000}]}));
 const result=allocateReplacementComponents(units,[{balance_id:randomUUID(),stock_item_id:sku,quantity:3000000}]);
 assert.equal(result.length,3);assert.equal(result.reduce((sum,row)=>sum+row.quantity,0),3000000);
});
