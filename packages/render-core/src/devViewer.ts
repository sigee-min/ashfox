import * as THREE from 'three';
import type { CompiledVfx, ProjectDocument } from '@ashfox/engine-core';
import { projectToThreeScene } from './projection';
import { waitForProjectionTextures } from './captureSurface';
import { createStudioEnvironmentMap } from './sceneMaterials';
import { buildStructureScene, type StructureObservationPayload } from './structureRender';
import { createVfxThreeGroup, evaluateVfxThreeGroup } from './vfxRender';
import {
  addViewportLighting,
  createGroundContactShadow,
  createViewportEnvironment,
  fitDirectionalShadowBounds,
} from './viewportEnvironment';

export interface DevInspectRef {
  readonly id: string;
  readonly symbol: string;
  readonly kind: string;
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly sourceRef: string;
  readonly position?: readonly [number, number, number];
  readonly dims?: readonly [number, number, number];
}

export interface DevDiagnostic {
  readonly severity?: string;
  readonly code: string;
  readonly file?: string;
  readonly message: string;
  readonly hint?: string;
}

export interface DevViewerState {
  readonly revision: number;
  readonly ok: boolean;
  readonly kind: 'model' | 'structure' | 'sprite' | 'sound' | 'vfx' | 'error';
  readonly entry: string;
  readonly auditScore: number | null;
  readonly auditDelta: number | null;
  readonly diagnostics: readonly DevDiagnostic[];
  readonly inspectRefs: readonly DevInspectRef[];
  readonly document?: ProjectDocument;
  readonly structure?: StructureObservationPayload;
  readonly vfx?: CompiledVfx;
  readonly png?: string;
  readonly wave?: readonly number[];
}

interface ViewerDom {
  readonly viewport: HTMLDivElement;
  readonly preview2d: HTMLDivElement;
  readonly titleEl: HTMLElement;
  readonly auditEl: HTMLElement;
  readonly inspectEl: HTMLElement;
  readonly copyBtn: HTMLButtonElement;
  readonly diagEl: HTMLElement;
}

interface OrbitState {
  theta: number;
  phi: number;
  radius: number;
  target: THREE.Vector3;
}

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
  styles?: Partial<CSSStyleDeclaration>,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (styles) Object.assign(node.style, styles);
  return node;
};

const createViewerDom = (): ViewerDom => {
  document.body.style.margin = '0';
  document.body.style.background = '#11151b';
  document.body.style.color = '#e5ebf2';
  document.body.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, monospace';
  const shell = el('div', undefined, {
    display: 'grid',
    gridTemplateColumns: '1fr 340px',
    height: '100vh',
  });
  const viewport = el('div', undefined, {
    position: 'relative',
    overflow: 'hidden',
    background: '#171c24',
  });
  const preview2d = el('div', undefined, {
    position: 'absolute',
    inset: '0',
    display: 'none',
    alignItems: 'center',
    justifyContent: 'center',
  });
  viewport.appendChild(preview2d);
  const sidebar = el('aside', undefined, {
    padding: '14px',
    borderLeft: '1px solid #28303d',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    fontSize: '12px',
  });
  const titleEl = el('div', 'Ashfox Dev', { fontWeight: '700', fontSize: '14px' });
  const auditEl = el('div', 'Audit: -', { color: '#9ab0c9' });
  const inspectCard = el('div', undefined, {
    padding: '10px',
    background: '#1b222c',
    borderRadius: '6px',
  });
  const inspectEl = el('pre', 'Click a part, room, or anchor to inspect.', {
    margin: '0 0 8px 0',
    whiteSpace: 'pre-wrap',
  });
  const copyBtn = el('button', 'Copy Source Ref', {
    display: 'none',
    padding: '6px 10px',
    background: '#2b6cb0',
    color: '#fff',
    border: '0',
    borderRadius: '4px',
    cursor: 'pointer',
  });
  inspectCard.append(inspectEl, copyBtn);
  const diagEl = el('div', undefined, { display: 'flex', flexDirection: 'column', gap: '8px' });
  sidebar.append(titleEl, auditEl, inspectCard, diagEl);
  shell.append(viewport, sidebar);
  document.body.appendChild(shell);
  return { viewport, preview2d, titleEl, auditEl, inspectEl, copyBtn, diagEl };
};

const formatVec = (vec: readonly number[] | undefined): string =>
  vec ? `[${vec.map((n) => Number(n.toFixed(2))).join(', ')}]` : '-';

