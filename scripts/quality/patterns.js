'use strict';

const ts = require('typescript');

/** Executable implementations for the manifest-owned source rules. */
const LINE_PATTERN_REGISTRY = Object.freeze({
  'as-any': /\bas any\b/,
  'as-unknown-as': /\bas unknown as\b/,
  'bare-document': /(^|[^\w.])document\s*(\.|\?\.|\[|\()/,
  'bare-window': /(^|[^\w.])window\s*(\.|\?\.|\[|\()/,
  'catch-without-binding': /catch\s*\{/,
  'console-in-src': /\bconsole\.(log|warn|error|info|debug)\(/,
  'engine-core-host-dependency':
    /@ashfox\/blockbench-|@ashfox\/backend-|\bBlockbench\b|\bMCP\b|\/mcp\b|from ['"](?:react|next|three)['"]/,
  'globalThis-as': /\bglobalThis\s+as\b/,
  'throw-in-src': /\bthrow\b/,
  'todo-fixme-comment': /\/\/\s*(TODO|FIXME)\b|\/\*\s*(TODO|FIXME)\b/,
  'ts-ignore': /@ts-ignore|@ts-expect-error/,
  'browser-authoring-contract':
    /window\.ashfox|data-ashfox-agent-manifest|agent-manifest\.json/
});
const AST_PATTERN_IDS = Object.freeze([
  'double-assertion',
  'explicit-any'
]);

const compareText = (left, right) =>
  left < right ? -1 : left > right ? 1 : 0;

const registryIds = () => [
  ...Object.keys(LINE_PATTERN_REGISTRY),
  ...AST_PATTERN_IDS
].sort(compareText);

const assertSourcePatternRegistryMatches = (policies) => {
  const declared = policies.map((policy) => policy.id).sort(compareText);
  const implemented = registryIds();
  if (JSON.stringify(declared) !== JSON.stringify(implemented)) {
    throw new Error(
      'quality: forbidden source rule implementations do not match ' +
      'development-manifest.json'
    );
  }
};

const policyAppliesToPath = (policy, relativePath) =>
  policy.scope.some((prefix) => relativePath.startsWith(prefix)) &&
  !policy.allowedPaths.includes(relativePath);

const linePatternFindings = (relativePath, source, policiesById) => {
  const findings = [];
  const lines = source.split(/\r?\n/);
  for (const [id, pattern] of Object.entries(LINE_PATTERN_REGISTRY)) {
    const policy = policiesById.get(id);
    if (!policy || !policyAppliesToPath(policy, relativePath)) continue;
    for (let index = 0; index < lines.length; index += 1) {
      if (!pattern.test(lines[index])) continue;
      findings.push({
        file: relativePath,
        line: index + 1,
        rule: id,
        snippet: lines[index].trim().slice(0, 200)
      });
    }
  }
  return findings;
};

const astPatternFindings = (
  filePath,
  relativePath,
  source,
  policiesById
) => {
  const active = new Set(AST_PATTERN_IDS.filter((id) => {
    const policy = policiesById.get(id);
    return policy && policyAppliesToPath(policy, relativePath);
  }));
  if (active.size === 0) return [];
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const lines = source.split(/\r?\n/);
  const findings = [];
  const report = (node, rule) => {
    const line = sourceFile.getLineAndCharacterOfPosition(
      node.getStart(sourceFile)
    ).line + 1;
    findings.push({
      file: relativePath,
      line,
      rule,
      snippet: lines[line - 1].trim().slice(0, 200)
    });
  };
  const visit = (node) => {
    if (active.has('explicit-any') && node.kind === ts.SyntaxKind.AnyKeyword) {
      report(node, 'explicit-any');
    }
    if (
      active.has('double-assertion') &&
      ts.isAsExpression(node) &&
      ts.isAsExpression(node.expression) &&
      (node.expression.type.kind === ts.SyntaxKind.UnknownKeyword ||
        node.expression.type.kind === ts.SyntaxKind.AnyKeyword)
    ) {
      report(node, 'double-assertion');
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return findings;
};

const sourcePatternFindings = (
  filePath,
  relativePath,
  source,
  policies
) => {
  const policiesById = new Map(policies.map((policy) => [policy.id, policy]));
  return [
    ...linePatternFindings(relativePath, source, policiesById),
    ...astPatternFindings(filePath, relativePath, source, policiesById)
  ];
};

module.exports = {
  assertSourcePatternRegistryMatches,
  sourcePatternFindings
};
