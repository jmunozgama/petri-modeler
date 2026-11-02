// Rendering and interaction (SPEC.md §Interactions, §Rendering). Every change to the
// net goes through `Petri`; this file never decides what is valid.

(function () {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const PLACE_R = 24;
  const TRANSITION_W = 30;
  const TRANSITION_H = 60;
  const MESSAGE_MS = 4000;
  const MIN_ZOOM = 0.2;
  const MAX_ZOOM = 5;
  const FIT_MAX_ZOOM = 2;  // fit never blows a small net up more than this
  const FIT_MARGIN = 60;   // net units around the nodes, room for labels
  const BUTTON_ZOOM = 1.25;
  const PAN_THRESHOLD = 4; // screen px a press must move to count as a drag
  const PAD_SIZE = 24;     // context pad button, net units
  const PAD_GAP = 6;
  const APPEND_DX = 120;   // an appended node goes this far to the right
  const LABEL_GAP = 7;     // space between a node and its label, clear of the label halo
  const CURVE_BEND = 0.25; // control-point offset of a curved arc, as a share of its length
  const TOKEN_R = 5;
  const MAX_DOTS = 5; // more tokens than this are drawn as a number
  // Dot offsets from the place centre for 1 to MAX_DOTS tokens.
  const DOTS = [
    [],
    [[0, 0]],
    [[-7, 0], [7, 0]],
    [[0, -7], [-7, 6], [7, 6]],
    [[-7, -7], [7, -7], [-7, 7], [7, 7]],
    [[-10, -10], [10, -10], [0, 0], [-10, 10], [10, 10]],
  ];

  const canvas = document.getElementById('canvas');
  const status = document.getElementById('status');
  const toolButtons = document.querySelectorAll('[data-tool]');
  const modeButtons = document.querySelectorAll('[data-mode]');
  const resetButton = document.getElementById('reset');
  const deleteButton = document.getElementById('delete');
  const undoButton = document.getElementById('undo');
  const redoButton = document.getElementById('redo');
  const exportButton = document.getElementById('export');
  const importButton = document.getElementById('import');
  const importFile = document.getElementById('import-file');
  const zoomInButton = document.getElementById('zoom-in');
  const zoomOutButton = document.getElementById('zoom-out');
  const fitButton = document.getElementById('fit');
  const properties = document.getElementById('properties');
  const labelInput = document.getElementById('prop-label');
  const tokensField = document.getElementById('prop-tokens-field');
  const tokensInput = document.getElementById('prop-tokens');

  let net = Petri.createNet();
  let mode = 'edit';
  let marking = null; // play marking, kept apart from the net; null in Edit mode
  let tool = 'select';
  let selection = new Set(); // ids of selected nodes and arcs
  let drag = null;    // {start, nodes: [{id, x, y}]}: selected nodes being moved
  let link = null;    // {source, line}: arc being drawn with the Arc tool
  let marquee = null; // {start, rect}: Shift+drag selection rectangle
  let pan = null;     // {client, view, moved, click}: press on empty canvas
  let connect = null; // {source, line}: context pad "connect" waiting for a target
  let undoStack = [];   // nets before each change, newest last
  let redoStack = [];   // nets undone, newest last
  let view = { x: 0, y: 0, k: 1 }; // top-left corner in net units, and zoom

  // ---- Helpers ----

  function svg(name, attrs) {
    const el = document.createElementNS(SVG_NS, name);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  }

  // Pointer position in net coordinates: zoom and pan change the view only.
  function netPoint(event) {
    const pt = canvas.createSVGPoint();
    pt.x = event.clientX;
    pt.y = event.clientY;
    const { x, y } = pt.matrixTransform(canvas.getScreenCTM().inverse());
    return { x, y };
  }

  function toNet(event) {
    const { x, y } = netPoint(event);
    return { x: Math.round(x), y: Math.round(y) };
  }

  const findNode = (id) =>
    net.places.find((p) => p.id === id) || net.transitions.find((t) => t.id === id);

  let messageTimer = null;
  function showMessage(text) {
    status.textContent = text;
    clearTimeout(messageTimer);
    messageTimer = setTimeout(() => { status.textContent = ''; }, MESSAGE_MS);
  }

  // Runs Petri calls as one step: a rejection becomes a status message and the net
  // goes back to how it was (also when an earlier call of the step succeeded); a step
  // that changed the net can be undone. `record` false: a node drag records once, at
  // its end.
  function attempt(change, record = true) {
    const before = structuredClone(net);
    const json = JSON.stringify(net);
    try {
      change();
    } catch (err) {
      showMessage(err.message);
      if (JSON.stringify(net) !== json) net = before;
    }
    if (record && JSON.stringify(net) !== json) pushUndo(before);
    render();
  }

  // ---- Undo / redo ----

  // A new change drops the redo steps.
  function pushUndo(before) {
    undoStack.push(before);
    redoStack = [];
  }

  // Restoring a net keeps the id counters where they are, so ids are never reused.
  function restore(saved) {
    saved.next = {
      p: Math.max(saved.next.p, net.next.p),
      t: Math.max(saved.next.t, net.next.t),
    };
    net = saved;
    cancelConnect();
    render();
  }

  function undo() {
    if (mode !== 'edit' || undoStack.length === 0) return;
    redoStack.push(net);
    restore(undoStack.pop());
  }

  function redo() {
    if (mode !== 'edit' || redoStack.length === 0) return;
    undoStack.push(net);
    restore(redoStack.pop());
  }

  // ---- Rendering ----

  // Static layers: arcs under nodes, the rubber band of a new arc on top.
  const defs = svg('defs', {});
  const arrow = svg('marker', {
    id: 'arrow', viewBox: '0 0 10 10', refX: 10, refY: 5,
    markerWidth: 10, markerHeight: 10, markerUnits: 'userSpaceOnUse', orient: 'auto',
  });
  arrow.append(svg('path', { d: 'M0,0 L10,5 L0,10 z' }));
  const arrowSelected = arrow.cloneNode(true);
  arrowSelected.id = 'arrow-selected';
  defs.append(arrow, arrowSelected);
  const arcLayer = svg('g', {});
  const nodeLayer = svg('g', {});
  const padLayer = svg('g', {});
  const overlay = svg('g', {});
  canvas.append(defs, arcLayer, nodeLayer, padLayer, overlay);

  // Point where the line from the centre of `node` towards `to` leaves its shape.
  function boundary(node, isPlace, to) {
    const dx = to.x - node.x;
    const dy = to.y - node.y;
    const len = Math.hypot(dx, dy) || 1;
    if (isPlace) return { x: node.x + dx / len * PLACE_R, y: node.y + dy / len * PLACE_R };
    const k = Math.min(
      dx ? TRANSITION_W / 2 / Math.abs(dx) : Infinity,
      dy ? TRANSITION_H / 2 / Math.abs(dy) : Infinity);
    return { x: node.x + dx * k, y: node.y + dy * k };
  }

  // A straight arrow, or a curve bent to its left when the opposite arc also exists,
  // so both arcs of a pair stay visible.
  function arcPath(arc) {
    const fromPlace = net.places.some((p) => p.id === arc.source);
    const a = findNode(arc.source);
    const b = findNode(arc.target);
    const paired = net.arcs.some((o) => o.source === arc.target && o.target === arc.source);
    if (!paired) {
      const s = boundary(a, fromPlace, b);
      const e = boundary(b, !fromPlace, a);
      return `M${s.x},${s.y} L${e.x},${e.y}`;
    }
    const c = {
      x: (a.x + b.x) / 2 + (b.y - a.y) * CURVE_BEND,
      y: (a.y + b.y) / 2 - (b.x - a.x) * CURVE_BEND,
    };
    const s = boundary(a, fromPlace, c);
    const e = boundary(b, !fromPlace, c);
    return `M${s.x},${s.y} Q${c.x},${c.y} ${e.x},${e.y}`;
  }

  function nodeGroup(node, shape, labelY, enabled) {
    let cls = 'node';
    if (selection.has(node.id)) cls += ' selected';
    if (enabled) cls += ' enabled';
    const g = svg('g', { class: cls, 'data-id': node.id });
    g.append(shape);
    const label = svg('text', { class: 'label', x: node.x, y: labelY });
    label.textContent = node.label;
    g.append(label);
    return g;
  }

  function tokenMarks(p, n) {
    if (n > MAX_DOTS) {
      const count = svg('text', { class: 'token-count', x: p.x, y: p.y });
      count.textContent = n;
      return [count];
    }
    return DOTS[n].map(([dx, dy]) =>
      svg('circle', { class: 'token', cx: p.x + dx, cy: p.y + dy, r: TOKEN_R }));
  }

  // The single selected node, or null when the selection is empty, an arc or several.
  function selectedNode() {
    if (selection.size !== 1) return null;
    return findNode([...selection][0]) || null;
  }

  // Shows the bar for exactly one selected node; a field being typed in is left alone.
  function updateProperties() {
    const node = selectedNode();
    properties.hidden = !node;
    if (!node) return;
    const isPlace = net.places.includes(node);
    tokensField.hidden = !isPlace;
    if (document.activeElement !== labelInput) labelInput.value = node.label;
    if (isPlace && document.activeElement !== tokensInput) tokensInput.value = node.tokens;
  }

  function render() {
    // Elements deleted from the net leave the selection.
    const ids = new Set([...net.places, ...net.transitions].map((n) => n.id));
    for (const a of net.arcs) ids.add(Petri.arcId(a.source, a.target));
    selection = new Set([...selection].filter((id) => ids.has(id)));
    deleteButton.disabled = selection.size === 0;
    undoButton.disabled = undoStack.length === 0;
    redoButton.disabled = redoStack.length === 0;

    arcLayer.replaceChildren();
    nodeLayer.replaceChildren();
    for (const arc of net.arcs) {
      const id = Petri.arcId(arc.source, arc.target);
      const selected = selection.has(id);
      const d = arcPath(arc);
      const g = svg('g', {
        class: selected ? 'arc selected' : 'arc',
        'data-id': id, 'data-source': arc.source, 'data-target': arc.target,
      });
      g.append(
        svg('path', { class: 'hit', d }),
        svg('path', { d, 'marker-end': selected ? 'url(#arrow-selected)' : 'url(#arrow)' }));
      arcLayer.append(g);
    }
    for (const p of net.places) {
      const g = nodeGroup(p,
        svg('circle', { cx: p.x, cy: p.y, r: PLACE_R }),
        p.y + PLACE_R + LABEL_GAP);
      g.append(...tokenMarks(p, marking ? marking[p.id] : p.tokens));
      nodeLayer.append(g);
    }
    const enabled = new Set(marking ? Petri.enabledTransitions(net, marking) : []);
    for (const t of net.transitions) {
      nodeLayer.append(nodeGroup(t,
        svg('rect', {
          x: t.x - TRANSITION_W / 2, y: t.y - TRANSITION_H / 2,
          width: TRANSITION_W, height: TRANSITION_H,
        }),
        t.y + TRANSITION_H / 2 + LABEL_GAP,
        enabled.has(t.id)));
    }
    renderPad();
    updateProperties();
  }

  function padButton(action, x, y, title, icon) {
    const g = svg('g', { class: 'pad-button', 'data-action': action });
    if (action === 'connect' && connect) g.classList.add('active');
    const t = svg('title', {});
    t.textContent = title;
    g.append(t, svg('rect', { class: 'pad-bg', x, y, width: PAD_SIZE, height: PAD_SIZE, rx: 4 }), icon);
    return g;
  }

  // Context pad: a row of icon buttons off the top-right corner of the single selected
  // node (clear of horizontal arcs), Edit mode only.
  function renderPad() {
    padLayer.replaceChildren();
    const node = mode === 'edit' && selectedNode();
    if (!node) return;
    const isPlace = net.places.includes(node);
    const x = node.x + (isPlace ? PLACE_R : TRANSITION_W / 2);
    const y = node.y - (isPlace ? PLACE_R : TRANSITION_H / 2) - PAD_SIZE;
    const cx = x + PAD_SIZE / 2;
    const cy = y + PAD_SIZE / 2;
    const appendIcon = isPlace
      ? svg('rect', { class: 'pad-icon', x: cx - 4, y: cy - 7, width: 8, height: 14 })
      : svg('circle', { class: 'pad-icon', cx, cy, r: 7 });
    const x2 = x + PAD_SIZE + PAD_GAP;
    const connectIcon = svg('path', {
      class: 'pad-icon',
      d: `M${x2 + 5},${y + PAD_SIZE - 5} L${x2 + PAD_SIZE - 6},${y + 6}`
        + ` M${x2 + PAD_SIZE - 13},${y + 6} L${x2 + PAD_SIZE - 6},${y + 6} L${x2 + PAD_SIZE - 6},${y + 13}`,
    });
    padLayer.append(
      padButton('append', x, y, isPlace ? 'Append transition' : 'Append place', appendIcon),
      padButton('connect', x2, y, 'Connect', connectIcon));
  }

  function setTool(name) {
    cancelConnect();
    tool = name;
    canvas.setAttribute('class', `tool-${name}`);
    for (const b of toolButtons) b.classList.toggle('active', b.dataset.tool === name);
  }

  // Play starts from the initial marking; going back to Edit drops the play marking.
  function setMode(name) {
    if (document.activeElement) document.activeElement.blur(); // applies a pending edit
    cancelConnect();
    mode = name;
    marking = name === 'play' ? Petri.initialMarking(net) : null;
    selection.clear();
    document.body.classList.toggle('play', name === 'play');
    for (const b of modeButtons) b.classList.toggle('active', b.dataset.mode === name);
    if (name === 'play') canvas.setAttribute('class', 'play');
    else setTool(tool);
    render();
  }

  // Play: a click on an enabled transition fires it; anything else does nothing.
  function playDown(nodeEl) {
    const id = nodeEl && nodeEl.dataset.id;
    if (!id || !net.transitions.some((t) => t.id === id)) return;
    if (Petri.isEnabled(net, marking, id)) {
      marking = Petri.fire(net, marking, id);
      render();
    }
  }

  // ---- View: zoom and pan ----

  function applyView() {
    const w = canvas.clientWidth / view.k;
    const h = canvas.clientHeight / view.k;
    canvas.setAttribute('viewBox', `${view.x} ${view.y} ${w} ${h}`);
  }

  // Zooms keeping net point `p` under the same screen point.
  function zoomAt(p, factor) {
    const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.k * factor));
    view = {
      x: p.x - (p.x - view.x) * view.k / k,
      y: p.y - (p.y - view.y) * view.k / k,
      k,
    };
    applyView();
  }

  function zoomCentre(factor) {
    const w = canvas.clientWidth / view.k;
    const h = canvas.clientHeight / view.k;
    zoomAt({ x: view.x + w / 2, y: view.y + h / 2 }, factor);
  }

  // Shows every node; an empty net gets the default view.
  function fit() {
    const nodes = [...net.places, ...net.transitions];
    if (nodes.length === 0) {
      view = { x: 0, y: 0, k: 1 };
      return applyView();
    }
    const xs = nodes.map((n) => n.x);
    const ys = nodes.map((n) => n.y);
    const minX = Math.min(...xs) - FIT_MARGIN;
    const minY = Math.min(...ys) - FIT_MARGIN;
    const bw = Math.max(...xs) + FIT_MARGIN - minX;
    const bh = Math.max(...ys) + FIT_MARGIN - minY;
    const k = Math.min(FIT_MAX_ZOOM, canvas.clientWidth / bw, canvas.clientHeight / bh);
    view = {
      x: minX + bw / 2 - canvas.clientWidth / k / 2,
      y: minY + bh / 2 - canvas.clientHeight / k / 2,
      k,
    };
    applyView();
  }

  // A press on empty canvas pans if it moves; if it does not, it is a click.
  function startPan(event, click) {
    pan = { client: { x: event.clientX, y: event.clientY }, view: { ...view }, moved: false, click };
  }

  function movePan(event) {
    const dx = event.clientX - pan.client.x;
    const dy = event.clientY - pan.client.y;
    if (!pan.moved && Math.hypot(dx, dy) < PAN_THRESHOLD) return;
    pan.moved = true;
    canvas.classList.add('panning');
    view = { ...view, x: pan.view.x - dx / view.k, y: pan.view.y - dy / view.k };
    applyView();
  }

  function endPan(event) {
    const { moved, click } = pan;
    pan = null;
    canvas.classList.remove('panning');
    if (!moved && event.type === 'pointerup') click();
  }

  // ---- Interaction ----

  function startMoving(at) {
    const nodes = [...selection].map(findNode).filter(Boolean).map(({ id, x, y }) => ({ id, x, y }));
    drag = { start: at, nodes, before: structuredClone(net) };
  }

  // Select tool: click selects one element, Shift+click toggles one, Shift+drag on
  // empty canvas draws a rectangle, dragging a node moves the whole selection.
  function selectDown(event, at) {
    const el = event.target.closest('.node, .arc');
    if (!el) {
      const rect = svg('rect', { class: 'marquee', x: at.x, y: at.y, width: 0, height: 0 });
      overlay.append(rect);
      marquee = { start: at, rect };
      return;
    }
    const id = el.dataset.id;
    if (event.shiftKey) {
      if (selection.has(id)) selection.delete(id);
      else selection.add(id);
    } else if (!selection.has(id)) {
      selection = new Set([id]);
    }
    if (!event.shiftKey && el.classList.contains('node')) startMoving(at);
    render();
  }

  function marqueeBox(at) {
    const { start } = marquee;
    return {
      x: Math.min(start.x, at.x), y: Math.min(start.y, at.y),
      width: Math.abs(at.x - start.x), height: Math.abs(at.y - start.y),
    };
  }

  // Adds every node whose centre is inside the rectangle, and every arc whose two
  // nodes are.
  function finishMarquee(event) {
    const box = marqueeBox(toNet(event));
    marquee.rect.remove();
    marquee = null;
    const inside = (n) => n.x >= box.x && n.x <= box.x + box.width
      && n.y >= box.y && n.y <= box.y + box.height;
    const nodes = new Set([...net.places, ...net.transitions].filter(inside).map((n) => n.id));
    for (const id of nodes) selection.add(id);
    for (const a of net.arcs) {
      if (nodes.has(a.source) && nodes.has(a.target)) selection.add(Petri.arcId(a.source, a.target));
    }
    render();
  }

  // Deletes arcs first: an arc attached to a deleted node is gone afterwards.
  function deleteSelection() {
    if (selection.size === 0) return;
    const isArc = (id) => net.arcs.some((a) => Petri.arcId(a.source, a.target) === id);
    const arcs = [...selection].filter(isArc);
    const nodes = [...selection].filter((id) => !isArc(id));
    attempt(() => { for (const id of [...arcs, ...nodes]) Petri.remove(net, id); });
  }

  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const nodeEl = event.target.closest('.node');
    const at = toNet(event);
    const padEl = event.target.closest('.pad-button');
    if (padEl) return padDown(padEl, at);
    if (connect) return connectDown(nodeEl);
    canvas.setPointerCapture(event.pointerId);

    // Only the Select tool can pick arcs; for everything else an arc is empty canvas.
    const picksArcs = mode === 'edit' && tool === 'select';
    const hit = picksArcs ? event.target.closest('.node, .arc') : nodeEl;
    if (!hit && !(picksArcs && event.shiftKey)) return startPan(event, () => emptyClick(at));

    if (mode === 'play') return playDown(nodeEl);
    if (tool === 'select') return selectDown(event, at);

    if (tool === 'arc') {
      const from = findNode(nodeEl.dataset.id);
      const line = svg('line', { class: 'rubber', x1: from.x, y1: from.y, x2: at.x, y2: at.y });
      overlay.append(line);
      link = { source: from.id, line };
    }
  });

  // ---- Context pad ----

  // Appends a node of the other kind to the right, joined by an arc, and selects it.
  function appendNode(node) {
    attempt(() => {
      const at = { x: node.x + APPEND_DX, y: node.y };
      const id = net.places.includes(node) ? Petri.addTransition(net, at) : Petri.addPlace(net, at);
      Petri.addArc(net, node.id, id);
      selection = new Set([id]);
    });
  }

  function startConnect(node, at) {
    cancelConnect();
    const line = svg('line', { class: 'rubber', x1: node.x, y1: node.y, x2: at.x, y2: at.y });
    overlay.append(line);
    connect = { source: node.id, line };
    render();
  }

  function cancelConnect() {
    if (!connect) return;
    connect.line.remove();
    connect = null;
    render();
  }

  function padDown(button, at) {
    const node = selectedNode();
    if (!node) return;
    if (button.dataset.action === 'append') appendNode(node);
    else if (connect) cancelConnect();
    else startConnect(node, at);
  }

  // While connecting, the next click on another node makes the arc; anything else cancels.
  function connectDown(nodeEl) {
    const { source } = connect;
    cancelConnect();
    if (nodeEl && nodeEl.dataset.id !== source) {
      attempt(() => Petri.addArc(net, source, nodeEl.dataset.id));
    }
  }

  // A click (no drag) on empty canvas: create a node, or clear the selection.
  function emptyClick(at) {
    if (mode !== 'edit') return;
    if (tool === 'select') {
      selection.clear();
      render();
    } else if (tool === 'place') {
      attempt(() => Petri.addPlace(net, at));
    } else if (tool === 'transition') {
      attempt(() => Petri.addTransition(net, at));
    }
  }

  canvas.addEventListener('pointermove', (event) => {
    if (connect) {
      const at = toNet(event);
      connect.line.setAttribute('x2', at.x);
      connect.line.setAttribute('y2', at.y);
    }
    if (pan) return movePan(event);
    if (link) {
      const at = toNet(event);
      link.line.setAttribute('x2', at.x);
      link.line.setAttribute('y2', at.y);
      return;
    }
    if (marquee) {
      for (const [k, v] of Object.entries(marqueeBox(toNet(event)))) marquee.rect.setAttribute(k, v);
      return;
    }
    if (!drag) return;
    const at = toNet(event);
    const dx = at.x - drag.start.x;
    const dy = at.y - drag.start.y;
    attempt(() => { for (const n of drag.nodes) Petri.move(net, n.id, n.x + dx, n.y + dy); }, false);
  });

  // Dropping a new arc on another node asks Petri to add it; dropping it on empty
  // canvas or back on its source cancels it.
  function finishLink(event) {
    const { source, line } = link;
    link = null;
    line.remove();
    if (event.type !== 'pointerup') return;
    const hit = document.elementFromPoint(event.clientX, event.clientY);
    const nodeEl = hit && hit.closest('#canvas .node');
    if (nodeEl && nodeEl.dataset.id !== source) {
      attempt(() => Petri.addArc(net, source, nodeEl.dataset.id));
    }
  }

  function endDrag(event) {
    if (pan) endPan(event);
    if (link) finishLink(event);
    if (marquee) finishMarquee(event);
    if (drag && JSON.stringify(drag.before) !== JSON.stringify(net)) {
      pushUndo(drag.before);
      render();
    }
    drag = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // Properties bar: a field is applied when it changes (Enter or leaving it), so one
  // edit is one change to the net; a rejected value shows the stored one again. The
  // node is the one selected when the field got focus: a click on the canvas changes
  // the selection before the field loses focus and fires its change.
  let editing = null;
  labelInput.addEventListener('change', () => {
    const id = editing;
    if (id && findNode(id)) attempt(() => Petri.setLabel(net, id, labelInput.value));
  });
  tokensInput.addEventListener('change', () => {
    const node = editing && findNode(editing);
    if (!node) return;
    const raw = tokensInput.value.trim();
    attempt(() => Petri.setTokens(net, node.id, raw === '' ? raw : Number(raw)));
    const now = findNode(node.id);
    if (now && selectedNode() === now) tokensInput.value = now.tokens;
  });
  for (const input of [labelInput, tokensInput]) {
    input.addEventListener('focus', () => {
      const node = selectedNode();
      editing = node && node.id;
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') input.blur();
      if (event.key === 'Escape') {
        const node = editing && findNode(editing);
        if (node) input.value = input === labelInput ? node.label : node.tokens;
        input.blur();
      }
    });
  }

  // ---- Export / import ----

  function exportFile() {
    const blob = new Blob([Petri.exportNet(net)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'petrinet.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000); // some browsers read it after click()
  }

  // The file is checked before asking: a rejected file never asks and changes nothing.
  async function importChosen() {
    const file = importFile.files[0];
    importFile.value = ''; // choosing the same file again fires `change` again
    if (!file) return;
    let imported;
    try {
      imported = Petri.importNet(await file.text());
    } catch (err) {
      showMessage(`Import failed: ${err.message}`);
      return;
    }
    const empty = net.places.length === 0 && net.transitions.length === 0;
    if (!empty && !window.confirm('Replace the current net with the imported one?')) return;
    pushUndo(net);
    net = imported;
    setMode('edit');
    fit();
    showMessage(`Imported ${file.name}.`);
  }

  for (const b of toolButtons) b.addEventListener('click', () => setTool(b.dataset.tool));
  exportButton.addEventListener('click', exportFile);
  importButton.addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', importChosen);
  zoomInButton.addEventListener('click', () => zoomCentre(BUTTON_ZOOM));
  zoomOutButton.addEventListener('click', () => zoomCentre(1 / BUTTON_ZOOM));
  fitButton.addEventListener('click', fit);
  window.addEventListener('resize', applyView);

  // Wheel and trackpad pinch (a wheel event with ctrlKey) zoom around the pointer.
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    const pixels = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
    const speed = event.ctrlKey ? 0.01 : 0.002;
    zoomAt(netPoint(event), Math.exp(-pixels * speed));
  }, { passive: false });
  deleteButton.addEventListener('click', deleteSelection);
  undoButton.addEventListener('click', undo);
  redoButton.addEventListener('click', redo);
  for (const b of modeButtons) b.addEventListener('click', () => setMode(b.dataset.mode));
  resetButton.addEventListener('click', () => {
    marking = Petri.initialMarking(net);
    render();
  });

  document.addEventListener('keydown', (event) => {
    if (event.target.closest('input, textarea')) return;
    if (event.key === 'Escape') cancelConnect();
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    if (mode === 'edit' && (event.key === 'Delete' || event.key === 'Backspace')) {
      event.preventDefault();
      deleteSelection();
    }
  });

  setTool('select');
  setMode('edit');
  applyView();
})();
