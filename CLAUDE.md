# Petri Net Modeler

Static web app for teaching plain Petri nets. `SPEC.md` is the contract: read it
before any change; if a request contradicts it, say so before coding.

## Structure
- `petri.js`: model, firing rule, JSON import/export. No DOM. Loaded as a classic
  script (global `Petri`) and by Node via `module.exports`, so `index.html` also works
  opened from disk.
- `ui.js`, `index.html`, `style.css`: rendering and interaction only. The UI never
  computes enabling, firing or validity itself: it calls `petri.js`.
- `tests/`: Node's built-in test runner.

## Rules
- No dependencies, no build step, no framework: open `index.html` and it works.
- Tests: `node --test`. They must pass before every commit.
- Never change a test to make it pass; if a test looks wrong, say so and stop.
- A logic bug gets a failing test first, then the fix.
- Tests check behaviour through the public API, never internals.
- UI changes are verified with a headless Chromium screenshot before reporting done.
- One slice per commit; the message says what it does ("Add arc creation").
- Do not add features outside `SPEC.md`; propose them instead.
- `main` is published by GitHub Pages: every push changes the live tool.
