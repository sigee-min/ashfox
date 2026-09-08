import type { ProgramExpr, ProgramTextureDecl, ProgramTextureStatement } from '../syntax/contract';
import { parseProgramExpression } from '../syntax/expression';
import { PROGRAM_PARSE_NESTING_LIMIT } from '../syntax/limits';
import { parseProgramTextureStatement, type ProgramTextureReader } from '../syntax/texture';
import type { SourceSpan } from '../../source/contract';
import {
  ASHFOX_ASSET_GRAMMAR,
  type AssetAssemblyDecl, type AssetAssemblyUse, type AssetBindDecl,
  type AssetComponentDecl, type AssetComponentJointBind, type AssetComponentSocketBind,
  type AssetComponentParamDecl, type AssetAssemblyConnect, type AssetParamSetDecl,
  type AssetPortBindingDecl, type AssetAtlasDecl, type AssetChartAbiDecl, type AssetDeclaration,
  type AssetDiagnostic, type AssetFrameDecl, type AssetGeometrySurfaceBind, type AssetGeometryPayload,
  type AssetImportDecl, type AssetJointDecl, type AssetKeyframeDecl, type AssetMotionDecl,
  type AssetPortDecl, type AssetPropertyDecl, type AssetQualifiedName, type AssetRigContractDecl,
  type AssetSkeletonDecl, type AssetSettingsDecl, type AssetSlotDecl, type AssetSocketContractDecl,
  type AssetSocketDecl, type AssetSourceParseResult, type AssetSourceUnit, type AssetSurfaceContractDecl,
  type AssetSurfaceDecl, type AssetTrackDecl, type AssetValueType } from './contract';
