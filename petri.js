// Petri net model, firing rule and JSON import/export (SPEC.md §Core API). No DOM.
// Works as a classic script (global `Petri`) and as a Node module.

(function (root) {
  'use strict';

  const FORMAT = 'petri-modeler';
  const VERSION = 1;
  const PLACE_ID = /^p([1-9]\d*)$/;
  const TRANSITION_ID = /^t([1-9]\d*)$/;

  const fail = (message) => { throw new Error(message); };

  // The net is plain data: a structuredClone of it is a full, independent net.
  // `next` holds the next id numbers, so ids are never reused.
  function createNet() {
    return { places: [], transitions: [], arcs: [], next: { p: 1, t: 1 } };
  }

  // Arc ids are derived from their ordered pair; node ids are never reused, so an
  // arc id is never reused either.
  const arcId = (source, target) => `${source}->${target}`;

  const findPlace = (net, id) => net.places.find((p) => p.id === id);
  const findTransition = (net, id) => net.transitions.find((t) => t.id === id);
  const findNode = (net, id) => findPlace(net, id) || findTransition(net, id);
  const findArc = (net, id) => net.arcs.find((a) => arcId(a.source, a.target) === id);

  function checkTokens(n) {
    if (!Number.isInteger(n) || n < 0) {
      fail(`Tokens must be an integer ≥ 0, got ${JSON.stringify(n)}.`);
    }
  }

  function checkPosition(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) fail('Position must be two numbers.');
  }

  function checkLabel(label) {
    if (typeof label !== 'string') fail('A label must be text.');
  }

  function requireNode(net, id) {
    return findNode(net, id) || fail(`Unknown node "${id}".`);
  }

  function requirePlace(net, id) {
    return findPlace(net, id) || fail(`"${id}" is not a place.`);
  }

  function requireTransition(net, id) {
    return findTransition(net, id) || fail(`"${id}" is not a transition.`);
  }

  // ---- Edit ----

  function addPlace(net, { x, y, label, tokens = 0 }) {
    checkPosition(x, y);
    checkTokens(tokens);
    if (label !== undefined) checkLabel(label);
    const id = `p${net.next.p}`;
    net.next.p += 1;
    net.places.push({ id, label: label === undefined ? id : label, x, y, tokens });
    return id;
  }

  function addTransition(net, { x, y, label }) {
    checkPosition(x, y);
    if (label !== undefined) checkLabel(label);
    const id = `t${net.next.t}`;
    net.next.t += 1;
    net.transitions.push({ id, label: label === undefined ? id : label, x, y });
    return id;
  }

  function checkArc(net, source, target) {
    requireNode(net, source);
    requireNode(net, target);
    const fromPlace = Boolean(findPlace(net, source));
    const toPlace = Boolean(findPlace(net, target));
    if (fromPlace === toPlace) {
      fail(fromPlace
        ? 'An arc cannot join two places.'
        : 'An arc cannot join two transitions.');
    }
    if (findArc(net, arcId(source, target))) {
      fail(`There is already an arc from ${source} to ${target}.`);
    }
  }

  function addArc(net, source, target) {
    checkArc(net, source, target);
    net.arcs.push({ source, target });
    return arcId(source, target);
  }

  function remove(net, id) {
    if (findNode(net, id)) {
      net.places = net.places.filter((p) => p.id !== id);
      net.transitions = net.transitions.filter((t) => t.id !== id);
      net.arcs = net.arcs.filter((a) => a.source !== id && a.target !== id);
      return;
    }
    const arc = findArc(net, id) || fail(`Unknown element "${id}".`);
    net.arcs = net.arcs.filter((a) => a !== arc);
  }

  function setLabel(net, id, label) {
    checkLabel(label);
    requireNode(net, id).label = label;
  }

  function setTokens(net, placeId, n) {
    const place = requirePlace(net, placeId);
    checkTokens(n);
    place.tokens = n;
  }

  function move(net, id, x, y) {
    const node = requireNode(net, id);
    checkPosition(x, y);
    node.x = x;
    node.y = y;
  }

  // ---- Play ----

  function initialMarking(net) {
    const m = {};
    for (const p of net.places) m[p.id] = p.tokens;
    return m;
  }

  const inputs = (net, t) => net.arcs.filter((a) => a.target === t).map((a) => a.source);
  const outputs = (net, t) => net.arcs.filter((a) => a.source === t).map((a) => a.target);

  function isEnabled(net, m, t) {
    requireTransition(net, t);
    return inputs(net, t).every((p) => (m[p] || 0) >= 1);
  }

  function enabledTransitions(net, m) {
    return net.transitions.map((t) => t.id).filter((t) => isEnabled(net, m, t));
  }

  function fire(net, m, t) {
    if (!isEnabled(net, m, t)) fail(`${t} is not enabled.`);
    const next = { ...m };
    for (const p of inputs(net, t)) next[p] -= 1;
    for (const p of outputs(net, t)) next[p] = (next[p] || 0) + 1;
    return next;
  }

  // ---- I/O ----

  function exportNet(net) {
    return JSON.stringify({
      format: FORMAT,
      version: VERSION,
      places: net.places.map(({ id, label, x, y, tokens }) => ({ id, label, x, y, tokens })),
      transitions: net.transitions.map(({ id, label, x, y }) => ({ id, label, x, y })),
      arcs: net.arcs.map(({ source, target }) => ({ source, target })),
    }, null, 2);
  }

  const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

  function readNode(item, kind, pattern) {
    if (!isObject(item)) fail(`Every ${kind} must be an object.`);
    if (typeof item.id !== 'string') fail(`A ${kind} has no id.`);
    const match = pattern.exec(item.id);
    if (!match) fail(`"${item.id}" is not a valid ${kind} id.`);
    if (typeof item.label !== 'string') fail(`${kind} ${item.id} has no label.`);
    if (!Number.isFinite(item.x) || !Number.isFinite(item.y)) {
      fail(`${kind} ${item.id} needs numbers x and y.`);
    }
    return Number(match[1]);
  }

  function importNet(text) {
    let doc;
    try {
      doc = JSON.parse(text);
    } catch (err) {
      fail('The file is not valid JSON.');
    }
    if (!isObject(doc)) fail('The file does not contain a net.');
    if (doc.format !== FORMAT) fail(`Wrong format: expected "${FORMAT}".`);
    if (doc.version !== VERSION) fail(`Wrong version: expected ${VERSION}.`);
    for (const key of ['places', 'transitions', 'arcs']) {
      if (!Array.isArray(doc[key])) fail(`Missing list "${key}".`);
    }

    const net = createNet();
    const seen = new Set();
    const claim = (id) => {
      if (seen.has(id)) fail(`Duplicate id "${id}".`);
      seen.add(id);
    };

    for (const item of doc.places) {
      const n = readNode(item, 'place', PLACE_ID);
      claim(item.id);
      if (!('tokens' in item)) fail(`place ${item.id} has no tokens.`);
      try {
        checkTokens(item.tokens);
      } catch (err) {
        fail(`place ${item.id}: ${err.message}`);
      }
      net.places.push({ id: item.id, label: item.label, x: item.x, y: item.y, tokens: item.tokens });
      net.next.p = Math.max(net.next.p, n + 1);
    }
    for (const item of doc.transitions) {
      const n = readNode(item, 'transition', TRANSITION_ID);
      claim(item.id);
      net.transitions.push({ id: item.id, label: item.label, x: item.x, y: item.y });
      net.next.t = Math.max(net.next.t, n + 1);
    }
    for (const item of doc.arcs) {
      if (!isObject(item) || typeof item.source !== 'string' || typeof item.target !== 'string') {
        fail('Every arc needs a source and a target.');
      }
      addArc(net, item.source, item.target);
    }
    return net;
  }

  const Petri = {
    createNet, addPlace, addTransition, addArc, remove, setLabel, setTokens, move,
    initialMarking, isEnabled, enabledTransitions, fire, exportNet, importNet, arcId,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Petri;
  else root.Petri = Petri;
})(typeof globalThis !== 'undefined' ? globalThis : this);
