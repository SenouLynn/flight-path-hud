/**
 * One stable colour per node, used for its map marker, its route line, its
 * waypoint badges and its roster swatch — so a track on the map and a row in the
 * list are recognisably the same node without reading either label.
 *
 * Assigned by hashing the node id, NOT by its position in the roster. Roster
 * position is not stable: a node going quiet is evicted after its TTL, and every
 * node below it would shift up and change colour. Recolouring the fleet mid-
 * flight because an unrelated node dropped off is exactly the kind of thing an
 * operator reads as "something just happened to that aircraft".
 *
 * The cost is collisions — two ids can hash to the same colour. Acceptable at
 * fleet scale (a handful of nodes against eight colours), and the alternative
 * trades a rare ambiguity for a frequent lie.
 */

/**
 * Eight hues chosen to stay legible against the `#0a0e14` map backdrop and to
 * separate from each other at marker size.
 *
 * `#ffdd57` is deliberately absent: it marks the *active* waypoint
 * (`.waypoint-marker.active`), a per-mission state that must not be confused
 * with an identity, and it would read as one if some node simply owned it.
 */
export const NODE_COLORS: readonly string[] = [
  '#74d7ff', // cyan
  '#ffb454', // amber
  '#c792ea', // violet
  '#6ee7a8', // mint
  '#ff8fa3', // rose
  '#8fb8ff', // periwinkle
  '#e6c07b', // sand
  '#5fd4c4', // teal
]

/**
 * FNV-1a, 32-bit. Chosen for being short, dependency-free and well-distributed
 * over short ASCII strings, which is exactly the input here. Nothing depends on
 * it being cryptographic.
 */
function hashNodeId(nodeId: string): number {
  let hash = 0x811c9dc5

  for (let index = 0; index < nodeId.length; index += 1) {
    hash ^= nodeId.charCodeAt(index)
    // The FNV prime, as a sum of shifts: `hash * 16777619` overflows a JS
    // number's integer-exact range partway through, `Math.imul` does not.
    hash = Math.imul(hash, 0x01000193)
  }

  // `>>> 0` reinterprets the sign bit, so the result indexes forwards.
  return hash >>> 0
}

/** The colour for a node id, stable for the lifetime of that id. */
export function nodeColor(nodeId: string): string {
  return NODE_COLORS[hashNodeId(nodeId) % NODE_COLORS.length]
}
