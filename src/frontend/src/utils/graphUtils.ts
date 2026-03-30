export type NodeId = string;

export interface TaskNode {
  id: string;
  name: string;
  x: number;
  y: number;
}

export interface ResourceNode {
  id: string;
  name: string;
  x: number;
  y: number;
}

export type EdgeType = "allocated" | "waiting" | "preempted";

export interface Edge {
  from: string;
  to: string;
  type: EdgeType;
  addedAt: number;
}

export interface GraphState {
  tasks: TaskNode[];
  resources: ResourceNode[];
  edges: Edge[];
  taskCounter: number;
  resourceCounter: number;
}

export function createEmptyState(): GraphState {
  return {
    tasks: [],
    resources: [],
    edges: [],
    taskCounter: 0,
    resourceCounter: 0,
  };
}

export function addTask(state: GraphState, name: string): GraphState {
  const newCounter = state.taskCounter + 1;
  const id = `T${newCounter}`;
  const angle = (state.tasks.length * 72 * Math.PI) / 180;
  const radius = 160 + state.tasks.length * 20;
  const newTask: TaskNode = {
    id,
    name,
    x: 420 + Math.cos(angle) * radius,
    y: 300 + Math.sin(angle) * radius,
  };
  return {
    ...state,
    tasks: [...state.tasks, newTask],
    taskCounter: newCounter,
  };
}

export function addResource(state: GraphState, name: string): GraphState {
  const newCounter = state.resourceCounter + 1;
  const id = `R${newCounter}`;
  const angle = (state.resources.length * 90 * Math.PI) / 180;
  const radius = 120 + state.resources.length * 15;
  const newResource: ResourceNode = {
    id,
    name,
    x: 420 + Math.cos(angle + Math.PI / 4) * radius,
    y: 300 + Math.sin(angle + Math.PI / 4) * radius,
  };
  return {
    ...state,
    resources: [...state.resources, newResource],
    resourceCounter: newCounter,
  };
}

/** Remove a task node and all its edges, then FIFO-reallocate freed resources. */
export function removeTask(state: GraphState, taskId: string): GraphState {
  // Resources allocated to this task become free
  const allocatedResources = state.edges
    .filter((e) => e.to === taskId && e.type === "allocated")
    .map((e) => e.from);

  // Drop all edges touching this task
  let newEdges = state.edges.filter(
    (e) => e.from !== taskId && e.to !== taskId,
  );

  // FIFO-reallocate freed resources
  for (const resourceId of allocatedResources) {
    const isStillAllocated = newEdges.some(
      (e) => e.from === resourceId && e.type === "allocated",
    );
    if (isStillAllocated) continue;
    // Check for preempted holder first
    const preemptedIdx = newEdges.findIndex(
      (e) => e.to === resourceId && e.type === "preempted",
    );
    if (preemptedIdx !== -1) {
      const pe = newEdges[preemptedIdx];
      newEdges.splice(preemptedIdx, 1);
      newEdges.push({
        from: resourceId,
        to: pe.from,
        type: "allocated",
        addedAt: Date.now(),
      });
    } else {
      const waiters = newEdges
        .filter((e) => e.to === resourceId && e.type === "waiting")
        .sort((a, b) => a.addedAt - b.addedAt);
      if (waiters.length > 0) {
        const earliest = waiters[0];
        newEdges = newEdges.filter((e) => e !== earliest);
        newEdges.push({
          from: resourceId,
          to: earliest.from,
          type: "allocated",
          addedAt: Date.now(),
        });
      }
    }
  }

  return {
    ...state,
    tasks: state.tasks.filter((t) => t.id !== taskId),
    edges: newEdges,
  };
}

/** Remove a resource node and all its edges. */
export function removeResource(
  state: GraphState,
  resourceId: string,
): GraphState {
  const newEdges = state.edges.filter(
    (e) => e.from !== resourceId && e.to !== resourceId,
  );
  return {
    ...state,
    resources: state.resources.filter((r) => r.id !== resourceId),
    edges: newEdges,
  };
}