import { parseGeometryPayload, type AssetGeometryReader } from './geometry';
import { ParserAbort, badName, freeze, join, valueName, type Token } from './parserSupport';
import { parseAssetDesign, parseAssetValueType } from './design';
export class Parser {
  private index = 0;
  private depth = 0;
  private declarations = 0;
  private lastBlockEnd: SourceSpan | null = null;
  private readonly diagnostics: AssetDiagnostic[] = [];
  constructor(
    private readonly tokens: readonly Token[],
    private readonly source: string,
    private readonly path: string
  ) {}
  private current(): Token { return this.tokens[this.index] ?? this.tokens[this.tokens.length - 1]!; }
  private end(): boolean { return this.current().kind === 'eof'; }
  private take(): Token { const token = this.current(); if (!this.end()) this.index += 1; return token; }
  private check(value: string): boolean { return !this.end() && this.current().kind === 'symbol' && this.current().value === value; }
  private match(value: string): boolean { if (!this.check(value)) return false; this.take(); return true; }
  private checkWord(value: string): boolean { return !this.end() && this.current().kind === 'identifier' && this.current().value === value; }
  private matchWord(value: string): boolean { if (!this.checkWord(value)) return false; this.take(); return true; }
  private fail(code: string, message: string, token = this.current()): void {
    this.diagnostics.push(freeze({ severity: 'error', code, message, path: this.path, span: token.span }));
  }
  private failSpan(code: string, message: string, span: SourceSpan): void {
    this.diagnostics.push(freeze({ severity: 'error', code, message, path: this.path, span }));
  }
  private expect(value: string, message: string): Token {
    if (this.check(value)) return this.take();
    this.fail('asset.expected-token', message); return this.current();
  }
  private expectWord(value: string, message: string): Token {
    if (this.checkWord(value)) return this.take();
    this.fail('asset.expected-token', message); return this.current();
  }
  private enter(token = this.current()): void {
    this.depth += 1;
    if (this.depth > PROGRAM_PARSE_NESTING_LIMIT) {
      this.fail('asset.nesting-limit', 'Asset source nesting exceeds the parser limit.', token);
      throw new ParserAbort();
    }
  }
  private leave(): void { this.depth -= 1; }
  private count(): void {
    this.declarations += 1;
    if (this.declarations > 4096) {
      this.fail('asset.declaration-limit', 'Asset source declares too many entries.');
      throw new ParserAbort();
    }
  }
  private recover(): void {
    let braces = 0;
    while (!this.end()) {
      if (this.check('{')) { braces += 1; this.take(); continue; }
      if (this.check('}')) { if (braces === 0) return; braces -= 1; this.take(); if (braces === 0) return; continue; }
      if (this.check(';') && braces === 0) { this.take(); return; }
      this.take();
    }
  }
  private scopeError(scope: string): void {
    this.fail('asset.invalid-scope', 'Statement "' + this.current().value +
      '" is not allowed in ' + scope + ' scope.');
    this.recover();
  }
  private id(message = 'Expected an identifier.'): Token {
    const token = this.current();
    if (!badName(token)) { this.take(); return token; }
    this.fail('asset.expected-identifier', message, token); return token;
  }
  private qualified(message = 'Expected a qualified name.'): AssetQualifiedName {
    const first = this.id(message);
    const segments = [first.value];
    while (this.match('.')) {
      const next = this.id('Expected a name after the qualified-name dot.');
      segments.push(next.value);
      if (segments.length > 2) this.fail('asset.invalid-qualified-name',
        'Qualified names contain one local name and at most one module alias.', next);
    }
    return freeze({ kind: 'qualified-name', segments: freeze(segments),
      span: join(first.span, this.tokens[Math.max(0, this.index - 1)]!.span) });
  }
  private expression(): ProgramExpr {
    return parseProgramExpression({
      qualifiedNames: true,
      current: () => this.current(), take: () => this.take(),
      check: (value) => this.check(value), match: (value) => this.match(value),
      fail: (code, message, token) => this.fail(code.replace(/^(?:model|program)\./, 'asset.'), message, token),
      enterDepth: () => this.enter(), leaveDepth: () => this.leave()
    });
  }
  private assignment(): boolean {
    if (this.current().kind !== 'identifier') return false;
    let next = this.index + 1;
    while (this.tokens[next]?.kind === 'symbol' &&
      (this.tokens[next]?.value === '-' || this.tokens[next]?.value === '.') &&
      this.tokens[next + 1]?.kind === 'identifier') next += 2;
    return this.tokens[next]?.kind === 'symbol' && this.tokens[next]?.value === '=';
  }
  private finish(): void {
    if (this.match(';')) { this.lastBlockEnd = this.tokens[Math.max(0, this.index - 1)]!.span; return; }
    if (this.check('}') || this.end()) { this.lastBlockEnd = this.current().span; return; }
    this.fail('asset.expected-terminator', 'Statements must end with ;.');
    this.recover();
  }
  private finishEnd(): SourceSpan { return this.lastBlockEnd ?? this.current().span; }
  private word(message: string): string { const token = this.current(); if (token.kind === 'identifier') { this.take(); return token.value; } this.fail('asset.expected-identifier', message, token); return ''; }
  private name(message = 'Expected a name.'): string { return this.id(message).value; }
  private abort(): never { throw new ParserAbort(); }
  private block<T>(read: () => T): T[] {
    this.expect('{', 'Expected { to begin a block.'); this.enter(); const values: T[] = [];
    try { while (!this.check('}') && !this.end()) values.push(read()); const close = this.expect('}', 'Expected } to close a block.'); this.lastBlockEnd = close.span; return values; } finally { this.leave(); }
  }
  private blockEnd(): SourceSpan { return this.lastBlockEnd ?? this.current().span; }
  private property(): AssetPropertyDecl {
    const start = this.current();
    let name = this.id('Expected a property name.').value;
    while (this.match('-')) name += '-' + this.id().value;
    while (this.match('.')) {
      name += '.' + this.id().value;
      while (this.match('-')) name += '-' + this.id().value;
    }
    this.expect('=', 'Expected = in a property declaration.');
    const value = this.expression();
    this.finish();
    return freeze({ kind: 'property', name, value, span: join(start.span, value.span) });
  }
  private properties(scope: string): AssetPropertyDecl[] {
    this.expect('{', 'Expected { to begin a property block.');
    this.enter();
    const values: AssetPropertyDecl[] = [];
    try {
      while (!this.check('}') && !this.end()) {
        if (this.assignment()) values.push(this.property()); else this.scopeError(scope);
      }
      this.expect('}', 'Expected } to close a property block.');
    } finally { this.leave(); }
    return values;
  }
  private closedProperties(values: readonly AssetPropertyDecl[], allowed: readonly string[], scope: string): void { const seen = new Set<string>(); for (const property of values) if (!allowed.includes(property.name)) this.failSpan('asset.invalid-property', 'Property "' + property.name + '" is not allowed in ' + scope + '.', property.span); else if (seen.has(property.name)) this.failSpan('asset.duplicate-property', 'Property "' + property.name + '" is declared more than once in ' + scope + '.', property.span); else seen.add(property.name); }
  private frame(): AssetFrameDecl {
    const start = this.expectWord('frame', 'Expected frame.');
    const values = this.properties('frame'); this.closedProperties(values, ['origin', 'x', 'y', 'z'], 'frame');
    return freeze({ kind: 'frame', properties: freeze(values),
      span: join(start.span, this.tokens[Math.max(0, this.index - 1)]!.span) });
  }
  private frameOrNull(values: readonly AssetPropertyDecl[], start: SourceSpan): AssetFrameDecl | null {
    const axes = values.filter((entry) => entry.name === 'x' || entry.name === 'y' || entry.name === 'z');
    return axes.length === 0 ? null : freeze({ kind: 'frame', properties: freeze(axes), span: join(start, axes[axes.length - 1]!.span) });
  }
  private texture(): ProgramTextureDecl {
    const start = this.expectWord('texture', 'Expected texture.'); const id = this.name('Expected a texture name.');
    const statements = this.block<ProgramTextureStatement>(() => parseProgramTextureStatement(this.textureReader()));
    return freeze({ kind: 'texture', id, statements: freeze(statements), span: join(start.span, this.blockEnd()) });
  }
  private textureReader(): ProgramTextureReader {
    return { current: () => this.current(), take: () => this.take(), checkWord: (value) => this.checkWord(value), expect: (value, message) => this.expect(value, message), fail: (code, message, token) => this.fail(code.replace(/^(?:model|program)\./, 'asset.'), message, token), abort: () => this.abort(), name: (message) => this.name(message), word: (message) => this.word(message), expression: () => this.expression(), finish: () => this.finish(), finishEnd: () => this.finishEnd(), block: <T>(read: () => T): T[] => this.block(read), blockEnd: () => this.blockEnd(), property: () => this.property() };
  }
  private namedAssignment(name: string): AssetQualifiedName {
    const start = this.current();
    this.expectWord(name, 'Expected ' + name + '.');
    this.expect('=', 'Expected = after ' + name + '.');
    const ref = this.qualified('Expected a name after ' + name + '.');
    this.finish();
    return freeze({ kind: 'qualified-name', segments: ref.segments, span: join(start.span, ref.span) });
  }
  private importDecl(): AssetImportDecl {
    const start = this.expectWord('import', 'Expected import.');
    const path = this.current();
    if (path.kind !== 'string') this.fail('asset.invalid-import-path', 'Imports require a quoted relative path.', path);
    else this.take();
    this.expectWord('as', 'Expected as after an import path.');
    const alias = this.id('Expected an import alias.');
    this.finish();
    return freeze({ kind: 'import', path: path.value, alias: alias.value,
      ref: freeze({ path: this.path, span: path.span }), span: join(start.span, alias.span) });
  }
  private socketContract(exported: boolean): AssetSocketContractDecl {
    const start = this.expectWord('contract', 'Expected contract after socket.');
    const id = this.id('Expected a socket contract name.');
    this.expect('{', 'Expected { to begin a socket contract.'); this.enter();
    const values: AssetPropertyDecl[] = []; let frame: AssetFrameDecl | null = null;
    try {
      while (!this.check('}') && !this.end()) {
        if (this.checkWord('frame')) { if (frame !== null) this.failSpan('asset.duplicate-frame', 'A declaration may contain only one frame.', this.current().span); frame = this.frame(); }
        else if (this.assignment()) values.push(this.property());
        else this.scopeError('socket contract');
      }
      const close = this.expect('}', 'Expected } to close a socket contract.');
    this.closedProperties(values, ['handedness'], 'socket contract');
    const handednessValue = values.find((entry) => entry.name === 'handedness')?.value;
    const handedness = valueName(handednessValue ?? ({ kind: 'name', value: '', span: id.span } as ProgramExpr));
    if (handednessValue === undefined) this.failSpan('asset.missing-handedness',
      'Socket contracts require an explicit handedness = right|left declaration.', id.span);
    if (handedness !== 'right' && handedness !== 'left') this.fail('asset.invalid-handedness',
      'Socket handedness must be right or left.', id);
    return freeze({ kind: 'socket-contract', exported, id: id.value,
      handedness: handedness === 'left' ? 'left' : 'right',
      frame, span: join(start.span, close.span) });
    } finally { this.leave(); }
  }
  private joint(): AssetJointDecl {
    const start = this.expectWord('joint', 'Expected joint.');
    const id = this.id('Expected a joint name.');
    this.expect('{', 'Expected { to begin a rig joint.'); this.enter();
    const values: AssetPropertyDecl[] = []; let frame: AssetFrameDecl | null = null;
    try { while (!this.check('}') && !this.end()) { if (this.checkWord('frame')) { if (frame !== null) this.failSpan('asset.duplicate-frame', 'A declaration may contain only one frame.', this.current().span); frame = this.frame(); } else if (this.assignment()) values.push(this.property()); else this.scopeError('rig contract joint'); }
    const close = this.expect('}', 'Expected } to close a rig joint.');
    this.closedProperties(values, ['parent', 'role', 'channels', 'mirror'], 'rig contract joint');
    const parentValue = values.find((entry) => entry.name === 'parent')?.value;
    const parentName = valueName(parentValue ?? ({ kind: 'name', value: 'none', span: id.span } as ProgramExpr));
    const channelValue = values.find((entry) => entry.name === 'channels')?.value;
    if (frame === null) this.failSpan('asset.missing-frame', 'Every rig joint requires an explicit local frame.', id.span);
    if (channelValue === undefined) this.failSpan('asset.missing-joint-channels', 'Every rig joint requires an explicit allowed channel set.', id.span);
    const channelValues = channelValue?.kind === 'vector' ? channelValue.values : channelValue === undefined ? [] : [channelValue];
    const channels: ('rotation' | 'scale')[] = [];
    for (const value of channelValues) { if (value.kind === 'name' && (value.value === 'rotation' || value.value === 'scale')) channels.push(value.value); else this.failSpan('asset.invalid-joint-channels', 'Joint channels must name rotation and/or scale.', value.span); }
    const mirrorValue = values.find((entry) => entry.name === 'mirror')?.value;
    if (mirrorValue === undefined) this.failSpan('asset.missing-joint-mirror', 'Every rig joint requires an explicit mirror = none|<joint> declaration.', id.span);
    const mirrorName = valueName(mirrorValue ?? ({ kind: 'name', value: 'none', span: id.span } as ProgramExpr));
    return freeze({ kind: 'joint', id: id.value,
      parent: parentName === null || parentName === 'none' ? null : freeze({ kind: 'qualified-name', segments: freeze(parentName.split('.')), span: parentValue!.span }),
      role: values.find((entry) => entry.name === 'role') === undefined ? null : valueName(values.find((entry) => entry.name === 'role')!.value),
      frame, channels: freeze(channels), mirror: mirrorName === null || mirrorName === 'none' ? null : freeze({ kind: 'qualified-name', segments: freeze(mirrorName.split('.')), span: mirrorValue!.span }), span: join(start.span, close.span) });
    } finally { this.leave(); }
  }
  private socket(): AssetSocketDecl {
    const start = this.expectWord('socket', 'Expected socket.');
    const id = this.id('Expected a socket name.');
    this.expect(':', 'Expected : and a socket contract.');
    const contract = this.qualified('Expected socket contract name.');
    this.expect('{', 'Expected { to begin a socket.');
    this.enter();
    const values: AssetPropertyDecl[] = [];
    let frame: AssetFrameDecl | null = null;
    try {
      while (!this.check('}') && !this.end()) {
        if (this.checkWord('frame')) { if (frame !== null) this.failSpan('asset.duplicate-frame', 'A declaration may contain only one frame.', this.current().span); frame = this.frame(); }
        else if (this.assignment()) values.push(this.property()); else this.scopeError('rig contract socket');
      }
      const close = this.expect('}', 'Expected } to close a socket.');
      this.closedProperties(values, ['joint', 'capacity'], 'rig contract socket');
      const jointValue = values.find((entry) => entry.name === 'joint')?.value;
      const jointRaw = jointValue === undefined ? null : valueName(jointValue);
      if (jointRaw === null) this.fail('asset.missing-socket-joint', 'A socket requires a local joint.', id);
      const joint = freeze({ kind: 'qualified-name', segments: freeze(jointRaw?.split('.') ?? []), span: jointValue?.span ?? id.span } satisfies AssetQualifiedName);
      const capacityValue = values.find((entry) => entry.name === 'capacity')?.value;
      const capacityRaw = valueName(capacityValue ?? ({ kind: 'name', value: '', span: id.span } as ProgramExpr));
      if (capacityValue === undefined) this.failSpan('asset.missing-socket-capacity',
        'Rig sockets require an explicit capacity = one|many declaration.', id.span);
      if (capacityRaw !== 'one' && capacityRaw !== 'many') this.fail('asset.invalid-socket-capacity',
        'Socket capacity must be one or many.', id);
      return freeze({ kind: 'socket', id: id.value, contract, joint,
        capacity: capacityRaw === 'many' ? 'many' : 'one', frame,
        span: join(start.span, close.span) });
    } finally { this.leave(); }
  }
  private rigContract(exported: boolean): AssetRigContractDecl {
    const start = this.expectWord('contract', 'Expected contract after rig.');
    const id = this.id('Expected a rig contract name.');
    this.expect('{', 'Expected { to begin a rig contract.'); this.enter();
    let frame: AssetFrameDecl | null = null; let handedness: AssetRigContractDecl['handedness'] | null = null; let handednessSeen = false; const joints: AssetJointDecl[] = []; const sockets: AssetSocketDecl[] = [];
    try {
      while (!this.check('}') && !this.end()) {
        if (this.checkWord('frame')) { if (frame !== null) this.failSpan('asset.duplicate-frame', 'A declaration may contain only one frame.', this.current().span); frame = this.frame(); }
        else if (this.checkWord('handedness')) { const value = this.property(); const raw = valueName(value.value); if (handednessSeen) this.failSpan('asset.duplicate-handedness', 'Rig handedness must be declared exactly once.', value.span); handednessSeen = true; if (raw !== 'right' && raw !== 'left') this.failSpan('asset.invalid-handedness', 'Rig handedness must be right or left.', value.value.span); else handedness = raw; }
        else if (this.checkWord('joint')) joints.push(this.joint());
        else if (this.checkWord('socket')) sockets.push(this.socket());
        else this.scopeError('rig contract');
      }
      const close = this.expect('}', 'Expected } to close a rig contract.');
      if (handedness === null) this.failSpan('asset.missing-handedness', 'Rig contracts require an explicit handedness = right|left declaration.', id.span);
      return freeze({ kind: 'rig-contract', exported, id: id.value, handedness: handedness ?? 'right', frame, joints: freeze(joints), sockets: freeze(sockets), span: join(start.span, close.span) });
    } finally { this.leave(); }
  }
  private bind(): AssetBindDecl {
    const start = this.expectWord('bind', 'Expected bind.');
    const joint = this.id('Expected a bound joint name.');
    this.expect('{', 'Expected { to begin a bind.'); this.enter();
    const values: AssetPropertyDecl[] = []; let frame: AssetFrameDecl | null = null;
    try {
      while (!this.check('}') && !this.end()) {
        if (this.checkWord('frame')) { if (frame !== null) this.failSpan('asset.duplicate-frame', 'A declaration may contain only one frame.', this.current().span); frame = this.frame(); }
        else if (this.assignment()) values.push(this.property()); else this.scopeError('skeleton bind');
      }
      const close = this.expect('}', 'Expected } to close a bind.');
      const ambiguous = values.find((entry) => entry.name === 'origin');
      if (ambiguous) this.failSpan('asset.bind-coordinate-space', 'Skeleton binds require parent-origin in the parent joint frame; ambiguous origin is not supported.', ambiguous.span);
      this.closedProperties(values, ['parent-origin'], 'skeleton bind');
      const parentOrigin = values.find((entry) => entry.name === 'parent-origin')?.value ?? null;
      return freeze({ kind: 'bind', joint: joint.value, parentOrigin,
        frame: frame ?? this.frameOrNull(values, start.span), span: join(start.span, close.span) });
    } finally { this.leave(); }
  }
  private skeleton(exported: boolean): AssetSkeletonDecl {
    const start = this.expectWord('skeleton', 'Expected skeleton.');
    const id = this.id('Expected a skeleton name.'); this.expectWord('implements', 'Skeletons require implements <rig-contract>.');
    const implementsName = this.qualified('Expected rig contract name.');
    this.expect('{', 'Expected { to begin a skeleton.'); this.enter(); const binds: AssetBindDecl[] = [];
    try {
      while (!this.check('}') && !this.end()) {
        if (this.checkWord('bind')) binds.push(this.bind()); else this.scopeError('skeleton');
      }
      const close = this.expect('}', 'Expected } to close a skeleton.');
      return freeze({ kind: 'skeleton', exported, id: id.value, implements: implementsName, binds: freeze(binds), span: join(start.span, close.span) });
    } finally { this.leave(); }
  }
  private valueType(): AssetValueType {
    return parseAssetValueType({ id: (m) => this.id(m), match: (v) => this.match(v),
      expect: (v, m) => this.expect(v, m), fail: (c, m, t) => this.fail(c, m, t) });
  }
  private slot(contract: boolean): AssetSlotDecl {
    const start = this.expectWord('slot', 'Expected slot.'); const id = this.id('Expected a slot name.');
    if (contract) { this.expect(':', 'Contract slots require a type.'); const type = this.valueType(); this.finish(); return freeze({ kind: 'slot', id: id.value, type, value: null, span: join(start.span, id.span) }); }
    this.expect('=', 'Surface and material slots require a value.'); const value = this.expression(); this.finish();
    return freeze({ kind: 'slot', id: id.value, type: 'unit', value, span: join(start.span, value.span) });
  }
  private surfaceContract(exported: boolean): AssetSurfaceContractDecl {
    const start = this.expectWord('contract', 'Expected contract after surface.'); const id = this.id('Expected a surface contract name.');
    this.expect('{', 'Expected { to begin a surface contract.'); this.enter(); const slots: AssetSlotDecl[] = []; const charts: AssetChartAbiDecl[] = []; let atlas: AssetAtlasDecl | null = null; let atlasSeen = false; let material: AssetSurfaceContractDecl['material'] = null; let materialSeen = false;
    try { while (!this.check('}') && !this.end()) { if (this.checkWord('slot')) slots.push(this.slot(true)); else if (this.checkWord('atlas')) { if (atlasSeen) this.failSpan('asset.duplicate-atlas', 'A surface contract may contain only one atlas.', this.current().span); atlasSeen = true; atlas = this.atlas(); } else if (this.checkWord('chart')) charts.push(this.chartAbi()); else if (this.checkWord('material')) { const value = this.property(); const raw = valueName(value.value); if (materialSeen) this.failSpan('asset.duplicate-material', 'A surface contract may contain only one material.', value.span); materialSeen = true; if (raw !== 'opaque' && raw !== 'cutout' && raw !== 'double') this.failSpan('asset.invalid-material', 'Surface material must be opaque, cutout, or double.', value.value.span); else material = raw; } else this.scopeError('surface contract'); }
      const close = this.expect('}', 'Expected } to close a surface contract.'); return freeze({ kind: 'surface-contract', exported, id: id.value, atlas, charts: freeze(charts), material, slots: freeze(slots), span: join(start.span, close.span) });
    } finally { this.leave(); }
  }
  private atlas(): AssetAtlasDecl {
    const start = this.expectWord('atlas', 'Expected atlas.'); const values = this.properties('surface atlas'); this.closedProperties(values, ['width', 'height'], 'surface atlas');
    return freeze({ kind: 'atlas', width: values.find((entry) => entry.name === 'width')?.value ?? null, height: values.find((entry) => entry.name === 'height')?.value ?? null, span: join(start.span, this.tokens[Math.max(0, this.index - 1)]!.span) });
  }
  private chartAbi(): AssetChartAbiDecl {
    const start = this.expectWord('chart', 'Expected chart.'); const id = this.id('Expected chart name.'); const layoutToken = this.id('Expected chart layout box or flat.'); const layout = layoutToken.value as AssetChartAbiDecl['layout']; if (layout !== 'box' && layout !== 'flat') this.fail('asset.invalid-chart-layout', 'Chart layout must be box or flat.', layoutToken);
    const values = this.properties('surface chart'); this.closedProperties(values, ['width', 'height', 'coverage'], 'surface chart'); const coverageRaw = valueName(values.find((entry) => entry.name === 'coverage')?.value ?? ({ kind: 'name', value: '', span: id.span } as ProgramExpr)); const coverage = coverageRaw === 'opaque' || coverageRaw === 'binary' || coverageRaw === 'optional' ? coverageRaw : null; if (coverageRaw !== '' && coverage === null) this.fail('asset.invalid-coverage', 'Chart coverage must be opaque, binary, or optional.', id);
    return freeze({ kind: 'chart-abi', id: id.value, layout: layout === 'flat' ? 'flat' : 'box', width: values.find((entry) => entry.name === 'width')?.value ?? null, height: values.find((entry) => entry.name === 'height')?.value ?? null, coverage, span: join(start.span, this.tokens[Math.max(0, this.index - 1)]!.span) });
  }
  private surface(exported: boolean): AssetSurfaceDecl {
    const start = this.expectWord('surface', 'Expected surface.'); const id = this.id('Expected a surface name.'); this.expect(':', 'Expected : and a surface contract.'); const contract = this.qualified('Expected surface contract name.');
    this.expect('{', 'Expected { to begin a surface.'); this.enter(); const slots: AssetSlotDecl[] = []; let texture: ProgramTextureDecl | null = null; let textureSeen = false; let material: AssetSurfaceDecl['material'] = null; let materialSeen = false;
    try { while (!this.check('}') && !this.end()) { if (this.checkWord('slot')) slots.push(this.slot(false)); else if (this.checkWord('texture')) { if (textureSeen) this.failSpan('asset.duplicate-texture', 'A surface may contain only one texture.', this.current().span); textureSeen = true; texture = this.texture(); } else if (this.checkWord('material')) { const value = this.property(); const raw = valueName(value.value); if (materialSeen) this.failSpan('asset.duplicate-material', 'A surface may contain only one material.', value.span); materialSeen = true; if (raw !== 'opaque' && raw !== 'cutout' && raw !== 'double') this.failSpan('asset.invalid-material', 'Surface material must be opaque, cutout, or double.', value.value.span); else material = raw; } else this.scopeError('surface'); }
      const close = this.expect('}', 'Expected } to close a surface.'); return freeze({ kind: 'surface', exported, id: id.value, contract, texture, material, slots: freeze(slots), span: join(start.span, close.span) });
    } finally { this.leave(); }
  }
  private port(direction: AssetPortDecl['direction']): AssetPortDecl {
    const start = this.take(); const domainToken = this.id('Expected a port domain.'); const domain = domainToken.value as AssetPortDecl['domain'];
    if (!['rig', 'surface', 'socket'].includes(domain)) this.fail('asset.invalid-port-domain', 'Port domain must be rig, surface, or socket.', domainToken);
    const id = this.id('Expected a port name.'); this.expect(':', 'Expected : and a port type.'); const type = this.qualified('Expected a port type name.');
    let capacity: AssetPortDecl['capacity'] = null; let capacityTerminated = false;
    if (this.checkWord('capacity')) {
      const property = this.property(); capacityTerminated = true; const raw = valueName(property.value);
      if (domain !== 'socket' || direction !== 'provides') this.failSpan('asset.invalid-socket-capacity',
        'Only provided socket ports may declare capacity.', property.span);
      else if (raw !== 'one' && raw !== 'many') this.failSpan('asset.invalid-socket-capacity',
        'Socket capacity must be one or many.', property.value.span);
      else capacity = raw;
    } else if (domain === 'socket' && direction === 'provides') this.failSpan('asset.missing-socket-capacity',
      'Provided socket ports require an explicit capacity = one|many declaration.', id.span);
    if (!capacityTerminated) this.finish();
    return freeze({ kind: 'port', direction, domain, id: id.value, type, capacity, span: join(start.span, type.span) });
  }
  private component(exported: boolean): AssetComponentDecl {
    const start = this.expectWord('component', 'Expected component.'); const id = this.id('Expected component name.');
    this.expect('{', 'Expected { to begin a component.'); this.enter(); const parameters: AssetComponentParamDecl[] = []; const ports: AssetPortDecl[] = []; const jointBindings: AssetComponentJointBind[] = []; const socketBindings: AssetComponentSocketBind[] = []; let geometry: AssetGeometryPayload | null = null;
    try { while (!this.check('}') && !this.end()) { if (this.checkWord('param')) parameters.push(this.componentParam()); else if (this.checkWord('requires')) ports.push(this.port('requires')); else if (this.checkWord('provides')) ports.push(this.port('provides')); else if (this.checkWord('bind')) { if (this.tokens[this.index + 1]?.kind === 'identifier' && this.tokens[this.index + 1]?.value === 'socket') socketBindings.push(this.componentSocketBind()); else jointBindings.push(this.componentJointBind()); } else if (this.checkWord('geometry')) { const geometryStart = this.take(); geometry = parseGeometryPayload(this.geometryReader(), geometryStart); } else this.scopeError('component'); }
      const close = this.expect('}', 'Expected } to close a component.');
      return freeze({ kind: 'component', exported, id: id.value, parameters: freeze(parameters), ports: freeze(ports), jointBindings: freeze(jointBindings), socketBindings: freeze(socketBindings), geometry: geometry ?? freeze({ kind: 'geometry', statements: freeze([]), span: close.span }), span: join(start.span, close.span) });
    } finally { this.leave(); }
  }
  private componentParam(): AssetComponentParamDecl {
    const start = this.expectWord('param', 'Expected param.'); const id = this.id('Expected a component parameter name.');
    this.expect(':', 'Component parameters require a closed type.'); const type = this.valueType(); this.finish();
    return freeze({ kind: 'component-param', id: id.value, type, span: join(start.span, id.span) });
  }
  private componentJointBind(): AssetComponentJointBind {
    const start = this.expectWord('bind', 'Expected bind.'); this.expectWord('bone', 'Component bindings use bind bone <geometry-name> to <rig-joint>.'); const geometryBone = this.id('Expected a geometry bone name.'); this.expectWord('to', 'Expected to in a component joint binding.'); const rigJoint = this.qualified('Expected a rig joint name.'); this.finish(); return freeze({ kind: 'component-joint-bind', geometryBone: geometryBone.value, rigJoint, span: join(start.span, rigJoint.span) });
  }
  private componentSocketBind(): AssetComponentSocketBind {
    const start = this.expectWord('bind', 'Expected bind.');
    this.expectWord('socket', 'Expected socket after bind.');
    const port = this.id('Expected a socket port name.');
    this.expectWord('to', 'Expected to in a component socket binding.');
    this.expectWord('bone', 'Component socket bindings target a geometry bone.');
    const geometryBone = this.id('Expected a geometry bone name.');
    this.expect('{', 'Expected { to begin a component socket binding.'); this.enter();
    let frame: AssetFrameDecl | null = null;
    try {
      while (!this.check('}') && !this.end()) {
        if (this.checkWord('frame')) { if (frame !== null) this.failSpan('asset.duplicate-frame', 'A declaration may contain only one frame.', this.current().span); frame = this.frame(); } else this.scopeError('component socket binding');
      }
      const close = this.expect('}', 'Expected } to close a component socket binding.');
      return freeze({ kind: 'component-socket-bind', port: port.value,
        geometryBone: geometryBone.value, frame, span: join(start.span, close.span) });
    } finally { this.leave(); }
  }
  private track(): AssetTrackDecl {
    const start = this.expectWord('track', 'Expected track.'); const parts = [this.id('Expected a track target.').value];
    while (this.match('/')) parts.push(this.id('Expected a target path segment.').value);
    this.expect('.', 'Tracks require .position, .rotation, .scale, or .ik.'); const propertyToken = this.id('Expected a track property.');
    const property = propertyToken.value as AssetTrackDecl['property'];
    if (property !== 'rotation' && property !== 'scale') this.fail('asset.invalid-motion-property', 'Rig motion only supports rest-relative rotation and scale tracks; position and IK are forbidden.', propertyToken);
    this.expect('{', 'Expected { to begin a track.'); this.enter(); const keyframes: AssetKeyframeDecl[] = [];
    try { while (!this.check('}') && !this.end()) { const keyStart = this.expectWord('key', 'Tracks contain key declarations.'); const time = this.expression(); this.expect('=', 'Expected = in a key declaration.'); const value = this.expression(); let interpolation: AssetKeyframeDecl['interpolation'] = 'linear'; if (this.current().kind === 'identifier' && ['linear', 'step', 'catmullrom'].includes(this.current().value)) interpolation = this.take().value as AssetKeyframeDecl['interpolation']; else this.failSpan('asset.missing-interpolation', 'Every motion key must declare linear, step, or catmullrom explicitly.', value.span); this.finish(); keyframes.push(freeze({ kind: 'keyframe', time, value, interpolation, span: join(keyStart.span, value.span) })); }
      const close = this.expect('}', 'Expected } to close a track.'); return freeze({ kind: 'track', target: parts.join('/'), property: property === 'scale' ? 'scale' : 'rotation', keyframes: freeze(keyframes), span: join(start.span, close.span) });
    } finally { this.leave(); }
  }
  private motion(exported: boolean): AssetMotionDecl {
    const start = this.expectWord('motion', 'Expected motion.'); const id = this.id('Expected motion name.'); this.expectWord('for', 'Motion requires for <rig-contract>.'); const rig = this.qualified('Expected rig contract name.');
    this.expect('{', 'Expected { to begin a motion.'); this.enter(); const properties: AssetPropertyDecl[] = []; const tracks: AssetTrackDecl[] = [];
    try { while (!this.check('}') && !this.end()) { if (this.checkWord('track')) tracks.push(this.track()); else if (this.assignment()) properties.push(this.property()); else this.scopeError('motion'); }
      const close = this.expect('}', 'Expected } to close a motion.'); return freeze({ kind: 'motion', exported, id: id.value, rig, properties: freeze(properties), tracks: freeze(tracks), span: join(start.span, close.span) });
    } finally { this.leave(); }
  }
  private assemblyUse(): AssetAssemblyUse {
    const start = this.expectWord('use', 'Expected use.'); const component = this.qualified('Expected component name.'); this.expectWord('as', 'Expected as after component name.'); const id = this.id('Expected component instance name.');
    const parameterSets: AssetParamSetDecl[] = []; const portBindings: AssetPortBindingDecl[] = []; this.expect('{', 'Expected { to begin component bindings.'); this.enter();
    try { while (!this.check('}') && !this.end()) { if (this.checkWord('set')) parameterSets.push(this.parameterSet()); else if (this.checkWord('bind')) portBindings.push(this.portBinding()); else this.scopeError('asset component use'); }
      const close = this.expect('}', 'Expected } to close component bindings.'); this.finish(); return freeze({ kind: 'use', component, id: id.value, parameterSets: freeze(parameterSets), portBindings: freeze(portBindings), span: join(start.span, close.span) });
    } finally { this.leave(); }
  }
  private parameterSet(): AssetParamSetDecl {
    const start = this.expectWord('set', 'Expected set.'); const id = this.id('Expected a component parameter name.'); this.expect('=', 'Expected = in a parameter assignment.'); const value = this.expression(); this.finish();
    return freeze({ kind: 'param-set', id: id.value, value, span: join(start.span, value.span) });
  }
  private portBinding(): AssetPortBindingDecl {
    const start = this.expectWord('bind', 'Expected bind.'); const port = this.id('Expected a component port name.'); this.expect('=', 'Expected = in a component port binding.'); const target = this.qualified('Expected a qualified concrete component port target.'); this.finish();
    return freeze({ kind: 'port-binding', port: port.value, target, span: join(start.span, target.span) });
  }
  private connect(): AssetAssemblyConnect {
    const start = this.expectWord('connect', 'Expected connect.'); const from = this.qualified('Expected a source socket path.'); this.expect('-', 'Expected -> in a socket connection.'); this.expect('>', 'Expected -> in a socket connection.'); const to = this.qualified('Expected a target socket path.'); this.finish();
    return freeze({ kind: 'connect', from, to, span: join(start.span, to.span) });
  }
  private settings(): AssetSettingsDecl {
    const start = this.expectWord('settings', 'Expected settings.');
    const values = this.properties('asset settings'); this.closedProperties(values, ['density', 'forward'], 'asset settings');
    const density = values.find((entry) => entry.name === 'density')?.value ?? null;
    const forwardRaw = valueName(values.find((entry) => entry.name === 'forward')?.value ??
      ({ kind: 'name', value: '', span: start.span } as ProgramExpr));
    const forward = ['north', 'south', 'east', 'west'].includes(forwardRaw ?? '')
      ? forwardRaw as AssetSettingsDecl['forward'] : null;
    if (forward === null) this.failSpan('asset.invalid-forward',
      'Asset settings require forward = north|south|east|west.', start.span);
    return freeze({ kind: 'settings', density, forward,
      span: join(start.span, this.blockEnd()) });
  }
  private assembly(exported: boolean): AssetAssemblyDecl {
    const start = this.expectWord('asset', 'Expected asset.'); const id = this.id('Expected asset name.'); this.expect('{', 'Expected { to begin an asset assembly.'); this.enter();
    let settings: AssetSettingsDecl | null = null; let settingsSeen = false; let skeleton: AssetQualifiedName | null = null; let skeletonSeen = false; const motions: AssetQualifiedName[] = []; const uses: AssetAssemblyUse[] = []; const connections: AssetAssemblyConnect[] = [];
    try { while (!this.check('}') && !this.end()) { if (this.checkWord('settings')) { if (settingsSeen) this.failSpan('asset.duplicate-settings', 'An asset may contain only one settings block.', this.current().span); settingsSeen = true; settings = this.settings(); } else if (this.checkWord('skeleton')) { if (skeletonSeen) this.failSpan('asset.duplicate-skeleton', 'An asset may contain only one skeleton binding.', this.current().span); skeletonSeen = true; skeleton = this.namedAssignment('skeleton'); } else if (this.checkWord('motion')) motions.push(this.namedAssignment('motion')); else if (this.checkWord('use')) uses.push(this.assemblyUse()); else if (this.checkWord('connect')) connections.push(this.connect()); else this.scopeError('asset assembly'); }
      const close = this.expect('}', 'Expected } to close an asset assembly.'); return freeze({ kind: 'asset', exported, id: id.value, settings, skeleton, motions: freeze(motions), uses: freeze(uses), connections: freeze(connections), span: join(start.span, close.span) });
    } finally { this.leave(); }
  }
  private geometryReader(): AssetGeometryReader {
    return { current: () => this.current(), end: () => this.end(), take: () => this.take(), check: (v) => this.check(v), checkWord: (v) => this.checkWord(v), match: (v) => this.match(v), expect: (v, m) => this.expect(v, m), id: (m) => this.id(m), assignment: () => this.assignment(), expression: () => this.expression(), property: () => { const value = this.property(); return freeze({ kind: 'geometry-property', name: value.name, value: value.value, span: value.span }); }, surfaceBinding: (): AssetGeometrySurfaceBind => { const start = this.expectWord('surface', 'Expected surface.'); this.expect('=', 'Expected = in a surface chart binding.'); const surfacePort = this.id('Expected a surface port name.'); this.expect('.', 'Surface chart bindings require <surface-port>.<chart>.'); const chart = this.id('Expected a surface chart name.'); this.finish(); return freeze({ kind: 'geometry-surface-bind', surfacePort: surfacePort.value, chart: chart.value, span: join(start.span, chart.span) }); }, fail: (c, m, t) => this.fail(c, m, t), enterDepth: (t) => this.enter(t), leaveDepth: () => this.leave(), recover: () => this.recover() };
  }
  private declaration(exported: boolean): AssetDeclaration | null {
    this.count(); const keyword = this.current().value;
    if (keyword === 'design') return parseAssetDesign({ take: () => this.take(), id: (m) => this.id(m),
      count: () => this.count(), matchWord: (w) => this.matchWord(w), expect: (v, m) => this.expect(v, m),
      valueType: () => this.valueType(), expression: () => this.expression(), finish: () => this.finish(),
      block: (read) => { this.block(read); }, blockEnd: () => this.blockEnd() }, exported);
    if (keyword === 'socket') { this.take(); return this.socketContract(exported); }
    if (keyword === 'rig') { this.take(); return this.rigContract(exported); }
    if (keyword === 'skeleton') return this.skeleton(exported);
    if (keyword === 'surface') { if (this.tokens[this.index + 1]?.kind === 'identifier' && this.tokens[this.index + 1]?.value === 'contract') { this.take(); return this.surfaceContract(exported); } return this.surface(exported); }
    if (keyword === 'component') return this.component(exported);
    if (keyword === 'motion') return this.motion(exported);
    if (keyword === 'asset') return this.assembly(exported);
    this.scopeError('module or asset unit'); return null;
  }
  private unit(kind: AssetSourceUnit['kind']): AssetSourceUnit | null {
    const start = this.take(); const id = this.id('Expected a source unit name.'); this.expect('{', 'Expected { to begin a source unit.'); this.enter(); const imports: AssetImportDecl[] = []; const declarations: AssetDeclaration[] = [];
    try { while (!this.check('}') && !this.end()) { if (this.checkWord('import')) imports.push(this.importDecl()); else { const exported = this.matchWord('export'); const declaration = this.declaration(exported); if (declaration !== null) declarations.push(declaration); } }
      const close = this.expect('}', 'Expected } to close a source unit.'); return freeze({ kind, id: id.value, imports: freeze(imports), declarations: freeze(declarations), span: join(start.span, close.span) }) as AssetSourceUnit;
    } finally { this.leave(); }
  }
  parse(): AssetSourceUnit | null {
    const header = this.current(); const version = this.tokens[this.index + 1];
    if (header.kind !== 'identifier' || header.value !== 'ashfox-model' || version?.kind !== 'number' || version.value !== '1') { this.fail('asset.invalid-header', 'Expected "' + ASHFOX_ASSET_GRAMMAR + '".', header); return null; }
    this.take(); this.take(); const unit = this.checkWord('module') ? this.unit('module') : this.checkWord('asset') ? this.unit('asset') : null;
    if (unit === null) this.fail('asset.expected-unit', 'Source must declare one module or asset unit.');
    if (!this.end()) this.fail('asset.trailing-source', 'Only one source unit is allowed.');
    return unit;
  }
  result(): AssetSourceParseResult { let unit: AssetSourceUnit | null = null; try { unit = this.parse(); } catch (error) { if (!(error instanceof ParserAbort)) this.fail('asset.parser-failure', 'Source could not be parsed safely.'); } if (this.diagnostics.length > 0) unit = null;
    return freeze({ path: this.path, source: this.source, grammar: ASHFOX_ASSET_GRAMMAR, unit, diagnostics: freeze([...this.diagnostics].sort((a, b) => a.span.start.offset - b.span.start.offset || a.code.localeCompare(b.code))) }); }
}
