import assert from 'node:assert/strict'
import test from 'node:test'
import { createParameterWriteRouter } from './parameterWriteRouter.js'

function setup(options={}){let time=0;const sent=[],recorded=[];const router=createParameterWriteRouter({send:(s,c,b)=>{sent.push({s,c,b});return options.sendResult!==false},canSend:()=>options.route!==false,
 enabled:()=>options.enabled!==false,isLive:()=>options.live!==false,recordEvent:e=>recorded.push(e),now:()=>time,timeoutMs:100,maxRetries:1});
 const request=(o={})=>router.handleClientMessage({type:'writeParameter',requestId:'w1',sysId:1,compId:1,name:'LOG_DISARMED',value:1,actor:'sitl-test',timestampMs:1,confirmation:true,...o});
 return{router,request,sent,recorded,advance:ms=>{time+=ms}}}
const value=(sysId=1,v=1,name='LOG_DISARMED')=>({sysId,compId:1,messageName:'PARAM_VALUE',payload:{paramValue:{paramId:name,value:v,paramType:2,paramIndex:1,paramCount:10}}})

test('routes to exact target and completes only on matching target/name/value',()=>{const h=setup();assert.equal(h.request({sysId:2}).status,'pending');assert.equal(`${h.sent[0].s}:${h.sent[0].c}`,'2:1')
 assert.equal(h.router.ingestEnvelope(value(1)),null);assert.equal(h.router.ingestEnvelope(value(2,0)),null);assert.equal(h.router.ingestEnvelope(value(2)).status,'complete')})
test('retries identical bytes then times out once',()=>{const h=setup();h.request();h.advance(101);h.router.tick();assert.ok(h.sent[0].b.equals(h.sent[1].b));h.advance(101);assert.equal(h.router.tick()[0].status,'failed');assert.deepEqual(h.router.tick(),[])})
test('policy rejects disabled, replay, stale, unconfirmed, unknown, unbounded, duplicate and ambiguous writes',()=>{
 for(const [options,override] of [[{enabled:false},{}],[{live:false},{}],[{route:false},{}],[{}, {confirmation:false}],[{}, {name:'RTL_ALT'}],[{}, {value:2}]]){const h=setup(options);assert.equal(h.request(override).status,'failed');assert.equal(h.sent.length,0)}
 const h=setup();h.request();assert.match(h.request({requestId:'w2'}).reason,/already pending/);assert.equal(h.sent.length,1)})
test('route loss at transmit and passive replay are safe',()=>{const gone=setup({sendResult:false});assert.match(gone.request().reason,/disappeared/)
 const h=setup({live:false});const event={type:'parameterWrite',requestId:'old',status:'complete'};assert.deepEqual(h.router.ingestRecordedEvent(event),event);assert.deepEqual(h.router.snapshotForNewClient(),[event])})