export function connectEdge(
  state: GraphState,
  taskId: string,
  resourceId: string,
): GraphState {
  const isAllocated = state.edges.some(
    (e) => e.from === resourceId && e.type === "allocated",
  );
  const waitingExists = state.edges.some(
    (e) => e.from === taskId && e.to === resourceId && e.type === "waiting",
  );
  const alreadyAllocatedToTask = state.edges.some(
    (e) => e.from === resourceId && e.to === taskId && e.type === "allocated",
  );
  if (alreadyAllocatedToTask || waitingExists) return state;
  const newEdge: Edge = !isAllocated
    ? { from: resourceId, to: taskId, type: "allocated", addedAt: Date.now() }
    : { from: taskId, to: resourceId, type: "waiting", addedAt: Date.now() };
  return { ...state, edges: [...state.edges, newEdge] };
}

/**
 * Remove a single task-resource relation and trigger FIFO reallocation for the freed resource.
 */
export function removeRelation(
  state: GraphState,
  taskId: string,
  resourceId: string,
): GraphState {
  let newEdges = [...state.edges];
  // Match any edge between this task and resource regardless of direction
  const edgeIdx = newEdges.findIndex(
    (e) =>
      (e.from === resourceId && e.to === taskId) ||
      (e.from === taskId && e.to === resourceId),
  );
  if (edgeIdx === -1) return state;
  const edge = newEdges[edgeIdx];
  newEdges.splice(edgeIdx, 1);

  if (edge.type === "allocated") {
    // Check for a preempted holder (originalTask → resourceId) to restore first
    const preemptedIdx = newEdges.findIndex(
      (e) => e.to === resourceId && e.type === "preempted",
    );
    if (preemptedIdx !== -1) {
      const pe = newEdges[preemptedIdx];
      newEdges.splice(preemptedIdx, 1);
      newEdges.push({
        from: resourceId,
        to: pe.from,
        type: "allocated",
        addedAt: Date.now(),
      });
    } else {
      const waiters = newEdges
        .filter((e) => e.to === resourceId && e.type === "waiting")
        .sort((a, b) => a.addedAt - b.addedAt);
      if (waiters.length > 0) {
        const earliest = waiters[0];
        newEdges = newEdges.filter((e) => e !== earliest);
        newEdges.push({
          from: resourceId,
          to: earliest.from,
          type: "allocated",
          addedAt: Date.now(),
        });
      }
    }
  }
  return { ...state, edges: newEdges };
}

/**
 * Resolve deadlock by giving priority task its requested resources.
 * The preempted lower-priority task gets a REVERSED edge: lowerTask → Resource (yellow, preempted).
 * This arrow points TOWARDS the resource, indicating it is waiting to reclaim it.
 */
export function resolveWithPriority(
  state: GraphState,
  priorityTaskId: string,
): GraphState {
  const waitingEdges = state.edges.filter(
    (e) => e.from === priorityTaskId && e.type === "waiting",
  );
  let newEdges = [...state.edges];
  for (const waitingEdge of waitingEdges) {
    const resourceId = waitingEdge.to;
    // Find who currently holds this resource (Resource → lowerTask, allocated)
    const allocatedEdgeIdx = newEdges.findIndex(
      (e) => e.from === resourceId && e.type === "allocated",
    );
    if (allocatedEdgeIdx !== -1) {
      const lowerTaskId = newEdges[allocatedEdgeIdx].to;
      // Remove the old allocated edge (Resource → lowerTask)
      newEdges.splice(allocatedEdgeIdx, 1);
      // Add preempted edge REVERSED: lowerTask → Resource (arrow points to resource)
      newEdges.push({
        from: lowerTaskId,
        to: resourceId,
        type: "preempted",
        addedAt: Date.now(),
      });
    }
    // Give resource to priority task
    newEdges.push({
      from: resourceId,
      to: priorityTaskId,
      type: "allocated",
      addedAt: Date.now(),
    });
    // Remove the waiting edge for priority task
    newEdges = newEdges.filter((e) => e !== waitingEdge);
  }
  return { ...state, edges: newEdges };
}

