import { setTimeout } from "node:timers/promises";
import { connectDatabase } from "../src/db/client.ts";
import { readLocalConfig } from "../src/config/local.ts";
import { runOneJob } from "../src/jobs/worker.ts";
import {paymentAdapter} from '../src/modules/payments/worker.ts';
import {autolarisAdviceAdapter,simulateAutolarisStatus} from '../src/modules/payments/autolaris.ts';
import {ingestProviderEvent,simulateCollection} from '../src/modules/payments/local.ts';
import {reconcilePaymentNow} from '../src/modules/payments/recovery.ts';
import {id,integer,invalid} from '../src/modules/catalog/validation.ts';
import {advertisingAdapter} from '../src/modules/advertising/worker.ts';
import {simulateCodCollection,ingestCodEvent} from '../src/modules/payments/cod-local.ts';
import {reconcileCodNow} from '../src/modules/payments/cod-recovery.ts';
import {shippingAdapter,reconcileShippingNow} from '../src/modules/fulfillment/worker.ts';
import {simulateWaybillIssue,ingestWaybillEvent} from '../src/modules/fulfillment/local.ts';
import {initializeFulfillments} from '../src/modules/fulfillment/core.ts';
import {simulateSettlement,reviseSettlementStatement} from '../src/modules/finance/settlements/local.ts';
import {reconcileSettlementNow} from '../src/modules/finance/settlements/recovery.ts';
import {simulateParcelReceipt} from '../src/modules/returns/receipt-source.ts';
import {reconcileParcelReceiptNow} from '../src/modules/returns/receipt-recovery.ts';
import {refundAdapter} from '../src/modules/returns/worker.ts';
import {createRefundDestinationSource,simulateRefundOutcome} from '../src/modules/returns/refund-source.ts';
import {reconcileRefundNow} from '../src/modules/returns/refund-recovery.ts';
import {reconcileRecoveryRefundNow,recoveryRefundAdapter} from '../src/modules/checkout/exceptions/refund-worker.ts';
import {simulateRecoveryDestination,simulateRecoveryOutcome} from '../src/modules/checkout/exceptions/refund-source.ts';
import {replacementShippingAdapter,ingestReplacementWaybillEvent,simulateReplacementWaybill} from '../src/modules/returns/replacement-shipping.ts';
import {simulateReplacementReceipt} from '../src/modules/returns/replacement-receipts.ts';
import {reconcileReplacementShippingNow,reconcileReplacementReceiptNow} from '../src/modules/returns/replacement-recovery.ts';
import {shippingCancellationAdapter,reconcileWaybillCancellationNow} from '../src/modules/fulfillment/cancellations.ts';
import {simulateWaybillCancellation,ingestWaybillCancellationEvent} from '../src/modules/fulfillment/cancellation-source.ts';

async function sourceInput(){
  if(process.stdin.isTTY)throw invalid();const chunks:Buffer[]=[];let size=0;
  for await(const chunk of process.stdin){const bytes=Buffer.from(chunk);size+=bytes.length;if(size>32768)throw invalid();chunks.push(bytes);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;}catch{throw invalid();}
}

