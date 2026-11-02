// Tests for SPEC.md §Core API. Expected values are computed by hand from SPEC.md.
// The net is observed only through the public API (exportNet, initialMarking, ...).

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const Petri = require('../petri.js');

const {
  createNet, addPlace, addTransition, addArc, remove, setLabel, setTokens, move,
  initialMarking, isEnabled, enabledTransitions, fire, exportNet, importNet, arcId,
} = Petri;

// The net as the JSON format describes it.
const view = (net) => JSON.parse(exportNet(net));
const place = (net, id) => view(net).places.find((p) => p.id === id);
const transition = (net, id) => view(net).transitions.find((t) => t.id === id);
const arcs = (net) => view(net).arcs;
const sorted = (xs) => [...xs].sort();

// A rejection is a plain Error with a readable message, not a crash such as a
// TypeError or the SyntaxError of JSON.parse.
const isRejection = (err) => err instanceof Error && err.name === 'Error' && err.message.length > 0;

// Asserts that fn throws an Error with a non-empty message and leaves the net as it was.
function assertRejected(net, fn) {
  const before = exportNet(net);
  assert.throws(fn, isRejection);
  assert.equal(exportNet(net), before);
}

describe('ids and labels', () => {
  test('places get ids p1, p2, ... and transitions t1, t2, ...', () => {
    const net = createNet();
    assert.equal(addPlace(net, { x: 0, y: 0 }), 'p1');
    assert.equal(addTransition(net, { x: 0, y: 0 }), 't1');
    assert.equal(addPlace(net, { x: 0, y: 0 }), 'p2');
    assert.equal(addTransition(net, { x: 0, y: 0 }), 't2');
  });

  test('ids are never reused after a deletion', () => {
    const net = createNet();
    addPlace(net, { x: 0, y: 0 });
    const p2 = addPlace(net, { x: 0, y: 0 });
    const t1 = addTransition(net, { x: 0, y: 0 });
    remove(net, p2);
    remove(net, t1);
    assert.equal(addPlace(net, { x: 0, y: 0 }), 'p3');
    assert.equal(addTransition(net, { x: 0, y: 0 }), 't2');
  });

  test('after an import, numbering continues above the highest imported id', () => {
    const net = importNet(JSON.stringify({
      format: 'petri-modeler', version: 1,
      places: [
        { id: 'p1', label: 'a', x: 0, y: 0, tokens: 0 },
        { id: 'p10', label: 'b', x: 0, y: 0, tokens: 0 },
        { id: 'p9', label: 'c', x: 0, y: 0, tokens: 0 },
      ],
      transitions: [{ id: 't3', label: 'd', x: 0, y: 0 }],
      arcs: [],
    }));
    assert.equal(addPlace(net, { x: 0, y: 0 }), 'p11');
    assert.equal(addTransition(net, { x: 0, y: 0 }), 't4');
  });

  test('default label is the id; default tokens are 0', () => {
    const net = createNet();
    const p = addPlace(net, { x: 10, y: 20 });
    const t = addTransition(net, { x: 30, y: 40 });
    assert.deepEqual(place(net, p), { id: p, label: p, x: 10, y: 20, tokens: 0 });
    assert.deepEqual(transition(net, t), { id: t, label: t, x: 30, y: 40 });
  });

  test('addPlace and addTransition accept a label; addPlace accepts tokens', () => {
    const net = createNet();
    const p = addPlace(net, { x: 0, y: 0, label: 'start', tokens: 2 });
    const t = addTransition(net, { x: 0, y: 0, label: 'register' });
    assert.equal(place(net, p).label, 'start');
    assert.equal(place(net, p).tokens, 2);
    assert.equal(transition(net, t).label, 'register');
  });

  test('an empty label given on creation stays empty', () => {
    const net = createNet();
    const p = addPlace(net, { x: 0, y: 0, label: '' });
    const t = addTransition(net, { x: 0, y: 0, label: '' });
    assert.equal(place(net, p).label, '');
    assert.equal(transition(net, t).label, '');
  });

  test('setLabel accepts empty and repeated labels', () => {
    const net = createNet();
    const p1 = addPlace(net, { x: 0, y: 0 });
    const p2 = addPlace(net, { x: 0, y: 0 });
    const t1 = addTransition(net, { x: 0, y: 0 });
    setLabel(net, p1, '');
    setLabel(net, p2, 'same');
    setLabel(net, t1, 'same');
    assert.equal(place(net, p1).label, '');
    assert.equal(place(net, p2).label, 'same');
    assert.equal(transition(net, t1).label, 'same');
  });

  test('setLabel on an unknown id throws and changes nothing', () => {
    const net = createNet();
    addPlace(net, { x: 0, y: 0 });
    assertRejected(net, () => setLabel(net, 'p9', 'x'));
  });

  test('move changes the position of a place and of a transition', () => {
    const net = createNet();
    const p = addPlace(net, { x: 0, y: 0 });
    const t = addTransition(net, { x: 0, y: 0 });
    move(net, p, 100, 200);
    move(net, t, 300, 400);
    assert.deepEqual([place(net, p).x, place(net, p).y], [100, 200]);
    assert.deepEqual([transition(net, t).x, transition(net, t).y], [300, 400]);
  });

  test('move on an unknown id throws and changes nothing', () => {
    const net = createNet();
    addPlace(net, { x: 0, y: 0 });
    assertRejected(net, () => move(net, 't1', 1, 1));
  });
});

