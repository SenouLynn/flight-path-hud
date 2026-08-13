import Ajv2020 from 'ajv/dist/2020.js'
import type { AnySchema } from 'ajv'
import { describe, expect, it } from 'vitest'
import telemetrySchemaJson from '../../../contracts/wire/telemetry-frame.schema.json'
import flightStateSchemaJson from '../../../contracts/wire/flight-state-frame.schema.json'
import envelopeSchemaJson from '../../../contracts/wire/envelope.schema.json'
import guidedTakeoffSchemaJson from '../../../contracts/wire/guided-takeoff-frame.schema.json'
import guidedLandSchemaJson from '../../../contracts/wire/guided-land-frame.schema.json'
import modeChangeSchemaJson from '../../../contracts/wire/mode-change-frame.schema.json'
import armDisarmSchemaJson from '../../../contracts/wire/arm-disarm-frame.schema.json'
import validTelemetry from '../../../contracts/fixtures/valid/telemetry-frame.json'
import validFlightState from '../../../contracts/fixtures/valid/flight-state-frame.json'
import validGuidedTakeoff from '../../../contracts/fixtures/valid/guided-takeoff-frame.json'
import validGuidedLand from '../../../contracts/fixtures/valid/guided-land-frame.json'
import validModeChange from '../../../contracts/fixtures/valid/mode-change-frame.json'
import validArmDisarm from '../../../contracts/fixtures/valid/arm-disarm-frame.json'
import invalidTelemetry from '../../../contracts/fixtures/invalid/telemetry-sequence-overflow.json'
import invalidFlightState from '../../../contracts/fixtures/invalid/flight-state-zero-system.json'
import invalidGuidedTakeoff from '../../../contracts/fixtures/invalid/guided-takeoff-negative-error.json'
import invalidGuidedLand from '../../../contracts/fixtures/invalid/guided-land-fractional-ack.json'
import invalidModeChange from '../../../contracts/fixtures/invalid/mode-change-custom-mode-overflow.json'
import invalidArmDisarm from '../../../contracts/fixtures/invalid/arm-disarm-force-safety-case.json'
import consumerCasesJson from '../../../contracts/fixtures/consumer/telemetry-parser-cases.json'
import { parseWireFrame } from './wire'

const telemetrySchema = telemetrySchemaJson as AnySchema
const flightStateSchema = flightStateSchemaJson as AnySchema
const envelopeSchema = envelopeSchemaJson as AnySchema
const guidedTakeoffSchema = guidedTakeoffSchemaJson as AnySchema
const guidedLandSchema = guidedLandSchemaJson as AnySchema
const modeChangeSchema = modeChangeSchemaJson as AnySchema
const armDisarmSchema = armDisarmSchemaJson as AnySchema

const ajv = new Ajv2020({ strict: false })
ajv.addSchema(telemetrySchema)
ajv.addSchema(flightStateSchema)
ajv.addSchema(guidedTakeoffSchema)
ajv.addSchema(guidedLandSchema)
ajv.addSchema(modeChangeSchema)
ajv.addSchema(armDisarmSchema)
const validateTelemetry = ajv.getSchema('https://flight-path-hud.local/contracts/wire/telemetry-frame.schema.json')
const validateFlightState = ajv.getSchema('https://flight-path-hud.local/contracts/wire/flight-state-frame.schema.json')
const validateGuidedTakeoff = ajv.getSchema('https://flight-path-hud.local/contracts/wire/guided-takeoff-frame.schema.json')
const validateGuidedLand = ajv.getSchema('https://flight-path-hud.local/contracts/wire/guided-land-frame.schema.json')
const validateModeChange = ajv.getSchema('https://flight-path-hud.local/contracts/wire/mode-change-frame.schema.json')
const validateArmDisarm = ajv.getSchema('https://flight-path-hud.local/contracts/wire/arm-disarm-frame.schema.json')
const validateEnvelope = ajv.compile(envelopeSchema)

if (validateTelemetry === undefined || validateFlightState === undefined
  || validateGuidedTakeoff === undefined || validateGuidedLand === undefined
  || validateModeChange === undefined || validateArmDisarm === undefined) {
  throw new Error('portable schemas did not register')
}

describe('portable producer schemas', () => {
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
  })

  it('rejects fixtures outside fixed-width identity domains', () => {
    expect(validateTelemetry(invalidTelemetry)).toBe(false)
    expect(validateFlightState(invalidFlightState)).toBe(false)
    expect(validateGuidedTakeoff(invalidGuidedTakeoff)).toBe(false)
    expect(validateGuidedLand(invalidGuidedLand)).toBe(false)
    expect(validateModeChange(invalidModeChange)).toBe(false)
    expect(validateArmDisarm(invalidArmDisarm)).toBe(false)
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
