import assert from 'node:assert/strict'
import test from 'node:test'
import { createMessageRequestRouter } from './messageRequestRouter.js'
import { MAV_CMD_REQUEST_MESSAGE } from './messageRequestProtocol.js'

function setup(options = {}) {
  let time = 0
  const sent = [], recorded = []
  const router = createMessageRequestRouter({ send: (s,c,b) => { sent.push({s,c,b}); return true }, canSend: () => options.route !== false,
    isLive: () => options.live !== false, recordEvent: e => recorded.push(e), now: () => time, timeoutMs: 100 })
  const request = (overrides={}) => router.handleClientMessage({ type:'requestMessage', requestId:'r1', sysId:1, compId:1, messageName:'HOME_POSITION', ...overrides })
  return { router, request, sent, recorded, advance: ms => { time += ms } }
}
const ack = (sysId=1,result=0) => ({ sysId, compId:1, messageName:'COMMAND_ACK', payload:{commandAck:{command:MAV_CMD_REQUEST_MESSAGE,result}} })
const home = (sysId=1) => ({ sysId, compId:1, messageName:'HOME_POSITION', payload:{homePosition:{latDegE7:1,lonDegE7:2,altMm:3}} })

test('completes only after exact-target ACK and requested response in either order', () => {
  for (const order of [[ack(),home()],[home(),ack()]]) {
    const {router,request,sent}=setup(); assert.equal(request().status,'pending'); assert.equal(`${sent[0].s}:${sent[0].c}`,'1:1')
    assert.equal(router.ingestEnvelope(ack(2)),null)
    assert.equal(router.ingestEnvelope(order[0]).status,'pending')
    assert.equal(router.ingestEnvelope(order[1]).status,'complete')
  }
})

test('negative ACK and independent ACK/response timeouts fail', () => {
  const negative=setup(); negative.request(); assert.match(negative.router.ingestEnvelope(ack(1,3)).reason,/result 3/)
  const noAck=setup(); noAck.request(); noAck.advance(101); assert.match(noAck.router.tick()[0].reason,/ack timeout/)
  const noResponse=setup(); noResponse.request(); noResponse.router.ingestEnvelope(ack()); noResponse.advance(101); assert.match(noResponse.router.tick()[0].reason,/response timeout/)
})

test('allowlist, replay, route, duplicate, and target ambiguity send no unsafe packets', () => {
  for (const [options,override] of [[{}, {messageName:'ATTITUDE'}],[{live:false},{}],[{route:false},{}]]) {
    const {request,sent}=setup(options); assert.equal(request(override).status,'failed'); assert.equal(sent.length,0)
  }
  const h=setup(); h.request(); assert.match(h.request({requestId:'r2'}).reason,/already pending/); assert.equal(h.sent.length,1)
})

test('malformed request metadata is normalized in failure frames', () => {
  const frame = setup().request({ requestId: 42, sysId: 999, messageName: 242 })
  assert.equal(frame.status, 'failed')
  assert.equal(frame.requestId, null)
  assert.equal(frame.sysId, null)
  assert.equal(frame.messageName, null)
})

test('recorded terminal state replays passively', () => {
  const {router,sent}=setup({live:false}); const event={type:'messageRequest',requestId:'old',status:'complete'}
  assert.deepEqual(router.ingestRecordedEvent(event),event); assert.deepEqual(router.snapshotForNewClient(),[event]); assert.equal(sent.length,0)
})
