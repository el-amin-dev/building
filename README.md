# floor

> An interactive 3D building you explore in the browser, from the outside in: floors, rooms, and the kitchen.

## Status

- created: 2026-09-11

## Stack

- Frontend only (no backend, no database)
- Vite 8, React 19.2, TypeScript 6.0
- 3D: three.js through `@react-three/fiber` and `@react-three/drei`
- State: Zustand. Styling: Tailwind CSS 4. Dev tweak panel: Leva
- Tests: Vitest + Testing Library (unit), Playwright on Chromium (end-to-end)
- Quality: ESLint, Prettier
- Tooling: Node 22, pnpm 11

## Getting started

See [`docs/RUNBOOK.md`](docs/RUNBOOK.md) for setup, run, and test commands.

## Documentation

- [`docs/RUNBOOK.md`](docs/RUNBOOK.md) — how to run, test, and debug the project
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — architecture decision records
