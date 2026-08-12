import { describe, expect, it } from 'vitest'
import { homeFromWireFrame } from './home'
import type { HomeWireFrame } from './wire'

describe('homeFromWireFrame', () => {
  it('renames fields from wire format to domain format', () => {
    const frame: HomeWireFrame = {
      type: 'home',
      sysId: 1,
      compId: 1,
      lat: 47.5,
      lon: -122.3,
      altMslM: 50,
    }

    const result = homeFromWireFrame(frame)

    expect(result.latDeg).toBe(47.5)
    expect(result.lonDeg).toBe(-122.3)
    expect(result.altMslM).toBe(50)
  })

  it('performs no scaling on latitude', () => {
    const frame: HomeWireFrame = {
      type: 'home',
      sysId: 1,
      compId: 1,
      lat: 47.6247,
      lon: -122.3103,
      altMslM: 100,
    }

    const result = homeFromWireFrame(frame)

    // Exact equality check to ensure no scaling happened
    expect(result.latDeg).toBe(frame.lat)
    expect(result.latDeg === frame.lat).toBe(true)
  })

  it('performs no scaling on longitude', () => {
    const frame: HomeWireFrame = {
      type: 'home',
      sysId: 1,
      compId: 1,
      lat: 47.6247,
      lon: -122.3103,
      altMslM: 100,
    }

    const result = homeFromWireFrame(frame)

    // Exact equality check to ensure no scaling happened
    expect(result.lonDeg).toBe(frame.lon)
    expect(result.lonDeg === frame.lon).toBe(true)
  })

  it('performs no scaling on altitude', () => {
    const frame: HomeWireFrame = {
      type: 'home',
      sysId: 1,
      compId: 1,
      lat: 47.6247,
      lon: -122.3103,
      altMslM: 123.456,
    }

    const result = homeFromWireFrame(frame)

    // Exact equality check to ensure no scaling happened
    expect(result.altMslM).toBe(frame.altMslM)
    expect(result.altMslM === frame.altMslM).toBe(true)
  })

  it('returns HomePosition with LatLon interface', () => {
    const frame: HomeWireFrame = {
      type: 'home',
      sysId: 1,
      compId: 1,
      lat: 47.5,
      lon: -122.3,
      altMslM: 50,
    }

    const result = homeFromWireFrame(frame)

    // Verify it has latDeg and lonDeg (LatLon interface)
    expect(result).toHaveProperty('latDeg')
    expect(result).toHaveProperty('lonDeg')
    expect(result).toHaveProperty('altMslM')
  })
})
