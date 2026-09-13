'use strict';
// Prebuilt instantiated geometry isolates lowering from source parsing/rasterization.
module.exports = count => {
  const span = { start: { offset: 0, line: 1, column: 1 }, end: { offset: 1, line: 1, column: 2 } };
  const exact = value => ({ numerator: BigInt(value), denominator: 1n, unit: 'unit' });
  const vector = values => ({ kind: 'vector', type: 'vec3<unit>', values: values.map(value => ({ kind: 'number', type: 'unit', value: exact(value) })) });
  const frame = { origin: [0, 0, 0].map(exact), xAxis: [1, 0, 0], yAxis: [0, 1, 0], zAxis: [0, 0, 1], determinant: 1 };
  const symbol = (name, kind = 'surface') => ({ modulePath: 'root.ashfox', name, kind, key: `root:${kind}:${name}` });
  const node = (kind, id, properties, children, surface) => ({ kind, id, properties, children, surface,
    attachmentBoneId: 'root', sourcePath: 'root.ashfox', span });
  const surfaces = [], plans = [], geometry = [];
  for (let i = 0; i < count; i++) {
    const skin = symbol(`skin_${i}`), id = `body/cube_${i}`;
    surfaces.push({ surface: skin, contract: symbol('skinContract', 'surface-contract'), material: 'opaque', charts: ['body'], span });
    plans.push({ surfaceSymbol: skin, texture: { id: `texture:${i}`, name: 'skin', width: 16, height: 16,
      source: { bucket: 'inline', key: `${i}.png`, contentType: 'image/png', contentHash: 'sha256:test' },
      visible: true, sampling: 'nearest', colorSpace: 'srgb', renderMode: 'default', renderSides: 'auto' },
    charts: { body: { id: 'body', layout: 'box', origin: [0, 0], width: 4, height: 2, coverage: null, span } } });
    geometry.push(node('cube', id, [{ name: 'origin', value: vector([0, 0, 0]), span },
      { name: 'size', value: vector([1, 1, 1]), span }],
    ['north', 'south', 'east', 'west', 'up', 'down'].map(face => node('face', `${id}/${face}`, [], [], null)),
    { port: 'skin', chart: 'body', surface: skin, span }));
  }
  const ir = { asset: symbol('asset', 'asset'), settings: {
    density: { kind: 'number', type: 'integer', value: { numerator: 1n, denominator: 1n, unit: 'plain' } }, forward: 'north' },
    rig: symbol('rig', 'rig-contract'), skeleton: symbol('skeleton', 'skeleton'),
    bones: [{ id: 'root', semanticJoint: 'root', parentId: null, parentRestFrame: frame, sourcePath: 'root.ashfox', span }],
    instances: [{ id: 'body', component: symbol('body', 'component'), placementAuthority: 'rig', placement: frame,
      parameters: {}, socketEndpoints: [], geometry, sourcePath: 'root.ashfox', span }],
    surfaces, connections: [], motions: [], budget: {
      limits: { instances: 1024, bones: 4096, nodes: 16384, faces: 65536, motionKeys: 65536, diagnostics: 256 },
      used: { instances: 1, bones: 1, nodes: count * 7, faces: count * 6, motionKeys: 0, diagnostics: 0 }
    } };
  return { ir, plans };
};