describe('tokens (initial marking)', () => {
  test('setTokens sets the initial tokens of a place, 0 included', () => {
    const net = createNet();
    const p = addPlace(net, { x: 0, y: 0 });
    setTokens(net, p, 7);
    assert.equal(place(net, p).tokens, 7);
    setTokens(net, p, 0);
    assert.equal(place(net, p).tokens, 0);
  });

  test('tokens are allowed on any place', () => {
    const net = createNet();
    const p1 = addPlace(net, { x: 0, y: 0 });
    const p2 = addPlace(net, { x: 0, y: 0 });
    const t1 = addTransition(net, { x: 0, y: 0 });
    addArc(net, p1, t1);
    addArc(net, t1, p2);
    setTokens(net, p1, 1);
    setTokens(net, p2, 3);
    assert.deepEqual(initialMarking(net), { [p1]: 1, [p2]: 3 });
  });

  for (const n of [-1, 1.5, '2', NaN, null]) {
    test(`setTokens with ${typeof n === 'string' ? `"${n}"` : String(n)} throws and changes nothing`, () => {
      const net = createNet();
      const p = addPlace(net, { x: 0, y: 0, tokens: 1 });
      assertRejected(net, () => setTokens(net, p, n));
    });
  }

  test('addPlace with negative or non-integer tokens throws and changes nothing', () => {
    const net = createNet();
    assertRejected(net, () => addPlace(net, { x: 0, y: 0, tokens: -1 }));
    assertRejected(net, () => addPlace(net, { x: 0, y: 0, tokens: 0.5 }));
    assert.equal(addPlace(net, { x: 0, y: 0 }), 'p1');
  });

  test('setTokens on an unknown id or on a transition throws and changes nothing', () => {
    const net = createNet();
    const t = addTransition(net, { x: 0, y: 0 });
    assertRejected(net, () => setTokens(net, 'p1', 1));
    assertRejected(net, () => setTokens(net, t, 1));
  });
});

