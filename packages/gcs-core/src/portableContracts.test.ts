import Ajv2020 from 'ajv/dist/2020.js'
import type { AnySchema } from 'ajv'
import { describe, expect, it } from 'vitest'
import telemetrySchemaJson from '../../../contracts/wire/telemetry-frame.schema.json'
import normalizedEnvelopeSchemaJson from '../../../contracts/wire/normalized-envelope.schema.json'
import coreEnvelopeSchemaJson from '../../../contracts/wire/core-envelope.schema.json'
import streamHealthSchemaJson from '../../../contracts/wire/stream-health.schema.json'
import flightStateSchemaJson from '../../../contracts/wire/flight-state-frame.schema.json'
import envelopeSchemaJson from '../../../contracts/wire/envelope.schema.json'
import guidedTakeoffSchemaJson from '../../../contracts/wire/guided-takeoff-frame.schema.json'
import guidedLandSchemaJson from '../../../contracts/wire/guided-land-frame.schema.json'
import modeChangeSchemaJson from '../../../contracts/wire/mode-change-frame.schema.json'
import armDisarmSchemaJson from '../../../contracts/wire/arm-disarm-frame.schema.json'
import missionSchemaJson from '../../../contracts/wire/mission-frame.schema.json'
import homeSchemaJson from '../../../contracts/wire/home-frame.schema.json'
import linkModeSchemaJson from '../../../contracts/wire/link-mode-frame.schema.json'
import guidedRepositionSchemaJson from '../../../contracts/wire/guided-reposition-frame.schema.json'
import clientCommandSchemaJson from '../../../contracts/wire/client-command.schema.json'
import bridgeLifecycleSchemaJson from '../../../contracts/wire/bridge-lifecycle-frame.schema.json'
import validTelemetry from '../../../contracts/fixtures/valid/telemetry-frame.json'
import validTelemetryFrames from '../../../contracts/fixtures/valid/telemetry-frames.json'
import validNormalizedEnvelopes from '../../../contracts/fixtures/valid/normalized-envelopes.json'
import validCoreEnvelopeCases from '../../../contracts/fixtures/valid/core-envelope-cases.json'
import validFlightState from '../../../contracts/fixtures/valid/flight-state-frame.json'
import validGuidedTakeoff from '../../../contracts/fixtures/valid/guided-takeoff-frame.json'
import validGuidedLand from '../../../contracts/fixtures/valid/guided-land-frame.json'
import validModeChange from '../../../contracts/fixtures/valid/mode-change-frame.json'
import validArmDisarm from '../../../contracts/fixtures/valid/arm-disarm-frame.json'
import validMission from '../../../contracts/fixtures/valid/mission-frame.json'
import validHome from '../../../contracts/fixtures/valid/home-frame.json'
import validLinkMode from '../../../contracts/fixtures/valid/link-mode-frame.json'
import validGuidedReposition from '../../../contracts/fixtures/valid/guided-reposition-frame.json'
import validClientCommands from '../../../contracts/fixtures/valid/client-commands.json'
import validBridgeLifecycleFrames from '../../../contracts/fixtures/valid/bridge-lifecycle-frames.json'
import invalidTelemetry from '../../../contracts/fixtures/invalid/telemetry-sequence-overflow.json'
import invalidTelemetryCases from '../../../contracts/fixtures/invalid/telemetry-frame-cases.json'
import invalidNormalizedEnvelopeCases from '../../../contracts/fixtures/invalid/normalized-envelope-cases.json'
import invalidFlightState from '../../../contracts/fixtures/invalid/flight-state-zero-system.json'
import invalidGuidedTakeoff from '../../../contracts/fixtures/invalid/guided-takeoff-negative-error.json'
import invalidGuidedLand from '../../../contracts/fixtures/invalid/guided-land-fractional-ack.json'
import invalidModeChange from '../../../contracts/fixtures/invalid/mode-change-custom-mode-overflow.json'
import invalidArmDisarm from '../../../contracts/fixtures/invalid/arm-disarm-force-safety-case.json'
import invalidClientCommand from '../../../contracts/fixtures/invalid/client-command-unknown-family.json'
import invalidMission from '../../../contracts/fixtures/invalid/mission-frame-latitude-overflow.json'
import invalidBridgeLifecycle from '../../../contracts/fixtures/invalid/bridge-lifecycle-extra-field.json'
import consumerCasesJson from '../../../contracts/fixtures/consumer/telemetry-parser-cases.json'
import { parseWireFrame } from './wire'

