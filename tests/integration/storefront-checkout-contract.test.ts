import assert from 'node:assert/strict';
import test from 'node:test';
import {checkoutFormInput,initialCheckoutIntent,validateCheckoutDraft as validateWith,type CheckoutIntent} from '../../src/modules/storefront/checkout.ts';
import {searchDestinations} from '../../src/modules/shipping/destinations.ts';
// The draft names a fixture area; the caller resolves it (fixture mode reads no database).
const destinations=await searchDestinations(null as never,'contoh',100);
const validateCheckoutDraft=(draft:Parameters<typeof validateWith>[0])=>validateWith(draft,destinations);

const cart='d53126a9-264c-4310-a89c-c61d86687dbd',quote='26b08a71-f07c-44de-9c76-3b74c8850a21';
const draft={recipient_name:'SYNTHETIC Receiver',phone:'0812 3456 7890',email:'',destination_id:'test-malang',address_line:'SYNTHETIC street\nRT 01 / RW 02',buyer_note:'SYNTHETIC note\nRing once',payment_method:'prepaid'};
function form(values:Partial<CheckoutIntent>={}){
 const {draft:fields,packages,...intent}=initialCheckoutIntent({cart,version:'1',draft:{...draft},...values});const data=new FormData();
 for(const [key,value] of Object.entries({...intent,...fields}))data.set(key,value);
 for(const p of packages){data.append('package_id',p.package_id);data.append('shipping_option_id',p.shipping_option_id);}
 return data;
}

test('checkout keeps the typed draft while producing the native canonical phone/address and optional email',()=>{
 const intent=checkoutFormInput(form()),result=validateCheckoutDraft(intent.draft);
 assert.deepEqual(result.errors,{});assert.ok(result.wire);
 assert.equal(intent.draft.address_line,draft.address_line);assert.equal(intent.draft.buyer_note,draft.buyer_note);
 assert.equal(result.wire.address.phone,'+6281234567890');assert.equal(result.wire.contact.phone,'+6281234567890');assert.equal(result.wire.contact.email,null);
 assert.equal(result.wire.address.address_line,'SYNTHETIC street RT 01 / RW 02');assert.equal(result.wire.address.postal_code,'00001');
 assert.equal(result.wire.buyer_note,'SYNTHETIC note Ring once');assert.equal(result.wire.canonicalAddress.destination_id,'test-malang');
 const withEmail=validateCheckoutDraft({...draft,email:'SYNTHETIC@EXAMPLE.TEST'});assert.equal(withEmail.wire?.contact.email,'synthetic@example.test');
});

test('checkout validation associates phone, destination, address, method and optional-field failures without authorizing free-text regions',()=>{
 const result=validateCheckoutDraft({...draft,recipient_name:'',phone:'not a phone',destination_id:'Malang',address_line:'Street\u0000hidden',buyer_note:'note\u202eevil',payment_method:'card'});
 assert.equal(result.wire,null);for(const name of ['recipient_name','phone','destination_id','address_line','buyer_note','payment_method'] as const)assert.ok(result.errors[name],name);
 assert.ok(validateCheckoutDraft({...draft,email:'not-an-email'}).errors.email);
 assert.equal(validateCheckoutDraft({...draft,buyer_note:'  '}).wire?.buyer_note,undefined);
});

test('checkout rejects client-authored money, actor/payment authority, unknown fields, duplicate scalars and file values',()=>{
 for(const key of ['price','buyer_total','paid','payment_status','owner_user_id','order_access','x-order-token','__proto__']){
  const data=form();data.append(key,'forged');assert.throws(()=>checkoutFormInput(data),{code:'INVALID_INPUT'},key);
 }
 for(const key of ['cart','phone','key','navigate']){const data=form();data.append(key,'duplicate');assert.throws(()=>checkoutFormInput(data),{code:'INVALID_INPUT'},key);}
 const file=form();file.set('phone',new Blob(['file']),'phone.txt');assert.throws(()=>checkoutFormInput(file),{code:'INVALID_INPUT'});
 const invalidVersion=form();invalidVersion.set('version','1e2');assert.throws(()=>checkoutFormInput(invalidVersion),{code:'CART_VERSION_REQUIRED'});
});

test('shipping form keeps paired parcel choices and rejects duplicate, unpaired or excessive parcel fields',()=>{
 const packages=[{package_id:'parcel-one',shipping_option_id:'regular-one'},{package_id:'parcel-two',shipping_option_id:'regular-two'}];
 const input=checkoutFormInput(form({kind:'shipping',quote,packages}));assert.deepEqual(input.packages,packages);assert.equal(input.quote,quote);
 assert.throws(()=>checkoutFormInput(form({kind:'shipping',quote,packages:[packages[0],packages[0]]})),{code:'INVALID_INPUT'});
 const missing=form({kind:'shipping',quote,packages});missing.delete('shipping_option_id');assert.throws(()=>checkoutFormInput(missing),{code:'INVALID_INPUT'});
 assert.throws(()=>checkoutFormInput(form({kind:'shipping',quote,packages:Array.from({length:51},(_,i)=>({package_id:`parcel-${i}`,shipping_option_id:'regular'}))})),{code:'INVALID_INPUT'});
 assert.throws(()=>checkoutFormInput(form({kind:'order',quote,packages})),{code:'INVALID_INPUT'});
});


test('native service radios pair each parcel independently and reject mixed, orphaned or duplicate choices',()=>{
 const packages=[{package_id:'parcel-one',shipping_option_id:'economy-one'},{package_id:'parcel-two',shipping_option_id:'regular-two'}];
 const radios=()=>{const data=form({kind:'shipping',quote,packages});data.delete('shipping_option_id');for(const p of packages)data.append(`shipping_option:${p.package_id}`,p.shipping_option_id);return data;};
 assert.deepEqual(checkoutFormInput(radios()).packages,packages);
 const mixed=radios();mixed.append('shipping_option_id','extra');assert.throws(()=>checkoutFormInput(mixed),{code:'INVALID_INPUT'});
 const orphan=radios();orphan.append('shipping_option:another-parcel','forged');assert.throws(()=>checkoutFormInput(orphan),{code:'INVALID_INPUT'});
 const duplicate=radios();duplicate.append('shipping_option:parcel-one','another');assert.throws(()=>checkoutFormInput(duplicate),{code:'INVALID_INPUT'});
 const missing=radios();missing.delete('shipping_option:parcel-two');assert.throws(()=>checkoutFormInput(missing),{code:'INVALID_INPUT'});
 const file=radios();file.set('shipping_option:parcel-one',new Blob(['file']),'option.txt');assert.throws(()=>checkoutFormInput(file),{code:'INVALID_INPUT'});
 const order=radios();order.set('kind','order');assert.throws(()=>checkoutFormInput(order),{code:'INVALID_INPUT'});
});
