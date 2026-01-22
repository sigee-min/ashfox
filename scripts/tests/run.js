const path = require('path');
const { register } = require('ts-node');

register({
  transpileOnly: true,
  compilerOptions: {
    module: 'CommonJS'
  }
});

const tests = ['uvAtlas.test.ts', 'uvPaintPixels.test.ts'];
for (const test of tests) {
  require(path.join(__dirname, test));
}

console.log('tests ok');
