'use strict';

/**
 * Function complexity ratchet: per-function line length, control nesting depth
 * and cognitive complexity for the scopes declared in
 * development-manifest.json `quality.complexity`. Existing violations live in a
 * committed baseline that may only shrink.
 */
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '..', '..');
const LOGICAL_OPERATORS = new Set([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
]);
const METRICS = Object.freeze(['lines', 'nesting', 'cognitive']);

const isFunction = (node) => ts.isFunctionLike(node) && Boolean(node.body);

const isLoop = (node) =>
  ts.isForStatement(node) ||
  ts.isForInStatement(node) ||
  ts.isForOfStatement(node) ||
  ts.isWhileStatement(node) ||
  ts.isDoStatement(node);

const isElseIf = (node) =>
  ts.isIfStatement(node) && ts.isIfStatement(node.parent) && node.parent.elseStatement === node;

const unwrap = (node) => (ts.isParenthesizedExpression(node) ? unwrap(node.expression) : node);

const isLogical = (node) =>
  ts.isBinaryExpression(node) && LOGICAL_OPERATORS.has(node.operatorToken.kind);

const scopeName = (node, sourceFile) => {
  if (ts.isConstructorDeclaration(node)) return 'constructor';
  if (node.name && !ts.isComputedPropertyName(node.name)) return node.name.getText(sourceFile);
  const parent = node.parent;
  if (parent && (ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent))) {
    return parent.name.getText(sourceFile);
  }
  if (parent && ts.isPropertyDeclaration(parent)) return parent.name.getText(sourceFile);
  if (parent && ts.isCallExpression(parent)) {
    const callee = ts.isPropertyAccessExpression(parent.expression)
      ? parent.expression.name.getText(sourceFile)
      : parent.expression.getText(sourceFile);
    return `<${callee.slice(0, 40)} callback>`;
  }
  return '<anonymous>';
};

/** Maximum depth of nested control statements in one function body. */
const nestingDepth = (body) => {
  let max = 0;
  const visit = (node, depth) => {
    if (isFunction(node)) return;
    let next = depth;
    if (
      (ts.isIfStatement(node) && !isElseIf(node)) ||
      isLoop(node) ||
      ts.isSwitchStatement(node) ||
      ts.isTryStatement(node)
    ) {
      next = depth + 1;
      max = Math.max(max, next);
    }
    ts.forEachChild(node, (child) => visit(child, next));
  };
  visit(body, 0);
  return max;
};

const logicalSequences = (node) => {
  const operators = [];
  const collect = (value) => {
    const current = unwrap(value);
    if (!isLogical(current)) return;
    collect(current.left);
    operators.push(current.operatorToken.kind);
    collect(current.right);
  };
  collect(node);
  return operators.filter((operator, index) => index === 0 || operators[index - 1] !== operator)
    .length;
};

const logicalOperands = (node) => {
  const current = unwrap(node);
  return isLogical(current)
    ? [...logicalOperands(current.left), ...logicalOperands(current.right)]
    : [current];
};

/** Cognitive complexity (SonarSource model) including nested callbacks. */
const cognitiveComplexity = (body) => {
  let total = 0;
  const visit = (node, nesting) => {
    if (isLogical(node)) {
      total += logicalSequences(node);
      for (const operand of logicalOperands(node)) visit(operand, nesting);
      return;
    }
    if (ts.isIfStatement(node)) {
      total += isElseIf(node) ? 1 : 1 + nesting;
      visit(node.expression, nesting);
      visit(node.thenStatement, nesting + 1);
      if (node.elseStatement && ts.isIfStatement(node.elseStatement)) {
        visit(node.elseStatement, nesting);
      } else if (node.elseStatement) {
        total += 1;
        visit(node.elseStatement, nesting + 1);
      }
      return;
    }
    if (isLoop(node) || ts.isSwitchStatement(node) || ts.isCatchClause(node)) {
      total += 1 + nesting;
      ts.forEachChild(node, (child) => visit(child, nesting + 1));
      return;
    }
    if (ts.isConditionalExpression(node)) {
      total += 1 + nesting;
      visit(node.condition, nesting);
      visit(node.whenTrue, nesting + 1);
      visit(node.whenFalse, nesting + 1);
      return;
    }
    if ((ts.isBreakStatement(node) || ts.isContinueStatement(node)) && node.label) total += 1;
    const next = isFunction(node) ? nesting + 1 : nesting;
    ts.forEachChild(node, (child) => visit(child, next));
  };
  visit(body, 0);
  return total;
};

