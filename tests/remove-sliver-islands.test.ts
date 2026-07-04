import { expect, test } from "bun:test"
import {
  type CopperPourIsland,
  removeSliverIslands,
} from "../lib/solvers/copper-pour/manifold-geometry-adapter"

// A rectangle W×L centered at the origin, as a CopperPourIsland with no holes.
// Its mean width (2·area/perimeter) is W·L/(W+L) ≈ W when W ≪ L.
const rectIsland = (w: number, l: number): CopperPourIsland => ({
  outerRing: [
    { x: -w / 2, y: -l / 2 },
    { x: w / 2, y: -l / 2 },
    { x: w / 2, y: l / 2 },
    { x: -w / 2, y: l / 2 },
  ],
  innerRings: [],
})

test("removeSliverIslands drops a sub-min-feature-width fragment", () => {
  // 0.06 × 0.5 mm → area 0.03 mm², width ≈ 0.054 mm (the exact class the board hit:
  // a 0.062 mm-wide, 0.030 mm² V3V3 inner-layer acid-trap the flood/subtract left behind).
  const sliver = rectIsland(0.06, 0.5)
  const plane = rectIsland(2, 2)
  const kept = removeSliverIslands([sliver, plane])
  expect(kept).toEqual([plane])
})

test("removeSliverIslands keeps a normal island untouched", () => {
  const islands = [rectIsland(2, 2), rectIsland(1.5, 0.8)]
  expect(removeSliverIslands(islands)).toEqual(islands)
})

test("removeSliverIslands double-gate: a thin but large-area shape is kept", () => {
  // 0.08 × 3 mm → width ≈ 0.078 mm (< min feature) but area 0.24 mm² (≥ max sliver area):
  // below the width floor yet too large to be a sliver, so it is left alone — a legitimate
  // plane pinched to a thin waist is never mistaken for an acid trap.
  const thinLarge = rectIsland(0.08, 3)
  expect(removeSliverIslands([thinLarge])).toEqual([thinLarge])
})

test("removeSliverIslands thresholds are configurable", () => {
  const island = rectIsland(0.06, 0.5) // width ≈ 0.054 mm, area 0.03 mm²
  // Relaxing the width floor below this island's width keeps it.
  expect(removeSliverIslands([island], 0.05)).toEqual([island])
})
