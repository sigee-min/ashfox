'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const HME = require('h264-mp4-encoder');
const { GifReader } = require('omggif');

const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'assets/showcase/shared-creatures');
const cli = path.join(root, 'apps/cli/dist/ashfox.cjs');
const sources = {
  griffin: 'examples/griffin/workbench/main.ashfox',
  fox: 'examples/fox/creatures/fox.ashfox',
  goblin: 'examples/goblin/creatures/goblin.ashfox',
};
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'ashfox-showcase-'));
const run = (args) =>
  execFileSync(process.execPath, [cli, ...args], {
    cwd: root,
    maxBuffer: 32 * 1024 * 1024,
    timeout: 120_000,
  });

const renderWithPreview = (entryRel, previewBody, outPath) => {
  const absEntry = path.join(root, entryRel);
  const dir = path.dirname(absEntry);
  const entryName = path.basename(absEntry);
  const files = {};
  for (const file of fs.readdirSync(dir)) {
    if (file !== entryName && file.endsWith('.ashfox')) {
      files[file] = fs.readFileSync(path.join(dir, file), 'utf8');
    }
  }
  const source = fs
    .readFileSync(absEntry, 'utf8')
    .replace(/(\}\s*)$/, `  preview showcase {\n${previewBody}\n  }\n$1`);
  return execFileSync(
    process.execPath,
    [cli, 'render', '--input-json', '--view', 'showcase', '--output', outPath],
    {
      input: JSON.stringify({ source, name: entryName, files }),
      cwd: root,
      maxBuffer: 32 * 1024 * 1024,
      timeout: 120_000,
    },
  );
};

const clearRect = (canvas, stride, rect) => {
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    const start = (y * stride + rect.x) * 4;
    canvas.fill(0, start, start + rect.width * 4);
  }
};

const gifToMp4 = async (gifPath, mp4Path) => {
  const reader = new GifReader(fs.readFileSync(gifPath));
  const encoder = await HME.createH264MP4Encoder();
  try {
    encoder.width = reader.width;
    encoder.height = reader.height;
    encoder.frameRate = 10;
    encoder.quantizationParameter = 20;
    encoder.speed = 5;
    encoder.initialize();
    const canvas = new Uint8Array(reader.width * reader.height * 4);
    let prevDisposal = 0;
    let prevInfo = null;
    let savedCanvas = null;
    for (let i = 0; i < reader.numFrames(); i++) {
      if (prevDisposal === 2 && prevInfo) clearRect(canvas, reader.width, prevInfo);
      else if (prevDisposal === 3 && savedCanvas) canvas.set(savedCanvas);
      const info = reader.frameInfo(i);
      savedCanvas = info.disposal === 3 ? canvas.slice() : null;
      reader.decodeAndBlitFrameRGBA(i, canvas);
      encoder.addFrameRgba(canvas);
      prevDisposal = info.disposal;
      prevInfo = info;
    }
    encoder.finalize();
    fs.writeFileSync(mp4Path, encoder.FS.readFile(encoder.outputFilename));
  } finally {
    encoder.delete();
  }
};

const main = async () => {
  try {
    const published = [];
    for (const [name, source] of Object.entries(sources)) {
      const baseFields = '    width = 640;\n    height = 360;\n    environment = studio;';
      renderWithPreview(source, baseFields, path.join(stage, `${name}-poster.png`));
      renderWithPreview(
        source,
        `${baseFields}\n    kind = gif;\n    mode = build;`,
        path.join(stage, `${name}-build-replay.gif`),
      );
      await gifToMp4(
        path.join(stage, `${name}-build-replay.gif`),
        path.join(stage, `${name}-build-replay.mp4`),
      );
      published.push(`${name}-poster.png`, `${name}-build-replay.gif`, `${name}-build-replay.mp4`);
      const asset = JSON.parse(run(['check', source]).toString()).result;
      for (const clip of asset.animations) {
        const file = `${name}-${clip.name}`;
        renderWithPreview(
          source,
          `${baseFields}\n    kind = gif;\n    clip = "${clip.name}";\n    duration = ${clip.durationSeconds};\n    fps = 10;`,
          path.join(stage, `${file}.gif`),
        );
        await gifToMp4(path.join(stage, `${file}.gif`), path.join(stage, `${file}.mp4`));
        published.push(`${file}.mp4`);
      }
      console.log(`CLI showcase rendered: ${name}`);
    }
    fs.mkdirSync(output, { recursive: true });
    for (const file of published) fs.copyFileSync(path.join(stage, file), path.join(output, file));
    execFileSync(process.execPath, [path.join(__dirname, 'verify.js'), '--write'], {
      cwd: root,
      stdio: 'inherit',
    });
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
