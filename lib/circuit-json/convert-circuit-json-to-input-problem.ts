import type {
  AnyCircuitElement,
  PcbBoard,
  PcbHole,
  PcbPlatedHole,
  PcbSmtPad,
  PcbTrace,
  PcbVia,
  Point,
} from "circuit-json"
import { getFullConnectivityMapFromCircuitJson } from "circuit-json-to-connectivity-map"
import type {
  InputCircularPad,
  InputPad,
  InputPillPad,
  InputPolygonPad,
  InputProblem,
  InputRectPad,
  InputTracePad,
} from "lib/types"
import type { ConvertCircuitJsonToInputProblemOptions } from "./ConvertCircuitJsonToInputProblemOptions"
import { buildSubcircuitConnectivityLookup } from "./buildSubcircuitConnectivityLookup"
import { resolvePourConnectivityKey } from "./resolvePourConnectivityKey"

export const convertCircuitJsonToInputProblem = (
  circuitJson: AnyCircuitElement[],
  options: ConvertCircuitJsonToInputProblemOptions,
): InputProblem => {
  const pcb_board = circuitJson.find((e) => e.type === "pcb_board") as
    | PcbBoard
    | undefined

  if (!pcb_board) throw new Error("No pcb_board found in circuit json")

  const globalConnectivityMap =
    getFullConnectivityMapFromCircuitJson(circuitJson)
  const subcircuitConnectivityMap = buildSubcircuitConnectivityLookup(
    circuitJson,
    globalConnectivityMap,
    options.subcircuit_id,
  )
  const pourConnectivityKey = resolvePourConnectivityKey(
    circuitJson,
    options,
    subcircuitConnectivityMap,
  )
  const { getSubcircuitConnectivityKeyForId } = subcircuitConnectivityMap

  const pads: InputPad[] = []

  for (const elm of circuitJson) {
    if (elm.type === "pcb_smtpad") {
      const smtpad = elm as PcbSmtPad
      if (smtpad.layer !== options.layer) continue

      let connectivityKey: string | undefined
      connectivityKey = getSubcircuitConnectivityKeyForId(smtpad.pcb_smtpad_id)
      if (!connectivityKey) {
        connectivityKey = `unconnected:${smtpad.pcb_smtpad_id}`
      }

      if (smtpad.shape === "rect") {
        pads.push({
          shape: "rect",
          padId: smtpad.pcb_smtpad_id,
          layer: smtpad.layer,
          connectivityKey,
          bounds: {
            minX: smtpad.x - smtpad.width! / 2,
            minY: smtpad.y - smtpad.height! / 2,
            maxX: smtpad.x + smtpad.width! / 2,
            maxY: smtpad.y + smtpad.height! / 2,
          },
        } as InputRectPad)
      } else if (smtpad.shape === "circle") {
        pads.push({
          shape: "circle",
          padId: smtpad.pcb_smtpad_id,
          layer: smtpad.layer,
          connectivityKey,
          x: smtpad.x,
          y: smtpad.y,
          radius: smtpad.radius!,
        } as InputCircularPad)
      } else if (smtpad.shape === "pill" || smtpad.shape === "rotated_pill") {
        pads.push({
          shape: "pill",
          padId: smtpad.pcb_smtpad_id,
          layer: smtpad.layer,
          connectivityKey,
          x: smtpad.x,
          y: smtpad.y,
          width: smtpad.width!,
          height: smtpad.height!,
          radius: smtpad.radius!,
          ccwRotation:
            smtpad.shape === "rotated_pill" ? smtpad.ccw_rotation : 0,
        } as InputPillPad)
      }
    } else if (elm.type === "pcb_plated_hole") {
      const platedHole = elm as PcbPlatedHole
      // A plated THROUGH-hole's barrel is conductive on every copper layer, but its .layers
      // only lists where it has pad copper (top/bottom). Skipping it on the inner layers lets
      // an inner copper pour flood solid over every through-hole pin with no anti-pad, shorting
      // that plane to the pin's net. Treat a hole that spans top & bottom as present on ALL
      // layers, so the pour cuts an anti-pad (or connects, if the hole is on the pour's net).
      const isThroughHole =
        platedHole.layers.includes("top") &&
        platedHole.layers.includes("bottom")
      if (!isThroughHole && !platedHole.layers.includes(options.layer)) continue

      let connectivityKey = getSubcircuitConnectivityKeyForId(
        platedHole.pcb_plated_hole_id,
      )
      if (!connectivityKey) {
        connectivityKey = `unconnected-plated-hole:${platedHole.pcb_plated_hole_id}`
      }

      if (platedHole.shape === "circle") {
        pads.push({
          shape: "circle",
          padId: platedHole.pcb_plated_hole_id,
          layer: options.layer,
          connectivityKey,
          x: platedHole.x,
          y: platedHole.y,
          radius: platedHole.outer_diameter / 2,
        } as InputCircularPad)
      } else if (platedHole.shape === "circular_hole_with_rect_pad") {
        const rectWidth = platedHole.rect_pad_width
        const rectHeight = platedHole.rect_pad_height
        if (typeof rectWidth !== "number" || typeof rectHeight !== "number") {
          continue
        }
        pads.push({
          shape: "rect",
          padId: platedHole.pcb_plated_hole_id,
          layer: options.layer,
          connectivityKey,
          bounds: {
            minX: platedHole.x - rectWidth / 2,
            minY: platedHole.y - rectHeight / 2,
            maxX: platedHole.x + rectWidth / 2,
            maxY: platedHole.y + rectHeight / 2,
          },
        } as InputRectPad)
      } else if (platedHole.shape === "pill" || platedHole.shape === "oval") {
        // A pill / oval plated hole (e.g. a USB-C shield leg) matches neither branch above, so
        // the stock solver drops it and an inner pour floods solid over it with no anti-pad.
        // Emit its copper extent (outer_width/height) as a native pill pad so the pour antipads
        // it like any other pad.
        if (platedHole.outer_width > 0 && platedHole.outer_height > 0) {
          pads.push({
            shape: "pill",
            padId: platedHole.pcb_plated_hole_id,
            layer: options.layer,
            connectivityKey,
            x: platedHole.x,
            y: platedHole.y,
            width: platedHole.outer_width,
            height: platedHole.outer_height,
            radius:
              Math.min(platedHole.outer_width, platedHole.outer_height) / 2,
            ccwRotation: platedHole.ccw_rotation ?? 0,
          } as InputPillPad)
        }
      }
    } else if (elm.type === "pcb_hole") {
      const hole = elm as PcbHole
      if (hole.hole_shape !== "circle") continue

      pads.push({
        shape: "circle",
        padId: hole.pcb_hole_id,
        layer: options.layer, // holes are through-all
        connectivityKey: `hole:${hole.pcb_hole_id}`,
        x: hole.x,
        y: hole.y,
        radius: hole.hole_diameter / 2,
      } as InputCircularPad)
    } else if (elm.type === "pcb_cutout") {
      const cutout = elm as any
      if (cutout.shape === "rect") {
        pads.push({
          shape: "rect",
          padId: cutout.pcb_cutout_id,
          layer: options.layer, // through-all
          connectivityKey: `cutout:${cutout.pcb_cutout_id}`,
          bounds: {
            minX: cutout.center.x - cutout.width / 2,
            minY: cutout.center.y - cutout.height / 2,
            maxX: cutout.center.x + cutout.width / 2,
            maxY: cutout.center.y + cutout.height / 2,
          },
        } as InputRectPad)
      } else if (cutout.shape === "circle") {
        pads.push({
          shape: "circle",
          padId: cutout.pcb_cutout_id,
          layer: options.layer, // through-all
          connectivityKey: `cutout:${cutout.pcb_cutout_id}`,
          x: cutout.center.x,
          y: cutout.center.y,
          radius: cutout.radius,
        } as InputCircularPad)
      } else if (cutout.shape === "polygon") {
        pads.push({
          shape: "polygon",
          padId: cutout.pcb_cutout_id,
          layer: options.layer, // through-all
          connectivityKey: `cutout:${cutout.pcb_cutout_id}`,
          points: cutout.points,
        } as InputPolygonPad)
      }
    } else if (elm.type === "pcb_via") {
      const via = elm as PcbVia
      // A through-via's barrel is conductive on every copper layer, but via.layers only lists
      // its endpoints (top/bottom) — the same case the plated-hole guard above handles. Skipping
      // it on the inner layers lets an inner copper pour flood solid over it with no anti-pad,
      // shorting that plane to the via's net. Treat a top & bottom via as present on ALL layers,
      // so each inner plane cuts an anti-pad (or connects, if the via is on the pour's net).
      const isThroughVia =
        via.layers.includes("top") && via.layers.includes("bottom")
      if (!isThroughVia && !via.layers.includes(options.layer)) continue

      const connectivityKey: string =
        getSubcircuitConnectivityKeyForId(via.pcb_via_id) ??
        `unconnected-via:${via.pcb_via_id}`

      pads.push({
        shape: "circle",
        padId: via.pcb_via_id,
        layer: options.layer,
        connectivityKey,
        x: via.x,
        y: via.y,
        radius: via.outer_diameter / 2,
      } as InputCircularPad)
    } else if (elm.type === "pcb_trace") {
      const trace = elm as PcbTrace
      const connectivityKey = getSubcircuitConnectivityKeyForId(
        trace.pcb_trace_id,
      )
      if (!connectivityKey) continue

      let currentSegmentGroup: Point[] = []
      let currentWidth: number | null = null

      const commitGroup = () => {
        if (currentSegmentGroup.length > 1) {
          pads.push({
            shape: "trace",
            padId: `${trace.pcb_trace_id}-${pads.length}`,
            layer: options.layer,
            connectivityKey,
            segments: currentSegmentGroup,
            width: currentWidth!,
          } as InputTracePad)
        }
        currentSegmentGroup = []
        currentWidth = null
      }

      for (const r of trace.route) {
        const ri = r as any
        const isWireOnLayer =
          ri.route_type === "wire" && ri.layer === options.layer
        if (isWireOnLayer) {
          if (currentWidth === null) currentWidth = ri.width
          currentSegmentGroup.push({ x: ri.x, y: ri.y })
        } else {
          commitGroup()
        }
      }
      commitGroup()
    }
  }

  const { width, height } = pcb_board

  // Use pour-specific outline if provided, otherwise fall back to board outline
  const outline = options.outline ?? pcb_board.outline

  let bounds: { minX: number; minY: number; maxX: number; maxY: number }
  if (outline && outline.length > 0) {
    const xs = outline.map((p) => p.x)
    const ys = outline.map((p) => p.y)
    bounds = {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
    }
  } else {
    bounds = {
      minX: -width! / 2,
      minY: -height! / 2,
      maxX: width! / 2,
      maxY: height! / 2,
    }
  }

  const regionsForPour = [
    {
      shape: "rect" as const,
      layer: options.layer,
      bounds,
      outline,
      connectivityKey: pourConnectivityKey,
      padMargin: options.pad_margin,
      traceMargin: options.trace_margin,
      board_edge_margin: options.board_edge_margin ?? 0,
      cutout_margin: options.cutout_margin,
    },
  ]

  return {
    pads,
    regionsForPour,
  }
}
