import type { FillRule } from "manifold-3d"
import {
  getCrossSection,
  runManifoldOperation,
  type CrossSection,
} from "./manifold-runtime"
import {
  fromScaledManifoldPolygons,
  MANIFOLD_GEOMETRY_SCALE,
  normalizeRing,
  signedArea,
  toScaledManifoldPolygons,
  type PolygonRing,
} from "./polygon-ring"

export const DEFAULT_MIN_ISLAND_AREA = 1e-8

export type CopperPourIsland = {
  outerRing: PolygonRing
  innerRings: PolygonRing[]
}

const emptyCrossSection = (): CrossSection => getCrossSection().square([0, 0])

export const crossSectionFromPolygon = (
  polygon: PolygonRing,
  fillRule: FillRule = "Positive",
): CrossSection => {
  const scaledPolygons = toScaledManifoldPolygons(
    [polygon],
    "crossSectionFromPolygon",
  )
  const CrossSection = getCrossSection()
  if (scaledPolygons.length === 0) {
    return emptyCrossSection()
  }
  return runManifoldOperation("crossSectionFromPolygon", scaledPolygons, () =>
    CrossSection.ofPolygons(scaledPolygons, fillRule),
  )
}

export const crossSectionFromPolygons = (
  polygons: PolygonRing[],
  fillRule: FillRule = "Positive",
): CrossSection => {
  const scaledPolygons = toScaledManifoldPolygons(
    polygons,
    "crossSectionFromPolygons",
  )
  const CrossSection = getCrossSection()
  if (scaledPolygons.length === 0) {
    return emptyCrossSection()
  }
  return runManifoldOperation("crossSectionFromPolygons", scaledPolygons, () =>
    CrossSection.ofPolygons(scaledPolygons, fillRule),
  )
}

export const composeCrossSections = (
  sections: CrossSection[],
): CrossSection => {
  const nonEmptySections = sections.filter((section) => !section.isEmpty())
  const CrossSection = getCrossSection()
  if (nonEmptySections.length === 0) {
    return emptyCrossSection()
  }
  return runManifoldOperation("composeCrossSections", [], () =>
    CrossSection.compose(nonEmptySections),
  )
}

export const offsetPolygon = (
  polygon: PolygonRing,
  margin: number,
  joinType: "Square" | "Round" | "Miter" = "Miter",
): PolygonRing[] => {
  const scaledPolygons = toScaledManifoldPolygons([polygon], "offsetPolygon")
  if (scaledPolygons.length === 0 || margin <= 0) {
    return scaledPolygons.length === 0 ? [] : [normalizeRing(polygon)]
  }

  const scaledMargin = margin * MANIFOLD_GEOMETRY_SCALE
  const CrossSection = getCrossSection()
  const section = runManifoldOperation(
    "offsetPolygon.input",
    scaledPolygons,
    () => CrossSection.ofPolygons(scaledPolygons, "Positive"),
  )
  const offset = runManifoldOperation(
    "offsetPolygon.offset",
    scaledPolygons,
    () => section.offset(scaledMargin, joinType, 2, 32),
  )
  return fromScaledManifoldPolygons(offset.toPolygons())
}

export const subtractBlockersFromPour = (
  pourPolygon: PolygonRing,
  blockerPolygons: PolygonRing[],
): CrossSection => {
  const pourSection = crossSectionFromPolygon(pourPolygon)
  const blockerSection = crossSectionFromPolygons(blockerPolygons)

  if (pourSection.isEmpty() || blockerSection.isEmpty()) {
    return pourSection
  }

  const operationPolygons = [
    ...toScaledManifoldPolygons([pourPolygon], "subtractBlockersFromPour.pour"),
    ...toScaledManifoldPolygons(
      blockerPolygons,
      "subtractBlockersFromPour.blockers",
    ),
  ]

  return runManifoldOperation(
    "subtractBlockersFromPour",
    operationPolygons,
    () => pourSection.subtract(blockerSection),
  )
}

export const removeTinyIslands = (
  section: CrossSection,
  minArea = DEFAULT_MIN_ISLAND_AREA,
): CrossSection => {
  if (section.isEmpty()) return section

  const minScaledArea =
    minArea * MANIFOLD_GEOMETRY_SCALE * MANIFOLD_GEOMETRY_SCALE
  const islands = section
    .decompose()
    .filter((island) => Math.abs(island.area()) >= minScaledArea)

  return composeCrossSections(islands)
}

// Fab minimum copper feature width (mm). A poured fragment narrower than this can't be
// reliably etched — it's a floating acid-trap, not usable copper. Matches JLCPCB's min
// trace/feature width and the board's downstream dropPourSlivers backstop.
export const DEFAULT_MIN_FEATURE_WIDTH = 0.1
// A sub-min-feature-width island this small (mm²) is a sliver; larger thin shapes are
// left alone so a legitimate plane pinched to a thin waist is never mistaken for one.
export const DEFAULT_MAX_SLIVER_AREA = 0.15

const ringPerimeter = (ring: PolygonRing): number => {
  let perimeter = 0
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!
    const b = ring[(i + 1) % ring.length]!
    perimeter += Math.hypot(b.x - a.x, b.y - a.y)
  }
  return perimeter
}

/**
 * Drop copper-pour islands that are DFM slivers. removeTinyIslands (area ≥ ~1e-8 mm²)
 * only clears numerically-degenerate geometry; this is the manufacturability filter on
 * top of it. A shape's mean width is 2·area/perimeter; an island is a sliver when it is
 * BOTH narrower than the fab minimum feature width AND small in area — so the flood/
 * subtract can't leave a floating acid-trap behind, while a large plane (even one with a
 * thin waist) is never removed. Islands are already disconnected pieces, so dropping one
 * severs nothing.
 */
export const removeSliverIslands = (
  islands: CopperPourIsland[],
  minFeatureWidth = DEFAULT_MIN_FEATURE_WIDTH,
  maxSliverArea = DEFAULT_MAX_SLIVER_AREA,
): CopperPourIsland[] =>
  islands.filter((island) => {
    const area = Math.abs(signedArea(island.outerRing))
    const perimeter = ringPerimeter(island.outerRing)
    const width = perimeter > 0 ? (2 * area) / perimeter : 0
    return !(width < minFeatureWidth && area < maxSliverArea)
  })

export const crossSectionToCopperPourIslands = (
  section: CrossSection,
): CopperPourIsland[] => {
  const islands: CopperPourIsland[] = []

  for (const island of section.decompose()) {
    const rings = fromScaledManifoldPolygons(island.toPolygons())
    if (rings.length === 0) continue

    const outerRing = rings.reduce((largest, ring) =>
      Math.abs(signedArea(ring)) > Math.abs(signedArea(largest))
        ? ring
        : largest,
    )
    const innerRings = rings.filter((ring) => ring !== outerRing)

    islands.push({
      outerRing,
      innerRings,
    })
  }

  return islands
}
