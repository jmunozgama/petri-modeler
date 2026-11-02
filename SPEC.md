# Petri Net Modeler: specification

The contract: tests, plans and reviews are measured against this file. Each sentence
is either a test or something checked by looking at the page.

## Model

- A net has **places**, **transitions** and **arcs**. Plain Petri nets: no arc
  weights, no capacities, no inhibitor arcs.
- Each node has an `id`, a `label` and a position (`x`, `y`).
  - Ids: `p1, p2, ...` for places, `t1, t2, ...` for transitions; assigned by the
    tool, never edited, never reused within a session; after an import, numbering
    continues above the highest imported id.
  - Label: free text, may be empty or repeated; default label = id.
- An **arc** goes from a place to a transition or from a transition to a place.
  - Place→place or transition→transition: rejected, net unchanged, a message is shown.
  - At most one arc per ordered pair (no weights): a second p1→t1 is rejected, net
    unchanged, a message is shown. p1→t1 and t1→p1 may both exist.
- **Initial marking**: each place holds an integer number of tokens ≥ 0, default 0,
  on any place. Set in Edit mode only.
- •t = input places of t (arcs p→t); t• = output places (arcs t→p).

## Firing rule

- t is **enabled** in marking M iff every place in •t has at least 1 token in M.
- A transition with no input places is always enabled.
- Firing an enabled t: remove 1 token from each place in •t, then add 1 token to each
  place in t•.
  - Example: M = {p0: 1, p1: 0, p2: 0}, •t1 = {p0}, t1• = {p1, p2}; firing t1 gives
    {p0: 0, p1: 1, p2: 1}.
  - Self-loop (p in •t and in t•): t needs a token in p, and p keeps it after firing.
- Firing a disabled transition: error, marking unchanged.

## Deletion

- Deleting a place or transition also deletes every arc attached to it.
- Deleting an arc leaves its nodes and the marking unchanged.

## Core API (`petri.js`, no DOM)

- The net is plain data; the play marking is separate from the net, so playing never
  changes the initial marking.
- Edit: `createNet()`, `addPlace(net, {x, y, label?, tokens?})` → id,
  `addTransition(net, {x, y, label?})` → id, `addArc(net, source, target)`,
  `remove(net, id)` (node or arc), `setLabel(net, id, label)`,
  `setTokens(net, placeId, n)`, `move(net, id, x, y)`.
- Play: `initialMarking(net)` → `{placeId: n}` with every place, zeros included;
  `isEnabled(net, M, t)`; `enabledTransitions(net, M)`; `fire(net, M, t)` → new
  marking (M itself is not modified).
- I/O: `exportNet(net)` → JSON string; `importNet(text)` → net, or an error with a
  message saying what is wrong.
- Invalid calls (unknown id, invalid or duplicate arc, negative or non-integer tokens,
  disabled transition) throw an `Error` with a readable message and change nothing.

## Interactions

Two modes, switched with a toolbar button; the current mode is always visible.

**Edit mode**
- Tools in the toolbar: Select, Place, Transition, Arc.
- Place / Transition tool: click on empty canvas creates the node there.
- Arc tool: drag from a node to another node creates the arc (or shows the rejection
  message).
- Select tool: click selects one element (node or arc); drag moves a node, its arcs
  follow. Delete or Backspace, or the Delete button, deletes the selection.
- Selected node: a properties bar edits its label and, for a place, its tokens.
- Messages (rejections, import errors) appear in a status bar for a few seconds.

**Play mode**
- Starts from the initial marking. Nothing can be created, moved, deleted or edited.
- Enabled transitions are highlighted (colour and thicker border); disabled ones are
  not. Clicking an enabled transition fires it; clicking a disabled one does nothing.
- Reset returns to the initial marking. Stopping Play (back to Edit) also returns the
  net to its initial marking; the play marking is never kept.
- A dead marking needs no message: no highlighted transition shows it.

**Rendering**
- Places are circles, transitions are rectangles, arcs are straight arrows; a pair of
  opposite arcs (p→t and t→p) is drawn as two curves so both are visible.
- Tokens: 1 to 5 as dots, more than 5 as a number.
- Projector: black on white, labels at least 16 px at 100% zoom; zoom in, zoom out
  and fit-to-screen buttons.

## JSON format

```json
{
  "format": "petri-modeler",
  "version": 1,
  "places": [{"id": "p1", "label": "start", "x": 100, "y": 200, "tokens": 1}],
  "transitions": [{"id": "t1", "label": "register", "x": 220, "y": 200}],
  "arcs": [{"source": "p1", "target": "t1"}]
}
```

- Export downloads the current net (with its initial marking) as `net.json`.
- Import replaces the current net after a confirmation when the current net is not
  empty; the tool switches to Edit mode.
- Import rejects, with a message and the current net unchanged: invalid JSON, wrong
  `format` or `version`, missing fields, duplicate ids, arcs to unknown nodes, invalid
  or duplicate arcs, tokens that are not integers ≥ 0.
- `importNet(exportNet(net))` gives the same net.

## Out of scope

- Arc weights, capacities, inhibitor arcs; WF-net or soundness checks; reachability
  graph; PNML; undo/redo; saving between visits (export/import only); multi-select,
  copy/paste; firing animation; touch-first use.