describe('arcs', () => {
  test('place→transition and transition→place are accepted', () => {
    const net = createNet();
    const p1 = addPlace(net, { x: 0, y: 0 });
    const t1 = addTransition(net, { x: 0, y: 0 });
    const p2 = addPlace(net, { x: 0, y: 0 });
    addArc(net, p1, t1);
    addArc(net, t1, p2);
    assert.deepEqual(arcs(net), [
      { source: p1, target: t1 },
      { source: t1, target: p2 },
    ]);
  });

  test('place→place is rejected and the net is unchanged', () => {
    const net = createNet();
    const p1 = addPlace(net, { x: 0, y: 0 });
    const p2 = addPlace(net, { x: 0, y: 0 });
    assertRejected(net, () => addArc(net, p1, p2));
  });

  test('transition→transition is rejected and the net is unchanged', () => {
    const net = createNet();
    const t1 = addTransition(net, { x: 0, y: 0 });
    const t2 = addTransition(net, { x: 0, y: 0 });
    assertRejected(net, () => addArc(net, t1, t2));
  });

  test('a second arc for the same ordered pair is rejected and the net is unchanged', () => {
    const net = createNet();
    const p1 = addPlace(net, { x: 0, y: 0 });
    const t1 = addTransition(net, { x: 0, y: 0 });
    addArc(net, p1, t1);
    assertRejected(net, () => addArc(net, p1, t1));
  });

  test('opposite arcs p1→t1 and t1→p1 may both exist', () => {
    const net = createNet();
    const p1 = addPlace(net, { x: 0, y: 0 });
    const t1 = addTransition(net, { x: 0, y: 0 });
    addArc(net, p1, t1);
    addArc(net, t1, p1);
    assert.deepEqual(arcs(net), [
      { source: p1, target: t1 },
      { source: t1, target: p1 },
    ]);
  });

  test('an arc to or from an unknown node is rejected and the net is unchanged', () => {
    const net = createNet();
    const p1 = addPlace(net, { x: 0, y: 0 });
    const t1 = addTransition(net, { x: 0, y: 0 });
    assertRejected(net, () => addArc(net, p1, 't9'));
    assertRejected(net, () => addArc(net, 'p9', t1));
  });
});

describe('deletion', () => {
  test('deleting a place deletes its input and output arcs', () => {
    const net = createNet();
    const p1 = addPlace(net, { x: 0, y: 0 });
    const t1 = addTransition(net, { x: 0, y: 0 });
    const t2 = addTransition(net, { x: 0, y: 0 });
    const p2 = addPlace(net, { x: 0, y: 0 });
    addArc(net, t1, p1);
    addArc(net, p1, t2);
    addArc(net, t2, p2);
    remove(net, p1);
    assert.equal(place(net, p1), undefined);
    assert.deepEqual(arcs(net), [{ source: t2, target: p2 }]);
  });

  test('deleting a transition deletes its input and output arcs', () => {
    const net = createNet();
    const p1 = addPlace(net, { x: 0, y: 0 });
    const t1 = addTransition(net, { x: 0, y: 0 });
    const p2 = addPlace(net, { x: 0, y: 0 });
    const t2 = addTransition(net, { x: 0, y: 0 });
    addArc(net, p1, t1);
    addArc(net, t1, p2);
    addArc(net, p2, t2);
    remove(net, t1);
    assert.equal(transition(net, t1), undefined);
    assert.deepEqual(arcs(net), [{ source: p2, target: t2 }]);
  });

  test('deleting an arc leaves its nodes and the marking unchanged', () => {
    const net = createNet();
    const p1 = addPlace(net, { x: 0, y: 0, tokens: 2 });
    const t1 = addTransition(net, { x: 0, y: 0 });
    const arc = addArc(net, p1, t1);
    remove(net, arc);
    assert.deepEqual(arcs(net), []);
    assert.deepEqual(place(net, p1), { id: p1, label: p1, x: 0, y: 0, tokens: 2 });
    assert.deepEqual(transition(net, t1), { id: t1, label: t1, x: 0, y: 0 });
    assert.deepEqual(initialMarking(net), { [p1]: 2 });
  });

  test('arcId gives the id addArc returned, so an existing arc can be deleted', () => {
    const net = createNet();
    const p1 = addPlace(net, { x: 0, y: 0 });
    const t1 = addTransition(net, { x: 0, y: 0 });
    const arc = addArc(net, p1, t1);
    addArc(net, t1, p1);
    assert.equal(arcId(p1, t1), arc);
    remove(net, arcId(t1, p1));
    assert.deepEqual(arcs(net), [{ source: p1, target: t1 }]);
  });

  test('deleting a node in a self-loop deletes both arcs', () => {
    const net = createNet();
    const p1 = addPlace(net, { x: 0, y: 0 });
    const t1 = addTransition(net, { x: 0, y: 0 });
    addArc(net, p1, t1);
    addArc(net, t1, p1);
    remove(net, t1);
    assert.deepEqual(arcs(net), []);
  });

  test('a deleted place is no longer in the initial marking', () => {
    const net = createNet();
    const p1 = addPlace(net, { x: 0, y: 0, tokens: 1 });
    const p2 = addPlace(net, { x: 0, y: 0, tokens: 2 });
    remove(net, p1);
    assert.deepEqual(initialMarking(net), { [p2]: 2 });
  });

  test('removing an arc that is already gone throws and changes nothing', () => {
    const net = createNet();
    const p1 = addPlace(net, { x: 0, y: 0 });
    const t1 = addTransition(net, { x: 0, y: 0 });
    const a1 = addArc(net, p1, t1);
    remove(net, a1);
    assertRejected(net, () => remove(net, a1));
    const p2 = addPlace(net, { x: 0, y: 0 });
    const a2 = addArc(net, p2, t1);
    remove(net, p2);
    assertRejected(net, () => remove(net, a2));
  });

  test('removing an unknown id throws and changes nothing', () => {
    const net = createNet();
    addPlace(net, { x: 0, y: 0 });
    assertRejected(net, () => remove(net, 'p9'));
  });
});

