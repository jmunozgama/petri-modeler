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

  const canvas = document.getElementById('canvas');
  const status = document.getElementById('status');
  const toolButtons = document.querySelectorAll('[data-tool]');

  let net = Petri.createNet();
  let tool = 'select';
  let drag = null; // {id, dx, dy}: node being moved and pointer offset from its centre
  let link = null;  // {source, line}: arc being drawn with the Arc tool

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
  defs.append(arrow);
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

  function nodeGroup(node, shape, labelY) {
    const g = svg('g', { class: 'node', 'data-id': node.id });
    g.append(shape);
    const label = svg('text', { class: 'label', x: node.x, y: labelY });
    label.textContent = node.label;
    g.append(label);
    return g;
  }

  function render() {
    arcLayer.replaceChildren();
    nodeLayer.replaceChildren();
    for (const arc of net.arcs) {
      const d = arcPath(arc);
      const g = svg('g', { class: 'arc', 'data-source': arc.source, 'data-target': arc.target });
      g.append(svg('path', { class: 'hit', d }), svg('path', { d, 'marker-end': 'url(#arrow)' }));
      arcLayer.append(g);
    }
    for (const p of net.places) {
      nodeLayer.append(nodeGroup(p,
        svg('circle', { cx: p.x, cy: p.y, r: PLACE_R }),
        p.y + PLACE_R + 4));
    }
    for (const t of net.transitions) {
      nodeLayer.append(nodeGroup(t,
        svg('rect', {
          x: t.x - TRANSITION_W / 2, y: t.y - TRANSITION_H / 2,
          width: TRANSITION_W, height: TRANSITION_H,
        }),
        t.y + TRANSITION_H / 2 + 4));
    }
  }

  function setTool(name) {
    tool = name;
    canvas.setAttribute('class', `tool-${name}`);
    for (const b of toolButtons) b.classList.toggle('active', b.dataset.tool === name);
  }

  // ---- Interaction ----

  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const nodeEl = event.target.closest('.node');
    const at = toNet(event);

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
      canvas.setPointerCapture(event.pointerId);
    } else if (tool === 'select') {
      const node = findNode(nodeEl.dataset.id);
      drag = { id: node.id, dx: at.x - node.x, dy: at.y - node.y };
      canvas.setPointerCapture(event.pointerId);
    }
  });

  canvas.addEventListener('pointermove', (event) => {
    if (link) {
      const at = toNet(event);
      link.line.setAttribute('x2', at.x);
      link.line.setAttribute('y2', at.y);
      return;
    }
    if (!drag) return;
    const at = toNet(event);
    attempt(() => Petri.move(net, drag.id, at.x - drag.dx, at.y - drag.dy));
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
    drag = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  for (const b of toolButtons) b.addEventListener('click', () => setTool(b.dataset.tool));

  setTool('select');
  render();
})();
