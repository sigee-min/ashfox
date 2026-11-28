const escapeHtml = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const KEYWORDS = new Set([
  'ashfox',
  'import',
  'as',
  'export',
  'module',
  'model',
  'sprite',
  'sound',
  'structure',
  'vfx',
  'design',
  'rig',
  'skeleton',
  'component',
  'surface',
  'motion',
  'asset',
  'palette',
  'material',
  'chart',
  'cube',
  'plane',
  'taper',
  'wedge',
  'cylinder',
  'rect',
  'paint',
  'fill',
  'pattern',
  'grain',
  'outline',
  'shade',
  'voice',
  'seq',
  'step',
  'variants',
  'master',
  'space',
  'filter',
  'gain',
  'loop',
  'floor',
  'room',
  'facade',
  'roof',
  'furnish',
  'weathering',
  'interior',
  'anchor',
  'zone',
  'element',
  'emitter',
  'params',
  'preview',
  'outputs',
  'for',
  'in',
  'true',
  'false',
  'once',
]);

const TOKEN_RE =
  /(\/\/[^\n]*|"(?:[^"\\]|\\.)*"|#[0-9a-fA-F]{3,8}\b|-?\d+(?:\.\d+)?(?:px|ms|hz|lufs|db|deg|tx|s|u|b|%)?|\b[A-Za-z_][A-Za-z0-9_]*\b)/gu;

const renderSwatch = (hex) => {
  const safe = escapeHtml(hex);
  return `<span class="tok-swatch" style="--swatch:${safe}" aria-hidden="true"></span><span class="tok-hex">${safe}</span>`;
};

const highlightString = (token) => {
  const hexMatch = token.match(/#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?\b/u);
  if (!hexMatch) return `<span class="tok-str">${escapeHtml(token)}</span>`;
  const idx = hexMatch.index;
  const before = token.slice(0, idx);
  const hex = hexMatch[0];
  const after = token.slice(idx + hex.length);
  return `<span class="tok-str">${escapeHtml(before)}</span>${renderSwatch(hex)}<span class="tok-str">${escapeHtml(after)}</span>`;
};

const highlightLine = (line) => {
  let out = '';
  let last = 0;
  for (const match of line.matchAll(TOKEN_RE)) {
    const idx = match.index ?? 0;
    if (idx > last) out += escapeHtml(line.slice(last, idx));
    const tok = match[0];
    if (tok.startsWith('//')) {
      out += `<span class="tok-cmt">${escapeHtml(tok)}</span>`;
    } else if (tok.startsWith('"')) {
      out += highlightString(tok);
    } else if (tok.startsWith('#')) {
      out += renderSwatch(tok);
    } else if (/^-?\d/u.test(tok)) {
      out += `<span class="tok-num">${escapeHtml(tok)}</span>`;
    } else if (KEYWORDS.has(tok)) {
      out += `<span class="tok-kw">${escapeHtml(tok)}</span>`;
    } else {
      out += escapeHtml(tok);
    }
    last = idx + tok.length;
  }
  if (last < line.length) out += escapeHtml(line.slice(last));
  return out || ' ';
};

export const highlightAshfox = (source) =>
  String(source || '')
    .split(/\r?\n/u)
    .map(
      (line, index) =>
        `<span class="code-line" data-line="${index + 1}">${highlightLine(line)}</span>`,
    )
    .join('\n');