const renderInspectSelection = (dom: ViewerDom, ref: DevInspectRef | null): void => {
  if (!ref) {
    dom.inspectEl.textContent = 'Click a part, room, or anchor to inspect.';
    dom.copyBtn.style.display = 'none';
    return;
  }
  dom.inspectEl.textContent = [
    `symbol: ${ref.symbol} (${ref.kind})`,
    `source: ${ref.sourceRef}`,
    `pos: ${formatVec(ref.position)}`,
    `dims: ${formatVec(ref.dims)}`,
  ].join('\n');
  dom.copyBtn.style.display = 'inline-block';
  dom.copyBtn.textContent = 'Copy Source Ref';
  dom.copyBtn.onclick = () => {
    void navigator.clipboard?.writeText(ref.sourceRef);
    dom.copyBtn.textContent = 'Copied!';
  };
};

const renderDiagnostics = (dom: ViewerDom, diagnostics: readonly DevDiagnostic[]): void => {
  dom.diagEl.replaceChildren();
  for (const diag of diagnostics) {
    const card = el('div', undefined, {
      padding: '8px',
      borderRadius: '6px',
      background: '#2b191c',
      border: '1px solid #6b2931',
    });
    const head = el('div', `[${diag.code}] ${diag.file ?? ''}`, {
      color: '#ff9ca3',
      fontWeight: '600',
    });
    const msg = el('div', diag.message, { marginTop: '4px' });
    card.append(head, msg);
    if (diag.hint) card.appendChild(el('div', diag.hint, { marginTop: '4px', color: '#ffd485' }));
    dom.diagEl.appendChild(card);
  }
};

const renderWaveCanvas = (wave: readonly number[]): HTMLCanvasElement => {
  const canvas = el('canvas', undefined, {
    maxWidth: '90%',
    borderRadius: '6px',
    background: '#0e1319',
  });
  canvas.width = 640;
  canvas.height = 240;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.strokeStyle = '#e4a851';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < wave.length; i++) {
    const x = (i / Math.max(1, wave.length - 1)) * canvas.width;
    const h = (wave[i] ?? 0) * (canvas.height * 0.42);
    ctx.moveTo(x, canvas.height / 2 - h);
    ctx.lineTo(x, canvas.height / 2 + h);
  }
  ctx.stroke();
  return canvas;
};

const attachOrbitControls = (
  domElement: HTMLElement,
  orbit: OrbitState,
  updateCam: () => void,
  onClick: (clientX: number, clientY: number) => void,
): void => {
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let lastX = 0;
  let lastY = 0;
  domElement.addEventListener('pointerdown', (e) => {
    dragging = true;
    startX = lastX = e.clientX;
    startY = lastY = e.clientY;
  });
  window.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    orbit.theta -= (e.clientX - lastX) * 0.008;
    orbit.phi = Math.max(0.12, Math.min(Math.PI - 0.12, orbit.phi - (e.clientY - lastY) * 0.008));
    lastX = e.clientX;
    lastY = e.clientY;
    updateCam();
  });
  window.addEventListener('pointerup', (e) => {
    if (!dragging) return;
    dragging = false;
    if (Math.hypot(e.clientX - startX, e.clientY - startY) < 5) onClick(e.clientX, e.clientY);
  });
  domElement.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      orbit.radius = Math.max(2, Math.min(240, orbit.radius * (e.deltaY > 0 ? 1.12 : 0.89)));
      updateCam();
    },
    { passive: false },
  );
};

