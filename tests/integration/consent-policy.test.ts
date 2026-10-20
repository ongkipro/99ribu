import assert from 'node:assert/strict';
import test from 'node:test';
import {measurementAllowed,matchingAllowed,parseChoices} from '../../src/modules/consent/choices.ts';

const input=()=>({analytics:'unspecified',advertising_measurement:'granted',marketing:'denied',meta:'granted',google:'granted',tiktok:'denied',google_signals:{ad_storage:'denied',analytics_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'}});

test('consent choices reject missing, extra or invented purpose decisions',()=>{
 const valid=input();assert.deepEqual(parseChoices(valid),valid);
 for(const value of [null,{},[],{...valid,principal_id:'forged'},{...valid,meta:true},{...valid,meta:' granted '},{...valid,google_signals:{...valid.google_signals,extra:'granted'}},{...valid,google_signals:{ad_storage:'granted'}}]) assert.throws(()=>parseChoices(value),{code:'INVALID_INPUT'});
});

test('measurement, matching, personalization, analytics and subscriptions remain independent choices',()=>{
 const choices=parseChoices(input());assert.equal(measurementAllowed(choices,'meta'),true);assert.equal(measurementAllowed(choices,'google'),true);assert.equal(measurementAllowed(choices,'tiktok'),false);
 assert.equal(matchingAllowed(choices,'google'),false);assert.equal(matchingAllowed(choices,'meta'),true);
 assert.equal(choices.marketing,'denied');assert.equal(choices.analytics,'unspecified');assert.equal(choices.google_signals.ad_personalization,'denied');
 const userData=parseChoices({...input(),google_signals:{...input().google_signals,ad_user_data:'granted'}});assert.equal(matchingAllowed(userData,'google'),true);assert.equal(userData.google_signals.ad_personalization,'denied');
 for(const advertising_measurement of ['denied','unspecified']){
  const declined=parseChoices({...input(),advertising_measurement});for(const platform of ['meta','google','tiktok'] as const){assert.equal(measurementAllowed(declined,platform),false);assert.equal(matchingAllowed(declined,platform),false);}
 }
});
