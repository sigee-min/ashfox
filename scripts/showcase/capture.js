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
const CREATURES = Object.freeze({
  griffin: {
    entry: 'showcase/assets/models/griffin_boss.ashfox',
    modules: {
      '"griffin_plumage/plumage"': '"./griffin_plumage.ashfox"',
    },
    files: {
      'griffin_plumage.ashfox': 'showcase/assets/module/griffin/griffin_plumage.ashfox',
    },
  },
  fox: {
    entry: 'showcase/assets/models/red_fox.ashfox',
    modules: {
      '"fox_fur/fur"': '"./fox_fur.ashfox"',
    },
    files: {
      'fox_fur.ashfox': 'showcase/assets/module/fox/fox_fur.ashfox',
    },
  },
  goblin: {
    entry: 'showcase/assets/models/goblin_raider.ashfox',
    modules: {
      '"shared_modules/goblin_kit"': '"./goblin_kit.ashfox"',
      '"shared_modules/goblin_skins"': '"./goblin_skins.ashfox"',
    },
    files: {
      'goblin_kit.ashfox': 'showcase/assets/module/goblin/goblin_kit.ashfox',
      'goblin_skins.ashfox': 'showcase/assets/module/goblin/goblin_skins.ashfox',
    },
  },
});

const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'ashfox-showcase-'));
const run = (args) =>
  execFileSync(process.execPath, [cli, ...args], {
    cwd: root,
    maxBuffer: 32 * 1024 * 1024,
    timeout: 120_000,
  });

const stageEntry = (name, spec, previewBody) => {
  const dir = path.join(stage, `src-${name}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const [targetName, relPath] of Object.entries(spec.files)) {
    fs.copyFileSync(path.join(root, relPath), path.join(dir, targetName));
  }
  let source = fs.readFileSync(path.join(root, spec.entry), 'utf8');
  for (const [pkgSpec, relSpec] of Object.entries(spec.modules)) {
    source = source.replaceAll(pkgSpec, relSpec);
  }
  if (previewBody) {
    source = source.replace(/(\}\s*)$/, `  preview showcase {\n${previewBody}\n  }\n$1`);
  }
  const stagedPath = path.join(dir, path.basename(spec.entry));
  fs.writeFileSync(stagedPath, source);
  return stagedPath;
};

const renderWithPreview = (name, spec, previewBody, outPath) => {
  const staged = stageEntry(`${name}-${path.basename(outPath)}`, spec, previewBody);
  return run(['render', staged, '--view', 'showcase', '--output', outPath]);
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
    for (const [name, spec] of Object.entries(CREATURES)) {
      const baseFields = '    width = 640;\n    height = 360;\n    environment = studio;';
      renderWithPreview(name, spec, baseFields, path.join(stage, `${name}-poster.png`));
      renderWithPreview(
        name,
        spec,
        `${baseFields}\n    kind = gif;\n    mode = build;`,
        path.join(stage, `${name}-build-replay.gif`),
      );
      await gifToMp4(
        path.join(stage, `${name}-build-replay.gif`),
        path.join(stage, `${name}-build-replay.mp4`),
      );
      published.push(`${name}-poster.png`, `${name}-build-replay.gif`, `${name}-build-replay.mp4`);
      const stagedCheck = stageEntry(`check-${name}`, spec, null);
      const asset = JSON.parse(run(['check', stagedCheck, '--json']).toString()).result;
      for (const clip of asset.animations) {
        const file = `${name}-${clip.name}`;
        renderWithPreview(
          name,
          spec,
          `${baseFields}\n    kind = gif;\n    clip = "${clip.name}";\n    duration = ${clip.durationSeconds};\n    fps = 10;`,
          path.join(stage, `${file}.gif`),
        );
        await gifToMp4(path.join(stage, `${file}.gif`), path.join(stage, `${file}.mp4`));
        published.push(`${file}.mp4`);
      }
      console.log(`CLI showcase rendered: ${name}`);
    }
    fs.mkdirSync(output, { recursive: true });
    for (const oldFile of fs.readdirSync(output)) {
      if (/\.(?:gif|png|mp4)$/iu.test(oldFile)) fs.rmSync(path.join(output, oldFile));
    }
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