/**
 * Restore all preempted edges back to allocated.
 * Preempted edges are lowerTask → Resource; reverse them to Resource → lowerTask (allocated, green).
 */
export function restorePreempted(state: GraphState): GraphState {
  const newEdges = state.edges.map((e) => {
    if (e.type === "preempted") {
      // Reverse: lowerTask → Resource  →  Resource → lowerTask (allocated)
      return {
        from: e.to, // Resource
        to: e.from, // lowerTask
        type: "allocated" as EdgeType,
        addedAt: Date.now(),
      };
    }
    return e;
  });
  return { ...state, edges: newEdges };
}

export function completeTask(state: GraphState, taskId: string): GraphState {
  let newEdges = [...state.edges];

  // Find resources allocated to this task
  const allocatedToTask = newEdges.filter(
    (e) => e.to === taskId && e.type === "allocated",
  );

  for (const allocEdge of allocatedToTask) {
    const resourceId = allocEdge.from;
    // Remove the allocation
    newEdges = newEdges.filter((e) => e !== allocEdge);

    // Check if there's a preempted holder (lowerTask → resourceId) to restore
    const preemptedIdx = newEdges.findIndex(
      (e) => e.to === resourceId && e.type === "preempted",
    );
    if (preemptedIdx !== -1) {
      // Restore: reverse preempted (lowerTask → Resource) to allocated (Resource → lowerTask)
      const pe = newEdges[preemptedIdx];
      newEdges.splice(preemptedIdx, 1);
      newEdges.push({
        from: resourceId,
        to: pe.from,
        type: "allocated",
        addedAt: Date.now(),
      });
    } else {
      // FIFO: give to earliest waiter
      const waiters = newEdges
        .filter((e) => e.to === resourceId && e.type === "waiting")
        .sort((a, b) => a.addedAt - b.addedAt);
      if (waiters.length > 0) {
        const earliest = waiters[0];
        newEdges = newEdges.filter((e) => e !== earliest);
        newEdges.push({
          from: resourceId,
          to: earliest.from,
          type: "allocated",
          addedAt: Date.now(),
        });
      }
    }
  }

  // Remove waiting edges FROM this task
  newEdges = newEdges.filter(
    (e) => !(e.from === taskId && e.type === "waiting"),
  );

  return { ...state, edges: newEdges };
}

export function detectCycle(state: GraphState): string[][] {
  const adj: Map<string, string[]> = new Map();
  const allNodes = [
    ...state.tasks.map((t) => t.id),
    ...state.resources.map((r) => r.id),
  ];
  for (const node of allNodes) adj.set(node, []);
  for (const edge of state.edges) {
    const neighbors = adj.get(edge.from) || [];
    neighbors.push(edge.to);
    adj.set(edge.from, neighbors);
  }
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const stackPath: string[] = [];
  function dfs(node: string): void {
    visited.add(node);
    inStack.add(node);
    stackPath.push(node);
    for (const neighbor of adj.get(node) || []) {
      if (!visited.has(neighbor)) {
        dfs(neighbor);
      } else if (inStack.has(neighbor)) {
        const cycleStart = stackPath.indexOf(neighbor);
        if (cycleStart !== -1) {
          const cycle = stackPath.slice(cycleStart);
          const cycleKey = [...cycle].sort().join(",");
          if (!cycles.some((c) => [...c].sort().join(",") === cycleKey))
            cycles.push([...cycle]);
        }
      }
    }
    stackPath.pop();
    inStack.delete(node);
  }
  for (const node of allNodes) {
    if (!visited.has(node)) dfs(node);
  }
  return cycles;
}

export function getDeadlockedNodes(cycles: string[][]): Set<string> {
  const result = new Set<string>();
  for (const cycle of cycles) for (const node of cycle) result.add(node);
  return result;
}
