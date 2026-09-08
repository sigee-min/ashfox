'use strict';

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const WEB_DIST = path.join(ROOT, 'apps', 'web', 'dist');
const HARNESS_ROOT = __dirname;
const DEFAULT_TIMEOUT_MS = 300_000;
const contentTypes = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
});

const usage = () => {
  console.log(`Usage: node scripts/agent-browser/run.js [options]

Options:
  --serve       Serve the built Workbench and /agent-test/ for CUA.
  --manual      Pause before each visual review acceptance (implies --serve).
  --no-build    Reuse apps/web/dist instead of building the Workbench.
  --development Build an unminified development Workbench with StrictMode.
  --port PORT   Bind a specific localhost port (default: an ephemeral port).
  --timeout MS  Headless run timeout (default: ${DEFAULT_TIMEOUT_MS}).`);
};

const parseArgs = (argv) => {
  const options = {
    serve: false,
    manual: false,
    build: true,
    development: false,
    port: 0,
    timeout: DEFAULT_TIMEOUT_MS
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      usage();
      process.exit(0);
    }
    if (argument === '--serve') options.serve = true;
    else if (argument === '--manual') {
      options.manual = true;
      options.serve = true;
    } else if (argument === '--no-build') options.build = false;
    else if (argument === '--development') options.development = true;
    else if (argument === '--port') options.port = Number(argv[++index]);
    else if (argument.startsWith('--port=')) options.port = Number(argument.slice(7));
    else if (argument === '--timeout') options.timeout = Number(argv[++index]);
    else if (argument.startsWith('--timeout=')) options.timeout = Number(argument.slice(10));
    else throw new Error(`Unknown option: ${argument}`);
  }
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65_535) {
    throw new Error('--port must be an integer from 0 to 65535.');
  }
  if (!Number.isInteger(options.timeout) || options.timeout < 1_000) {
    throw new Error('--timeout must be an integer of at least 1000 ms.');
  }
  return options;
};

const chromePath = () => {
  const candidates = [
    process.env.ASHFOX_CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ].filter(Boolean);
  const found = candidates.find((candidate) => fs.statSync(
    candidate,
    { throwIfNoEntry: false }
  )?.isFile());
  if (!found) throw new Error(
    'Chrome or Chromium is required. Set ASHFOX_CHROME_PATH to its executable.'
  );
  return found;
};

const freePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.unref();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      reject(new Error('Could not allocate the browser test port.'));
      return;
    }
    const port = address.port;
    server.close((error) => error ? reject(error) : resolve(port));
  });
});

const safeFile = (root, relative) => {
  let decoded;
  try {
    decoded = decodeURIComponent(relative);
  } catch {
    return null;
  }
  const file = path.resolve(root, decoded.replace(/^\/+/, ''));
  if (file !== root && !file.startsWith(`${root}${path.sep}`)) return null;
  if (fs.statSync(file, { throwIfNoEntry: false })?.isFile()) return file;
  if (fs.statSync(path.join(file, 'index.html'), { throwIfNoEntry: false })?.isFile()) {
    return path.join(file, 'index.html');
  }
  return null;
};

const requestFile = (pathname) => {
  if (pathname === '/' || pathname === '/agent-test') {
    return { redirect: '/agent-test/' };
  }
  if (pathname.startsWith('/agent-test/')) {
    return { file: safeFile(HARNESS_ROOT, pathname.slice('/agent-test/'.length)) };
  }
  if (pathname === '/workbench') return { redirect: '/workbench/' };
  if (pathname.startsWith('/workbench/')) {
    return { file: safeFile(WEB_DIST, pathname.slice(1)) };
  }
  return { file: safeFile(WEB_DIST, pathname.slice(1)) };
};