const addStructurePickBoxes = (
  refs: readonly DevInspectRef[],
  selectable: THREE.Object3D[],
  group: THREE.Object3D,
): void => {
  for (const ref of refs) {
    if (!ref.position || !ref.dims) continue;
    const [sx, sy, sz] = ref.dims;
    if (sx <= 0 || sy <= 0 || sz <= 0) continue;
    const proxy = new THREE.Mesh(
      new THREE.BoxGeometry(sx, sy, sz),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    proxy.position.set(
      ref.position[0] + sx / 2,
      ref.position[1] + sy / 2,
      ref.position[2] + sz / 2,
    );
    proxy.userData.inspectRef = ref;
    group.add(proxy);
    selectable.push(proxy);
  }
};

const matchInspectRef = (
  hit: THREE.Intersection,
  refs: readonly DevInspectRef[],
): DevInspectRef | null => {
  const direct = hit.object.userData.inspectRef as DevInspectRef | undefined;
  if (direct) return direct;
  const nodeId = hit.object.userData.nodeId;
  if (typeof nodeId === 'string') {
    return (
      refs.find((r) => r.id === nodeId || r.symbol === nodeId || nodeId.endsWith(`/${r.id}`)) ??
      null
    );
  }
  return refs[0] ?? null;
};

const setupSceneLighting = (
  scene: THREE.Scene,
  environmentTarget: THREE.WebGLRenderTarget,
  twilight = false,
): void => {
  const env = createViewportEnvironment(twilight ? 'evening' : 'studio');
  scene.background = env.background;
  scene.environment = environmentTarget.texture;
  addViewportLighting(scene);
};

const frameOrbitToRoot = (root: THREE.Object3D, orbit: OrbitState): void => {
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) return;
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  orbit.target.copy(sphere.center);
  orbit.radius = Math.max(4, sphere.radius * 2.5);
};

interface ViewerContext {
  readonly dom: ViewerDom;
  readonly renderer: THREE.WebGLRenderer;
  readonly environmentTarget: THREE.WebGLRenderTarget;
  readonly camera: THREE.PerspectiveCamera;
  readonly orbit: OrbitState;
  activeRefs: readonly DevInspectRef[];
  selectable: THREE.Object3D[];
  highlight: THREE.BoxHelper | null;
  activeScene: THREE.Scene;
  disposeActive: () => void;
}

const updateCameraView = (ctx: ViewerContext): void => {
  const sinPhi = Math.sin(ctx.orbit.phi);
  ctx.camera.position.set(
    ctx.orbit.target.x + ctx.orbit.radius * sinPhi * Math.sin(ctx.orbit.theta),
    ctx.orbit.target.y + ctx.orbit.radius * Math.cos(ctx.orbit.phi),
    ctx.orbit.target.z + ctx.orbit.radius * sinPhi * Math.cos(ctx.orbit.theta),
  );
  ctx.camera.lookAt(ctx.orbit.target);
  ctx.renderer.render(ctx.activeScene, ctx.camera);
};

const resizeViewport = (ctx: ViewerContext): void => {
  const w = Math.max(1, ctx.dom.viewport.clientWidth);
  const h = Math.max(1, ctx.dom.viewport.clientHeight);
  ctx.camera.aspect = w / h;
  ctx.camera.updateProjectionMatrix();
  ctx.renderer.setSize(w, h);
  updateCameraView(ctx);
};

const pickAtPointer = (ctx: ViewerContext, clientX: number, clientY: number): void => {
  const rect = ctx.renderer.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  );
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(ndc, ctx.camera);
  const hits = raycaster.intersectObjects(ctx.selectable, true);
  if (hits.length === 0) return;
  const hit = hits[0]!;
  renderInspectSelection(ctx.dom, matchInspectRef(hit, ctx.activeRefs));
  if (ctx.highlight) ctx.activeScene.remove(ctx.highlight);
  ctx.highlight = new THREE.BoxHelper(hit.object, '#ffaa33');
  ctx.activeScene.add(ctx.highlight);
  ctx.renderer.render(ctx.activeScene, ctx.camera);
};

const mount2dContent = (ctx: ViewerContext, state: DevViewerState): void => {
  ctx.dom.preview2d.style.display = 'flex';
  ctx.dom.preview2d.replaceChildren();
  if (state.png) {
    const img = el('img', undefined, {
      width: '256px',
      imageRendering: 'pixelated',
      cursor: 'pointer',
    });
    img.src = `data:image/png;base64,${state.png}`;
    img.onclick = () => renderInspectSelection(ctx.dom, ctx.activeRefs[0] ?? null);
    ctx.dom.preview2d.appendChild(img);
  } else if (state.wave) {
    const canvas = renderWaveCanvas(state.wave);
    canvas.onclick = () => renderInspectSelection(ctx.dom, ctx.activeRefs[0] ?? null);
    ctx.dom.preview2d.appendChild(canvas);
  }
  ctx.disposeActive = () => {};
  resizeViewport(ctx);
};

const mountVfxContent = (ctx: ViewerContext, vfx: CompiledVfx): void => {
  ctx.dom.preview2d.style.display = 'none';
  const group = createVfxThreeGroup(vfx);
  evaluateVfxThreeGroup(group, Math.max(0.05, vfx.durationSeconds * 0.35));
  ctx.activeScene.add(group.root);
  group.root.traverse((o) => {
    if (o instanceof THREE.Mesh) ctx.selectable.push(o);
  });
  ctx.disposeActive = () => group.dispose();
  frameOrbitToRoot(group.root, ctx.orbit);
  resizeViewport(ctx);
};

