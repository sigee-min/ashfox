const { execFileSync } = require('child_process');
const path = require('path');

const assertRatchetLines = (ratchetLines) => {
  if (!Number.isSafeInteger(ratchetLines) || ratchetLines < 1) {
    throw new Error('source-size ratchet requires a positive integer limit');
  }
};

const sourceSizeRatchetViolations = (fileStats, baseline, ratchetLines) => {
  assertRatchetLines(ratchetLines);
  const findings = [];
  const statsByFile = new Map(fileStats.map((stat) => [stat.file, stat]));
  for (const { file, lines } of fileStats) {
    const committed = baseline[file];
    if (lines <= ratchetLines) continue;
    if (typeof committed !== 'number') {
      findings.push({
        file,
        lines,
        baseline: null,
        allowed: ratchetLines,
        reason: 'new source file exceeds the ratchet threshold',
      });
      continue;
    }
    if (lines > committed) {
      findings.push({
        file,
        lines,
        baseline: committed,
        allowed: committed,
        reason: 'source file grew beyond its committed baseline',
      });
      continue;
    }
    if (lines < committed) {
      findings.push({
        file,
        lines,
        baseline: committed,
        allowed: lines,
        reason: 'committed baseline must be lowered to the current size',
      });
    }
  }
  for (const [file, committed] of Object.entries(baseline)) {
    const stat = statsByFile.get(file);
    if (stat && stat.lines > ratchetLines) continue;
    findings.push({
      file,
      lines: stat?.lines ?? 0,
      baseline: committed,
      allowed: ratchetLines,
      reason: stat
        ? 'baseline entry must be removed after crossing the threshold'
        : 'baseline entry refers to a missing source file',
    });
  }
  return findings;
};

const sameBaseline = (left, right) => {
  const leftEntries = Object.entries(left).sort(([leftKey], [rightKey]) =>
    leftKey.localeCompare(rightKey),
  );
  const rightEntries = Object.entries(right).sort(([leftKey], [rightKey]) =>
    leftKey.localeCompare(rightKey),
  );
  return JSON.stringify(leftEntries) === JSON.stringify(rightEntries);
};

const readHistoricalSourceSizeBaselines = ({ repoRoot, baselinePath, currentBaseline }) => {
  const relativeBaselinePath = path.relative(repoRoot, baselinePath).replace(/\\/g, '/');
  try {
    const insideWorkTree = execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (insideWorkTree !== 'true') return [];
    const shallow =
      execFileSync('git', ['rev-parse', '--is-shallow-repository'], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim() === 'true';
    if (shallow) {
      throw new Error(
        'source-size history is unavailable in a shallow clone; fetch full ' +
          'history before running quality:architecture',
      );
    }
    const revisions = execFileSync('git', ['log', '--format=%H', '--', relativeBaselinePath], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .trim()
      .split(/\r?\n/)
      .filter(Boolean);
    const snapshots = revisions.flatMap((revision) => {
      try {
        const raw = execFileSync('git', ['show', `${revision}:${relativeBaselinePath}`], {
          cwd: repoRoot,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        });
        return [JSON.parse(raw)];
      } catch {
        // A deletion commit has no file to show. Preserve that absence so a
        // later reintroduction cannot reuse the file's older allowance.
        return [{}];
      }
    });
    if (snapshots[0] && sameBaseline(snapshots[0], currentBaseline)) {
      snapshots.shift();
    }
    return snapshots;
  } catch (error) {
    if (error instanceof Error && error.message.includes('shallow clone')) {
      throw error;
    }
    return [];
  }
};

const sourceSizeHistoryViolations = (currentBaseline, historicalBaselines, ratchetLines) => {
  assertRatchetLines(ratchetLines);
  if (historicalBaselines.length === 0) return [];
  const findings = [];
  for (const [file, lines] of Object.entries(currentBaseline)) {
    const historicalValues = historicalBaselines.map((baseline) => baseline[file]);
    if (historicalValues.some((value) => typeof value !== 'number')) {
      findings.push({
        file,
        lines,
        baseline: lines,
        allowed: ratchetLines,
        reason: 'baseline entry is new or was previously removed',
      });
      continue;
    }
    const allowed = Math.min(...historicalValues);
    if (lines > allowed) {
      findings.push({
        file,
        lines,
        baseline: lines,
        allowed,
        reason: 'baseline increased relative to repository history',
      });
    }
  }
  return findings;
};

module.exports = {
  readHistoricalSourceSizeBaselines,
  sourceSizeHistoryViolations,
  sourceSizeRatchetViolations,
};
