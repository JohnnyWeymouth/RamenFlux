# RamenFlux

A narrative storyboard tool for tracking characters across plot beats.

## Why you were getting CORS errors

Browsers block ES module scripts loaded from `file://` URLs. Any project using
`<script type="module">` or Web Workers **must** be served over HTTP, even
locally. A dev server fixes this in one command.

## Setup

You need [Node.js](https://nodejs.org) (v18 or newer).

```bash
# 1. Install dependencies (only needed once)
npm install

# 2. Start the dev server
npm run dev
```

Then open the URL it prints (usually http://localhost:5173). Hot-reload is
included — changes to any file update the browser instantly.

```bash
# Build a production bundle (output goes to dist/)
npm run build

# Preview the production build locally
npm run preview
```

## Project structure

```
RamenFlux/
├── index.html                 # Entry HTML (Vite uses this as root)
├── vite.config.ts             # Vite config (Vue plugin)
├── tsconfig.json
├── package.json
└── src/
    ├── main.ts                # Mounts the Vue app
    ├── App.vue                # Main component (board + panel)
    ├── style.css              # All styles
    ├── types.ts               # Shared TypeScript interfaces
    ├── crossing_minimizer.ts  # Layout algorithm (greedy → local search → B&B)
    ├── layout.worker.ts       # Web Worker: runs the minimizer off-thread
    └── useLayoutWorker.ts     # Vue composable: worker lifecycle + scheduling
```

## How the worker is loaded

Vite handles Web Workers natively. The `?worker` suffix in the import:

```ts
import LayoutWorker from './layout.worker.ts?worker'
```

tells Vite to bundle `layout.worker.ts` separately and give you a constructor
for it. No manual compilation or separate `minimizer.worker.js` file needed.