const startServer = async (requestedPort, resultToken = null) => {
  const port = requestedPort === 0 ? await freePort() : requestedPort;
  if (!fs.statSync(WEB_DIST, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error('apps/web/dist is missing; run without --no-build first.');
  }
  let completionValue = null;
  let complete;
  const completion = new Promise((resolve) => {
    complete = resolve;
  });
  const readBody = (request, response, done) => {
    const chunks = [];
    let length = 0;
    request.on('data', (chunk) => {
      length += chunk.length;
      if (length > 4 * 1024 * 1024) {
        response.writeHead(413);
        response.end();
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => done(Buffer.concat(chunks).toString('utf8')));
  };
  const server = http.createServer((request, response) => {
    let url;
    try {
      url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);
    } catch {
      response.writeHead(400);
      response.end('Bad request');
      return;
    }
    if (resultToken && url.pathname === '/agent-test/result' && request.method === 'POST') {
      if (url.searchParams.get('token') !== resultToken) {
        response.writeHead(404);
        response.end();
        return;
      }
      readBody(request, response, (body) => {
        try {
          completionValue = JSON.parse(body);
        } catch {
          completionValue = { status: 'failure', error: { message: 'Invalid result JSON.' } };
        }
        complete(completionValue);
        response.writeHead(204);
        response.end();
      });
      return;
    }
    const target = requestFile(url.pathname);
    if (target.redirect) {
      response.writeHead(302, { Location: `${target.redirect}${url.search}` });
      response.end();
      return;
    }
    if (!target.file) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }
    const type = contentTypes[path.extname(target.file).toLowerCase()] ??
      'application/octet-stream';
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Type': type
    });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    fs.createReadStream(target.file).on('error', () => {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    }).pipe(response);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return { server, port, completion };
};

const buildWeb = (development) => {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  if (development) {
    const typecheck = childProcess.spawnSync(
      npm,
      ['--workspace', '@ashfox/web', 'run', 'typecheck'],
      { cwd: ROOT, stdio: 'inherit' }
    );
    if (typecheck.error) throw typecheck.error;
    if (typecheck.status !== 0) throw new Error(`Workbench typecheck exited with ${typecheck.status}.`);
    const script = [
      "const esbuild = require('esbuild');",
      "const { createBuildOptions } = require('./apps/web/scripts/buildOptions');",
      "const { prepareOutput } = require('./apps/web/scripts/prepareOutput');",
      "prepareOutput();",
      "esbuild.build(createBuildOptions({ minify: false, sourcemap: 'inline' })).catch((error) => { console.error(error); process.exit(1); });"
    ].join('');
    const build = childProcess.spawnSync(process.execPath, ['-e', script], {
      cwd: ROOT,
      stdio: 'inherit'
    });
    if (build.error) throw build.error;
    if (build.status !== 0) throw new Error(`Development Workbench build exited with ${build.status}.`);
    return;
  }
  const result = childProcess.spawnSync(
    npm,
    ['--workspace', '@ashfox/web', 'run', 'build'],
    { cwd: ROOT, stdio: 'inherit' }
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Workbench build exited with ${result.status}.`);
};

const waitForServer = async (url, server) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (server.listening !== true) throw new Error('Browser test server stopped during startup.');
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The bounded retry loop owns startup races.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Browser test server did not become ready in 5 seconds.');
};

const saveEvidence = (evidence) => {
  const target = path.join(ROOT, '.ashfox', 'agent-browser', 'latest.json');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(evidence ?? {}, null, 2)}\n`);
  return target;
};

const conciseResult = (result) => {
  const evidence = result.evidence ?? {};
  return {
    status: result.status,
    mode: evidence.mode,
    visualCertification: evidence.visualCertification,
    reviews: evidence.reviews?.length ?? 0,
    completedCycle: evidence.reviews?.some((review) =>
      review.mode === 'cycle' && review.completedCycles >= 1
    ) ?? false,
    guards: evidence.guards,
    capture: evidence.capture
  };
};

const captureDom = (browser, url, profile, timeout, completion) => new Promise((resolve, reject) => {
  const child = childProcess.spawn(browser, [
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    '--disable-extensions',
    '--disable-dev-shm-usage',
    '--hide-scrollbars',
    '--mute-audio',
    '--autoplay-policy=no-user-gesture-required',
    `--user-data-dir=${profile}`,
    '--window-size=1440,1000',
    '--use-angle=swiftshader',
    '--use-gl=angle',
    '--enable-webgl',
    // Keep normal browser time: cycle acceptance requires real RAF progression.
    url
  ], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true
  });
  let stderr = '';
  let settled = false;
  let result = null;
  let failure = null;
  let killTimer;
  const stop = () => {
    child.kill('SIGTERM');
    killTimer = setTimeout(() => child.kill('SIGKILL'), 5_000);
  };
  const timeoutTimer = setTimeout(() => {
    failure = new Error(`Headless browser exceeded ${timeout} ms.`);
    stop();
  }, timeout);
  const finish = (error, result) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeoutTimer);
    clearTimeout(killTimer);
    if (error) reject(error);
    else resolve(result);
  };
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-4_000); });
  child.once('error', (error) => finish(error));
  child.once('close', (status) => {
    if (result && !failure) {
      finish(null, result);
      return;
    }
    const detail = stderr.trim().slice(-4_000);
    finish(failure ?? new Error(
      `Headless browser ended before posting a test result (status ${status ?? 'unknown'}).` +
      (detail ? `\n${detail}` : '')
    ));
  });
  completion.then((value) => {
    if (settled) return;
    result = { status: value?.status, evidence: value };
    clearTimeout(timeoutTimer);
    stop();
  }).catch(() => undefined);
});

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  if (options.build) buildWeb(options.development);
  const resultToken = options.serve ? null : crypto.randomUUID();
  const { server, port, completion } = await startServer(options.port, resultToken);
  const baseUrl = `http://127.0.0.1:${port}`;
  const query = new URLSearchParams();
  if (options.manual) query.set('manual', '1');
  if (resultToken) query.set('token', resultToken);
  const testUrl = `${baseUrl}/agent-test/${query.size > 0 ? `?${query}` : ''}`;
  await waitForServer(`${baseUrl}/agent-test/`, server);
  console.log(`ashfox agent browser test: ${testUrl}`);
  if (options.serve) {
    console.log('Standalone server is ready for CUA manual QA.');
    await new Promise((resolve) => {
      const stop = () => {
        server.close(() => resolve());
      };
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
    });
    return;
  }

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ashfox-agent-browser-'));
  try {
    const result = await captureDom(
      chromePath(), testUrl, profile, options.timeout, completion
    );
    const evidencePath = saveEvidence(result.evidence);
    if (result.status !== 'success') {
      console.error(JSON.stringify({
        ...conciseResult(result),
        error: result.evidence?.error,
        lastSteps: result.evidence?.steps?.slice(-4)
      }, null, 2));
      throw new Error('The public agent browser regression failed.');
    }
    console.log('ashfox public agent browser regression passed');
    console.log(JSON.stringify({ ...conciseResult(result), evidencePath }, null, 2));
  } finally {
    server.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
};

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
