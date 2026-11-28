'use strict';
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const { buildSync } = require('esbuild');
const { ASSET_CATALOG } = require('./catalog.js');

const root = path.resolve(__dirname, '../..');
const outDir = path.join(root, 'assets/catalog/thumbs');
const cli = path.join(root, 'apps/cli/dist/ashfox.cjs');
const chrome =
  process.env.ASHFOX_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const WIDTH = 480;
const HEIGHT = 360;
const GLB_DOMAINS = new Set(['model', 'structure', 'vfx']);
const TARGETS = ASSET_CATALOG.filter((entry) => GLB_DOMAINS.has(entry.domain));

const compileGlbs = (temp) => {
  fs.cpSync(path.join(root, 'showcase'), path.join(temp, 'showcase'), { recursive: true });
  const built = JSON.parse(
    execFileSync(
      process.execPath,
      [cli, 'build', path.join(temp, 'showcase/.ashfoxworkspace'), '--json'],
      { cwd: temp, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    ),
  ).result;
  const byId = new Map(built.exports.map((exp) => [exp.id, exp.directory]));
  const glbs = new Map();
  for (const entry of TARGETS) {
    const expId = entry.exportId || entry.id;
    const dir = byId.get(expId);
    if (!dir) throw new Error(`Missing export ${expId} for ${entry.id}`);
    glbs.set(entry.slug, fs.readFileSync(path.join(dir, `${expId}.glb`)));
  }
  return glbs;
};

const bundleThreeRuntime = () => {
  const result = buildSync({
    stdin: {
      contents: `
        import * as THREE from 'three';
        import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
        import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
        window.__THREE_THUMBS__ = { THREE, GLTFLoader, RoomEnvironment };
      `,
      resolveDir: root,
      loader: 'js',
    },
    bundle: true,
    minify: true,
    write: false,
    format: 'iife',
    platform: 'browser',
  });
  return result.outputFiles[0].text;
};

const renderHtml = (items) => `<!doctype html>
<html>
<head><meta charset="utf-8"><style>body{margin:0;background:#0d1014}</style></head>
<body>
<canvas id="c" width="${WIDTH}" height="${HEIGHT}"></canvas>
<script src="/three.js"></script>
<script>
(async () => {
  const { THREE, GLTFLoader, RoomEnvironment } = window.__THREE_THUMBS__;
  const canvas = document.getElementById('c');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, alpha: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.setPixelRatio(1);
  renderer.setSize(${WIDTH}, ${HEIGHT}, false);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTarget = pmrem.fromScene(new RoomEnvironment(), 0.04);

  const bgCanvas = document.createElement('canvas');
  bgCanvas.width = 64;
  bgCanvas.height = 64;
  const bgCtx = bgCanvas.getContext('2d');
  const grad = bgCtx.createRadialGradient(32, 28, 4, 32, 32, 46);
  grad.addColorStop(0, '#1e242d');
  grad.addColorStop(0.65, '#12161c');
  grad.addColorStop(1, '#090b0f');
  bgCtx.fillStyle = grad;
  bgCtx.fillRect(0, 0, 64, 64);
  const bgTex = new THREE.CanvasTexture(bgCanvas);
  bgTex.colorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = bgTex;
  scene.environment = envTarget.texture;
  scene.environmentIntensity = 0.85;

  scene.add(new THREE.HemisphereLight(0xf0f4ff, 0x1a2029, 1.15));
  const key = new THREE.DirectionalLight(0xfff1dc, 1.9);
  key.position.set(14, 22, -16);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xcbe0ff, 0.75);
  fill.position.set(-16, 10, -10);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xe6efff, 1.05);
  rim.position.set(-10, 14, 18);
  scene.add(rim);

  const camera = new THREE.PerspectiveCamera(34, ${WIDTH} / ${HEIGHT}, 0.05, 500);
  const loader = new GLTFLoader();
  const CORNERS = [
    [-1,-1,-1],[1,-1,-1],[-1,1,-1],[1,1,-1],
    [-1,-1,1],[1,-1,1],[-1,1,1],[1,1,1],
  ];

  const isVisibleInHierarchy = (obj) => {
    for (let cur = obj; cur; cur = cur.parent) {
      if (!cur.visible) return false;
      const s = cur.scale;
      if (Math.abs(s.x) < 1e-4 && Math.abs(s.y) < 1e-4 && Math.abs(s.z) < 1e-4) return false;
    }
    return true;
  };

  const hideLowerLods = (rootObj) => {
    const lodNodes = [];
    rootObj.traverse((n) => {
      if (/_LOD([0-9]+)$/i.test(n.name || '')) {
        const tier = Number(/_LOD([0-9]+)$/i.exec(n.name)[1]);
        lodNodes.push({ tier, node: n });
      }
    });
    if (lodNodes.length > 0) {
      const minTier = Math.min(...lodNodes.map((x) => x.tier));
      for (const item of lodNodes) {
        item.node.visible = item.tier === minTier;
      }
    }
  };

  const computeTightBox = (rootObj) => {
    const box = new THREE.Box3();
    const meshBox = new THREE.Box3();
    rootObj.updateMatrixWorld(true);
    rootObj.traverse((obj) => {
      if (!obj.isMesh || !obj.geometry || !isVisibleInHierarchy(obj)) return;
      obj.geometry.computeBoundingBox();
      if (!obj.geometry.boundingBox || obj.geometry.boundingBox.isEmpty()) return;
      meshBox.copy(obj.geometry.boundingBox).applyMatrix4(obj.matrixWorld);
      box.union(meshBox);
    });
    if (box.isEmpty()) box.setFromObject(rootObj);
    return box;
  };

  const frameCamera = (box, domain) => {
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const azimuth = domain === 'vfx' ? Math.PI + 0.58 : Math.PI + 0.65;
    const elevation = domain === 'structure' ? 0.42 : 0.34;
    const dir = new THREE.Vector3(
      Math.sin(azimuth) * Math.cos(elevation),
      Math.sin(elevation),
      Math.cos(azimuth) * Math.cos(elevation),
    ).normalize();
    const worldUp = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(worldUp, dir).normalize();
    const up = new THREE.Vector3().crossVectors(dir, right).normalize();

    const tanHalfV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const tanHalfH = tanHalfV * camera.aspect;
    const hx = Math.max(0.1, size.x / 2);
    const hy = Math.max(0.1, size.y / 2);
    const hz = Math.max(0.1, size.z / 2);
    let minDistance = 0;
    for (const [cx, cy, cz] of CORNERS) {
      const sx = cx * hx, sy = cy * hy, sz = cz * hz;
      const rx = sx * right.x + sy * right.y + sz * right.z;
      const ry = sx * up.x + sy * up.y + sz * up.z;
      const rz = sx * dir.x + sy * dir.y + sz * dir.z;
      minDistance = Math.max(minDistance, rz + Math.max(Math.abs(rx) / tanHalfH, Math.abs(ry) / tanHalfV));
    }
    const padding = domain === 'structure' ? 1.08 : domain === 'vfx' ? 1.12 : 1.08;
    const distance = Math.max(0.8, minDistance * padding);
    camera.position.copy(center).addScaledVector(dir, distance);
    camera.near = Math.max(0.02, distance * 0.02);
    camera.far = Math.max(200, distance * 8);
    camera.lookAt(center);
    camera.updateProjectionMatrix();
  };

  const items = ${JSON.stringify(items)};
  try {
    for (const item of items) {
      const gltf = await loader.loadAsync('/glb/' + item.slug + '.glb');
      scene.add(gltf.scene);
      hideLowerLods(gltf.scene);

      let mixer = null;
      if (gltf.animations && gltf.animations.length > 0) {
        mixer = new THREE.AnimationMixer(gltf.scene);
        const preferred =
          gltf.animations.find((c) => c.name === 'wing_display') ||
          gltf.animations.find((c) => /idle|hover|sway|shamble/i.test(c.name)) ||
          gltf.animations[0];
        const action = mixer.clipAction(preferred);
        action.play();
        const seekTime = item.peakTimeSec ?? (item.slug === 'treasure-chest' ? 0.45 : 0.15);
        mixer.setTime(seekTime);
      }

      const box = computeTightBox(gltf.scene);
      frameCamera(box, item.domain);
      renderer.render(scene, camera);
      const dataUrl = canvas.toDataURL('image/png');
      await fetch('/save/' + item.slug, { method: 'POST', body: dataUrl });

      scene.remove(gltf.scene);
      gltf.scene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (const m of mats) m.dispose();
        }
      });
    }
    await fetch('/done', { method: 'POST' });
  } catch (err) {
    await fetch('/error', { method: 'POST', body: String(err && err.stack ? err.stack : err) });
  }
})();
</script>
</body>
</html>`;

const main = async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ashfox-thumbs-'));
  let server;
  let chromeProc;

  try {
    const glbs = compileGlbs(temp);
    const threeBundle = bundleThreeRuntime();
    const items = TARGETS.map((t) => ({
      slug: t.slug,
      domain: t.domain,
      peakTimeSec: t.peakTimeSec ?? null,
    }));

    let resolveBatch;
    let rejectBatch;
    const finished = new Promise((resolve, reject) => {
      resolveBatch = resolve;
      rejectBatch = reject;
    });
    const saved = new Set();

    server = http.createServer((req, res) => {
      if (req.url === '/render.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderHtml(items));
        return;
      }
      if (req.url === '/three.js') {
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
        res.end(threeBundle);
        return;
      }
      if (req.url?.startsWith('/glb/')) {
        const slug = req.url.slice(5).replace(/\.glb$/, '');
        const bytes = glbs.get(slug);
        if (!bytes) {
          res.writeHead(404);
          res.end();
          return;
        }
        res.writeHead(200, { 'Content-Type': 'model/gltf-binary' });
        res.end(bytes);
        return;
      }
      if (req.url?.startsWith('/save/') && req.method === 'POST') {
        const slug = req.url.slice(6);
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          const b64 = body.replace(/^data:image\/png;base64,/, '');
          fs.writeFileSync(path.join(outDir, `${slug}.png`), Buffer.from(b64, 'base64'));
          saved.add(slug);
          res.writeHead(200);
          res.end('ok');
        });
        return;
      }
      if (req.url === '/done' && req.method === 'POST') {
        res.writeHead(200);
        res.end('ok');
        resolveBatch();
        return;
      }
      if (req.url === '/error' && req.method === 'POST') {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          res.writeHead(500);
          res.end('err');
          rejectBatch(new Error(Buffer.concat(chunks).toString('utf8')));
        });
        return;
      }
      res.writeHead(404);
      res.end();
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();

    chromeProc = spawn(
      chrome,
      [
        '--headless=new',
        '--enable-webgl',
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--disable-background-networking',
        '--disable-component-update',
        '--no-first-run',
        '--no-default-browser-check',
        `--user-data-dir=${path.join(temp, 'chrome-profile')}`,
        `--window-size=${WIDTH},${HEIGHT}`,
        `http://127.0.0.1:${port}/render.html`,
      ],
      { stdio: 'ignore' },
    );

    const timeout = setTimeout(() => rejectBatch(new Error('Thumbnail render timed out')), 90000);
    try {
      await finished;
    } finally {
      clearTimeout(timeout);
    }

    if (saved.size !== TARGETS.length) {
      throw new Error(`Expected ${TARGETS.length} thumbnails, saved ${saved.size}`);
    }
    console.log(`Rendered ${saved.size} studio thumbnails (${WIDTH}x${HEIGHT}) -> ${outDir}`);
  } finally {
    if (chromeProc && chromeProc.exitCode === null) {
      await new Promise((resolve) => {
        const force = setTimeout(() => {
          chromeProc.kill('SIGKILL');
          resolve();
        }, 2000);
        chromeProc.once('exit', () => {
          clearTimeout(force);
          resolve();
        });
        chromeProc.kill('SIGTERM');
      });
    }
    if (server) server.close();
    fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
};

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : String(err));
  process.exitCode = 1;
});
