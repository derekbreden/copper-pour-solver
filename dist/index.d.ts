import { BasePipelineSolver } from '@tscircuit/solver-utils';
import { Bounds, Point } from '@tscircuit/math-utils';
import { BRepShape, LayerRef, Point as Point$1, AnyCircuitElement } from 'circuit-json';

interface InputPourRegion {
    shape: "rect";
    layer: string;
    bounds: Bounds;
    outline?: Point[];
    connectivityKey: string;
    padMargin: number;
    traceMargin: number;
    board_edge_margin?: number;
    cutout_margin?: number;
}
interface BaseInputPad {
    padId: string;
    connectivityKey: string;
    layer: string;
}
interface InputRectPad extends BaseInputPad {
    shape: "rect";
    bounds: Bounds;
}
interface InputCircularPad extends BaseInputPad {
    shape: "circle";
    x: number;
    y: number;
    radius: number;
}
interface InputPillPad extends BaseInputPad {
    shape: "pill";
    x: number;
    y: number;
    width: number;
    height: number;
    radius: number;
    ccwRotation: number;
}
interface InputTracePad extends BaseInputPad {
    shape: "trace";
    width: number;
    segments: Point[];
}
interface InputPolygonPad extends BaseInputPad {
    shape: "polygon";
    points: Point[];
}
type InputPad = InputRectPad | InputCircularPad | InputPillPad | InputTracePad | InputPolygonPad;
interface InputProblem {
    regionsForPour: InputPourRegion[];
    pads: InputPad[];
}
interface PipelineOutput {
    brep_shapes: BRepShape[];
}

declare class CopperPourPipelineSolver extends BasePipelineSolver<InputProblem> {
    input: InputProblem;
    pipelineDef: never[];
    constructor(input: InputProblem);
    getSolverName(): string;
    getOutput(): PipelineOutput;
}

declare const initializeManifoldGeometry: () => Promise<void>;

interface ConvertCircuitJsonToInputProblemOptions {
    layer: LayerRef;
    subcircuit_id?: string;
    source_net_id?: string;
    source_net_name?: string;
    subcircuit_connectivity_map_key?: string;
    /**
     * @deprecated Use subcircuit_connectivity_map_key, source_net_id, or
     * source_net_name. Generated connectivity-map ids are intentionally rejected.
     */
    pour_connectivity_key?: string;
    pad_margin: number;
    trace_margin: number;
    board_edge_margin?: number;
    cutout_margin?: number;
    outline?: Point$1[];
}

declare const convertCircuitJsonToInputProblem: (circuitJson: AnyCircuitElement[], options: ConvertCircuitJsonToInputProblemOptions) => InputProblem;

export { type BaseInputPad, type ConvertCircuitJsonToInputProblemOptions, CopperPourPipelineSolver, type InputCircularPad, type InputPad, type InputPillPad, type InputPolygonPad, type InputPourRegion, type InputProblem, type InputRectPad, type InputTracePad, type PipelineOutput, convertCircuitJsonToInputProblem, initializeManifoldGeometry };