const [target, mode, ...extra] = process.argv.slice(2);
const paymentCommand=mode==='--confirm-payment'||mode==='--reconcile-payment'||mode==='--autolaris-paid';
const codCommand=['--collect-cod','--refuse-cod','--reconcile-cod'].includes(mode);
const shippingCommand=['--issue-waybill','--fail-waybill','--reconcile-shipping'].includes(mode),initializeCommand=mode==='--initialize-fulfillment';
const cancellationCommand=['--cancel-waybill','--reject-waybill-cancellation','--reconcile-waybill-cancellation'].includes(mode);
const settlementCommand=['--observe-settlement','--revise-settlement','--reconcile-settlement'].includes(mode);
const receiptCommand=mode==='--receive-parcel'||mode==='--reconcile-parcel-receipt';
const refundCommand=['--verify-refund-destination','--confirm-refund','--fail-refund','--reconcile-refund'].includes(mode);
const recoveryRefundCommand=['--verify-recovery-destination','--confirm-recovery-refund','--fail-recovery-refund','--reconcile-recovery-refund'].includes(mode);
const replacementShippingCommand=['--issue-replacement-waybill','--fail-replacement-waybill','--reconcile-replacement-shipping'].includes(mode);
const replacementReceiptCommand=mode==='--receive-replacement'||mode==='--reconcile-replacement-receipt';
const expectedExtra=mode==='--once'&&extra.length===1?1:mode==='--revise-settlement'?2:mode==='--reconcile-settlement'||mode==='--reconcile-parcel-receipt'||mode==='--reconcile-replacement-receipt'||paymentCommand||codCommand||shippingCommand||cancellationCommand||initializeCommand||refundCommand||recoveryRefundCommand||replacementShippingCommand?1:0;
if ((target !== 'local' && target !== 'test') || (mode !== undefined && mode !== '--once'&&!paymentCommand&&!codCommand&&!shippingCommand&&!cancellationCommand&&!initializeCommand&&!settlementCommand&&!receiptCommand&&!refundCommand&&!recoveryRefundCommand&&!replacementShippingCommand&&!replacementReceiptCommand) || extra.length!==expectedExtra) {
  throw new Error('Use worker.ts local|test [--once [JOB_ID] | --confirm-payment ATTEMPT_ID | --reconcile-payment ATTEMPT_ID | --autolaris-paid ATTEMPT_ID | --collect-cod SHIPMENT_ID | --refuse-cod SHIPMENT_ID | --reconcile-cod SHIPMENT_ID | --issue-waybill BOOKING_ID | --fail-waybill BOOKING_ID | --reconcile-shipping BOOKING_ID | --cancel-waybill CANCELLATION_ID | --reject-waybill-cancellation CANCELLATION_ID | --reconcile-waybill-cancellation CANCELLATION_ID | --initialize-fulfillment ORDER_ID | --observe-settlement < JSON | --revise-settlement SOURCE_ID EXPECTED_VERSION < JSON | --reconcile-settlement SOURCE_ID | --receive-parcel < JSON | --reconcile-parcel-receipt SOURCE_ID | --verify-refund-destination REFUND_ID | --confirm-refund REFUND_ID | --fail-refund REFUND_ID | --reconcile-refund REFUND_ID | --verify-recovery-destination RECOVERY_REFUND_ID | --confirm-recovery-refund RECOVERY_REFUND_ID | --fail-recovery-refund RECOVERY_REFUND_ID | --reconcile-recovery-refund RECOVERY_REFUND_ID | --issue-replacement-waybill BOOKING_ID | --fail-replacement-waybill BOOKING_ID | --reconcile-replacement-shipping BOOKING_ID | --receive-replacement < JSON | --reconcile-replacement-receipt SOURCE_ID].');
}
const onlyJobId=mode==='--once'&&extra.length===1?id(extra[0]):undefined;
let settlementId=settlementCommand&&mode!=='--observe-settlement'?id(extra[0]):null;
const settlementVersion=mode==='--revise-settlement'&&/^[1-9]\d{0,9}$/.test(extra[1])?integer(Number(extra[1]),1):null;
if(mode==='--revise-settlement'&&settlementVersion===null)throw invalid();
const attemptId=paymentCommand?id(extra[0]):null;
const shipmentId=codCommand?id(extra[0]):null;
const bookingId=shippingCommand?id(extra[0]):null,orderId=initializeCommand?id(extra[0]):null;
const cancellationId=cancellationCommand?id(extra[0]):null;
const replacementBookingId=replacementShippingCommand?id(extra[0]):null;
readLocalConfig(process.env);
const { sql } = connectDatabase(target);
const adapters={'payment.create':paymentAdapter(sql,target),'payment.autolaris.advice':autolarisAdviceAdapter(sql,target),'advertising.dispatch':advertisingAdapter(sql,target),'shipping.create':shippingAdapter(sql,target),'shipping.cancel.create':shippingCancellationAdapter(sql,target),'refund.create':refundAdapter(sql,target),'recovery.refund.create':recoveryRefundAdapter(sql,target),'replacement.shipping.create':replacementShippingAdapter(sql,target)};
const stop = new AbortController();
const shutdown = () => stop.abort();
process.once("SIGINT", shutdown); process.once("SIGTERM", shutdown);
try {
  // Report readiness only after the actual database/schema can be reached.
  await sql`select id from app.outbox_job limit 0`;
  if(cancellationId){
    let processed=0;for(const job of await reconcileWaybillCancellationNow(sql,cancellationId))if(await runOneJob(sql,adapters,job))processed++;
    if(mode!=='--reconcile-waybill-cancellation')await ingestWaybillCancellationEvent(sql,await simulateWaybillCancellation(sql,target,cancellationId,mode==='--reject-waybill-cancellation'?'failed':'cancelled'));
    const jobs=await reconcileWaybillCancellationNow(sql,cancellationId);for(const job of jobs)if(await runOneJob(sql,adapters,job))processed++;
    console.log(`local_waybill_cancellation_command target=${target} mode=${mode} cancellation_id=${cancellationId} callbacks=${jobs.length} processed=${processed}`);
  }else if(replacementReceiptCommand){
    const sourceId=mode==='--receive-replacement'?(await simulateReplacementReceipt(sql,target,await sourceInput())).id:id(extra[0]);
    const jobs=await reconcileReplacementReceiptNow(sql,sourceId);let processed=0;for(const job of jobs)if(await runOneJob(sql,adapters,job))processed++;
    console.log(`local_replacement_receipt_command target=${target} mode=${mode} source_id=${sourceId} callbacks=${jobs.length} processed=${processed}`);
  }else if(replacementBookingId){
    let processed=0;for(const job of await reconcileReplacementShippingNow(sql,replacementBookingId))if(await runOneJob(sql,adapters,job))processed++;
    if(mode!=='--reconcile-replacement-shipping')await ingestReplacementWaybillEvent(sql,await simulateReplacementWaybill(sql,target,replacementBookingId,mode==='--fail-replacement-waybill'?'failed':'issued'));
    const jobs=await reconcileReplacementShippingNow(sql,replacementBookingId);for(const job of jobs)if(await runOneJob(sql,adapters,job))processed++;
    console.log(`local_replacement_shipping_command target=${target} mode=${mode} booking_id=${replacementBookingId} callbacks=${jobs.length} processed=${processed}`);
  }else if(refundCommand){
    const refundId=id(extra[0]);
    if(mode==='--verify-refund-destination'){
      const source=await createRefundDestinationSource(sql,target,refundId);
      console.log(`local_refund_destination_command target=${target} refund_id=${refundId} source_id=${source.id}`);
    }else{
      let processed=0;for(const job of await reconcileRefundNow(sql,refundId))if(await runOneJob(sql,adapters,job))processed++;
      if(mode!=='--reconcile-refund')await simulateRefundOutcome(sql,target,refundId,mode==='--confirm-refund'?'succeeded':'failed');
      const jobs=await reconcileRefundNow(sql,refundId);for(const job of jobs)if(await runOneJob(sql,adapters,job))processed++;
      console.log(`local_refund_command target=${target} mode=${mode} refund_id=${refundId} callbacks=${jobs.length} processed=${processed}`);
    }
  }else if(recoveryRefundCommand){
    const refundId=id(extra[0]);
    if(mode==='--verify-recovery-destination'){
      const source=await simulateRecoveryDestination(sql,target,refundId);
      console.log(`local_recovery_destination_command target=${target} refund_id=${refundId} source_id=${source.id}`);
    }else{
      let processed=0;for(const job of await reconcileRecoveryRefundNow(sql,refundId))if(await runOneJob(sql,adapters,job))processed++;
      if(mode!=='--reconcile-recovery-refund')await simulateRecoveryOutcome(sql,target,refundId,mode==='--confirm-recovery-refund'?'succeeded':'failed');
      const jobs=await reconcileRecoveryRefundNow(sql,refundId);for(const job of jobs)if(await runOneJob(sql,adapters,job))processed++;
      console.log(`local_recovery_refund_command target=${target} mode=${mode} refund_id=${refundId} callbacks=${jobs.length} processed=${processed}`);
    }
  }else if(receiptCommand){
    const sourceId=mode==='--receive-parcel'?(await simulateParcelReceipt(sql,target,await sourceInput())).id:id(extra[0]);
    const jobs=await reconcileParcelReceiptNow(sql,sourceId);let processed=0;for(const job of jobs)if(await runOneJob(sql,adapters,job))processed++;
    console.log(`local_parcel_receipt_command target=${target} mode=${mode} source_id=${sourceId} callbacks=${jobs.length} processed=${processed}`);
  }else if(settlementCommand){
    if(mode==='--observe-settlement')settlementId=(await simulateSettlement(sql,target,await sourceInput())).operation_id;
    else if(mode==='--revise-settlement'&&settlementId&&settlementVersion!==null){const input=await sourceInput();await sql.begin(tx=>reviseSettlementStatement(tx,target,settlementId as string,settlementVersion,input));}
    if(!settlementId)throw invalid();
    const jobs=await reconcileSettlementNow(sql,settlementId);let processed=0;for(const job of jobs)if(await runOneJob(sql,adapters,job))processed++;
    console.log(`local_settlement_command target=${target} mode=${mode} source_id=${settlementId} callbacks=${jobs.length} processed=${processed}`);
  }else if(orderId){
    await sql.begin(tx=>initializeFulfillments(tx,orderId));console.log(`local_fulfillment_command target=${target} order_id=${orderId}`);
  }else if(bookingId){
    let processed=0;
    for(const job of await reconcileShippingNow(sql,bookingId))if(await runOneJob(sql,adapters,job))processed++;
    if(mode!=='--reconcile-shipping')await ingestWaybillEvent(sql,await simulateWaybillIssue(sql,target,bookingId,mode==='--fail-waybill'?'failed':'issued'));
    const jobs=await reconcileShippingNow(sql,bookingId);for(const job of jobs)if(await runOneJob(sql,adapters,job))processed++;
    console.log(`local_shipping_command target=${target} mode=${mode} booking_id=${bookingId} callbacks=${jobs.length} processed=${processed}`);
  }else if(shipmentId){
    if(mode!=='--reconcile-cod')await ingestCodEvent(sql,await simulateCodCollection(sql,target,shipmentId,{status:mode==='--refuse-cod'?'refused':'collected'}));
    const jobs=await reconcileCodNow(sql,shipmentId);let processed=0;for(const job of jobs)if(await runOneJob(sql,adapters,job))processed++;
    console.log(`local_cod_command target=${target} mode=${mode} shipment_id=${shipmentId} callbacks=${jobs.length} processed=${processed}`);
  }else if(attemptId){
    const existing=await reconcilePaymentNow(sql,attemptId);
    for(const job of existing) await runOneJob(sql,adapters,job);
    if(mode==='--confirm-payment') await ingestProviderEvent(sql,await simulateCollection(sql,target,attemptId));
    // S93: the simulated AutoLaris account reports payment; the next advice poll (made due now) observes it.
    if(mode==='--autolaris-paid'){await simulateAutolarisStatus(sql,target,attemptId,'paid');
      const [poll]=await sql`update app.outbox_job set run_at=now() where kind='payment.autolaris.advice' and payload->>'attemptId'=${attemptId} and status='pending' returning id`;if(poll)await runOneJob(sql,adapters,poll.id);}
    const jobs=await reconcilePaymentNow(sql,attemptId);
    for(const job of jobs) await runOneJob(sql,adapters,job);
    console.log(`local_payment_command target=${target} mode=${mode} attempt_id=${attemptId} jobs=${jobs.length}`);
  }else{console.log(`worker_ready target=${target} dispatch=simulated`);
  do {
    const processed = await runOneJob(sql,adapters,onlyJobId);
    if (mode === "--once") break;
    if (!processed && !stop.signal.aborted) {
      await setTimeout(500, undefined, { signal: stop.signal }).catch((error) => {
        if (error.name !== "AbortError") throw error;
      });
    }
  } while (!stop.signal.aborted);
  }
} finally {
  await sql.end();
  process.off("SIGINT", shutdown); process.off("SIGTERM", shutdown);
}
