import assert from 'node:assert/strict';
import test from 'node:test';
import {DEPARTMENT_PHOTOS,HERO_PHOTOS,homeSafe} from '../src/modules/storefront/department-photos.ts';
import {HOME_BANNERS} from '../src/modules/storefront/banners.ts';
import {CLAIM_PHOTO_REASONS} from '../src/modules/storefront/claim-photos.ts';

const url=(name:string)=>`http://127.0.0.1:3099/media/catalog/${name}.webp`;
const claim='704a95f22942';
const clean='ffffffffffff';

test('a product whose photo is a screened claim photo is not home safe, in every photo URL form',()=>{
  assert.equal(homeSafe({name:'Pembersih wajan',images:[{url:url(`pembersih-wajan-${claim}`)}]}),false);
  assert.equal(homeSafe({name:'Pembersih wajan',images:[{url:url(claim)}]}),false);
  const sha=`${claim}${'0'.repeat(52)}`;
  assert.equal(homeSafe({name:'Pembersih wajan',images:[{url:url(sha)}]}),false,'the legacy 64-hex name matches by its first 12 hex');
  assert.equal(homeSafe({name:'Pembersih wajan',images:[{url:url(`pembersih-wajan-${clean}`)},{url:url(`pembersih-wajan-${claim}`)}]}),false,'any photo of the gallery counts');
});

test('clean photos and plain names stay home safe; claim words in the name do not',()=>{
  assert.equal(homeSafe({name:'Pembersih wajan',images:[{url:url(`pembersih-wajan-${clean}`)}]}),true);
  assert.equal(homeSafe({name:'Sabun Whitening Wajah',images:[{url:url(`sabun-${clean}`)}]}),false);
  assert.equal(homeSafe({name:'Pembersih wajan',images:[]}),true);
});

test('no curated department, hero or banner photo is itself a claim photo',()=>{
  const picks=[...Object.values(DEPARTMENT_PHOTOS).map(p=>p.photo),...HERO_PHOTOS.map(p=>p.photo),...HOME_BANNERS.map(b=>b.photo)];
  assert.equal(new Set(picks).size,picks.length,'each curated photo is used once');
  for(const photo of picks) assert.equal(CLAIM_PHOTO_REASONS.has(photo.slice(0,12)),false,photo);
});
