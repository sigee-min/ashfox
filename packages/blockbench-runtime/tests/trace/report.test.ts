import assert from 'node:assert/strict';

import {
  isTraceLogHeader,
  isTraceLogEntry,
  TRACE_LOG_SCHEMA_VERSION,
} from '@ashfox/blockbench-contracts/types/traceLog';

import { buildTraceLogReport } from '../../src/trace/report';

const line = (value: unknown): string => JSON.stringify(value);
const header = (
  schemaVersion: number = TRACE_LOG_SCHEMA_VERSION,
  createdAt = '2026-01-01T00:00:00.000Z',
): string => line({ kind: 'header', schemaVersion, createdAt });
const zeroCounts = () => ({ added: 0, removed: 0, changed: 0 });
const diff = (changedKind: 'cubes' | 'textures') => ({
  sinceRevision: changedKind === 'cubes' ? 'r0' : 'r1',
  currentRevision: changedKind === 'cubes' ? 'r1' : 'r2',
  counts: {
    bones: zeroCounts(),
    cubes: {
      ...zeroCounts(),
      changed: changedKind === 'cubes' ? 1 : 0,
    },
    textures: {
      ...zeroCounts(),
      changed: changedKind === 'textures' ? 2 : 0,
    },
    animations: zeroCounts(),
  },
});
const state = (revision: string) => ({
  id: 'project',
  revision,
  name: null,
  format: null,
  counts: {
    bones: 0,
    cubes: 0,
    meshes: 0,
    meshVertices: 0,
    meshFaces: 0,
    textures: 0,
    animations: 0,
  },
});

{
  const report = buildTraceLogReport('');
  assert.equal(report.schemaVersion, TRACE_LOG_SCHEMA_VERSION);
  assert.equal(report.steps, 0);
  assert.equal(report.errors, 1);
  assert.equal(report.routes.tool, 0);
  assert.equal(report.lastError?.op, 'parse');
  assert.equal(report.lastError?.code, 'invalid_payload');
}

{
  const sparse = new Array(1);
  const sparseTuple = new Array(3);
  assert.equal(
    isTraceLogHeader({
      kind: 'header',
      schemaVersion: TRACE_LOG_SCHEMA_VERSION,
      createdAt: '2026-01-01T00:00:00.000Z',
      notes: sparse,
    }),
    false,
  );
  assert.equal(
    isTraceLogEntry({
      kind: 'step',
      seq: 1,
      ts: '2026-01-01T00:00:01.000Z',
      route: 'tool',
      op: 'sparse-state',
      response: { ok: true },
      state: {
        id: 'project',
        active: true,
        name: null,
        format: null,
        revision: 'r1',
        counts: {
          bones: 1,
          cubes: 0,
          textures: 0,
          animations: 0,
        },
        bones: [{ name: 'root', pivot: sparseTuple }],
      },
    }),
    false,
  );
}

{
  const report = buildTraceLogReport(header(2));
  assert.equal(report.schemaVersion, TRACE_LOG_SCHEMA_VERSION);
  assert.equal(report.steps, 0);
  assert.equal(report.errors, 1);
  assert.equal(report.lastError?.code, 'invalid_payload');
  assert.match(report.warnings?.[0] ?? '', new RegExp(`must be v${TRACE_LOG_SCHEMA_VERSION}`));
}

{
  const report = buildTraceLogReport(
    [
      line({
        kind: 'step',
        seq: 1,
        ts: '2026-01-01T00:00:00.000Z',
        route: 'tool',
        op: 'noop',
        response: { ok: true },
      }),
      header(TRACE_LOG_SCHEMA_VERSION, '2026-01-01T00:00:01.000Z'),
    ].join('\n'),
  );
  assert.equal(report.steps, 0);
  assert.equal(report.errors, 1);
  assert.equal(report.lastError?.code, 'invalid_payload');
}

{
  const report = buildTraceLogReport(
    [header(2), header(TRACE_LOG_SCHEMA_VERSION, '2026-01-01T00:00:01.000Z')].join('\n'),
  );
  assert.equal(report.steps, 0);
  assert.equal(report.errors, 1);
  assert.equal(report.lastError?.code, 'invalid_payload');
}

