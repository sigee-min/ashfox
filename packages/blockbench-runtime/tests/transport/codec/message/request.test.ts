import assert from 'node:assert/strict';

import { isSidecarMessage } from '../../../../src/transport/protocol';

{
  assert.equal(
    isSidecarMessage({ type: 'request', id: '', tool: 'list_capabilities', ts: 1 }),
    false,
  );
  assert.equal(
    isSidecarMessage({ type: 'request', id: 'r1', tool: 'list_capabilities', ts: 1 }),
    false,
  );
  assert.equal(
    isSidecarMessage({
      type: 'request',
      id: 'r1',
      tool: 'list_capabilities',
      payload: {},
      ts: 1,
    }),
    true,
  );
  assert.equal(
    isSidecarMessage({
      type: 'request',
      id: 'r1',
      tool: 'not_a_tool',
      payload: {},
      ts: 1,
    }),
    false,
  );
  for (const payload of [
    {
      clip: 'walk',
      channel: 'sound',
      keys: [{ time: 0, value: 123 }],
    },
    {
      target: {},
      op: { op: 'set_pixel', x: 0, y: 0, color: '#ffffff' },
    },
    {
      target: { cubeName: 'body' },
      op: { op: 'fill_rect' },
    },
  ]) {
    assert.equal(
      isSidecarMessage({
        type: 'request',
        id: 'schema-domain-gap',
        tool: 'clip' in payload ? 'set_trigger_keyframes' : 'paint_faces',
        payload,
        ts: 1,
      }),
      false,
    );
  }
  for (const op of [
    { op: 'set_pixel', x: 0, y: 0, color: '#ffffff' },
    {
      op: 'fill_rect',
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      color: '#ffffffff',
    },
    {
      op: 'draw_rect',
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      color: '#ffffff',
    },
    {
      op: 'draw_line',
      x1: 0,
      y1: 0,
      x2: 1,
      y2: 1,
      color: '#ffffffff',
    },
  ]) {
    assert.equal(
      isSidecarMessage({
        type: 'request',
        id: 'valid-texture-op',
        tool: 'paint_faces',
        payload: { target: { cubeName: 'body' }, op },
        ts: 1,
      }),
      true,
      op.op,
    );
  }
  for (const op of [
    { op: 'set_pixel', x: 0, y: 0, color: '#ffffff', extra: false },
    {
      op: 'fill_rect',
      x: 0,
      y: 0,
      width: -1,
      height: 1,
      color: '#ffffff',
    },
    {
      op: 'draw_line',
      x1: 0,
      y1: 0,
      x2: 1,
      y2: 1,
      color: '#ffffff',
      lineWidth: -99,
    },
    {
      op: 'fill_rect',
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      color: '#ffffff',
      extra: true,
    },
  ]) {
    assert.equal(
      isSidecarMessage({
        type: 'request',
        id: 'invalid-texture-op',
        tool: 'paint_faces',
        payload: { target: { cubeName: 'body' }, op },
        ts: 1,
      }),
      false,
      op.op,
    );
  }
  for (const color of ['', '#fff', '#xyz', 'ffffff']) {
    assert.equal(
      isSidecarMessage({
        type: 'request',
        id: 'invalid-texture-color',
        tool: 'paint_faces',
        payload: {
          target: { cubeName: 'body' },
          op: { op: 'set_pixel', x: 0, y: 0, color },
        },
        ts: 1,
      }),
      false,
      color,
    );
  }
  assert.equal(
    isSidecarMessage({
      type: 'request',
      id: 'r1',
      tool: 'set_frame_pose',
      payload: {
        clip: 'walk',
        frame: 0,
        bones: [{ name: 'root' }],
      },
      ts: 1,
    }),
    false,
  );
  for (const inheritedName of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    assert.equal(
      isSidecarMessage({
        type: 'request',
        id: 'r1',
        tool: 'list_capabilities',
        payload: JSON.parse(`{"${inheritedName}":true}`),
        ts: 1,
      }),
      false,
      inheritedName,
    );
  }
  assert.equal(
    isSidecarMessage({
      type: 'request',
      id: 'r1',
      tool: 'add_mesh',
      payload: {
        name: 'mesh',
        uvPolicy: { symmetryAxis: 'x', texelDensity: -1, padding: 999 },
        vertices: [
          { id: 'a', pos: [0, 0, 0] },
          { id: 'b', pos: [1, 0, 0] },
          { id: 'c', pos: [0, 1, 0] },
        ],
        faces: [{ vertices: ['a', 'b', 'c'] }],
      },
      ts: 1,
    }),
    false,
  );
  assert.equal(
    isSidecarMessage({
      type: 'request',
      id: 'r1',
      tool: 'list_capabilities',
      payload: 7,
      ts: 1,
    }),
    false,
  );
  assert.equal(
    isSidecarMessage({
      type: 'request',
      id: 'r1',
      tool: 'list_capabilities',
      payload: { unexpected: true },
      ts: 1,
    }),
    false,
  );
  assert.equal(
    isSidecarMessage({
      type: 'request',
      id: 'r1',
      tool: 'reload_plugins',
      payload: {},
      ts: 1,
    }),
    false,
  );
  assert.equal(
    isSidecarMessage({
      type: 'request',
      id: 'r1',
      tool: 'reload_plugins',
      payload: { confirm: false },
      ts: 1,
    }),
    false,
  );
  assert.equal(
    isSidecarMessage({
      type: 'request',
      id: 'r1',
      tool: 'reload_plugins',
      payload: { confirm: true },
      ts: 1,
    }),
    true,
  );
  assert.equal(
    isSidecarMessage({
      type: 'request',
      id: 'r1',
      tool: 'list_capabilities',
      payload: {},
      extra: true,
      ts: 1,
    }),
    false,
  );
}
