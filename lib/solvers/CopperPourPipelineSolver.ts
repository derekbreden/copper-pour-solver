import { BasePipelineSolver } from "@tscircuit/solver-utils"
import type { BRepShape } from "circuit-json"
import type { InputProblem, PipelineOutput } from "lib/types"
import { generateBRep } from "./copper-pour/generate-brep"
import { getBoardPolygon } from "./copper-pour/get-board-polygon"
import {
  crossSectionToCopperPourIslands,
  removeSliverIslands,
  removeTinyIslands,
  subtractBlockersFromPour,
} from "./copper-pour/manifold-geometry-adapter"
import { isManifoldGeometryInitialized } from "./copper-pour/manifold-runtime"
import { processObstaclesForPour } from "./copper-pour/process-obstacles"

export class CopperPourPipelineSolver extends BasePipelineSolver<InputProblem> {
  pipelineDef = []
  constructor(public input: InputProblem) {
    super(input)
  }

  override getSolverName(): string {
    return "CopperPourPipelineSolver"
  }

  override getOutput(): PipelineOutput {
    if (!isManifoldGeometryInitialized()) {
      throw new Error(
        "Manifold geometry has not been initialized. Call initializeManifoldGeometry() before solving copper pours.",
      )
    }

    const brep_shapes: BRepShape[] = []

    for (const region of this.input.regionsForPour) {
      const boardPolygon = getBoardPolygon(region)

      const padsForLayer = this.input.pads.filter(
        (p) => p.layer === region.layer,
      )

      const { polygonsToSubtract } = processObstaclesForPour(
        padsForLayer,
        region.connectivityKey,
        {
          padMargin: region.padMargin,
          traceMargin: region.traceMargin,
          board_edge_margin: region.board_edge_margin,
          cutoutMargin: region.cutout_margin,
        },
        region.outline,
      )

      const finalPour = removeTinyIslands(
        subtractBlockersFromPour(boardPolygon, polygonsToSubtract),
      )
      const pourIslands = removeSliverIslands(
        crossSectionToCopperPourIslands(finalPour),
      )

      const new_breps = generateBRep(pourIslands)
      brep_shapes.push(...new_breps)
    }

    return {
      brep_shapes,
    }
  }
}
