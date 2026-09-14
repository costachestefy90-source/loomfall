# Loomfall design exploration

Before implementation, I compared five deliberately different directions for a cloth playground:

1. **GPU fabric renderer** — a WebGL height-field or compute-style solver would push a lot of nodes quickly and could look cinematic, but it would make direct node grabbing, cutting, and stable mobile fallback more fragile.
2. **Sewing-table editor** — users would stitch panels, cut seams, and assemble garments. This is a deeper creative tool, but it moves the center of gravity away from the instant joy of dropping objects on fabric.
3. **Physics arcade** — a sequence of challenge cards would ask players to bounce, catch, or catapult objects with cloth. It is immediately game-like, but it risks hiding the underlying experiment and reducing freeform play.
4. **Replayable lab instrument** — the core simulation would be paired with a timeline, rewindable snapshots, and parameter graphing. It would be excellent for investigation, but it adds a lot of state-management overhead before the first satisfying interaction.
5. **Constraint Lab** — a 2D mass-spring cloth with a small spatial hash, tactile tools, live telemetry, and scenario presets. Every interaction stays visible: the user can grab nodes, pin fabric, cut constraints, change the environment, and drop different collision shapes in one continuous workspace.

## Chosen direction

I chose **Constraint Lab**. It keeps the simulation small enough to be dependable in a static GitHub Pages build while still feeling technically expressive. The visual language treats the cloth as an instrument panel rather than a generic canvas: pins, springs, tear paths, contact rings, and telemetry make the mechanics legible. The initial build uses a reliable Verlet-style solver with iterative distance constraints; later improvements can add more presets, shape behaviors, and accessibility without rewriting the foundation.

## Guardrails

- The solver is bounded and capped so a slow tab cannot create an unstable time step.
- The draw loop is independent from React rendering; controls update a compact parameter object.
- Every feature is reachable from a button or keyboard shortcut, with visible status and a reset path.
- There is no backend, key, or runtime service dependency. The built output is a self-contained static site.