/** Measures every function in one source file. */
const functionMetrics = (file, source) => {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const results = [];
  const ordinals = new Map();
  const visit = (node, names, insideFunction) => {
    const named = isFunction(node) || ts.isClassLike(node);
    const chain = named ? [...names, scopeName(node, sourceFile)] : names;
    if (isFunction(node)) {
      const qualified = chain.join('/');
      const ordinal = (ordinals.get(qualified) ?? 0) + 1;
      ordinals.set(qualified, ordinal);
      const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
      const end = sourceFile.getLineAndCharacterOfPosition(node.end).line + 1;
      results.push({
        key: `${file}::${qualified}${ordinal > 1 ? `#${ordinal}` : ''}`,
        start,
        lines: end - start + 1,
        nesting: nestingDepth(node.body),
        // Nested functions contribute to their enclosing function's score.
        cognitive: insideFunction ? 0 : cognitiveComplexity(node.body),
      });
    }
    ts.forEachChild(node, (child) => visit(child, chain, insideFunction || isFunction(node)));
  };
  visit(sourceFile, [], false);
  return results;
};

const limitsOf = (policy) => ({
  lines: policy.maxFunctionLines,
  nesting: policy.maxNestingDepth,
  cognitive: policy.maxCognitiveComplexity,
});

/** Metrics above their limit for every offending function, keyed and sorted. */
const exceedances = (metrics, policy) => {
  const limits = limitsOf(policy);
  const entries = metrics
    .map((metric) => [
      metric.key,
      Object.fromEntries(
        METRICS.filter((name) => metric[name] > limits[name]).map((name) => [name, metric[name]]),
      ),
    ])
    .filter(([, values]) => Object.keys(values).length > 0)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return Object.fromEntries(entries);
};

/** Compares current exceedances with the committed baseline. */
const complexityViolations = (current, baseline) => {
  const findings = [];
  for (const [key, values] of Object.entries(current)) {
    for (const [metric, value] of Object.entries(values)) {
      const allowed = baseline[key]?.[metric];
      if (allowed === undefined) findings.push(`${key}: new ${metric} ${value} exceeds the limit`);
      else if (value > allowed) findings.push(`${key}: ${metric} grew from ${allowed} to ${value}`);
    }
  }
  for (const [key, values] of Object.entries(baseline)) {
    for (const [metric, allowed] of Object.entries(values)) {
      const value = current[key]?.[metric];
      if (value === undefined || value < allowed) {
        findings.push(
          `${key}: baseline ${metric} ${allowed} is stale (now ${value ?? 'within limit'}); ` +
            'run node scripts/quality/complexity.js --write',
        );
      }
    }
  }
  return findings;
};

/** Baseline that only shrinks: keeps current values that do not exceed the old ones. */
const tightenedBaseline = (current, baseline, acceptNew) => {
  const next = {};
  for (const [key, values] of Object.entries(current)) {
    const kept = Object.entries(values).filter(([metric, value]) => {
      const allowed = baseline[key]?.[metric];
      return allowed === undefined ? acceptNew : value <= allowed;
    });
    if (kept.length) next[key] = Object.fromEntries(kept);
  }
  return next;
};

const sourceFiles = (scopes, root = ROOT) => {
  const files = [];
  const walk = (directory) => {
    for (const entry of fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => (left.name < right.name ? -1 : 1))) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(target);
      else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) files.push(target);
    }
  };
  for (const scope of scopes) walk(path.join(root, scope));
  return files;
};

const main = () => {
  const { readDevelopmentManifest } = require('./manifest');
  const policy = readDevelopmentManifest(ROOT).quality.complexity;
  const baselinePath = path.join(ROOT, policy.baseline);
  const metrics = sourceFiles(policy.scopes).flatMap((file) =>
    functionMetrics(path.relative(ROOT, file).replace(/\\/g, '/'), fs.readFileSync(file, 'utf8')),
  );
  const current = exceedances(metrics, policy);
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  if (process.argv.includes('--write')) {
    const next = tightenedBaseline(current, baseline, process.argv.includes('--accept-new'));
    fs.writeFileSync(baselinePath, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`complexity baseline written: ${Object.keys(next).length} functions`);
    return;
  }
  const findings = complexityViolations(current, baseline);
  if (findings.length) {
    console.error('ashfox complexity gate failed:');
    for (const finding of findings) console.error(`- ${finding}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `ashfox complexity gate ok: ${metrics.length} functions, ` +
      `${Object.keys(baseline).length} baselined (limits: lines ${policy.maxFunctionLines}, ` +
      `nesting ${policy.maxNestingDepth}, cognitive ${policy.maxCognitiveComplexity})`,
  );
};

if (require.main === module) main();

module.exports = Object.freeze({
  complexityViolations,
  exceedances,
  functionMetrics,
  tightenedBaseline,
});
