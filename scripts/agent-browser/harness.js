'use strict';

(() => {
  const support = window.__ashfoxAgentBrowserSupport?.();
  if (!support) throw new Error('Agent browser support did not load.');
  const {
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
    gateElement
  } = support;

  const readDocument = async (inspect, expectedWorkspaceHash, document) => {
    let content = '';
    for (let page = 0; page < 64; page += 1) {
      const result = await inspect({ kind: 'workspace', document: {
        expectedWorkspaceHash, document, offset: content.length, maxCodeUnits: 2048
      } }, `workspace.document.${document}.${page}`);
      const chunk = successfulData(result, `workspace.document.${document}`).documentChunk;
      expect(chunk?.offset === content.length && chunk.document === document,
        'Workspace metadata chunks lost their identity.');
      content += chunk.content;
      if (chunk.done) return content;
      expect(chunk.content.length > 0, 'Workspace metadata made no progress.');
    }
    fail('Workspace metadata exceeded the fixture read budget.');
  };

  const run = async () => {
    render(manual ? 'Loading the public runtime manifest…' : 'Running public agent protocol…');
    const { api, methods, transport } = await manifestAndPort();
    const inspect = (payload, name) => call(api, methods.inspect, payload, name);
    // Closed-contract parsers intentionally accept same-realm records only.
    // Use the manifest transport for payload-bearing calls so JSON parsing occurs
    // in the Workbench realm; the initial direct inspect proves window.ashfox.
    const present = (payload, name) => domBridgeCall(transport, methods.present, payload, name);
    const capture = (payload, name) => domBridgeCall(transport, methods.capture, payload, name);
    const runCommand = (payload, name) => domBridgeCall(
      transport,
      methods.run,
      { operations: payload.operations },
      name
    );

    const retiredSide = await present({ review: 'preview', camera: 'side' }, 'present.retired-side');
    failedWith(retiredSide, 'present.retired-side', 'invalid_request');

    const initialResult = await inspect(undefined, 'inspect.initial');
    const initial = successfulData(initialResult, 'inspect.initial');
    expect(typeof initial.revision === 'string' && typeof initial.workspaceHash === 'string',
      'The initial overview omitted revision or workspace identity.', brief(initialResult));
    expect(initial.entry?.packageName && initial.entry?.entryName,
      'The initial overview omitted the selected entry.', brief(initialResult));
    expect(initial.build?.buildKey, 'The initial overview omitted the build key.');
    const bridgeInitialResult = await domBridgeCall(
      transport, methods.inspect, undefined, 'transport.inspect.initial'
    );
    const bridgeInitial = successfulData(bridgeInitialResult, 'transport.inspect.initial');
    expect(bridgeInitial.workspaceHash === initial.workspaceHash &&
      bridgeInitial.revision === initial.revision,
    'The public DOM bridge returned a different initial identity.', brief(bridgeInitialResult));
    state.initial = {
      revision: initial.revision,
      workspaceHash: initial.workspaceHash,
      entry: initial.entry,
      buildKey: initial.build.buildKey,
      productHash: initial.build.productHash,
      workflow: initial.workflow,
      readiness: initial.readiness
    };

    const catalog = [];
    let offset = 0;
    for (let page = 0; page < 16; page += 1) {
      const result = await inspect({
        kind: 'workspace',
        catalog: { expectedWorkspaceHash: initial.workspaceHash, offset, limit: 32 }
      }, `workspace.catalog.${page}`);
      const data = successfulData(result, `workspace.catalog.${page}`);
      expect(data.valid === true && data.catalog, 'Workspace catalog was not valid.', brief(result));
      catalog.push(...data.catalog.files);
      if (data.catalog.nextOffset === null) break;
      expect(data.catalog.nextOffset > offset, 'Workspace catalog pagination made no progress.');
      offset = data.catalog.nextOffset;
      if (page === 15) fail('Workspace catalog exceeded its bounded page count.');
    }
    expect(catalog.length > 0, 'Workspace catalog was empty.');
    const entryFile = catalog.find((file) => file.path === initial.build.path) ??
      catalog.find((file) => file.kind === 'entry');
    expect(entryFile, 'Workspace catalog did not contain the selected entry.');
    const sourceBefore = await readSource(api, methods.inspect, initial.workspaceHash, entryFile.path);
    const manifestBefore = await readDocument(inspect, initial.workspaceHash, 'manifest');
    const lockBefore = await readDocument(inspect, initial.workspaceHash, 'lock');
    const seedMatch = sourceBefore.match(/\bseed\s*=\s*(\d+)\s*;/u);
    expect(seedMatch, 'The known Workbench fixture has no seed field to edit.');
    const seedBefore = Number(seedMatch[1]);
    const sourceWithSeed = sourceBefore.replace(
      /\bseed\s*=\s*(\d+)\s*;/u, `seed = ${seedBefore + 1};`
    );
    const motionKey = '      key 0.5s = (0deg, 12deg, 0deg) linear;';
    const sourceAfter = sourceWithSeed.includes('key 0.5s =')
      ? sourceWithSeed
      : sourceWithSeed.replace(/(\s*key 0s = \([^;]+;\n)/u, `$1${motionKey}\n`);
    expect(sourceAfter !== sourceBefore, 'The seed or motion edit did not change source bytes.');
    expect(sourceAfter.includes(motionKey), 'The known fixture motion edit was not staged.');
    const changes = {
      expectedWorkspaceHash: initial.workspaceHash,
      writes: [{ path: entryFile.path, expectedHash: entryFile.contentHash, source: sourceAfter }],
      deletes: []
    };
    state.sourceEdit = {
      path: entryFile.path,
      seedBefore,
      seedAfter: seedBefore + 1,
      motionKeyAdded: !sourceBefore.includes('key 0.5s ='),
      sourceCodeUnits: sourceAfter.length
    };

    const canonicalNativeResult = await present(
      { review: 'preview', camera: 'native' },
      'present.canonical-native-baseline'
    );
    const canonicalNative = successfulData(
      canonicalNativeResult,
      'present.canonical-native-baseline'
    );
    expect(canonicalNative.purpose === 'preview' &&
      canonicalNative.frameEvidence?.pixelHash?.startsWith('sha256:'),
    'Canonical native preview did not include real viewport pixel evidence.',
    brief(canonicalNativeResult));
    const canonicalPerspectiveResult = await present(
      { review: 'next' },
      'present.canonical-perspective-baseline'
    );
    const canonicalPerspective = successfulData(
      canonicalPerspectiveResult,
      'present.canonical-perspective-baseline'
    );
    expect(canonicalPerspective.camera === 'perspective' &&
      canonicalPerspective.frameEvidence?.pixelHash?.startsWith('sha256:'),
    'Canonical perspective baseline did not include real viewport pixel evidence.',
    brief(canonicalPerspectiveResult));
    state.canonicalPreview = {
      nativePixelHash: canonicalNative.frameEvidence.pixelHash,
      perspectivePixelHash: canonicalPerspective.frameEvidence.pixelHash
    };

    const invalidCandidate = await inspect({
      kind: 'workspace',
      candidate: { entry: initial.entry, changes: { ...changes, lock: { forbidden: true } } }
    }, 'candidate.invalid-closed-change');
    const invalidError = failedWith(invalidCandidate, 'candidate.invalid-closed-change', 'invalid_request');
    const afterInvalidResult = await inspect(undefined, 'inspect.after-invalid-candidate');
    const afterInvalid = successfulData(afterInvalidResult, 'inspect.after-invalid-candidate');
    expect(afterInvalid.workspaceHash === initial.workspaceHash,
      'An invalid candidate changed the authoritative workspace.', brief(afterInvalidResult));
    state.guards = {
      retiredSideRejected: true,
      invalidCandidate: { code: invalidError.code, path: invalidError.path, workspaceUnchanged: true }
    };

    const invalidSource = sourceAfter.replace('size = (4u, 4u, 4u);', 'size = (0u, 4u, 4u);');
    expect(invalidSource !== sourceAfter, 'The invalid geometry fixture did not alter the cube.');
    const semanticResult = await inspect({ kind: 'workspace', candidate: {
      entry: initial.entry, changes: { ...changes,
        writes: [{ ...changes.writes[0], source: invalidSource }] }
    } }, 'candidate.invalid-geometry');
    const semantic = successfulData(semanticResult, 'candidate.invalid-geometry');
    expect(semantic.valid === false && !semantic.previewToken && semantic.diagnostics.length > 0,
      'An invalid geometry candidate must return valid=false and source diagnostics.', brief(semanticResult));
    const afterSemantic = successfulData(await inspect(undefined, 'inspect.after-invalid-geometry'),
      'inspect.after-invalid-geometry');
    expect(afterSemantic.workspaceHash === initial.workspaceHash,
      'Semantic candidate rejection changed the workspace.');
    state.guards.invalidGeometry = {
      valid: false, diagnosticCode: semantic.diagnostics[0].code, workspaceUnchanged: true
    };

    const candidateResult = await inspect({
      kind: 'workspace', candidate: { entry: initial.entry, changes }
    }, 'candidate.valid');
    const candidate = successfulData(candidateResult, 'candidate.valid');
    expect(candidate.kind === 'workspace' && candidate.valid === true,
      'The seed candidate was not valid.', brief(candidateResult));
    expect(typeof candidate.previewToken === 'string', 'The valid candidate had no preview token.');
    const previewResult = await present({
      review: 'preview', camera: 'native', previewToken: candidate.previewToken
    }, 'present.candidate-preview');
    const preview = successfulData(previewResult, 'present.candidate-preview');
    expect(preview.purpose === 'preview' && preview.verdict === 'pending',
      'Candidate preview did not return a pending preview observation.', brief(previewResult));
    expect(preview.frameEvidence?.pixelHash?.startsWith('sha256:'),
      'Candidate preview did not include real viewport pixel evidence.', brief(previewResult));
    state.candidatePreview = {
      previewTokenIssued: true,
      camera: preview.camera,
      frameNonce: preview.frameNonce,
      frameEvidence: preview.frameEvidence
    };
    expect(preview.frameEvidence.pixelHash !== canonicalNative.frameEvidence.pixelHash,
      'Candidate preview pixel evidence did not differ from the canonical native baseline.');
    await gate(
      'Candidate preview is visible. Apply the seed and motion edit when ready.',
      { kind: 'candidate-preview', frameNonce: preview.frameNonce },
      'Apply candidate'
    );

    const canonicalAfterCandidateResult = await present(
      { review: 'next' },
      'present.canonical-perspective-after-candidate'
    );
    const canonicalAfterCandidate = successfulData(
      canonicalAfterCandidateResult,
      'present.canonical-perspective-after-candidate'
    );
    expect(canonicalAfterCandidate.camera === 'perspective' &&
      canonicalAfterCandidate.frameEvidence?.pixelHash ===
        canonicalPerspective.frameEvidence.pixelHash,
    'Candidate preview contaminated the canonical perspective before apply.',
    brief(canonicalAfterCandidateResult));
    state.candidateIsolation = {
      candidateNativeDiffersFromCanonical: true,
      canonicalPerspectiveRestoredBeforeApply: true,
      canonicalPerspectivePixelHash: canonicalAfterCandidate.frameEvidence.pixelHash
    };

    const applyResult = await runCommand({
      requestId: 'agent-browser-apply-1',
      operations: [{ name: 'workspace.apply', payload: { entry: initial.entry, changes } }]
    }, 'run.apply-candidate');
    expect(applyResult.ok === true, 'run.apply-candidate failed.', brief(applyResult));
    const applied = applyResult;
    const updatedResult = await inspect(undefined, 'inspect.after-apply');
    const updated = successfulData(updatedResult, 'inspect.after-apply');
    expect(updated.workspaceHash !== initial.workspaceHash && updated.revision !== initial.revision,
      'The valid candidate did not advance the public workspace revision.', brief(updatedResult));
    state.applied = {
      revision: updated.revision,
      workspaceHash: updated.workspaceHash,
      buildKey: updated.build.buildKey,
      productHash: updated.build.productHash,
      receiptRevision: applied.receipt?.revision
    };

    const staleApplyResult = await runCommand({
      requestId: 'agent-browser-stale-apply-1',
      operations: [{ name: 'workspace.apply', payload: { entry: initial.entry, changes } }]
    }, 'run.stale-apply');
    const staleError = failedWith(staleApplyResult, 'run.stale-apply', 'invalid_state');
    expect(await readDocument(inspect, updated.workspaceHash, 'manifest') === manifestBefore,
      'A source edit unexpectedly changed the workspace manifest.');
    expect(await readDocument(inspect, updated.workspaceHash, 'lock') !== lockBefore,
      'The engine did not reseal the lock after the source edit.');
    const afterStaleResult = await inspect(undefined, 'inspect.after-stale-apply');
    const afterStale = successfulData(afterStaleResult, 'inspect.after-stale-apply');
    expect(afterStale.workspaceHash === updated.workspaceHash,
      'A stale apply changed the authoritative workspace.', brief(afterStaleResult));
    state.guards.staleApply = {
      code: staleError.code, message: staleError.message, workspaceUnchanged: true
    };

    const captureBeforeReviewResult = await capture({ kind: 'build' }, 'capture.before-reviews');
    const captureBeforeReviewError = failedWith(
      captureBeforeReviewResult, 'capture.before-reviews', 'invalid_state'
    );
    expect(captureBeforeReviewError.path === 'review',
      'Capture before review failed for a reason other than remaining reviews.',
      brief(captureBeforeReviewResult));
    state.guards.captureBeforeReviews = {
      code: captureBeforeReviewError.code,
      path: captureBeforeReviewError.path,
      workspaceUnchanged: true
    };

    const reviewCount = updated.workflow?.remainingVisualReviewCount;
    expect(Number.isSafeInteger(reviewCount) && reviewCount > 0 && reviewCount < 32,
      'The updated overview did not expose a bounded set of visual reviews.', brief(updatedResult));
    const plannedReviews = updated.workflow.remainingVisualReviews ?? [];
    const reviews = [];
    const reviewKeys = new Set();
    for (let index = 0; index < reviewCount; index += 1) {
      const planned = plannedReviews[index] ?? '';
      if (manual && planned.startsWith('cycle:')) {
        await gate(
          `Cycle ${index + 1} is ready. Press Start cycle and watch the visible playback.`,
          { index, mode: 'cycle', planned },
          'Start cycle'
        );
      }
      const nextResult = await present({ review: 'next' }, `present.review-next.${index}`);
      const next = successfulData(nextResult, `present.review-next.${index}`);
      expect(next.purpose === 'delivery' && next.verdict === 'pending',
        `Review ${index + 1} was not a pending delivery observation.`, brief(nextResult));
      expect(next.frameEvidence?.pixelHash?.startsWith('sha256:'),
        `Review ${index + 1} did not include real viewport pixel evidence.`, brief(nextResult));
      const key = `${next.mode}:${next.camera}:${next.clipId ?? ''}`;
      expect(!reviewKeys.has(key), `Review ${index + 1} repeated ${key}.`);
      reviewKeys.add(key);
      const review = {
        mode: next.mode,
        camera: next.camera,
        clipId: next.clipId,
        frameNonce: next.frameNonce,
        completedCycles: next.completedCycles,
        frameEvidence: next.frameEvidence,
        checkIds: next.reviewChecks.map((check) => check.id)
      };
      await pauseBeforeAcceptance(review, index);
      const acceptedResult = await present({
        review: 'accept', frameNonce: review.frameNonce, checkIds: review.checkIds
      }, `present.review-accept.${index}`);
      const accepted = successfulData(acceptedResult, `present.review-accept.${index}`);
      expect(accepted.verdict === 'accepted' && accepted.review === 'accept',
        `Review ${index + 1} was not accepted.`, brief(acceptedResult));
      reviews.push({ ...review, accepted: true, completedCycles: accepted.completedCycles });
      await wait(40);
    }
    for (const camera of ['left', 'right']) {
      expect(reviews.some((review) => review.mode === 'frame' && review.camera === camera),
        `The review sequence did not observe the ${camera} side.`);
    }
    const left = reviews.find((review) => review.camera === 'left');
    const right = reviews.find((review) => review.camera === 'right');
    expect(left.frameNonce !== right.frameNonce,
      'Opposite sides reused one frame acknowledgement.');
    expect(reviews.some((review) => review.mode === 'cycle' && review.completedCycles >= 1),
      'The review sequence contained no completed animation cycle.');
    state.reviews = reviews;

    const completedResult = await inspect(undefined, 'inspect.after-reviews');
    const completed = successfulData(completedResult, 'inspect.after-reviews');
    expect(completed.workflow?.remainingVisualReviewCount === 0 && completed.workflow?.stage === 'deliver',
      'All review acceptances did not move the public workflow to delivery.', brief(completedResult));
    state.afterReviews = {
      workflow: completed.workflow,
      revision: completed.revision,
      workspaceHash: completed.workspaceHash
    };

    const captureResult = await capture({ kind: 'build' }, 'capture.build');
    expect(captureResult.ok === true, 'The public build capture failed.', brief(captureResult));
    const artifact = captureResult.artifact;
    expect(artifact?.contentType === 'image/gif' && artifact.byteLength > 0 &&
      artifact.contentHash?.startsWith('sha256:'),
    'The public build capture did not return a valid GIF artifact.', brief(captureResult));
    state.capture = artifact;
    state.finishedAt = new Date().toISOString();
    state.status = 'success';
    render('Success — public agent protocol and real Workbench rendering passed.');
  };

  render('Starting public agent browser regression…');
  run().then(() => {
    submitResult();
  }).catch((error) => {
    state.status = 'failure';
    state.error = {
      message: toError(error),
      details: error && typeof error === 'object' ? error.details : undefined
    };
    state.finishedAt = new Date().toISOString();
    gateElement.dataset.visible = 'false';
    render(`Failure — ${state.error.message}`);
    submitResult();
    console.error('ashfox agent browser regression failed', error);
  });
})();