const telemetrySchema = telemetrySchemaJson as AnySchema
const normalizedEnvelopeSchema = normalizedEnvelopeSchemaJson as AnySchema
const coreEnvelopeSchema = coreEnvelopeSchemaJson as AnySchema
const streamHealthSchema = streamHealthSchemaJson as AnySchema
const flightStateSchema = flightStateSchemaJson as AnySchema
const envelopeSchema = envelopeSchemaJson as AnySchema
const guidedTakeoffSchema = guidedTakeoffSchemaJson as AnySchema
const guidedLandSchema = guidedLandSchemaJson as AnySchema
const modeChangeSchema = modeChangeSchemaJson as AnySchema
const armDisarmSchema = armDisarmSchemaJson as AnySchema
const missionSchema = missionSchemaJson as AnySchema
const homeSchema = homeSchemaJson as AnySchema
const linkModeSchema = linkModeSchemaJson as AnySchema
const guidedRepositionSchema = guidedRepositionSchemaJson as AnySchema
const clientCommandSchema = clientCommandSchemaJson as AnySchema
const bridgeLifecycleSchema = bridgeLifecycleSchemaJson as AnySchema

const ajv = new Ajv2020({ strict: false })
ajv.addSchema(normalizedEnvelopeSchema)
ajv.addSchema(streamHealthSchema)
ajv.addSchema(coreEnvelopeSchema)
ajv.addSchema(telemetrySchema)
ajv.addSchema(flightStateSchema)
ajv.addSchema(guidedTakeoffSchema)
ajv.addSchema(guidedLandSchema)
ajv.addSchema(modeChangeSchema)
ajv.addSchema(armDisarmSchema)
ajv.addSchema(missionSchema)
ajv.addSchema(homeSchema)
ajv.addSchema(linkModeSchema)
ajv.addSchema(guidedRepositionSchema)
ajv.addSchema(bridgeLifecycleSchema)
const validateTelemetry = ajv.getSchema('https://flight-path-hud.local/contracts/wire/telemetry-frame.schema.json')
const validateNormalizedEnvelope = ajv.getSchema('https://flight-path-hud.local/contracts/wire/normalized-envelope.schema.json')
const validateCoreEnvelope = ajv.getSchema('https://flight-path-hud.local/contracts/wire/core-envelope.schema.json')
const validateFlightState = ajv.getSchema('https://flight-path-hud.local/contracts/wire/flight-state-frame.schema.json')
const validateGuidedTakeoff = ajv.getSchema('https://flight-path-hud.local/contracts/wire/guided-takeoff-frame.schema.json')
const validateGuidedLand = ajv.getSchema('https://flight-path-hud.local/contracts/wire/guided-land-frame.schema.json')
const validateModeChange = ajv.getSchema('https://flight-path-hud.local/contracts/wire/mode-change-frame.schema.json')
const validateArmDisarm = ajv.getSchema('https://flight-path-hud.local/contracts/wire/arm-disarm-frame.schema.json')
const validateMission = ajv.getSchema('https://flight-path-hud.local/contracts/wire/mission-frame.schema.json')
const validateHome = ajv.getSchema('https://flight-path-hud.local/contracts/wire/home-frame.schema.json')
const validateLinkMode = ajv.getSchema('https://flight-path-hud.local/contracts/wire/link-mode-frame.schema.json')
const validateGuidedReposition = ajv.getSchema('https://flight-path-hud.local/contracts/wire/guided-reposition-frame.schema.json')
const validateClientCommand = ajv.compile(clientCommandSchema)
const validateBridgeLifecycle = ajv.getSchema('https://flight-path-hud.local/contracts/wire/bridge-lifecycle-frame.schema.json')
const validateEnvelope = ajv.compile(envelopeSchema)

if (validateTelemetry === undefined || validateNormalizedEnvelope === undefined || validateCoreEnvelope === undefined || validateFlightState === undefined
  || validateGuidedTakeoff === undefined || validateGuidedLand === undefined
  || validateModeChange === undefined || validateArmDisarm === undefined || validateMission === undefined
  || validateHome === undefined || validateLinkMode === undefined || validateGuidedReposition === undefined
  || validateBridgeLifecycle === undefined) {
  throw new Error('portable schemas did not register')
}