{
  const malformedSteps = [
    { kind: 'step' },
    {
      kind: 'step',
      seq: 1,
      ts: '2026-01-01T00:00:01.000Z',
      route: 'tool',
      op: 'unknown-field',
      response: { ok: true },
      extra: true,
    },
    {
      kind: 'step',
      seq: 2,
      ts: '2026-01-01T00:00:02.000Z',
      route: 'tool',
      op: 'bad-diff',
      response: { ok: true },
      diff: {},
    },
    {
      kind: 'step',
      seq: 3,
      ts: '2026-01-01T00:00:03.000Z',
      route: 'tool',
      op: 'missing-failure-error',
      response: { ok: false },
    },
    {
      kind: 'step',
      seq: 4,
      ts: '2026-01-01T00:00:04.000Z',
      route: 'tool',
      op: 'mixed-success-response',
      response: {
        ok: true,
        error: { code: 'unknown', message: 'must not coexist' },
      },
    },
    {
      kind: 'step',
      seq: 5,
      ts: '2026-01-01T00:00:05.000Z',
      route: 'tool',
      op: 'unknown-error-code',
      response: {
        ok: false,
        error: { code: 'invented', message: 'not in the contract' },
      },
    },
    {
      kind: 'step',
      seq: 6,
      ts: '2026-01-01T00:00:06.000Z',
      route: 'tool',
      op: 'invalid-full-state',
      response: { ok: true },
      state: {
        id: 'project',
        active: true,
        name: null,
        format: null,
        revision: 'r1',
        counts: {
          bones: 1,
          cubes: 0,
          textures: 0,
          animations: 0,
        },
        bones: [{ name: 'root', pivot: [0, 0, 0], extra: true }],
      },
    },
    {
      kind: 'step',
      seq: 7,
      ts: '2026-01-01T00:00:07.000Z',
      route: 'tool',
      op: 'invalid-full-diff',
      response: { ok: true },
      diff: {
        ...diff('cubes'),
        cubes: {
          added: [{ key: 'cube', item: { name: 'missing-shape' } }],
          removed: [],
          changed: [],
        },
      },
    },
    {
      kind: 'step',
      seq: 8,
      ts: '2026-01-01T00:00:08.000Z',
      route: 'tool',
      op: 'mismatched-state-count',
      response: { ok: true },
      state: {
        id: 'project',
        active: true,
        name: null,
        format: null,
        revision: 'r1',
        counts: {
          bones: 2,
          cubes: 0,
          textures: 0,
          animations: 0,
        },
        bones: [{ name: 'root', pivot: [0, 0, 0] }],
      },
    },
    {
      kind: 'step',
      seq: 9,
      ts: '2026-01-01T00:00:09.000Z',
      route: 'tool',
      op: 'mismatched-diff-count',
      response: { ok: true },
      diff: {
        ...diff('textures'),
        textures: {
          added: [],
          removed: [],
          changed: [],
        },
      },
    },
  ];
  malformedSteps.forEach((entry) => {
    assert.equal(isTraceLogEntry(entry), false);
  });
  const report = buildTraceLogReport([header(), ...malformedSteps.map(line)].join('\n'));
  assert.equal(report.steps, 0);
  assert.equal(report.errors, 0);
  assert.equal(report.warnings?.length, malformedSteps.length);
}

{
  assert.equal(
    isTraceLogEntry({
      kind: 'step',
      seq: 1,
      ts: '2026-01-01T00:00:01.000Z',
      route: 'tool',
      op: 'non-finite-details',
      response: {
        ok: false,
        error: {
          code: 'unknown',
          message: 'boom',
          details: { value: Number.NaN },
        },
      },
    }),
    false,
  );
}

{
  const step = (seq: number, ts: string) =>
    line({
      kind: 'step',
      seq,
      ts,
      route: 'tool',
      op: `step-${seq}`,
      response: { ok: true },
    });
  const report = buildTraceLogReport(
    [
      header(),
      step(2, '2026-01-01T00:00:02.000Z'),
      step(2, '2026-01-01T00:00:03.000Z'),
      step(1, '2026-01-01T00:00:04.000Z'),
      step(4, '2026-01-01T00:00:05.000Z'),
    ].join('\n'),
  );
  assert.equal(report.steps, 2);
  assert.equal(report.warnings?.length, 3);
  assert.deepEqual(Object.keys(report.ops), ['step-2', 'step-4']);
}

