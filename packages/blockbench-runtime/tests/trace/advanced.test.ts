import assert from 'node:assert/strict';

import {
  isProjectStateContract,
  type ProjectDiff,
  type ProjectState,
} from '@ashfox/blockbench-contracts/types/internal';
import { TraceLogStore } from '../../src/trace/store';
import { TraceRecorder } from '../../src/trace/recorder';
import { parseTraceLogText } from '../../src/trace/replay';
import { TraceLogFlushScheduler } from '../../src/trace/flush';
import { ok } from '../helpers';

class InMemoryTraceLogWriter {
  private text = '';

  write(text: string) {
    this.text = text;
    return null;
  }

  getText(): string {
    return this.text;
  }
}

const createState = (): ProjectState => ({
  id: 'p1',
  active: true,
  name: 'project',
  format: 'geckolib',
  revision: 'r1',
  counts: { bones: 0, cubes: 0, textures: 1, animations: 0 },
  textureResolution: { width: 16, height: 16 },
  textures: [{ id: 't1', name: 'tex', path: 'path', width: 16, height: 16 }],
  textureUsage: {
    textures: [
      {
        id: 't1',
        name: 'tex',
        cubeCount: 1,
        faceCount: 1,
        cubes: [{ id: 'c1', name: 'cube', faces: [{ face: 'north', uv: [0, 0, 16, 16] }] }],
      },
    ],
  },
  cubes: [],
  bones: [],
  animations: [],
});

const createDiff = (): ProjectDiff => ({
  sinceRevision: 'r0',
  currentRevision: 'r1',
  counts: {
    bones: { added: 0, removed: 0, changed: 0 },
    cubes: { added: 0, removed: 0, changed: 0 },
    textures: { added: 1, removed: 0, changed: 0 },
    animations: { added: 0, removed: 0, changed: 0 },
  },
  textures: {
    added: [{ key: 't1', item: { id: 't1', name: 'tex', path: 'path', width: 16, height: 16 } }],
    removed: [],
    changed: [],
  },
});

{
  const state = createState();
  const textureUsage = state.textureUsage;
  if (!textureUsage) throw new Error('Expected texture usage fixture.');
  const invalidUsage: ProjectState = {
    ...state,
    textureUsage: {
      ...textureUsage,
      textures: textureUsage.textures.map((entry, index) =>
        index === 0 ? { ...entry, cubeCount: 999, faceCount: 888 } : entry,
      ),
    },
  };
  assert.equal(isProjectStateContract(invalidUsage), false);

  const invalidUvPolicy: ProjectState = {
    ...createState(),
    counts: {
      ...createState().counts,
      meshes: 1,
      meshVertices: 3,
      meshFaces: 1,
    },
    meshes: [
      {
        name: 'mesh',
        uvPolicy: { texelDensity: -1, padding: 99 },
        vertices: [
          { id: 'a', pos: [0, 0, 0] },
          { id: 'b', pos: [1, 0, 0] },
          { id: 'c', pos: [0, 1, 0] },
        ],
        faces: [{ vertices: ['a', 'b', 'c'] }],
      },
    ],
  };
  assert.equal(isProjectStateContract(invalidUvPolicy), false);
}

const header = () => ({
  kind: 'header' as const,
  schemaVersion: 1 as const,
  createdAt: '2026-08-06T00:00:00.000Z',
});

const appendHeader = (store: TraceLogStore): void => {
  assert.equal(store.append(header()).error, undefined);
};

const appendStep = (store: TraceLogStore, seq: number, op: string) =>
  store.append({
    kind: 'step',
    seq,
    ts: new Date().toISOString(),
    route: 'tool',
    op,
    response: { ok: true, data: { seq } },
  });

// Store trims by maxBytes.
{
  const store = new TraceLogStore({ autoFlush: false, maxEntries: 10 });
  appendHeader(store);
  appendStep(store, 1, 'one');
  appendStep(store, 2, 'two');
  const cap = store.getText().length;
  store.update({ maxBytes: cap });
  appendStep(store, 3, 'three');
  assert.ok(store.size() < 4);
  assert.equal(parseTraceLogText(store.getText()).ok, true);
}

