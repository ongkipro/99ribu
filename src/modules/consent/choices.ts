import {invalid,object} from '../catalog/validation.ts';

export type Decision='granted'|'denied'|'unspecified';
export type Platform='meta'|'google'|'tiktok';
export type Choices={analytics:Decision;advertising_measurement:Decision;marketing:Decision;meta:Decision;google:Decision;tiktok:Decision;google_signals:{ad_storage:Decision;analytics_storage:Decision;ad_user_data:Decision;ad_personalization:Decision}};
export const LOCAL_PRIVACY_POLICY_VERSION='local-privacy-v1';
function decision(value:unknown):Decision{
 if(value!=='granted'&&value!=='denied'&&value!=='unspecified') throw invalid();return value;
}
export function parseChoices(value:unknown):Choices{
 const input=object(value,['analytics','advertising_measurement','marketing','meta','google','tiktok','google_signals']);
 const google=object(input.google_signals,['ad_storage','analytics_storage','ad_user_data','ad_personalization']);
 return {analytics:decision(input.analytics),advertising_measurement:decision(input.advertising_measurement),marketing:decision(input.marketing),meta:decision(input.meta),google:decision(input.google),tiktok:decision(input.tiktok),google_signals:{ad_storage:decision(google.ad_storage),analytics_storage:decision(google.analytics_storage),ad_user_data:decision(google.ad_user_data),ad_personalization:decision(google.ad_personalization)}};
}
// First-party eligibility only. Provider mapping/dispatch remains independently
// gated; consent for measurement never implies personalization or subscription.
export function measurementAllowed(choices:Choices,platform:Platform){return choices.advertising_measurement==='granted'&&choices[platform]==='granted';}
export function matchingAllowed(choices:Choices,platform:Platform){return measurementAllowed(choices,platform)&&(platform!=='google'||choices.google_signals.ad_user_data==='granted');}
