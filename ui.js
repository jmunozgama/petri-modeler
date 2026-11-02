// Rendering and interaction (SPEC.md §Interactions, §Rendering). Every change to the
// net goes through `Petri`; this file never decides what is valid.

(function () {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const PLACE_R = 24;
  const TRANSITION_W = 30;
  const TRANSITION_H = 60;
  const MESSAGE_MS = 4000;
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

  // ---- Helpers ----

  function svg(name, attrs) {
    const el = document.createElementNS(SVG_NS, name);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  }

  // Pointer position in net coordinates, so zoom and pan can later change the view only.
  function toNet(event) {
    const pt = canvas.createSVGPoint();
    pt.x = event.clientX;
    pt.y = event.clientY;
    const { x, y } = pt.matrixTransform(canvas.getScreenCTM().inverse());
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

  // Runs a Petri call; a rejection becomes a status message and the net stays as it was.
  function attempt(change) {
    try {
      change();
    } catch (err) {
      showMessage(err.message);
    }
    render();
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
  const overlay = svg('g', {});
  canvas.append(defs, arcLayer, nodeLayer, overlay);

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
        p.y + PLACE_R + 4);
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
        t.y + TRANSITION_H / 2 + 4,
        enabled.has(t.id)));
    }
    updateProperties();
  }

  function setTool(name) {
    tool = name;
    canvas.setAttribute('class', `tool-${name}`);
    for (const b of toolButtons) b.classList.toggle('active', b.dataset.tool === name);
  }

  // Play starts from the initial marking; going back to Edit drops the play marking.
  function setMode(name) {
    if (document.activeElement) document.activeElement.blur(); // applies a pending edit
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

  // ---- Interaction ----

  function startMoving(at) {
    const nodes = [...selection].map(findNode).filter(Boolean).map(({ id, x, y }) => ({ id, x, y }));
    drag = { start: at, nodes };
  }

  // Select tool: click selects one element, Shift+click toggles one, Shift+drag on
  // empty canvas draws a rectangle, dragging a node moves the whole selection.
  function selectDown(event, at) {
    const el = event.target.closest('.node, .arc');
    if (!el) {
      if (event.shiftKey) {
        const rect = svg('rect', { class: 'marquee', x: at.x, y: at.y, width: 0, height: 0 });
        overlay.append(rect);
        marquee = { start: at, rect };
      } else {
        selection.clear();
      }
      render();
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
    canvas.setPointerCapture(event.pointerId);

    if (mode === 'play') return playDown(nodeEl);
    if (tool === 'select') return selectDown(event, at);

    if (!nodeEl) {
      if (tool === 'place') attempt(() => Petri.addPlace(net, at));
      else if (tool === 'transition') attempt(() => Petri.addTransition(net, at));
      return;
    }

    if (tool === 'arc') {
      const from = findNode(nodeEl.dataset.id);
      const line = svg('line', { class: 'rubber', x1: from.x, y1: from.y, x2: at.x, y2: at.y });
      overlay.append(line);
      link = { source: from.id, line };
    }
  });

  canvas.addEventListener('pointermove', (event) => {
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
    attempt(() => { for (const n of drag.nodes) Petri.move(net, n.id, n.x + dx, n.y + dy); });
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
    if (link) finishLink(event);
    if (marquee) finishMarquee(event);
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
    if (selectedNode() === node) tokensInput.value = node.tokens;
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

  for (const b of toolButtons) b.addEventListener('click', () => setTool(b.dataset.tool));
  deleteButton.addEventListener('click', deleteSelection);
  for (const b of modeButtons) b.addEventListener('click', () => setMode(b.dataset.mode));
  resetButton.addEventListener('click', () => {
    marking = Petri.initialMarking(net);
    render();
  });

  document.addEventListener('keydown', (event) => {
    if (event.target.closest('input, textarea')) return;
    if (mode === 'edit' && (event.key === 'Delete' || event.key === 'Backspace')) {
      event.preventDefault();
      deleteSelection();
    }
  });

  setTool('select');
  setMode('edit');
})();
