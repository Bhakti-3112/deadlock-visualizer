import type React from "react";
import { useCallback, useRef, useState } from "react";
import type { Edge, GraphState } from "../utils/graphUtils";
import { getDeadlockedNodes } from "../utils/graphUtils";

interface GraphCanvasProps {
  state: GraphState;
  cycles: string[][];
  onNodeDrag: (id: string, x: number, y: number) => void;
}

// Tasks are now SQUARES, Resources are now CIRCLES
const TASK_HALF = 45; // half-side of the square
const RES_RADIUS = 45; // radius of the resource circle

// Edge colors
const EDGE_COLORS: Record<string, string> = {
  allocated: "#22c55e", // green
  waiting: "#ef4444", // red
  preempted: "#eab308", // yellow
};
const DEADLOCK_EDGE_COLOR = "#f97316"; // orange

// Node colors (same palette, shapes swapped)
const TASK_FILL = "#dbeafe"; // light blue
const TASK_STROKE = "#1d4ed8"; // dark blue
const RES_FILL = "#dcfce7"; // light green
const RES_STROKE = "#15803d"; // dark green

function getNodeCenter(
  id: string,
  state: GraphState,
): { x: number; y: number } | null {
  const task = state.tasks.find((t) => t.id === id);
  if (task) return { x: task.x, y: task.y };
  const resource = state.resources.find((r) => r.id === id);
  if (resource) return { x: resource.x, y: resource.y };
  return null;
}

/** Compute where an arrow line exits/enters a node boundary. */
function getEdgeEndpoints(
  edge: Edge,
  state: GraphState,
): { x1: number; y1: number; x2: number; y2: number } | null {
  const from = getNodeCenter(edge.from, state);
  const to = getNodeCenter(edge.to, state);
  if (!from || !to) return null;

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist === 0) return null;

  const nx = dx / dist;
  const ny = dy / dist;

  const isFromTask = state.tasks.some((t) => t.id === edge.from);
  const isFromResource = state.resources.some((r) => r.id === edge.from);
  const isToTask = state.tasks.some((t) => t.id === edge.to);
  const isToResource = state.resources.some((r) => r.id === edge.to);

  // Exit point from source node
  let x1 = from.x;
  let y1 = from.y;
  if (isFromTask) {
    // Square: find intersection with border
    const tx = nx !== 0 ? TASK_HALF / Math.abs(nx) : Number.POSITIVE_INFINITY;
    const ty = ny !== 0 ? TASK_HALF / Math.abs(ny) : Number.POSITIVE_INFINITY;
    const t = Math.min(tx, ty);
    x1 = from.x + nx * t;
    y1 = from.y + ny * t;
  } else if (isFromResource) {
    // Circle
    x1 = from.x + nx * RES_RADIUS;
    y1 = from.y + ny * RES_RADIUS;
  }

  // Entry point into destination node (with arrowhead offset)
  let x2 = to.x;
  let y2 = to.y;
  const ARROW_OFFSET = 8;
  if (isToTask) {
    // Square
    const tx = nx !== 0 ? TASK_HALF / Math.abs(nx) : Number.POSITIVE_INFINITY;
    const ty = ny !== 0 ? TASK_HALF / Math.abs(ny) : Number.POSITIVE_INFINITY;
    const t = Math.min(tx, ty);
    x2 = to.x - nx * (t + ARROW_OFFSET);
    y2 = to.y - ny * (t + ARROW_OFFSET);
  } else if (isToResource) {
    // Circle
    x2 = to.x - nx * (RES_RADIUS + ARROW_OFFSET);
    y2 = to.y - ny * (RES_RADIUS + ARROW_OFFSET);
  }

  return { x1, y1, x2, y2 };
}

function isEdgeInCycle(edge: Edge, cycles: string[][]): boolean {
  for (const cycle of cycles) {
    for (let i = 0; i < cycle.length; i++) {
      const a = cycle[i];
      const b = cycle[(i + 1) % cycle.length];
      if (
        (edge.from === a && edge.to === b) ||
        (edge.from === b && edge.to === a)
      ) {
        return true;
      }
    }
  }
  return false;
}

