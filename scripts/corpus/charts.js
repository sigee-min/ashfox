'use strict';
module.exports = count => {
  const span = { start: { offset: 0, line: 1, column: 1 }, end: { offset: 1, line: 1, column: 2 } };
  const number = (value, unit = 'texel') => ({ kind: 'number', numerator: BigInt(value), denominator: 1n, text: String(value), unit, rawUnit: unit === 'plain' ? '' : unit, span });
  const vector = values => ({ kind: 'vector', values: values.map(value => number(value)), span });
  const name = value => ({ kind: 'name', value, span });
  const property = (name, value) => ({ kind: 'property', name, value, span });
  const texel = value => ({ kind: 'number', type: 'texel', value: { numerator: BigInt(value), denominator: 1n, unit: 'texel' } });
  const symbol = (name, kind) => ({ modulePath: 'root', name, kind, key: `root:${kind}:${name}` });
  const contractSymbol = symbol('skin-contract', 'surface-contract');
  const charts = {}, declarations = [], usages = [];
  for (let i = 0; i < count; i++) {
    const id = `chart_${i}`;
    charts[id] = { id, layout: 'flat', width: texel(1), height: texel(1), coverage: 'optional', span };
    declarations.push({ kind: 'chart', id, layout: 'flat', statements: [property('origin', vector([i, 0])), property('fill', name('body'))], span });
    usages.push({ chart: id, shape: { kind: 'flat', size: [1, 1] }, span });
  }
  const payload = { kind: 'texture', id: 'skin', statements: [
    property('atlas', vector([count, 1])), property('background', name('body')), property('background-alpha', number(255, 'plain')),
    { kind: 'palette', properties: [property('body', { kind: 'vector', values: ['#24151a', '#8f3f3f', '#e0a15a'].map(value => ({ kind: 'color', value, span })), span })], span },
    { kind: 'grain', algorithm: 'clustered', seed: property('seed', number(7, 'plain')), span }, ...declarations
  ], span };
  return { surface: { symbol: symbol('skin', 'surface'), contract: contractSymbol,
    textureSource: { kind: 'unlowered-texture-source', payload, span }, material: 'opaque', slots: {}, span },
  contract: { symbol: contractSymbol, atlas: { width: texel(count), height: texel(1), span }, charts, material: 'opaque', slots: {}, span }, usages };
};
