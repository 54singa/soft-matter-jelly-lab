# Soft Matter.

A runnable Three.js jelly playground based on the supplied recording, with a round pudding silhouette: a smaller flat top, gently fluted tapered sides, and a broad rounded base. The page contains only the material experiment, with no surrounding video or social UI.

## Live demo

**[Open the interactive jelly playground](https://54singa.github.io/soft-matter-jelly-lab/)**

[![Soft Matter interactive jelly playground](docs/soft-matter-jelly-lab.png)](https://54singa.github.io/soft-matter-jelly-lab/)

## Run locally

Requires Node.js 22.13 or newer.

```sh
npm install
npm run dev -- --port 4399
```

Open the address printed by the server. For a static production build:

```sh
npm run build
```

The generated site is in `dist/client/` and can be served by any static HTTP server. Use localhost or HTTPS for WebGPU. The renderer automatically falls back to WebGL2 when needed.

## Interaction

- Drag any visible point on the jelly with the mouse or a finger.
- Release to let stored elastic energy and inertia move the body.
- Choose Berry, Mint, or Honey.
- Change Firmness and Internal damping independently.
- Reset specimen restores the body; the R key does the same. Current material settings are retained.
- Sliders support arrow keys, Home, and End.

## Implementation

`lib/soft-body.ts` contains a CPU XPBD soft-body solver: 343 particles, 1,296 tetrahedral volume constraints, elastic edge constraints, gravity, floor friction, and velocity damping. A fixed 120 Hz solver drives a finer smooth surface through interpolation. Raycast barycentric coordinates map the precise grab point to the simulation particles; this creates local stretch rather than a whole-object scale animation. Pointer capture handles releases outside the original hit region.

`lib/jelly.ts` contains the Three.js WebGPURenderer scene. Transmissive physical node materials, both surface sides, clearcoat, absorption, an approximate thickness field, refracted studio lighting, updated normals, and a dynamic soft contact shadow create the wet optical appearance. Optics and material stiffness are tuned artistically rather than calibrated laboratory measurements. The scene prefers WebGPU and has a WebGL2 fallback.

`app/page.tsx` contains the controls and an optional feature-detected WebMCP `configure_jelly` tool. There is no server data storage or external runtime asset dependency.

## Validation

Actual browser pointer drags were performed on the upper/front and left portions of the surface, and both WebGPU and WebGL2 rendering were observed. Local strain increased during grabs; motion persisted after release and decayed. Color controls, slider keyboard endpoints, reset, and valid/invalid WebMCP settings were also checked. Independent solver stress runs covered softness and damping endpoints, volume preservation, and long settling.