// Detail rule enables full state + usage for UV-heavy ops.
{
  const store = new TraceLogStore({ autoFlush: false, maxEntries: 20 });
  const recorder = new TraceRecorder(
    {
      getProjectState: (_payload) => ok({ project: createState() }),
      getProjectDiff: (_payload) => ok({ diff: createDiff() }),
    },
    store,
    {
      includeState: true,
      includeDiff: true,
      stateDetail: 'summary',
      diffDetail: 'summary',
      detailRules: [
        {
          ops: ['paint_faces'],
          includeUsage: true,
          stateDetail: 'full',
          diffDetail: 'full',
        },
      ],
    },
  );

  recorder.record('paint_faces', {}, { ok: true, data: { ok: true } });
  recorder.record('get_project_state', { detail: 'summary' }, { ok: true, data: { ok: true } });

  const parsed = parseTraceLogText(store.getText());
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    const detailed = parsed.records.find(
      (record) => record.kind === 'step' && record.op === 'paint_faces',
    );
    const summary = parsed.records.find(
      (record) => record.kind === 'step' && record.op === 'get_project_state',
    );
    assert.ok(detailed && detailed.kind === 'step');
    assert.ok(summary && summary.kind === 'step');
    if (detailed && detailed.kind === 'step') {
      const state = detailed.state as Record<string, unknown> | undefined;
      assert.ok(state && Array.isArray(state.textures));
      assert.ok(state && state.textureUsage);
    }
    if (summary && summary.kind === 'step') {
      const state = summary.state as Record<string, unknown> | undefined;
      assert.ok(state && !('textures' in state));
    }
  }
}

// Recorder canonicalizes optional undefined fields before store validation.
{
  const store = new TraceLogStore({ autoFlush: false, maxEntries: 20 });
  let revision = 0;
  let recorded = 0;
  const recorder = new TraceRecorder(
    {
      getProjectState: () =>
        ok({
          project: {
            ...createState(),
            revision: `r${++revision}`,
            dirty: undefined,
            uvPixelsPerBlock: undefined,
            meshes: undefined,
          },
        }),
      getProjectDiff: () =>
        ok({
          diff: { ...createDiff(), baseMissing: undefined },
        }),
    },
    store,
    {
      stateDetail: 'full',
      diffDetail: 'full',
      onRecord: () => {
        recorded += 1;
      },
    },
  );
  assert.equal(
    recorder.record(
      'one',
      { id: undefined },
      {
        ok: true,
        data: { id: undefined },
      },
    ),
    null,
  );
  assert.equal(
    recorder.record(
      'two',
      {},
      {
        ok: true,
        data: {},
      },
    ),
    null,
  );
  assert.equal(recorded, 2);
  assert.equal(store.size(), 3);
  const parsed = parseTraceLogText(store.getText());
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    const steps = parsed.records.filter((entry) => entry.kind === 'step');
    assert.equal(steps.length, 2);
    assert.equal('dirty' in (steps[0]?.state ?? {}), false);
    assert.equal('baseMissing' in (steps[1]?.diff ?? {}), false);
  }
}

// Writer failures do not roll back an accepted ledger header or step.
{
  let writes = 0;
  let recorded = 0;
  const store = new TraceLogStore({
    autoFlush: true,
    maxEntries: 20,
    writer: {
      write: () => {
        writes += 1;
        return writes === 1 ? { code: 'io_error' as const, message: 'header flush failed' } : null;
      },
    },
  });
  const recorder = new TraceRecorder(
    {
      getProjectState: () => ok({ project: createState() }),
      getProjectDiff: () => ok({ diff: createDiff() }),
    },
    store,
    {
      includeDiff: false,
      onRecord: () => {
        recorded += 1;
      },
    },
  );
  assert.equal(
    recorder.record(
      'one',
      {},
      {
        ok: true,
        data: {},
      },
    )?.code,
    'io_error',
  );
  assert.equal(store.size(), 2);
  assert.equal(recorded, 1);
  assert.equal(
    recorder.record(
      'two',
      {},
      {
        ok: true,
        data: {},
      },
    ),
    null,
  );
  assert.equal(store.size(), 3);
  assert.equal(recorded, 2);
  assert.equal(parseTraceLogText(store.getText()).ok, true);
}