describe('play: enabling and firing', () => {
  test('initialMarking lists every place, zeros included', () => {
    const net = createNet();
    const p1 = addPlace(net, { x: 0, y: 0, tokens: 1 });
    const p2 = addPlace(net, { x: 0, y: 0 });
    addTransition(net, { x: 0, y: 0 });
    assert.deepEqual(initialMarking(net), { [p1]: 1, [p2]: 0 });
  });

  test('t is enabled iff every input place has at least one token', () => {
    const net = createNet();
    const p1 = addPlace(net, { x: 0, y: 0, tokens: 1 });
    const p2 = addPlace(net, { x: 0, y: 0 });
    const t1 = addTransition(net, { x: 0, y: 0 });
    addArc(net, p1, t1);
    addArc(net, p2, t1);
    assert.equal(isEnabled(net, initialMarking(net), t1), false);
    setTokens(net, p2, 1);
    assert.equal(isEnabled(net, initialMarking(net), t1), true);
  });

  test('a transition with no input places is always enabled', () => {
    const net = createNet();
    const t1 = addTransition(net, { x: 0, y: 0 });
    assert.equal(isEnabled(net, initialMarking(net), t1), true);
    const p1 = addPlace(net, { x: 0, y: 0 });
    addArc(net, t1, p1);
    let m = initialMarking(net);
    assert.equal(isEnabled(net, m, t1), true);
    m = fire(net, m, t1);
    m = fire(net, m, t1);
    assert.deepEqual(m, { [p1]: 2 });
  });

  test('SPEC example: M = {p1:1, p2:0, p3:0}, •t1 = {p1}, t1• = {p2, p3} gives {p1:0, p2:1, p3:1}', () => {
    const net = createNet();
    const p1 = addPlace(net, { x: 0, y: 0, tokens: 1 });
    const p2 = addPlace(net, { x: 0, y: 0 });
    const p3 = addPlace(net, { x: 0, y: 0 });
    const t1 = addTransition(net, { x: 0, y: 0 });
    addArc(net, p1, t1);
    addArc(net, t1, p2);
    addArc(net, t1, p3);
    assert.deepEqual(fire(net, initialMarking(net), t1), { [p1]: 0, [p2]: 1, [p3]: 1 });
  });

  test('firing removes exactly one token per input place and adds one per output place', () => {
    const net = createNet();
    const p1 = addPlace(net, { x: 0, y: 0, tokens: 3 });
    const p2 = addPlace(net, { x: 0, y: 0, tokens: 1 });
    const p3 = addPlace(net, { x: 0, y: 0, tokens: 2 });
    const p4 = addPlace(net, { x: 0, y: 0, tokens: 5 });
    const t1 = addTransition(net, { x: 0, y: 0 });
    addArc(net, p1, t1);
    addArc(net, p2, t1);
    addArc(net, t1, p3);
    assert.deepEqual(fire(net, initialMarking(net), t1),
      { [p1]: 2, [p2]: 0, [p3]: 3, [p4]: 5 });
  });

  test('self-loop: t needs a token in p and p keeps it after firing', () => {
    const net = createNet();
    const p1 = addPlace(net, { x: 0, y: 0 });
    const p2 = addPlace(net, { x: 0, y: 0 });
    const t1 = addTransition(net, { x: 0, y: 0 });
    addArc(net, p1, t1);
    addArc(net, t1, p1);
    addArc(net, t1, p2);
    assert.equal(isEnabled(net, initialMarking(net), t1), false);
    assert.throws(() => fire(net, initialMarking(net), t1), isRejection);
    setTokens(net, p1, 1);
    assert.deepEqual(fire(net, initialMarking(net), t1), { [p1]: 1, [p2]: 1 });
  });

  test('firing a disabled transition throws and keeps the marking', () => {
    const net = createNet();
    const p1 = addPlace(net, { x: 0, y: 0 });
    const p2 = addPlace(net, { x: 0, y: 0 });
    const t1 = addTransition(net, { x: 0, y: 0 });
    addArc(net, p1, t1);
    addArc(net, t1, p2);
    const before = exportNet(net);
    const m = initialMarking(net);
    assert.throws(() => fire(net, m, t1), isRejection);
    assert.deepEqual(m, { [p1]: 0, [p2]: 0 });
    assert.equal(exportNet(net), before);
  });

  test('enabling is decided by the given marking, not by the initial one', () => {
    const net = createNet();
    const p1 = addPlace(net, { x: 0, y: 0, tokens: 1 });
    const p2 = addPlace(net, { x: 0, y: 0 });
    const t1 = addTransition(net, { x: 0, y: 0 });
    const t2 = addTransition(net, { x: 0, y: 0 });
    addArc(net, p1, t1);
    addArc(net, t1, p2);
    addArc(net, p2, t2);
    const m1 = fire(net, initialMarking(net), t1);
    assert.equal(isEnabled(net, m1, t1), false);
    assert.equal(isEnabled(net, m1, t2), true);
    assert.deepEqual(enabledTransitions(net, m1), [t2]);
    assert.throws(() => fire(net, m1, t1), isRejection);
    assert.deepEqual(fire(net, m1, t2), { [p1]: 0, [p2]: 0 });
  });

  test('fire returns a new marking: M, the initial marking and the net are not modified', () => {
    const net = createNet();
    const p1 = addPlace(net, { x: 0, y: 0, tokens: 1 });
    const p2 = addPlace(net, { x: 0, y: 0 });
    const t1 = addTransition(net, { x: 0, y: 0 });
    addArc(net, p1, t1);
    addArc(net, t1, p2);
    const before = exportNet(net);
    const m = initialMarking(net);
    const m2 = fire(net, m, t1);
    assert.deepEqual(m, { [p1]: 1, [p2]: 0 });
    assert.deepEqual(m2, { [p1]: 0, [p2]: 1 });
    assert.deepEqual(initialMarking(net), { [p1]: 1, [p2]: 0 });
    assert.equal(exportNet(net), before);
  });

  test('enabledTransitions: in a conflict both are enabled; after firing one, none is', () => {
    const net = createNet();
    const p1 = addPlace(net, { x: 0, y: 0, tokens: 1 });
    const p2 = addPlace(net, { x: 0, y: 0 });
    const t1 = addTransition(net, { x: 0, y: 0 });
    const t2 = addTransition(net, { x: 0, y: 0 });
    const t3 = addTransition(net, { x: 0, y: 0 });
    addArc(net, p1, t1);
    addArc(net, p1, t2);
    addArc(net, p2, t3);
    const m = initialMarking(net);
    assert.ok(Array.isArray(enabledTransitions(net, m)));
    assert.deepEqual(sorted(enabledTransitions(net, m)), [t1, t2]);
    assert.deepEqual(enabledTransitions(net, fire(net, m, t1)), []);
  });

  test('enabledTransitions includes a transition with no input places', () => {
    const net = createNet();
    const p1 = addPlace(net, { x: 0, y: 0 });
    const t1 = addTransition(net, { x: 0, y: 0 });
    const t2 = addTransition(net, { x: 0, y: 0 });
    addArc(net, p1, t2);
    assert.deepEqual(enabledTransitions(net, initialMarking(net)), [t1]);
  });

  test('isEnabled and fire on an unknown id or on a place throw and change nothing', () => {
    const net = createNet();
    const p1 = addPlace(net, { x: 0, y: 0, tokens: 1 });
    const before = exportNet(net);
    const m = initialMarking(net);
    for (const id of ['t9', p1]) {
      assert.throws(() => isEnabled(net, m, id), isRejection);
      assert.throws(() => fire(net, m, id), isRejection);
    }
    assert.deepEqual(m, { [p1]: 1 });
    assert.equal(exportNet(net), before);
  });

  test('the net is plain data: a structuredClone behaves the same and is independent', () => {
    const net = createNet();
    const p1 = addPlace(net, { x: 0, y: 0, tokens: 1 });
    const t1 = addTransition(net, { x: 0, y: 0 });
    addArc(net, p1, t1);
    const copy = structuredClone(net);
    assert.equal(exportNet(copy), exportNet(net));
    assert.equal(addPlace(copy, { x: 0, y: 0 }), 'p2');
    assert.deepEqual(fire(copy, initialMarking(copy), t1), { [p1]: 0, p2: 0 });
    assert.deepEqual(initialMarking(net), { [p1]: 1 });
    assert.equal(addPlace(net, { x: 0, y: 0 }), 'p2');
  });
});

