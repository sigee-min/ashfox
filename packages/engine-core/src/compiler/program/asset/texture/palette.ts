import type {
  ProgramExpr,
  ProgramProperty,
  ProgramTexturePalette,
} from '../../../../project/program/syntax/contract';
import type { SourceSpan } from '../../../../project/source/contract';
import type { AssetTextureIssue } from './contract';
import type { TextureExpressionContext } from './expressions';

export type PaletteRole =
  | Readonly<{ readonly kind: 'accent'; readonly color: string }>
  | Readonly<{
      readonly kind: 'ramp';
      readonly shadow: string;
      readonly base: string;
      readonly light: string;
    }>;

const colorLiteral = /^#[0-9a-f]{6}$/iu;

const colorValues = (
  expression: ProgramExpr,
  context: TextureExpressionContext,
): readonly string[] | null => {
  if (
    expression.kind === 'vector' &&
    Array.isArray(expression.values) &&
    expression.values.length === 3
  ) {
    const values = expression.values.map((entry) => context.evaluate(entry, 'color'));
    return values.every((value) => value?.kind === 'color' && colorLiteral.test(value.value))
      ? values.map((value) =>
          value === null || value.kind !== 'color' ? '#000000' : value.value.toLowerCase(),
        )
      : null;
  }
  const value = context.evaluate(expression, 'color');
  return value?.kind === 'color' && colorLiteral.test(value.value)
    ? [value.value.toLowerCase()]
    : null;
};

const luma = (value: string): number =>
  Number.parseInt(value.slice(1, 3), 16) * 2126 +
  Number.parseInt(value.slice(3, 5), 16) * 7152 +
  Number.parseInt(value.slice(5, 7), 16) * 722;

const isIncreasingRamp = (colors: readonly string[]): boolean =>
  luma(colors[0]!) < luma(colors[1]!) && luma(colors[1]!) < luma(colors[2]!);

/** One palette role's accent or ramp, or null after reporting an invalid color set. */
const readPaletteRole = (
  entry: ProgramProperty,
  context: TextureExpressionContext,
  path: string,
  issue: AssetTextureIssue,
): PaletteRole | null => {
  const colors = colorValues(entry.value, context);
  if (colors === null) {
    issue(
      path,
      entry.value.span,
      'asset.texture.invalid-color',
      'Palette roles require one color or a three-color ramp.',
    );
    return null;
  }
  if (colors.length === 1) return Object.freeze({ kind: 'accent', color: colors[0]! });
  if (isIncreasingRamp(colors)) {
    return Object.freeze({ kind: 'ramp', shadow: colors[0]!, base: colors[1]!, light: colors[2]! });
  }
  issue(
    path,
    entry.value.span,
    'asset.texture.invalid-ramp',
    'Palette ramp colors must increase from shadow to base to light.',
  );
  return null;
};

/** Whether a palette entry is a well-formed, first declaration of its role name. */
const acceptPaletteEntry = (
  entry: ProgramProperty,
  declaration: ProgramTexturePalette,
  seen: Set<string>,
  path: string,
  issue: AssetTextureIssue,
): boolean => {
  if (entry === null || typeof entry !== 'object' || typeof entry.name !== 'string') {
    issue(
      path,
      declaration.span,
      'asset.texture.invalid-palette-role',
      'Palette role declaration is malformed.',
    );
    return false;
  }
  if (seen.has(entry.name)) {
    issue(
      path,
      entry.span,
      'asset.texture.duplicate-role',
      'Palette role "' + entry.name + '" is declared more than once.',
    );
    return false;
  }
  seen.add(entry.name);
  return true;
};

/** Resolve and validate every color role in a surface palette block. */
export const readPalette = (
  declaration: ProgramTexturePalette,
  context: TextureExpressionContext,
  path: string,
  issue: AssetTextureIssue,
): ReadonlyMap<string, PaletteRole> | null => {
  const result = new Map<string, PaletteRole>();
  let valid = true;
  const seen = new Set<string>();
  if (
    declaration === null ||
    typeof declaration !== 'object' ||
    !Array.isArray(declaration.properties)
  ) {
    issue(
      path,
      context.ownerSpan,
      'asset.texture.invalid-palette',
      'Texture palette is malformed.',
    );
    return null;
  }
  for (const entry of declaration.properties) {
    const role = acceptPaletteEntry(entry, declaration, seen, path, issue)
      ? readPaletteRole(entry, context, path, issue)
      : null;
    if (role === null) valid = false;
    else result.set(entry.name, role);
  }
  if (result.size === 0) {
    issue(
      path,
      declaration.span,
      'asset.texture.empty-palette',
      'Texture palette requires at least one valid role.',
    );
    valid = false;
  }
  return valid ? result : null;
};

/** Resolve a named palette role reference, enforcing ramp-only usage when required. */
export const readRole = (
  expression: ProgramExpr,
  palette: ReadonlyMap<string, PaletteRole>,
  requireRamp: boolean,
  path: string,
  issue: AssetTextureIssue,
  fallback: SourceSpan,
): Readonly<{ readonly name: string; readonly role: PaletteRole }> | null => {
  if (expression.kind !== 'name') {
    issue(
      path,
      expression.span ?? fallback,
      'asset.texture.invalid-role',
      'Paint operations must name a palette role.',
    );
    return null;
  }
  const selected = palette.get(expression.value);
  if (selected === undefined) {
    issue(
      path,
      expression.span,
      'asset.texture.unknown-role',
      'Unknown palette role "' + expression.value + '".',
    );
    return null;
  }
  if (requireRamp && selected.kind !== 'ramp') {
    issue(
      path,
      expression.span,
      'asset.texture.ramp-required',
      'This paint operation requires a three-color palette ramp.',
    );
    return null;
  }
  return Object.freeze({ name: expression.value, role: selected });
};
