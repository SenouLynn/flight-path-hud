import Ajv2020 from 'ajv/dist/2020.js'
import type { AnySchema } from 'ajv'
import { describe, expect, it } from 'vitest'
import telemetrySchemaJson from '../../../contracts/wire/telemetry-frame.schema.json'
import flightStateSchemaJson from '../../../contracts/wire/flight-state-frame.schema.json'
import envelopeSchemaJson from '../../../contracts/wire/envelope.schema.json'
import validTelemetry from '../../../contracts/fixtures/valid/telemetry-frame.json'
import validFlightState from '../../../contracts/fixtures/valid/flight-state-frame.json'
import invalidTelemetry from '../../../contracts/fixtures/invalid/telemetry-sequence-overflow.json'
import invalidFlightState from '../../../contracts/fixtures/invalid/flight-state-zero-system.json'
import consumerCasesJson from '../../../contracts/fixtures/consumer/telemetry-parser-cases.json'
import { parseWireFrame } from './wire'

const telemetrySchema = telemetrySchemaJson as AnySchema
const flightStateSchema = flightStateSchemaJson as AnySchema
const envelopeSchema = envelopeSchemaJson as AnySchema

const ajv = new Ajv2020({ strict: false })
ajv.addSchema(telemetrySchema)
ajv.addSchema(flightStateSchema)
const validateTelemetry = ajv.getSchema('https://flight-path-hud.local/contracts/wire/telemetry-frame.schema.json')
const validateFlightState = ajv.getSchema('https://flight-path-hud.local/contracts/wire/flight-state-frame.schema.json')
const validateEnvelope = ajv.compile(envelopeSchema)

if (validateTelemetry === undefined || validateFlightState === undefined) {
  throw new Error('portable schemas did not register')
}

describe('portable producer schemas', () => {
  it('accepts the canonical telemetry and tagged-frame fixtures', () => {
    expect(validateTelemetry(validTelemetry), JSON.stringify(validateTelemetry.errors)).toBe(true)
    expect(validateFlightState(validFlightState), JSON.stringify(validateFlightState.errors)).toBe(true)
    expect(validateEnvelope(validTelemetry), JSON.stringify(validateEnvelope.errors)).toBe(true)
    expect(validateEnvelope(validFlightState), JSON.stringify(validateEnvelope.errors)).toBe(true)
  })

  it('rejects fixtures outside fixed-width identity domains', () => {
    expect(validateTelemetry(invalidTelemetry)).toBe(false)
    expect(validateFlightState(invalidFlightState)).toBe(false)
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