{
  const state = {
    id: 'project',
    revision: 'r1',
    name: null,
    format: null,
    counts: {
      bones: 0,
      cubes: 0,
      textures: 0,
      animations: 0,
    },
  };
  const error = { code: 'unknown', message: 'failed' };
  const baseStep = {
    kind: 'step',
    seq: 1,
    ts: '2026-01-01T00:00:01.000Z',
    route: 'tool',
    op: 'branch-contract',
    response: { ok: true },
  };
  assert.equal(
    isTraceLogEntry({
      ...baseStep,
      state,
      stateError: error,
    }),
    false,
  );
  assert.equal(
    isTraceLogEntry({
      ...baseStep,
      state,
      diff: diff('cubes'),
      diffError: error,
    }),
    false,
  );
  assert.equal(
    isTraceLogEntry({
      ...baseStep,
      stateError: error,
      diff: diff('cubes'),
    }),
    false,
  );
}

{
  assert.equal(Object.prototype.hasOwnProperty.call(Object.prototype, 'count'), false);
  const report = buildTraceLogReport(
    [
      header(),
      line({
        kind: 'step',
        seq: 1,
        ts: '2026-01-01T00:00:01.000Z',
        route: 'tool',
        op: '__proto__',
        response: { ok: true },
      }),
    ].join('\n'),
  );
  assert.equal(report.ops.__proto__?.count, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(Object.prototype, 'count'), false);
}

{
  const report = buildTraceLogReport(
    [
      header(),
      line({
        kind: 'step',
        seq: 1,
        ts: '2026-01-01T00:00:01.000Z',
        route: 'tool',
        op: 'mesh-update',
        response: { ok: true },
        state: state('r1'),
        diff: {
          sinceRevision: 'r0',
          currentRevision: 'r1',
          counts: {
            bones: zeroCounts(),
            cubes: zeroCounts(),
            meshes: { ...zeroCounts(), changed: 1 },
            textures: zeroCounts(),
            animations: zeroCounts(),
          },
        },
      }),
    ].join('\n'),
  );
  assert.equal(report.diffCounts?.meshes?.changed, 1);
}

{
  const records = [header()];
  for (let seq = 1; seq <= 3; seq += 1) {
    const revision = `overflow-r${seq}`;
    records.push(
      line({
        kind: 'step',
        seq,
        ts: `2026-01-01T00:00:0${seq}.000Z`,
        route: 'tool',
        op: 'overflow',
        response: { ok: true },
        state: state(revision),
        diff: {
          sinceRevision: `overflow-r${seq - 1}`,
          currentRevision: revision,
          counts: {
            bones: { ...zeroCounts(), changed: Number.MAX_SAFE_INTEGER },
            cubes: zeroCounts(),
            textures: zeroCounts(),
            animations: zeroCounts(),
          },
        },
      }),
    );
  }
  const report = buildTraceLogReport(records.join('\n'));
  assert.equal(report.diffCounts?.bones.changed, Number.MAX_SAFE_INTEGER);
  assert.ok(
    report.warnings?.some(
      (warning) => warning.includes('bones.changed') && warning.includes('clamped'),
    ),
  );
}

{
  const text = [
    header(),
    'invalid json',
    line({
      kind: 'step',
      seq: 1,
      ts: '2026-01-01T00:00:01.000Z',
      route: 'tool',
      op: 'update_cube',
      response: { ok: true },
      state: state('r1'),
      diff: diff('cubes'),
    }),
    line({
      kind: 'step',
      seq: 2,
      ts: '2026-01-01T00:00:03.000Z',
      route: 'tool',
      op: 'paint_faces',
      response: {
        ok: false,
        error: { code: 'unknown', message: 'boom' },
      },
      state: state('r2'),
      diff: diff('textures'),
    }),
  ].join('\n');
  const report = buildTraceLogReport(text);

  assert.equal(report.steps, 2);
  assert.equal(report.errors, 1);
  assert.equal(report.routes.tool, 2);
  assert.equal(report.ops.update_cube.count, 1);
  assert.equal(report.ops.update_cube.errors, 0);
  assert.equal(report.ops.paint_faces.count, 1);
  assert.equal(report.ops.paint_faces.errors, 1);
  assert.equal(report.firstTs, '2026-01-01T00:00:01.000Z');
  assert.equal(report.lastTs, '2026-01-01T00:00:03.000Z');
  assert.equal(report.lastError?.seq, 2);
  assert.equal(report.lastError?.op, 'paint_faces');
  assert.equal(report.lastError?.code, 'unknown');
  assert.equal(report.diffCounts?.cubes.changed, 1);
  assert.equal(report.diffCounts?.textures.changed, 2);
  assert.equal(report.warnings?.length, 1);
}