const mountModelContent = async (ctx: ViewerContext, doc: ProjectDocument): Promise<void> => {
  ctx.dom.preview2d.style.display = 'none';
  const proj = projectToThreeScene(doc, {
    assets: {},
    showSkeleton: true,
    showTextures: true,
    showWireframe: false,
  });
  await waitForProjectionTextures(proj, new AbortController().signal);
  proj.root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(proj.root);
  fitDirectionalShadowBounds(ctx.activeScene, bounds);
  const groundShadow = createGroundContactShadow(bounds, { studioStage: true });
  ctx.activeScene.add(groundShadow.object, proj.root);
  ctx.selectable = [...proj.selectable];
  ctx.disposeActive = () => {
    groundShadow.dispose();
    proj.dispose();
  };
  frameOrbitToRoot(proj.root, ctx.orbit);
  resizeViewport(ctx);
};

const mountStructureContent = async (
  ctx: ViewerContext,
  structure: StructureObservationPayload,
  inspectRefs: readonly DevInspectRef[],
): Promise<void> => {
  ctx.dom.preview2d.style.display = 'none';
  const handle = await buildStructureScene(
    structure,
    { dioramaBase: true },
    new AbortController().signal,
  );
  ctx.activeScene.add(handle.root);
  handle.root.traverse((o) => {
    if (o instanceof THREE.Mesh) ctx.selectable.push(o);
  });
  addStructurePickBoxes(inspectRefs, ctx.selectable, ctx.activeScene);
  ctx.disposeActive = () => handle.dispose();
  frameOrbitToRoot(handle.root, ctx.orbit);
  resizeViewport(ctx);
};

const applyViewerState = async (ctx: ViewerContext, state: DevViewerState): Promise<void> => {
  ctx.dom.titleEl.textContent = `${state.entry} (${state.kind})`;
  const delta =
    state.auditDelta !== null ? ` (${state.auditDelta >= 0 ? '+' : ''}${state.auditDelta})` : '';
  ctx.dom.auditEl.textContent = `Audit: ${state.auditScore !== null ? `${state.auditScore}${delta}` : '-'}`;
  renderDiagnostics(ctx.dom, state.diagnostics);
  ctx.activeRefs = state.inspectRefs;
  renderInspectSelection(ctx.dom, state.inspectRefs[0] ?? null);
  if (!state.ok) return;
  ctx.disposeActive();
  ctx.selectable = [];
  ctx.highlight = null;
  ctx.activeScene = new THREE.Scene();
  setupSceneLighting(ctx.activeScene, ctx.environmentTarget);
  if (state.document) return mountModelContent(ctx, state.document);
  if (state.structure) return mountStructureContent(ctx, state.structure, state.inspectRefs);
  if (state.vfx) return mountVfxContent(ctx, state.vfx);
  mount2dContent(ctx, state);
};

export const mountDevViewer = (): void => {
  const dom = createViewerDom();
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  dom.viewport.appendChild(renderer.domElement);
  const environmentTarget = createStudioEnvironmentMap(renderer);
  const ctx: ViewerContext = {
    dom,
    renderer,
    environmentTarget,
    camera: new THREE.PerspectiveCamera(42, 1, 0.1, 1000),
    orbit: { theta: 0.7, phi: 1.05, radius: 24, target: new THREE.Vector3() },
    activeRefs: [],
    selectable: [],
    highlight: null,
    activeScene: new THREE.Scene(),
    disposeActive: () => {},
  };
  window.addEventListener('beforeunload', () => {
    ctx.disposeActive();
    environmentTarget.dispose();
    renderer.dispose();
  });
  window.addEventListener('resize', () => resizeViewport(ctx));
  attachOrbitControls(
    renderer.domElement,
    ctx.orbit,
    () => updateCameraView(ctx),
    (x, y) => pickAtPointer(ctx, x, y),
  );
  const refresh = async (): Promise<void> => {
    const res = await fetch('/api/state');
    if (res.ok) await applyViewerState(ctx, (await res.json()) as DevViewerState);
  };
  void refresh();
  const events = new EventSource('/events');
  events.onmessage = () => void refresh();
};