describe('portable producer schemas', () => {
  it('accepts all fifteen strict internal normalized families', () => {
    expect(validNormalizedEnvelopes).toHaveLength(15)
    for (const frame of validNormalizedEnvelopes) {
      expect(validateNormalizedEnvelope(frame), `${frame.messageName}: ${JSON.stringify(validateNormalizedEnvelope.errors)}`).toBe(true)
    }
  })

  it('rejects unknown, mismatched, composite, and core-decorated internal envelopes', () => {
    for (const fixture of invalidNormalizedEnvelopeCases) {
      expect(validateNormalizedEnvelope(fixture.frame), fixture.caseId).toBe(false)
    }
  })

  it('accepts health-decorated core output for all fifteen normalized families', () => {
    for (const frame of validNormalizedEnvelopes) {
      const coreFrame = { ...frame, health: validCoreEnvelopeCases.health }
      expect(validateCoreEnvelope(coreFrame), `${frame.messageName}: ${JSON.stringify(validateCoreEnvelope.errors)}`).toBe(true)
    }
  })

  it('keeps ingress, core, and public boundaries distinct', () => {
    const raw = validNormalizedEnvelopes.find((frame) => frame.messageName === 'HEARTBEAT')
    const routed = validNormalizedEnvelopes.find((frame) => frame.messageName === 'HOME_POSITION')
    expect(raw).toBeDefined()
    expect(routed).toBeDefined()
    expect(validateCoreEnvelope(raw)).toBe(false)
    expect(validateCoreEnvelope({ ...routed, health: validCoreEnvelopeCases.health })).toBe(true)
    expect(validateTelemetry({ ...routed, health: validCoreEnvelopeCases.health })).toBe(false)
  })

  it('accepts exactly the eight public raw families with strict health', () => {
    expect(validTelemetryFrames).toHaveLength(8)
    for (const frame of validTelemetryFrames) {
      expect(validateTelemetry(frame), `${frame.messageName}: ${JSON.stringify(validateTelemetry.errors)}`).toBe(true)
      expect(validateEnvelope(frame), `${frame.messageName}: ${JSON.stringify(validateEnvelope.errors)}`).toBe(true)
    }
  })

  it('rejects routed families, payload mismatches, and missing or widened health publicly', () => {
    for (const fixture of invalidTelemetryCases) {
      expect(validateTelemetry(fixture.frame), fixture.caseId).toBe(false)
      expect(validateEnvelope(fixture.frame), fixture.caseId).toBe(false)
    }
  })

  it('accepts the canonical telemetry and tagged-frame fixtures', () => {
    expect(validateTelemetry(validTelemetry), JSON.stringify(validateTelemetry.errors)).toBe(true)
    expect(validateFlightState(validFlightState), JSON.stringify(validateFlightState.errors)).toBe(true)
    expect(validateEnvelope(validTelemetry), JSON.stringify(validateEnvelope.errors)).toBe(true)
    expect(validateEnvelope(validFlightState), JSON.stringify(validateEnvelope.errors)).toBe(true)
    expect(validateGuidedTakeoff(validGuidedTakeoff), JSON.stringify(validateGuidedTakeoff.errors)).toBe(true)
    expect(validateGuidedLand(validGuidedLand), JSON.stringify(validateGuidedLand.errors)).toBe(true)
    expect(validateEnvelope(validGuidedTakeoff), JSON.stringify(validateEnvelope.errors)).toBe(true)
    expect(validateEnvelope(validGuidedLand), JSON.stringify(validateEnvelope.errors)).toBe(true)
    expect(validateModeChange(validModeChange), JSON.stringify(validateModeChange.errors)).toBe(true)
    expect(validateEnvelope(validModeChange), JSON.stringify(validateEnvelope.errors)).toBe(true)
    expect(validateArmDisarm(validArmDisarm), JSON.stringify(validateArmDisarm.errors)).toBe(true)
    expect(validateEnvelope(validArmDisarm), JSON.stringify(validateEnvelope.errors)).toBe(true)
    for (const fixture of [validMission, validHome, validLinkMode, validGuidedReposition]) {
      expect(validateEnvelope(fixture), JSON.stringify(validateEnvelope.errors)).toBe(true)
    }
  })

  it('rejects fixtures outside fixed-width identity domains', () => {
    expect(validateTelemetry(invalidTelemetry)).toBe(false)
    expect(validateFlightState(invalidFlightState)).toBe(false)
    expect(validateGuidedTakeoff(invalidGuidedTakeoff)).toBe(false)
    expect(validateGuidedLand(invalidGuidedLand)).toBe(false)
    expect(validateModeChange(invalidModeChange)).toBe(false)
    expect(validateArmDisarm(invalidArmDisarm)).toBe(false)
    expect(validateMission(invalidMission)).toBe(false)
  })

  it('accepts every current client command family and rejects raw injection', () => {
    for (const command of validClientCommands) {
      expect(validateClientCommand(command), `${command.type}: ${JSON.stringify(validateClientCommand.errors)}`).toBe(true)
    }
    expect(validateClientCommand(invalidClientCommand)).toBe(false)
  })

  it('accepts every bridge-only lifecycle family', () => {
    for (const frame of validBridgeLifecycleFrames) {
      expect(validateBridgeLifecycle(frame), `${frame.type}: ${JSON.stringify(validateBridgeLifecycle.errors)}`).toBe(true)
      expect(validateEnvelope(frame), `${frame.type}: ${JSON.stringify(validateEnvelope.errors)}`).toBe(true)
    }
    expect(validateBridgeLifecycle(invalidBridgeLifecycle)).toBe(false)
  })
})

interface ConsumerCase {
  name: string
  input: unknown
  accepted: boolean
  producerValid: boolean
  expectedPayload?: unknown
}

describe('portable tolerant-consumer fixtures', () => {
  const cases = consumerCasesJson as ConsumerCase[]
  for (const fixture of cases) {
    it(fixture.name, () => {
      const result = parseWireFrame(fixture.input)
      expect(validateTelemetry(fixture.input)).toBe(fixture.producerValid)
      expect(result !== null).toBe(fixture.accepted)
      if (fixture.expectedPayload !== undefined) expect(result?.payload).toEqual(fixture.expectedPayload)
    })
  }
})
