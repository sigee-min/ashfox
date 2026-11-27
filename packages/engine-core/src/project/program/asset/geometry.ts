import { freeze } from '../../../immutable';
import type { ProgramExpr } from '../syntax/contract';
import type { ProgramToken } from '../syntax/lex';
import type { SourceSpan } from '../../source/contract';
import type {
  AssetGeometryBlock,
  AssetGeometryPayload,
  AssetGeometryProperty,
  AssetGeometrySurfaceBind,
  AssetGeometryStatement,
} from './contract';

export interface AssetGeometryReader {
  readonly current: () => ProgramToken;
  readonly end: () => boolean;
  readonly take: () => ProgramToken;
  readonly check: (value: string) => boolean;
  readonly checkWord: (value: string) => boolean;
  readonly match: (value: string) => boolean;
  readonly expect: (value: string, message: string) => ProgramToken;
  readonly id: (message: string) => ProgramToken;
  readonly assignment: () => boolean;
  readonly expression: () => ProgramExpr;
  readonly property: () => AssetGeometryProperty;
  readonly surfaceBinding: () => AssetGeometrySurfaceBind;
  readonly fail: (code: string, message: string, token?: ProgramToken) => void;
  readonly enterDepth: (token?: ProgramToken) => void;
  readonly leaveDepth: () => void;
  readonly recover: () => void;
}

const join = (left: SourceSpan, right: SourceSpan): SourceSpan =>
  Object.freeze({ start: left.start, end: right.end });

const keywords = new Set([
  'bone',
  'cube',
  'plane',
  'taper',
  'wedge',
  'cylinder',
  'expression_slot',
  'locator',
  'face',
]);

const block = (reader: AssetGeometryReader): AssetGeometryBlock => {
  const start = reader.take();
  const keyword = start.value as AssetGeometryBlock['keyword'];
  const id = reader.id('Expected a geometry node name.').value;
  reader.expect('{', 'Expected { to begin a geometry node.');
  reader.enterDepth(start);
  const statements: AssetGeometryStatement[] = [];
  try {
    while (!reader.check('}') && !reader.end()) {
      if (reader.checkWord('surface')) statements.push(reader.surfaceBinding());
      else if (reader.assignment()) statements.push(reader.property());
      else if (reader.current().kind === 'identifier' && keywords.has(reader.current().value))
        statements.push(block(reader));
      else {
        reader.fail(
          'asset.invalid-geometry-scope',
          'Only geometry nodes and properties are allowed in a component geometry block.',
        );
        reader.recover();
      }
    }
    const close = reader.expect('}', 'Expected } to close a geometry node.');
    return freeze({
      kind: 'geometry-block',
      keyword,
      id,
      statements: freeze(statements),
      span: join(start.span, close.span),
    });
  } finally {
    reader.leaveDepth();
  }
};

export const parseGeometryPayload = (
  reader: AssetGeometryReader,
  start: ProgramToken,
): AssetGeometryPayload => {
  reader.expect('{', 'Expected { to begin component geometry.');
  reader.enterDepth(start);
  const statements: AssetGeometryStatement[] = [];
  try {
    while (!reader.check('}') && !reader.end()) {
      if (reader.checkWord('surface')) statements.push(reader.surfaceBinding());
      else if (reader.assignment()) statements.push(reader.property());
      else if (reader.current().kind === 'identifier' && keywords.has(reader.current().value))
        statements.push(block(reader));
      else {
        reader.fail(
          'asset.invalid-geometry-scope',
          'Component geometry accepts only bone, cube, plane, locator, face, and properties.',
        );
        reader.recover();
      }
    }
    const close = reader.expect('}', 'Expected } to close component geometry.');
    return freeze({
      kind: 'geometry',
      statements: freeze(statements),
      span: join(start.span, close.span),
    });
  } finally {
    reader.leaveDepth();
  }
};
