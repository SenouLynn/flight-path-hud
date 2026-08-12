/**
 * The marker element factories are DOM-shaped but tiny, so they are tested
 * against a minimal stand-in rather than by pulling a whole DOM implementation
 * into a suite that otherwise runs in plain Node.
 */

import { describe, expect, it } from 'vitest'
import { styleWaypointMarker } from './mapAdapter'

/**
 * Just enough of an element for these functions: a real class list and a style
 * object. Mirrors how MapLibre treats the element it is handed — it adds its own
 * class to it and expects that class to survive.
 */
function fakeElement(initialClasses: string[] = []): HTMLElement {
  const classes = new Set(initialClasses)

  return {
    classList: {
      add: (...names: string[]) => names.forEach((name) => classes.add(name)),
      remove: (...names: string[]) => names.forEach((name) => classes.delete(name)),
      contains: (name: string) => classes.has(name),
      toggle: (name: string, force?: boolean) => {
        const next = force ?? !classes.has(name)
        if (next) {
          classes.add(name)
        } else {
          classes.delete(name)
        }
        return next
      },
    },
    get className() {
      return [...classes].join(' ')
    },
    set className(value: string) {
      classes.clear()
      value.split(/\s+/).filter(Boolean).forEach((name) => classes.add(name))
    },
    style: {} as CSSStyleDeclaration,
  } as unknown as HTMLElement
}

describe('styleWaypointMarker', () => {
  /**
   * The regression this file exists for. `maplibregl-marker` carries
   * `position: absolute; left: 0; top: 0`. Dropping it puts the badge into normal
   * flow, where the first one happens to land on the container origin — exactly
   * where it belongs — and every badge after it stacks below, displaced.
   */
  it('preserves classes it does not own, including MapLibre\'s own', () => {
    const element = fakeElement(['waypoint-marker', 'maplibregl-marker'])

    styleWaypointMarker(element, false, '#74d7ff')

    expect(element.classList.contains('maplibregl-marker')).toBe(true)
    expect(element.classList.contains('waypoint-marker')).toBe(true)
  })

  it('keeps MapLibre\'s class across an activate/deactivate cycle', () => {
    const element = fakeElement(['waypoint-marker', 'maplibregl-marker'])

    styleWaypointMarker(element, true, '#74d7ff')
    styleWaypointMarker(element, false, '#74d7ff')
    styleWaypointMarker(element, true, '#74d7ff')

    expect(element.classList.contains('maplibregl-marker')).toBe(true)
  })

  it('adds and removes only the active class', () => {
    const element = fakeElement(['waypoint-marker', 'maplibregl-marker'])

    styleWaypointMarker(element, true)
    expect(element.classList.contains('active')).toBe(true)

    styleWaypointMarker(element, false)
    expect(element.classList.contains('active')).toBe(false)
    expect(element.classList.contains('waypoint-marker')).toBe(true)
  })

  it('paints an inactive badge in its node colour', () => {
    const element = fakeElement(['waypoint-marker'])

    styleWaypointMarker(element, false, '#c792ea')

    expect(element.style.background).toBe('#c792ea')
  })

  it('hands an active badge back to the stylesheet, so the highlight wins', () => {
    const element = fakeElement(['waypoint-marker'])

    styleWaypointMarker(element, true, '#c792ea')

    expect(element.style.background).toBe('')
  })

  it('leaves the stylesheet in charge when no colour is given', () => {
    const element = fakeElement(['waypoint-marker'])

    styleWaypointMarker(element, false)

    expect(element.style.background).toBe('')
  })
})