describe('JSON import and export', () => {
  const sample = {
    format: 'petri-modeler',
    version: 1,
    places: [{ id: 'p1', label: 'start', x: 100, y: 200, tokens: 1 }],
    transitions: [{ id: 't1', label: 'register', x: 220, y: 200 }],
    arcs: [{ source: 'p1', target: 't1' }],
  };
  const withChange = (change) => {
    const doc = structuredClone(sample);
    change(doc);
    return JSON.stringify(doc);
  };

  test('exportNet writes the SPEC format', () => {
    const net = createNet();
    const p1 = addPlace(net, { x: 100, y: 200, label: 'start', tokens: 1 });
    const t1 = addTransition(net, { x: 220, y: 200, label: 'register' });
    addArc(net, p1, t1);
    assert.deepEqual(view(net), sample);
  });

  test('importNet reads the SPEC example', () => {
    const net = importNet(JSON.stringify(sample));
    assert.deepEqual(view(net), sample);
    assert.deepEqual(initialMarking(net), { p1: 1 });
  });

  test('importNet(exportNet(net)) gives the same net', () => {
    const net = createNet();
    const p1 = addPlace(net, { x: 1, y: 2, label: '', tokens: 3 });
    const p2 = addPlace(net, { x: 3, y: 4, label: 'same' });
    const t1 = addTransition(net, { x: 5, y: 6, label: 'same' });
    const t2 = addTransition(net, { x: 7, y: 8 });
    addArc(net, p1, t1);
    addArc(net, t1, p1);
    addArc(net, t1, p2);
    addArc(net, p2, t2);
    const p3 = addPlace(net, { x: 9, y: 9 });
    addPlace(net, { x: 9, y: 9 });
    remove(net, p3);
    const copy = importNet(exportNet(net));
    assert.deepEqual(view(copy), view(net));
    assert.deepEqual(initialMarking(copy), initialMarking(net));
    assert.equal(addPlace(copy, { x: 0, y: 0 }), 'p5');
  });

  test('an empty net round-trips', () => {
    const net = createNet();
    assert.deepEqual(view(importNet(exportNet(net))), view(net));
  });

  const invalid = {
    'invalid JSON': '{"format": "petri-modeler",',
    'not an object': '[]',
    'wrong format': withChange((d) => { d.format = 'pnml'; }),
    'missing format': withChange((d) => { delete d.format; }),
    'wrong version': withChange((d) => { d.version = 2; }),
    'missing version': withChange((d) => { delete d.version; }),
    'missing places': withChange((d) => { delete d.places; }),
    'missing transitions': withChange((d) => { delete d.transitions; }),
    'missing arcs': withChange((d) => { delete d.arcs; }),
    'place without x': withChange((d) => { delete d.places[0].x; }),
    'place without y': withChange((d) => { delete d.places[0].y; }),
    'place without label': withChange((d) => { delete d.places[0].label; }),
    'place without tokens': withChange((d) => { delete d.places[0].tokens; }),
    'transition without id': withChange((d) => { delete d.transitions[0].id; }),
    'transition without label': withChange((d) => { delete d.transitions[0].label; }),
    'transition without x': withChange((d) => { delete d.transitions[0].x; }),
    'transition without y': withChange((d) => { delete d.transitions[0].y; }),
    'arc without source': withChange((d) => { delete d.arcs[0].source; }),
    'arc without target': withChange((d) => { delete d.arcs[0].target; }),
    'duplicate place id': withChange((d) => { d.places.push({ ...d.places[0] }); }),
    'duplicate transition id': withChange((d) => { d.transitions.push({ ...d.transitions[0] }); }),
    'same id for a place and a transition': withChange((d) => { d.transitions[0].id = 'p1'; d.arcs = []; }),
    'place id not of the form p<n>': withChange((d) => { d.places[0].id = 'start'; d.arcs[0].source = 'start'; }),
    'place id of the form t<n>': withChange((d) => { d.places[0].id = 't5'; d.arcs[0].source = 't5'; }),
    'transition id not of the form t<n>': withChange((d) => { d.transitions[0].id = 'end'; d.arcs[0].target = 'end'; }),
    'place id p0': withChange((d) => { d.places[0].id = 'p0'; d.arcs[0].source = 'p0'; }),
    'arc to an unknown node': withChange((d) => { d.arcs[0].target = 't9'; }),
    'arc from an unknown node': withChange((d) => { d.arcs[0].source = 'p9'; }),
    'place→place arc': withChange((d) => {
      d.places.push({ id: 'p2', label: 'p2', x: 0, y: 0, tokens: 0 });
      d.arcs.push({ source: 'p1', target: 'p2' });
    }),
    'transition→transition arc': withChange((d) => {
      d.transitions.push({ id: 't2', label: 't2', x: 0, y: 0 });
      d.arcs.push({ source: 't1', target: 't2' });
    }),
    'duplicate arc': withChange((d) => { d.arcs.push({ source: 'p1', target: 't1' }); }),
    'negative tokens': withChange((d) => { d.places[0].tokens = -1; }),
    'non-integer tokens': withChange((d) => { d.places[0].tokens = 1.5; }),
    'tokens as a string': withChange((d) => { d.places[0].tokens = '1'; }),
  };
  for (const [name, text] of Object.entries(invalid)) {
    test(`importNet rejects ${name} with a message`, () => {
      assert.throws(() => importNet(text), isRejection);
    });
  }
});