// Writer exceptions are converted at the boundary without wedging the ledger.
{
  let writes = 0;
  const store = new TraceLogStore({
    autoFlush: true,
    maxEntries: 20,
    writer: {
      write: () => {
        writes += 1;
        if (writes === 1) throw new Error('writer failed');
        return null;
      },
    },
  });
  const recorder = new TraceRecorder(
    {
      getProjectState: () => ok({ project: createState() }),
      getProjectDiff: () => ok({ diff: createDiff() }),
    },
    store,
    { includeDiff: false },
  );
  assert.equal(
    recorder.record(
      'one',
      {},
      {
        ok: true,
        data: {},
      },
    )?.details?.reason,
    'trace_log_writer_threw',
  );
  assert.equal(
    recorder.record(
      'two',
      {},
      {
        ok: true,
        data: {},
      },
    ),
    null,
  );
  assert.equal(store.size(), 3);
  assert.equal(writes, 3);
  assert.equal(parseTraceLogText(store.getText()).ok, true);
}

// Explicit flush surfaces writer failures to its caller.
{
  const store = new TraceLogStore({
    autoFlush: false,
    maxEntries: 20,
    writer: {
      write: () => {
        throw new Error('flush writer failed');
      },
    },
  });
  const recorder = new TraceRecorder(
    {
      getProjectState: () => ok({ project: createState() }),
      getProjectDiff: () => ok({ diff: createDiff() }),
    },
    store,
  );
  assert.equal(
    recorder.record(
      'one',
      {},
      {
        ok: true,
        data: {},
      },
    ),
    null,
  );
  assert.equal(recorder.flush()?.details?.reason, 'trace_log_writer_threw');
  assert.equal(
    recorder.flushTo({
      write: () => ({ code: 'io_error', message: 'explicit failure' }),
    })?.message,
    'explicit failure',
  );
}

// Rejected steps do not advance sequence or the accepted diff baseline.
{
  let revision = 0;
  const diffCalls: string[] = [];
  const store = new TraceLogStore({ autoFlush: false, maxEntries: 20 });
  const recorder = new TraceRecorder(
    {
      getProjectState: () =>
        ok({
          project: { ...createState(), revision: `r${++revision}` },
        }),
      getProjectDiff: ({ sinceRevision }) => {
        diffCalls.push(sinceRevision);
        return ok({ diff: createDiff() });
      },
    },
    store,
  );
  assert.equal(
    recorder.record(
      '',
      {},
      {
        ok: true,
        data: {},
      },
    )?.details?.reason,
    'trace_log_record_invalid',
  );
  assert.equal(store.size(), 1);
  assert.equal(
    recorder.record(
      'accepted',
      {},
      {
        ok: true,
        data: {},
      },
    ),
    null,
  );
  assert.deepEqual(diffCalls, []);
  const parsed = parseTraceLogText(store.getText());
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    const steps = parsed.records.filter((entry) => entry.kind === 'step');
    assert.equal(steps.length, 1);
    assert.equal(steps[0]?.seq, 1);
    assert.equal('diff' in (steps[0] ?? {}), false);
  }
}

// Flush scheduler writes after N entries.
{
  const store = new TraceLogStore({ autoFlush: false, maxEntries: 10 });
  appendHeader(store);
  const writer = new InMemoryTraceLogWriter();
  const scheduler = new TraceLogFlushScheduler({
    store,
    writer,
    policy: { flushEvery: 2 },
  });

  appendStep(store, 1, 'one');
  scheduler.recorded();
  assert.equal(writer.getText().length, 0);

  appendStep(store, 2, 'two');
  scheduler.recorded();
  assert.ok(writer.getText().length > 0);
}
