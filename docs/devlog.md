# Loomfall devlog

Short field notes from the making of Loomfall — Constraint Lab. Each entry describes a shipped, testable change in the project.

## 2026-09-13 — The lab remembers

The second polish pass turned the simulation from a one-shot toy into a small experiment workflow.

- Added a **run archive** that captures the current preset, energy, tears, contacts, object count, and a plain-language observation.
- Added **JSON export** so a curious player can take a run outside the browser without a backend or account, plus local persistence and an explicit clear action.
- Added a three-body **impact volley** with distinct lateral velocity and spin for a fast collision study.
- Added **focus mode** (`F`) for a larger field. Responsive canvas rebuilds now preserve the active bodies and elapsed time instead of silently returning to the preset setup.
- Added a live **3D depth projection** (`D`) that derives relief from cloth deformation and perspective, then projects objects and contact rings into the same camera view. The physics remains intentionally 2D and stable; the 3D layer is a visual instrument for reading folds.
- Replaced the decorative telemetry bars with a live energy history and fixed the object list so drops and removals appear immediately.
- Added auto-pause on hidden tabs as a small battery and performance courtesy.

Verification for this pass: `npm run lint`, `npm run build`, and a local-browser interaction check covering volley, focus mode, object persistence, and snapshot capture.

The current visual reference is [`public/loomfall-banner.png`](../public/loomfall-banner.png), a real screenshot of the running laboratory.

## 2026-09-12 — Make the mechanics legible

The first refinement pass tightened the control language, added the live stress view, stabilized contact behavior, and gave the canvas a clearer instrument-panel frame. The goal was to make every interaction answer a physical question: what bends, what collides, and what gives way?

## 2026-09-11 — Five starting conditions

Loomfall began as a dependable 2D constraint lab: a rectangular mass-spring cloth, four throwable object shapes, direct manipulation tools, and five scenarios designed to make different parts of the solver visible. The static-first approach keeps the project easy to run locally and easy to host on GitHub Pages.
