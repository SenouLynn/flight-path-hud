import assert from 'node:assert/strict';
import test from 'node:test';
import { createMessageIntervalRouter } from './messageIntervalRouter.js';
import { MAV_CMD_SET_MESSAGE_INTERVAL } from './messageRequestProtocol.js';

function setup(options={}){let time=0;const sent=[],recorded=[];const router=createMessageIntervalRouter({send:(s,c,b)=>{sent.push({s,c,b});return true},canSend:()=>options.route!==false,
 enabled:()=>options.enabled!==false,isLive:()=>options.live!==false,recordEvent:e=>recorded.push(e),now:()=>time,ackTimeoutMs:100,observationTimeoutMs:200});
 const request=(o={})=>router.handleClientMessage({type:'setMessageInterval',requestId:'i1',sysId:1,compId:1,messageName:'ATTITUDE',intervalUs:200000,...o});
 return{router,request,sent,recorded,advance:ms=>{time+=ms}}}
const ack=(result=0,sysId=1)=>({sysId,compId:1,messageName:'COMMAND_ACK',payload:{commandAck:{command:MAV_CMD_SET_MESSAGE_INTERVAL,result}}})

test('requires exact-target ACK then observed message',()=>{const h=setup();assert.equal(h.request().status,'awaitingAck');assert.equal(h.router.ingestEnvelope(ack(0,2)),null)
 assert.equal(h.router.ingestEnvelope(ack()).status,'awaitingObservation');assert.equal(h.router.ingestEnvelope({sysId:1,compId:1,messageName:'ATTITUDE',payload:{}}).status,'complete')})
test('default interval also requires observation; disable completes on ACK',()=>{const d=setup();d.request({intervalUs:0});d.router.ingestEnvelope(ack());assert.equal(d.router.ingestEnvelope({sysId:1,compId:1,messageName:'ATTITUDE',payload:{}}).status,'complete')
 const x=setup();x.request({intervalUs:-1});assert.equal(x.router.ingestEnvelope(ack()).status,'complete')})
test('negative ACK and independent timeouts fail',()=>{const n=setup();n.request();assert.match(n.router.ingestEnvelope(ack(3)).reason,/result 3/)
 const a=setup();a.request();a.advance(101);assert.match(a.router.tick()[0].reason,/ack timeout/)
 const o=setup();o.request();o.router.ingestEnvelope(ack());o.advance(201);assert.match(o.router.tick()[0].reason,/observation timeout/)})
test('disabled gate, replay, route, allowlist, unsafe rate, duplicate and target ambiguity send nothing',()=>{
 for(const [options,override] of [[{enabled:false},{}],[{live:false},{}],[{route:false},{}],[{}, {messageName:'RAW_IMU'}],[{}, {intervalUs:99999}]]){const h=setup(options);assert.equal(h.request(override).status,'failed');assert.equal(h.sent.length,0)}
 const h=setup();h.request();assert.match(h.request({requestId:'i2'}).reason,/already pending/);assert.equal(h.sent.length,1)})
test('recorded state replays without sending',()=>{const h=setup({live:false});const event={type:'messageInterval',requestId:'old',status:'complete'};assert.deepEqual(h.router.ingestRecordedEvent(event),event);assert.deepEqual(h.router.snapshotForNewClient(),[event]);assert.equal(h.sent.length,0)})
