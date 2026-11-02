// Rendering and interaction (SPEC.md §Interactions, §Rendering). Every change to the
// net goes through `Petri`; this file never decides what is valid.

(function () {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const PLACE_R = 24;
  const TRANSITION_W = 30;
  const TRANSITION_H = 60;
  const MESSAGE_MS = 4000;

  const canvas = document.getElementById('canvas');
  const status = document.getElementById('status');
  const toolButtons = document.querySelectorAll('[data-tool]');

  let net = Petri.createNet();
  let tool = 'select';
  let drag = null; // {id, dx, dy}: node being moved and pointer offset from its centre

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

  function nodeGroup(node, shape, labelY) {
    const g = svg('g', { class: 'node', 'data-id': node.id });
    g.append(shape);
    const label = svg('text', { class: 'label', x: node.x, y: labelY });
    label.textContent = node.label;
    g.append(label);
    return g;
  }

  function render() {
    canvas.replaceChildren();
    for (const p of net.places) {
      canvas.append(nodeGroup(p,
        svg('circle', { cx: p.x, cy: p.y, r: PLACE_R }),
        p.y + PLACE_R + 4));
    }
    for (const t of net.transitions) {
      canvas.append(nodeGroup(t,
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

  const findNode = (id) =>
    net.places.find((p) => p.id === id) || net.transitions.find((t) => t.id === id);

  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const nodeEl = event.target.closest('.node');
    const at = toNet(event);

    if (!nodeEl) {
      if (tool === 'place') attempt(() => Petri.addPlace(net, at));
      else if (tool === 'transition') attempt(() => Petri.addTransition(net, at));
      return;
    }

    if (tool === 'select') {
      const node = findNode(nodeEl.dataset.id);
      drag = { id: node.id, dx: at.x - node.x, dy: at.y - node.y };
      canvas.setPointerCapture(event.pointerId);
    }
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const at = toNet(event);
    attempt(() => Petri.move(net, drag.id, at.x - drag.dx, at.y - drag.dy));
  });

  function endDrag(event) {
    if (!drag) return;
    drag = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  for (const b of toolButtons) b.addEventListener('click', () => setTool(b.dataset.tool));

  setTool('select');
  render();
})();
