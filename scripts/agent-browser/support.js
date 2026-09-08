'use strict';

(() => {
  const params = new URLSearchParams(window.location.search);
  const manual = params.get('manual') === '1';
  const runnerToken = params.get('token');
  const iframe = document.querySelector('iframe');
  const statusElement = document.getElementById('agent-test-status');
  const noteElement = document.getElementById('agent-test-note');
  const evidenceElement = document.getElementById('agent-test-evidence');
  const gateElement = document.getElementById('agent-test-gate');
  const gateLabel = document.getElementById('agent-test-gate-label');
  const continueButton = document.getElementById('agent-test-continue');
  const state = {
    status: 'running',
    mode: manual ? 'manual' : 'automated',
    visualCertification: false,
    protocolAcceptance:
      'known Workbench fixture through the public runtime manifest and window.ashfox',
    startedAt: new Date().toISOString(),
    steps: []
  };

  const toError = (error) => error instanceof Error ? error.message : String(error);
  const brief = (value) => {
    if (!value || typeof value !== 'object') return value;
    if (value.ok !== true) return { ok: false, revision: value.revision, error: value.error };
    const data = value.data;
    if ((!data || typeof data !== 'object') && value.artifact) {
      return { ok: true, revision: value.revision, artifact: value.artifact };
    }
    if (!data || typeof data !== 'object') return { ok: true, revision: value.revision };
    const summary = { ok: true, revision: value.revision };
    if (data.kind === 'workspace') {
      summary.data = {
        kind: data.kind,
        valid: data.valid,
        diagnostics: Array.isArray(data.diagnostics) ? data.diagnostics.length : 0,
        previewToken: typeof data.previewToken === 'string',
        catalog: data.catalog && {
          total: data.catalog.total,
          count: data.catalog.files.length,
          nextOffset: data.catalog.nextOffset
        },
        sourceChunk: data.sourceChunk && {
          path: data.sourceChunk.path,
          offset: data.sourceChunk.offset,
          codeUnits: data.sourceChunk.content.length,
          done: data.sourceChunk.done
        }
      };
    } else if (data.review) {
      summary.data = {
        review: data.review,
        purpose: data.purpose,
        mode: data.mode,
        camera: data.camera,
        clipId: data.clipId,
        verdict: data.verdict,
        frameNonce: data.frameNonce,
        observedTimeSeconds: data.observedTimeSeconds,
        completedCycles: data.completedCycles,
        checkCount: Array.isArray(data.reviewChecks) ? data.reviewChecks.length : 0,
        frameEvidence: data.frameEvidence && {
          width: data.frameEvidence.width,
          height: data.frameEvidence.height,
          pixelHash: data.frameEvidence.pixelHash
        }
      };
    } else if (data.artifact) {
      summary.data = { artifact: data.artifact };
    } else {
      summary.data = {
        revision: data.revision,
        workspaceHash: data.workspaceHash,
        entry: data.entry,
        build: data.build && {
          path: data.build.path,
          buildKey: data.build.buildKey,
          productHash: data.build.productHash
        },
        workflow: data.workflow,
        readiness: data.readiness,
        counts: data.counts
      };
    }
    return summary;
  };

  const render = (message) => {
    document.documentElement.dataset.testStatus = state.status;
    document.body.dataset.testStatus = state.status;
    statusElement.textContent = message;
    noteElement.textContent = manual
      ? 'Manual mode: the Workbench frame remains visible before every acceptance.'
      : 'Automated protocol acceptance of the known Workbench fixture; this run is not visual certification.';
    evidenceElement.textContent = JSON.stringify(state, null, 2);
  };

  const submitResult = () => {
    if (!runnerToken) return;
    void fetch(`/agent-test/result?token=${encodeURIComponent(runnerToken)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(state)
    }).catch(() => undefined);
  };

  const fail = (message, details) => {
    const error = new Error(message);
    error.details = details;
    throw error;
  };
  const expect = (condition, message, details) => {
    if (!condition) fail(message, details);
  };
  const wait = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  const waitFor = async (label, predicate, timeout = 30_000) => {
    const deadline = performance.now() + timeout;
    while (performance.now() < deadline) {
      let result = null;
      try { result = predicate(); } catch { result = null; }
      if (result) return result;
      await wait(50);
    }
    fail(`Timed out waiting for ${label}.`);
  };
  const record = (name, result, details = {}) => {
    state.steps.push({ name, result: brief(result), ...details });
    evidenceElement.textContent = JSON.stringify(state, null, 2);
    return result;
  };
  const call = async (api, method, payload, name = method) => {
    const started = performance.now();
    let result;
    try {
      // The page API accepts closed JSON records from its own realm, just as
      // an in-page agent call would. Never loosen production readers for a
      // parent-frame fixture object.
      const input = payload === undefined ? undefined
        : iframe.contentWindow.JSON.parse(JSON.stringify(payload));
      result = input === undefined ? await api[method]() : await api[method](input);
    } catch (error) {
      fail(`Public ${method} call threw.`, { name, error: toError(error) });
    }
    return record(name, result, { elapsedMs: Math.round(performance.now() - started) });
  };
  const successfulData = (result, name) => {
    expect(result && result.ok === true, `${name} failed.`, brief(result));
    return result.data;
  };
  const failedWith = (result, name, codes) => {
    expect(result && result.ok === false, `${name} unexpectedly succeeded.`, brief(result));
    const allowed = Array.isArray(codes) ? codes : [codes];
    expect(allowed.includes(result.error?.code), `${name} returned the wrong failure code.`, brief(result));
    return result.error;
  };
  const currentPort = () => {
    try { return iframe?.contentWindow?.ashfox ?? null; } catch { return null; }
  };

  const manifestAndPort = async () => {
    const response = await fetch('/workbench/agent-manifest.json', { cache: 'no-store' });
    expect(response.ok, 'The public runtime manifest was not reachable.', response.status);
    const manifest = await response.json();
    expect(manifest.schemaVersion === 1, 'Only runtime manifest schema version 1 is supported.');
    expect(manifest.pageApi?.global === 'ashfox', 'The manifest does not name window.ashfox.');
    const methods = {
      inspect: manifest.pageApi.inspectMethod,
      present: manifest.pageApi.presentMethod,
      capture: manifest.pageApi.captureMethod,
      run: manifest.pageApi.runMethod
    };
    expect(Object.values(methods).every((value) => typeof value === 'string'),
      'The runtime manifest does not expose all public methods.', methods);
    state.manifest = {
      schemaVersion: manifest.schemaVersion,
      protocol: manifest.protocol,
      global: manifest.pageApi.global,
      methods
    };
    const api = await waitFor('iframe window.ashfox', currentPort);
    for (const method of Object.values(methods)) {
      expect(typeof api[method] === 'function', `window.ashfox.${method} is unavailable.`);
    }
    return { api, methods, transport: manifest.pageApi.transport };
  };

  const domBridgeCall = async (transport, method, payload, name) => {
    expect(transport?.inputSelector && transport?.resultSelector && transport?.resultAttribute,
      'The runtime manifest omitted its DOM transport contract.');
    const requestId = `agent-browser-dom-${Date.now()}`;
    const input = await waitFor('public DOM bridge input', () => {
      try { return iframe.contentDocument?.querySelector(transport.inputSelector); } catch { return null; }
    });
    const envelope = { requestId, method };
    if (payload !== undefined) envelope.payload = payload;
    input.value = JSON.stringify(envelope);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const result = await waitFor(`DOM bridge response for ${name}`, () => {
      try {
        const node = iframe.contentDocument?.querySelector(transport.resultSelector);
        const serialized = node?.getAttribute(transport.resultAttribute);
        if (!serialized) return null;
        const response = JSON.parse(serialized);
        return response.requestId === requestId ? response.result : null;
      } catch { return null; }
    }, 60_000);
    state.transport = { kind: 'manifest DOM bridge', requestId, method, result: brief(result) };
    return record(name, result, { transport: 'dom-bridge' });
  };

  const readSource = async (api, method, hash, sourcePath) => {
    let offset = 0;
    let source = '';
    for (let page = 0; page < 64; page += 1) {
      const result = await call(api, method, {
        kind: 'workspace',
        read: { expectedWorkspaceHash: hash, path: sourcePath, offset, maxCodeUnits: 2048 }
      }, `workspace.read.${page}`);
      const chunk = successfulData(result, `workspace.read.${page}`).sourceChunk;
      expect(chunk?.path === sourcePath && chunk.offset === offset,
        'Workspace source pagination returned the wrong chunk.', brief(result));
      source += chunk.content;
      if (chunk.done) return source;
      expect(chunk.content.length > 0, 'Workspace source pagination made no progress.');
      offset += chunk.content.length;
    }
    fail('Workspace source pagination exceeded its bounded page count.');
  };

  const gate = async (label, details, buttonLabel) => {
    if (!manual) return;
    state.status = 'paused';
    state.gate = { ...details, instruction: label };
    gateLabel.textContent = label;
    continueButton.textContent = buttonLabel;
    gateElement.dataset.visible = 'true';
    render(label);
    await new Promise((resolve) => {
      const continueFromGate = () => {
        continueButton.removeEventListener('click', continueFromGate);
        gateElement.dataset.visible = 'false';
        state.gate = null;
        state.status = 'running';
        resolve();
      };
      continueButton.addEventListener('click', continueFromGate);
      continueButton.focus();
    });
  };

  const pauseBeforeAcceptance = (review, index) => gate(
    `Review ${index + 1}: observe the visible ${review.mode} frame, then accept it.`,
    {
      index,
      mode: review.mode,
      camera: review.camera,
      clipId: review.clipId,
      frameNonce: review.frameNonce
    },
    'Accept observed frame'
  );

  window.__ashfoxAgentBrowserSupport = () => ({
    manual,
    state,
    render,
    submitResult,
    fail,
    expect,
    wait,
    record,
    call,
    successfulData,
    failedWith,
    manifestAndPort,
    domBridgeCall,
    readSource,
    gate,
    pauseBeforeAcceptance,
    brief,
    toError,
    iframe,
    gateElement
  });
})();
