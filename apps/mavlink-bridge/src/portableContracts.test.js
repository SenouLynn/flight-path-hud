import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { encodeGuidedReposition } from './guidedRepositionProtocol.js'
import { encodeGuidedTakeoff } from './guidedTakeoffProtocol.js'
import { encodeGuidedLand } from './guidedLandProtocol.js'
import { encodeModeChange } from './modeChangeProtocol.js'
import { encodeArmDisarm } from './armDisarmProtocol.js'
import { createModeChangeRouter } from './modeChangeRouter.js'
import { createArmDisarmRouter } from './armDisarmRouter.js'

const vectors = JSON.parse(readFileSync(
  new URL('../../../contracts/mavlink/guided-reposition-vectors.json', import.meta.url),
  'utf8',
))

for (const vector of vectors) {
  test(`guided reposition matches portable bytes: ${vector.name}`, () => {
    const frame = encodeGuidedReposition(vector.input)
    const payload = frame.subarray(6, -2)
    assert.equal(payload.toString('hex'), vector.expectedPayloadHex)
    assert.equal(frame[5], vector.expected.messageId)
    assert.equal(payload.readInt32LE(16), vector.expected.latitudeDegE7)
    assert.equal(payload.readInt32LE(20), vector.expected.longitudeDegE7)
    assert.equal(payload.readFloatLE(24), vector.expected.relativeAltitudeM)
    assert.equal(payload.readUInt16LE(28), vector.expected.command)
    assert.equal(payload[32], vector.expected.coordinateFrame)
  })
}

const guidedFlightVectors = JSON.parse(readFileSync(
  new URL('../../../contracts/mavlink/guided-flight-command-vectors.json', import.meta.url),
  'utf8',
))

for (const vector of guidedFlightVectors) {
  test(`${vector.command} matches portable bytes: ${vector.name}`, () => {
    const frame = vector.command === 'guidedTakeoff'
      ? encodeGuidedTakeoff(vector.input)
      : encodeGuidedLand(vector.input)
    const payload = frame.subarray(6, -2)
    assert.equal(payload.toString('hex'), vector.expectedPayloadHex)
    assert.equal(frame[5], vector.expected.messageId)
    assert.equal(payload.readUInt16LE(28), vector.expected.commandId)
    assert.equal(payload[30], vector.expected.targetSystemId)
    assert.equal(payload[31], vector.expected.targetComponentId)
    if (vector.expected.relativeAltitudeM !== undefined) {
      assert.equal(payload.readFloatLE(24), vector.expected.relativeAltitudeM)
    }
  })
}

const modeChangeVectors = JSON.parse(readFileSync(
  new URL('../../../contracts/mavlink/mode-change-command-vectors.json', import.meta.url),
  'utf8',
))

for (const vector of modeChangeVectors) {
  test(`mode change matches portable bytes: ${vector.name}`, () => {
    const frame = encodeModeChange(vector.input)
    const payload = frame.subarray(6, -2)
    assert.equal(payload.toString('hex'), vector.expectedPayloadHex)
    assert.equal(frame[5], vector.expected.messageId)
    assert.equal(payload.readFloatLE(0), vector.expected.baseMode)
    assert.equal(payload.readFloatLE(4), vector.expected.customMode)
    assert.equal(payload.readUInt16LE(28), vector.expected.commandId)
    assert.equal(payload[30], vector.expected.targetSystemId)
    assert.equal(payload[31], vector.expected.targetComponentId)
  })
}

const armDisarmVectors = JSON.parse(readFileSync(
  new URL('../../../contracts/mavlink/arm-disarm-command-vectors.json', import.meta.url),
  'utf8',
))

for (const vector of armDisarmVectors) {
  test(`arm/disarm matches portable bytes: ${vector.name}`, () => {
    const frame = encodeArmDisarm(vector.input)
    const payload = frame.subarray(6, -2)
    assert.equal(payload.toString('hex'), vector.expectedPayloadHex)
    assert.equal(frame[5], vector.expected.messageId)
    assert.equal(payload.readFloatLE(0), vector.expected.armParameter)
    assert.equal(payload.readFloatLE(4), vector.expected.forceParameter)
    assert.equal(payload.readUInt16LE(28), vector.expected.commandId)
    assert.equal(payload[30], vector.expected.targetSystemId)
    assert.equal(payload[31], vector.expected.targetComponentId)
  })
}

const lifecycleTraces = JSON.parse(readFileSync(
  new URL('../../../contracts/semantics/command-lifecycle-traces.json', import.meta.url),
  'utf8',
))

for (const contract of lifecycleTraces) {
  for (const scenario of contract.scenarios) {
    test(`${contract.family} follows portable lifecycle trace: ${scenario.name}`, () => {
      let route = true
      const sent = []
      const common = { send: (...args) => { sent.push(args); return true }, canSend: () => route,
        now: () => 1000, ackTimeoutMs: 100, observationTimeoutMs: 200, maxRetries: 0 }
      const mode = contract.family === 'modeChange'
      const router = mode
        ? createModeChangeRouter({ ...common, enabled: () => true, getFlightState: () => (
          { armed: false, customMode: 0, vehicleType: 2 }
        ) })
        : createArmDisarmRouter({ ...common, enabled: () => true, isIsolatedSitl: () => true,
          getFlightState: () => ({ armed: false, autopilotType: 3, vehicleType: 2 }) })
      let frame = null
      for (const step of scenario.steps) {
        if (step.action === 'request') frame = router.handleClientMessage(contract.request)
        else if (step.action === 'ack') frame = router.ingestEnvelope({ sysId: 1, compId: 1,
          messageName: 'COMMAND_ACK', payload: { commandAck: { command: mode ? 176 : 400, result: step.result } } })
        else if (step.action === 'observe') frame = router.ingestEnvelope({ sysId: 1, compId: 1,
          messageName: 'HEARTBEAT', payload: { heartbeat: mode ? { customMode: 5, armed: false } : { armed: true } } })
        else if (step.action === 'dropRoute') { route = false; frame = null }
        else if (step.action === 'tick') frame = router.tick(step.atMs)[0]
        else if (step.action === 'replay') frame = router.ingestRecordedEvent({
          type: contract.family, requestId: `${contract.family}-replay`, sysId: 1, compId: 1, status: 'complete',
        })
        assert.equal(frame?.status ?? null, step.status)
        if (step.reason !== undefined) assert.equal(frame?.reason, step.reason)
        assert.equal(sent.length, step.sends)
      }
    })
  }
}
