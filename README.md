# deadlock-visualizer
Implementation Plan

Backend: store tasks, resources, allocations, requests as stable state

Frontend: graph state managed in React 

Use SVG for graph rendering 

DFS cycle detection on every state change

Priority modal shown when deadlock detected

Resolution engine: identify cycle participants, sort by priority, release lowest-priority task resources, re-run allocation queue, repeat

Control panel on left/right side, graph canvas takes center stage