export default function GraphCanvas({
  state,
  cycles,
  onNodeDrag,
}: GraphCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState<{
    id: string;
    ox: number;
    oy: number;
  } | null>(null);
  const deadlockedNodes = getDeadlockedNodes(cycles);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.preventDefault();
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const ox = e.clientX - rect.left;
      const oy = e.clientY - rect.top;
      const center = getNodeCenter(id, state);
      if (!center) return;
      setDragging({ id, ox: ox - center.x, oy: oy - center.y });
    },
    [state],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!dragging) return;
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const x = e.clientX - rect.left - dragging.ox;
      const y = e.clientY - rect.top - dragging.oy;
      onNodeDrag(dragging.id, x, y);
    },
    [dragging, onNodeDrag],
  );

  const handleMouseUp = useCallback(() => {
    setDragging(null);
  }, []);

  const svgW = 900;
  const svgH = 620;

  return (
    <svg
      ref={svgRef}
      role="img"
      aria-label="Resource Allocation Graph"
      width="100%"
      viewBox={`0 0 ${svgW} ${svgH}`}
      style={{
        background: "#ffffff",
        minHeight: 600,
        cursor: dragging ? "grabbing" : "default",
      }}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <defs>
        {(["allocated", "waiting", "preempted"] as const).map((type) => (
          <marker
            key={type}
            id={`arrow-${type}`}
            markerWidth="10"
            markerHeight="7"
            refX="9"
            refY="3.5"
            orient="auto"
          >
            <polygon points="0 0, 10 3.5, 0 7" fill={EDGE_COLORS[type]} />
          </marker>
        ))}
        <marker
          id="arrow-deadlock"
          markerWidth="10"
          markerHeight="7"
          refX="9"
          refY="3.5"
          orient="auto"
        >
          <polygon points="0 0, 10 3.5, 0 7" fill={DEADLOCK_EDGE_COLOR} />
        </marker>
        <filter id="deadlock-glow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Edges */}
      {state.edges.map((edge) => {
        const pts = getEdgeEndpoints(edge, state);
        if (!pts) return null;
        const { x1, y1, x2, y2 } = pts;
        const inCycle = isEdgeInCycle(edge, cycles);
        const color = inCycle
          ? DEADLOCK_EDGE_COLOR
          : EDGE_COLORS[edge.type] || "#999";
        const dashArray =
          edge.type === "waiting"
            ? "6,3"
            : edge.type === "preempted"
              ? "4,4"
              : undefined;
        const strokeWidth =
          edge.type === "allocated" ? 2.5 : edge.type === "preempted" ? 2.5 : 2;
        const edgeKey = `${edge.from}-${edge.to}-${edge.type}`;

        return (
          <g key={edgeKey}>
            {inCycle && (
              <line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={DEADLOCK_EDGE_COLOR}
                strokeWidth={6}
                strokeOpacity={0.4}
                strokeDasharray={dashArray}
              />
            )}
            <line
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={color}
              strokeWidth={strokeWidth}
              strokeDasharray={dashArray}
              markerEnd={
                inCycle ? "url(#arrow-deadlock)" : `url(#arrow-${edge.type})`
              }
            />
          </g>
        );
      })}

      {/* Resource nodes — CIRCLES (light green fill, dark green outline) */}
      {state.resources.map((res) => {
        const isDeadlocked = deadlockedNodes.has(res.id);
        return (
          <g
            key={res.id}
            onMouseDown={(e) => handleMouseDown(e, res.id)}
            style={{ cursor: "grab" }}
          >
            {isDeadlocked && (
              <circle
                cx={res.x}
                cy={res.y}
                r={RES_RADIUS + 7}
                fill="none"
                stroke={DEADLOCK_EDGE_COLOR}
                strokeWidth={3}
                strokeOpacity={0.85}
                filter="url(#deadlock-glow)"
              />
            )}
            <circle
              cx={res.x}
              cy={res.y}
              r={RES_RADIUS}
              fill={RES_FILL}
              stroke={isDeadlocked ? DEADLOCK_EDGE_COLOR : RES_STROKE}
              strokeWidth={isDeadlocked ? 2.5 : 2}
            />
            <foreignObject
              x={res.x - RES_RADIUS + 8}
              y={res.y - RES_RADIUS + 8}
              width={(RES_RADIUS - 8) * 2}
              height={(RES_RADIUS - 8) * 2}
            >
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  textAlign: "center",
                  fontSize: "13px",
                  fontWeight: 600,
                  color: "#14532d",
                  wordBreak: "break-word",
                  lineHeight: 1.2,
                  fontFamily: "Satoshi, sans-serif",
                  userSelect: "none",
                }}
              >
                {res.name}
              </div>
            </foreignObject>
            <text
              x={res.x}
              y={res.y - RES_RADIUS - 10}
              textAnchor="middle"
              fontSize={11}
              fill="#6b7280"
              fontFamily="Satoshi, sans-serif"
              fontWeight={500}
            >
              {res.id}
            </text>
          </g>
        );
      })}

      {/* Task nodes — SQUARES (light blue fill, dark blue outline) */}
      {state.tasks.map((task) => {
        const isDeadlocked = deadlockedNodes.has(task.id);
        const x = task.x - TASK_HALF;
        const y = task.y - TASK_HALF;
        const size = TASK_HALF * 2;
        return (
          <g
            key={task.id}
            onMouseDown={(e) => handleMouseDown(e, task.id)}
            style={{ cursor: "grab" }}
          >
            {isDeadlocked && (
              <rect
                x={x - 6}
                y={y - 6}
                width={size + 12}
                height={size + 12}
                rx={4}
                fill="none"
                stroke={DEADLOCK_EDGE_COLOR}
                strokeWidth={3}
                strokeOpacity={0.85}
                filter="url(#deadlock-glow)"
              />
            )}
            <rect
              x={x}
              y={y}
              width={size}
              height={size}
              rx={4}
              fill={TASK_FILL}
              stroke={isDeadlocked ? DEADLOCK_EDGE_COLOR : TASK_STROKE}
              strokeWidth={isDeadlocked ? 2.5 : 2}
            />
            <foreignObject
              x={x + 8}
              y={y + 8}
              width={size - 16}
              height={size - 16}
            >
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  textAlign: "center",
                  fontSize: "13px",
                  fontWeight: 600,
                  color: "#1e3a8a",
                  wordBreak: "break-word",
                  lineHeight: 1.2,
                  fontFamily: "Satoshi, sans-serif",
                  userSelect: "none",
                }}
              >
                {task.name}
              </div>
            </foreignObject>
            <text
              x={task.x}
              y={y - 8}
              textAnchor="middle"
              fontSize={11}
              fill="#6b7280"
              fontFamily="Satoshi, sans-serif"
              fontWeight={500}
            >
              {task.id}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
