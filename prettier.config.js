'use strict';

// Derived configuration: the style authority is development-manifest.json.
const { engineering } = require('./development-manifest.json');

const { style } = engineering;

module.exports = {
  printWidth: style.printWidth,
  tabWidth: style.indentSpaces,
  useTabs: false,
  semi: style.semicolons === 'required',
  singleQuote: style.quotes === 'single',
  jsxSingleQuote: false,
  trailingComma: 'all',
  arrowParens: 'always',
  // Template literal contents are data (DSL sources, HTML, shaders); never reformat them.
  embeddedLanguageFormatting: 'off',
  endOfLine: 'lf'
};
