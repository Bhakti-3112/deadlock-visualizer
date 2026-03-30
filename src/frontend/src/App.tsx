import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useCallback, useMemo, useState } from "react";
import GraphCanvas from "./components/GraphCanvas";
import {
  addResource,
  addTask,
  completeTask,
  connectEdge,
  createEmptyState,
  detectCycle,
  getDeadlockedNodes,
  removeRelation,
  removeResource,
  removeTask,
  resolveWithPriority,
  restorePreempted,
} from "./utils/graphUtils";
import type { GraphState } from "./utils/graphUtils";

type ResolutionStep =
  | { phase: "pick"; deadlockedTaskIds: string[] }
  | { phase: "preempt"; selectedTaskId: string }
  | { phase: "complete"; selectedTaskId: string }
  | { phase: "done" };

export default function App() {
  const [graphState, setGraphState] = useState<GraphState>(createEmptyState);
  const [taskInput, setTaskInput] = useState("");
  const [resourceInput, setResourceInput] = useState("");
  const [connectTask, setConnectTask] = useState<string>("");
  const [connectResource, setConnectResource] = useState<string>("");
  const [resolutionStep, setResolutionStep] = useState<ResolutionStep | null>(
    null,
  );
  const [stepCount, setStepCount] = useState(0);
  const [totalSteps, setTotalSteps] = useState(0);

  const cycles = useMemo(() => detectCycle(graphState), [graphState]);
  const deadlockedNodes = useMemo(() => getDeadlockedNodes(cycles), [cycles]);
  const hasDeadlock = cycles.length > 0;

  const deadlockedTaskIds = useMemo(
    () =>
      graphState.tasks
        .filter((t) => deadlockedNodes.has(t.id))
        .map((t) => t.id),
    [graphState.tasks, deadlockedNodes],
  );

  // Build deduplicated task-resource relation list
  const relations = useMemo(() => {
    const seen = new Set<string>();
    const result: {
      taskId: string;
      taskName: string;
      resourceId: string;
      resourceName: string;
    }[] = [];
    for (const edge of graphState.edges) {
      let taskId: string | null = null;
      let resourceId: string | null = null;
      if (edge.type === "allocated" || edge.type === "preempted") {
        // allocated: Resource → Task; preempted: LowerTask → Resource
        if (edge.type === "allocated") {
          taskId = edge.to;
          resourceId = edge.from;
        } else {
          // preempted arrow: LowerTask → Resource
          taskId = edge.from;
          resourceId = edge.to;
        }
      } else if (edge.type === "waiting") {
        taskId = edge.from;
        resourceId = edge.to;
      }
      if (!taskId || !resourceId) continue;
      const key = `${taskId}:${resourceId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const task = graphState.tasks.find((t) => t.id === taskId);
      const resource = graphState.resources.find((r) => r.id === resourceId);
      if (!task || !resource) continue;
      result.push({
        taskId,
        taskName: task.name,
        resourceId,
        resourceName: resource.name,
      });
    }
    return result;
  }, [graphState]);

  const handleAddTask = () => {
    const name = taskInput.trim();
    if (!name) return;
    setGraphState((prev) => addTask(prev, name));
    setTaskInput("");
  };

  const handleAddResource = () => {
    const name = resourceInput.trim();
    if (!name) return;
    setGraphState((prev) => addResource(prev, name));
    setResourceInput("");
  };

  const handleConnect = () => {
    if (!connectTask || !connectResource) return;
    setGraphState((prev) => connectEdge(prev, connectTask, connectResource));
  };

  const handleRemoveRelation = (taskId: string, resourceId: string) => {
    setGraphState((prev) => removeRelation(prev, taskId, resourceId));
  };

  const handleRemoveTask = (taskId: string) => {
    setGraphState((prev) => removeTask(prev, taskId));
    if (connectTask === taskId) setConnectTask("");
    if (
      resolutionStep &&
      resolutionStep.phase !== "done" &&
      "selectedTaskId" in resolutionStep &&
      resolutionStep.selectedTaskId === taskId
    ) {
      setResolutionStep(null);
    }
  };

  const handleRemoveResource = (resourceId: string) => {
    setGraphState((prev) => removeResource(prev, resourceId));
    if (connectResource === resourceId) setConnectResource("");
  };

  const handleNodeDrag = useCallback((id: string, x: number, y: number) => {
    setGraphState((prev) => ({
      ...prev,
      tasks: prev.tasks.map((t) => (t.id === id ? { ...t, x, y } : t)),
      resources: prev.resources.map((r) => (r.id === id ? { ...r, x, y } : r)),
    }));
  }, []);

  const handleStartResolution = () => {
    setResolutionStep({ phase: "pick", deadlockedTaskIds });
    setStepCount(1);
    setTotalSteps(deadlockedTaskIds.length);
  };

  const handlePickTask = (taskId: string) => {
    setResolutionStep({ phase: "preempt", selectedTaskId: taskId });
  };

  const handlePreempt = () => {
    if (!resolutionStep || resolutionStep.phase !== "preempt") return;
    // Preempt resources for the priority task — lower-priority tasks get
    // yellow preempted edges (LowerTask → Resource, pointing toward the resource).
    // NEVER restore immediately — the priority task still holds the resource.
    // restorePreempted happens inside completeTask when the priority task finishes.
    const newState = resolveWithPriority(
      graphState,
      resolutionStep.selectedTaskId,
    );
    setGraphState(newState);
    // Always advance to complete phase regardless of whether the cycle is resolved.
    // The resource is now held by the priority task; it must be released first.
    setResolutionStep({
      phase: "complete",
      selectedTaskId: resolutionStep.selectedTaskId,
    });
  };

  const handleCompleteTask = () => {
    if (!resolutionStep || resolutionStep.phase !== "complete") return;
    const taskId = resolutionStep.selectedTaskId;
    // Release all resources held by priority task; restore any preempted edges
    // back to allocated (Resource → LowerTask, green) and FIFO-assign freed resources.
    let newState = completeTask(graphState, taskId);
    // Clean up any remaining preempted edges that completeTask didn't handle
    newState = restorePreempted(newState);
    const newCycles = detectCycle(newState);
    if (newCycles.length === 0) {
      setGraphState(newState);
      setResolutionStep({ phase: "done" });
    } else {
      setGraphState(newState);
      const newDeadlockedNodes = getDeadlockedNodes(newCycles);
      const remaining = newState.tasks
        .filter((t) => newDeadlockedNodes.has(t.id) && t.id !== taskId)
        .map((t) => t.id);
      if (remaining.length === 0) {
        setResolutionStep({ phase: "done" });
      } else {
        setStepCount((s) => s + 1);
        setResolutionStep({ phase: "pick", deadlockedTaskIds: remaining });
      }
    }
  };

  const getTaskName = (id: string) =>
    graphState.tasks.find((t) => t.id === id)?.name || id;

  return (
    <div
      className="flex h-screen bg-background font-body"
      style={{ overflow: "hidden" }}
    >
      {/* Sidebar */}
      <aside
        className="w-80 flex-shrink-0 border-r border-border flex flex-col"
        style={{ background: "#f8f9fa", overflowY: "auto" }}
        data-ocid="sidebar.panel"
      >
        <div className="px-4 py-4 border-b border-border">
          <h1 className="font-brand text-lg font-bold text-foreground leading-tight">
            Deadlock Visualizer
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Resource Allocation Graph
          </p>
        </div>

        <div className="px-4 py-4 flex flex-col gap-5 flex-1">
          {/* Add Task */}
          <section data-ocid="add_task.section">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Add Task (Process)
            </p>
            <div className="flex gap-2">
              <Input
                placeholder="e.g. Browser"
                value={taskInput}
                onChange={(e) => setTaskInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddTask()}
                className="flex-1 h-8 text-sm bg-white"
                data-ocid="task.input"
              />
              <Button
                size="sm"
                onClick={handleAddTask}
                disabled={!taskInput.trim()}
                className="h-8 px-3"
                data-ocid="task.primary_button"
              >
                Add
              </Button>
            </div>
            {graphState.tasks.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {graphState.tasks.map((t) => (
                  <span
                    key={t.id}
                    className="inline-flex items-center gap-1 rounded-full border border-transparent bg-secondary text-secondary-foreground px-2.5 py-0.5 text-xs font-semibold"
                  >
                    {t.name}
                    <span className="text-muted-foreground">({t.id})</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveTask(t.id)}
                      className="ml-0.5 text-muted-foreground hover:text-red-500 transition-colors leading-none"
                      title={`Remove task ${t.name}`}
                      aria-label={`Remove task ${t.name}`}
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}
          </section>

          <Separator />

          {/* Add Resource */}
          <section data-ocid="add_resource.section">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Add Resource
            </p>
            <div className="flex gap-2">
              <Input
                placeholder="e.g. Printer"
                value={resourceInput}
                onChange={(e) => setResourceInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddResource()}
                className="flex-1 h-8 text-sm bg-white"
                data-ocid="resource.input"
              />
              <Button
                size="sm"
                onClick={handleAddResource}
                disabled={!resourceInput.trim()}
                className="h-8 px-3"
                data-ocid="resource.primary_button"
              >
                Add
              </Button>
            </div>
            {graphState.resources.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {graphState.resources.map((r) => (
                  <span
                    key={r.id}
                    className="inline-flex items-center gap-1 rounded-full border border-border bg-background text-foreground px-2.5 py-0.5 text-xs font-semibold"
                  >
                    {r.name}
                    <span className="text-muted-foreground">({r.id})</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveResource(r.id)}
                      className="ml-0.5 text-muted-foreground hover:text-red-500 transition-colors leading-none"
                      title={`Remove resource ${r.name}`}
                      aria-label={`Remove resource ${r.name}`}
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}
          </section>

          <Separator />

          {/* Connect */}
          <section data-ocid="connect.section">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Connect Task ↔ Resource
            </p>
            <div className="flex flex-col gap-2">
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">
                  Task
                </Label>
                <Select value={connectTask} onValueChange={setConnectTask}>
                  <SelectTrigger
                    className="h-8 text-sm bg-white"
                    data-ocid="connect.task.select"
                  >
                    <SelectValue placeholder="Select task" />
                  </SelectTrigger>
                  <SelectContent>
                    {graphState.tasks.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name} — {t.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">
                  Resource
                </Label>
                <Select
                  value={connectResource}
                  onValueChange={setConnectResource}
                >
                  <SelectTrigger
                    className="h-8 text-sm bg-white"
                    data-ocid="connect.resource.select"
                  >
                    <SelectValue placeholder="Select resource" />
                  </SelectTrigger>
                  <SelectContent>
                    {graphState.resources.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.name} — {r.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                size="sm"
                onClick={handleConnect}
                disabled={!connectTask || !connectResource}
                className="h-8"
                data-ocid="connect.primary_button"
              >
                Connect
              </Button>
            </div>
          </section>

          <Separator />

          {/* Active Relations */}
          {relations.length > 0 && (
            <>
              <section data-ocid="relations.section">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  Active Relations
                </p>
                <div className="flex flex-col gap-1.5">
                  {relations.map(
                    ({ taskId, taskName, resourceId, resourceName }) => (
                      <div
                        key={`${taskId}:${resourceId}`}
                        className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md border border-border bg-white text-xs"
                      >
                        <span className="font-medium truncate">
                          <span className="text-blue-700">{taskName}</span>
                          <span className="text-muted-foreground mx-1">→</span>
                          <span className="text-green-700">{resourceName}</span>
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            handleRemoveRelation(taskId, resourceId)
                          }
                          className="flex-shrink-0 text-muted-foreground hover:text-red-500 transition-colors leading-none px-1"
                          title="Remove relation"
                          aria-label={`Remove relation ${taskName} to ${resourceName}`}
                        >
                          ✕
                        </button>
                      </div>
                    ),
                  )}
                </div>
              </section>
              <Separator />
            </>
          )}

          {/* Legend */}
          <section>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Legend
            </p>
            <div className="flex flex-col gap-2.5">
              {/* Node shape legend */}
              <ShapeLegendRow
                shape="square"
                color="#bfdbfe"
                stroke="#1d4ed8"
                label="Task (square)"
                desc="Process requesting or holding resources"
              />
              <ShapeLegendRow
                shape="circle"
                color="#bbf7d0"
                stroke="#15803d"
                label="Resource (circle)"
                desc="Resource that can be allocated to a task"
              />
              {/* Edge color legend */}
              <LegendRow
                color="#22c55e"
                dash={false}
                label="Allocated"
                desc="Resource assigned to exactly one task (Resource → Task)"
              />
              <LegendRow
                color="#ef4444"
                dash={true}
                dashArray="6,3"
                label="Waiting"
                desc="Task queued for a busy resource — not in deadlock; turns green via FIFO when freed"
              />
              <LegendRow
                color="#eab308"
                dash={true}
                dashArray="4,4"
                label="Preempted"
                desc="Resource taken by higher-priority task (LowerTask → Resource); returns green (allocated) when priority task completes"
              />
              <LegendRow
                color="#f97316"
                dash={true}
                dashArray="8,3"
                strokeWidth={3}
                label="Deadlock cycle"
                desc="Circular wait detected — edges forming the cycle"
              />
            </div>
          </section>
        </div>
      </aside>

      {/* Main area */}
      <main
        className="flex-1 flex flex-col overflow-hidden"
        data-ocid="main.panel"
      >
        {/* Top bar */}
        <div
          className="flex items-center justify-between px-5 py-3 border-b border-border bg-background"
          data-ocid="status.panel"
        >
          <div className="flex items-center gap-3">
            {hasDeadlock ? (
              <span
                className="flex items-center gap-2 text-sm font-semibold"
                style={{ color: "#dc2626" }}
                data-ocid="status.error_state"
              >
                <span className="text-base">⚠️</span> Deadlock Detected
                <Badge variant="destructive" className="text-xs">
                  {cycles.length} cycle{cycles.length > 1 ? "s" : ""}
                </Badge>
              </span>
            ) : (
              <span
                className="flex items-center gap-2 text-sm font-semibold"
                style={{ color: "#16a34a" }}
                data-ocid="status.success_state"
              >
                <span className="text-base">✅</span> No Deadlock
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{graphState.tasks.length} tasks</span>
            <span>·</span>
            <span>{graphState.resources.length} resources</span>
            <span>·</span>
            <span>{graphState.edges.length} edges</span>
          </div>
        </div>

        {/* Canvas */}
        <div className="flex-1 relative overflow-hidden">
          {graphState.tasks.length === 0 &&
          graphState.resources.length === 0 ? (
            <div
              className="absolute inset-0 flex flex-col items-center justify-center text-center"
              style={{ background: "#fff" }}
              data-ocid="canvas.empty_state"
            >
              <div className="text-5xl mb-4">🔄</div>
              <p className="text-lg font-semibold text-foreground mb-1">
                Start building your graph
              </p>
              <p className="text-sm text-muted-foreground max-w-xs">
                Add tasks and resources in the sidebar, then connect them to see
                the Resource Allocation Graph.
              </p>
            </div>
          ) : (
            <GraphCanvas
              state={graphState}
              cycles={cycles}
              onNodeDrag={handleNodeDrag}
            />
          )}
        </div>

        {/* Resolution Panel */}
        {(hasDeadlock || resolutionStep?.phase === "done") && (
          <div
            className="border-t border-border bg-background"
            style={{ maxHeight: 220, overflowY: "auto" }}
            data-ocid="resolution.panel"
          >
            <div className="px-5 py-3">
              {!resolutionStep ? (
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-sm text-foreground">
                      🛠 Interactive Resolution
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Select a high-priority task to start resolving the
                      deadlock step by step.
                    </p>
                  </div>
                  <Button
                    size="sm"
                    onClick={handleStartResolution}
                    data-ocid="resolution.primary_button"
                  >
                    Start Interactive Resolution
                  </Button>
                </div>
              ) : resolutionStep.phase === "done" ? (
                <div
                  className="flex items-center gap-3"
                  data-ocid="resolution.success_state"
                >
                  <span className="text-xl">🎉</span>
                  <div>
                    <p
                      className="font-semibold text-sm"
                      style={{ color: "#16a34a" }}
                    >
                      All deadlocks resolved!
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Resources have been returned to their original holders.
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="ml-auto"
                    onClick={() => setResolutionStep(null)}
                    data-ocid="resolution.close_button"
                  >
                    Dismiss
                  </Button>
                </div>
              ) : resolutionStep.phase === "pick" ? (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="font-semibold text-sm text-foreground">
                      🛠 Step {stepCount} of ~{totalSteps} — Pick
                      highest-priority task
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {resolutionStep.deadlockedTaskIds.map((tid) => (
                      <button
                        type="button"
                        key={tid}
                        onClick={() => handlePickTask(tid)}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-border bg-background hover:border-primary hover:bg-accent transition-colors text-sm font-medium"
                        data-ocid="resolution.task.button"
                      >
                        <span>{getTaskName(tid)}</span>
                        <span className="text-xs text-muted-foreground font-mono">
                          ({tid})
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : resolutionStep.phase === "preempt" ? (
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-sm text-foreground">
                      🛠 Step {stepCount}: Preempt resources for{" "}
                      <span className="text-primary">
                        {getTaskName(resolutionStep.selectedTaskId)} (
                        {resolutionStep.selectedTaskId})
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Lower-priority holders will be preempted — their edges
                      turn yellow (LowerTask → Resource). Resource is reassigned
                      to the selected task (green).
                    </p>
                  </div>
                  <Button
                    size="sm"
                    onClick={handlePreempt}
                    data-ocid="resolution.preempt.primary_button"
                  >
                    Preempt Resources
                  </Button>
                </div>
              ) : resolutionStep.phase === "complete" ? (
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-sm text-foreground">
                      ✅ Complete task:{" "}
                      <span className="text-primary">
                        {getTaskName(resolutionStep.selectedTaskId)} (
                        {resolutionStep.selectedTaskId})
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Task finishes and releases resources. Yellow preempted
                      edges flip back to green (Resource → LowerTask,
                      allocated). Next waiter gets resource via FIFO (red →
                      green).
                    </p>
                  </div>
                  <Button
                    size="sm"
                    onClick={handleCompleteTask}
                    data-ocid="resolution.complete.primary_button"
                  >
                    Complete Task
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function LegendRow({
  color,
  dash,
  dashArray,
  strokeWidth = 2,
  label,
  desc,
}: {
  color: string;
  dash: boolean;
  dashArray?: string;
  strokeWidth?: number;
  label: string;
  desc: string;
}) {
  const markerId = `leg-${color.replace("#", "")}-${strokeWidth}`;
  return (
    <div className="flex items-start gap-2">
      <svg
        role="img"
        aria-label={label}
        width="36"
        height="12"
        className="flex-shrink-0 mt-0.5"
      >
        <defs>
          <marker
            id={markerId}
            markerWidth="6"
            markerHeight="5"
            refX="5"
            refY="2.5"
            orient="auto"
          >
            <polygon points="0 0, 6 2.5, 0 5" fill={color} />
          </marker>
        </defs>
        <line
          x1="2"
          y1="6"
          x2="28"
          y2="6"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={dash ? dashArray : undefined}
          markerEnd={`url(#${markerId})`}
        />
      </svg>
      <div className="flex flex-col">
        <span className="text-xs font-semibold text-foreground leading-tight">
          {label}
        </span>
        <span className="text-[10px] text-muted-foreground leading-snug mt-0.5">
          {desc}
        </span>
      </div>
    </div>
  );
}

function ShapeLegendRow({
  shape,
  color,
  stroke,
  label,
  desc,
}: {
  shape: "square" | "circle";
  color: string;
  stroke: string;
  label: string;
  desc: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <svg
        role="img"
        aria-label={label}
        width="20"
        height="20"
        className="flex-shrink-0"
        viewBox="0 0 20 20"
      >
        {shape === "square" ? (
          <rect
            x="2"
            y="2"
            width="16"
            height="16"
            fill={color}
            stroke={stroke}
            strokeWidth="2"
          />
        ) : (
          <circle
            cx="10"
            cy="10"
            r="8"
            fill={color}
            stroke={stroke}
            strokeWidth="2"
          />
        )}
      </svg>
      <div className="flex flex-col">
        <span className="text-xs font-semibold text-foreground leading-tight">
          {label}
        </span>
        <span className="text-[10px] text-muted-foreground leading-snug mt-0.5">
          {desc}
        </span>
      </div>
    </div>
  );
}
