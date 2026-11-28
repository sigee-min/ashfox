import { is3dDomain } from './state.js';

const THREE_PKG = 'three';

export const buildAgentPrompt = (entry, lang) =>
  lang === 'ko'
    ? `https://ashfox.io/agent.md 를 읽고 https://ashfox.io${entry.sourceHref} 예제를 참고해 비슷한 에셋을 만들어 줘.`
    : `Read https://ashfox.io/agent.md and use https://ashfox.io${entry.sourceHref} as reference to build a matching ${entry.domain} asset.`;

const buildCliSnippet = (entry) =>
  `npx @ashfox/cli check ${entry.sourcePath}\nnpx @ashfox/cli build ${entry.sourcePath} --out ./dist`;

const buildThreeSnippet = (entry) => {
  if (is3dDomain(entry.domain)) {
    const clip = entry.motions?.[0] || entry.meta?.clips?.[0];
    const animLine = clip
      ? `\n  const mixer = new THREE.AnimationMixer(gltf.scene);\n  const clip = gltf.animations.find(c => c.name === '${clip}');\n  if (clip) mixer.clipAction(clip).play();`
      : '';
    return `import { GLTFLoader } from '${THREE_PKG}/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
loader.load('${entry.outputHref}', (gltf) => {
  scene.add(gltf.scene);${animLine}
});`;
  }
  if (entry.domain === 'sound') {
    const loopLine = entry.meta?.loop ? '\n  src.loop = true;' : '';
    return `const ctx = new AudioContext();
const res = await fetch('${entry.outputHref}');
const buf = await ctx.decodeAudioData(await res.arrayBuffer());
const src = ctx.createBufferSource();
src.buffer = buf;${loopLine}
src.connect(ctx.destination);
src.start();`;
  }
  return `import * as THREE from '${THREE_PKG}';

const tex = new THREE.TextureLoader().load('${entry.outputHref}');
tex.magFilter = THREE.NearestFilter;
tex.minFilter = THREE.NearestFilter;
tex.colorSpace = THREE.SRGBColorSpace;`;
};

const buildUnitySnippet = (entry) => {
  if (is3dDomain(entry.domain)) {
    return `// Using glTFast (com.unity.cloud.gltfast)
var gltf = new GLTFast.GltfImport();
await gltf.Load("${entry.outputHref}");
await gltf.InstantiateMainSceneAsync(transform);`;
  }
  if (entry.domain === 'sound') {
    const loopLine = entry.meta?.loop ? '\nsource.loop = true;' : '';
    return `AudioSource source = gameObject.AddComponent<AudioSource>();
source.clip = Resources.Load<AudioClip>("${entry.id}");${loopLine}
source.Play();`;
  }
  return `Texture2D tex = Resources.Load<Texture2D>("${entry.id}");
tex.filterMode = FilterMode.Point;
var sprite = Sprite.Create(tex, new Rect(0, 0, tex.width, tex.height), new Vector2(0.5f, 0.5f), 16f);`;
};

const buildGodotSnippet = (entry) => {
  if (is3dDomain(entry.domain)) {
    const clip = entry.motions?.[0] || entry.meta?.clips?.[0];
    const animLine = clip ? `\n\t$AnimationPlayer.play("${clip}")` : '';
    return `var scene := preload("res://assets/${entry.id}.glb")
func _ready() -> void:
\tvar instance := scene.instantiate()
\tadd_child(instance)${animLine}`;
  }
  if (entry.domain === 'sound') {
    return `@onready var sfx := AudioStreamPlayer.new()
func _ready() -> void:
\tadd_child(sfx)
\tsfx.stream = preload("res://assets/${entry.id}.wav")
\tsfx.play()`;
  }
  if (entry.meta?.spriteProfile === 'ui_9slice') {
    return `var panel := NinePatchRect.new()
panel.texture = preload("res://assets/${entry.id}.png")
panel.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST`;
  }
  return `var sprite := Sprite2D.new()
sprite.texture = preload("res://assets/${entry.id}.png")
sprite.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST`;
};

export const buildUseSnippets = (entry, lang, copy) => [
  {
    id: 'agent',
    label: copy.useAgentPrompt || 'Agent Prompt',
    code: buildAgentPrompt(entry, lang),
  },
  { id: 'cli', label: copy.useCliBuild || 'CLI Build', code: buildCliSnippet(entry) },
  { id: 'three', label: copy.useThreeJs || 'Three.js / Web', code: buildThreeSnippet(entry) },
  { id: 'unity', label: copy.useUnity || 'Unity C#', code: buildUnitySnippet(entry) },
  { id: 'godot', label: copy.useGodot || 'Godot GDScript', code: buildGodotSnippet(entry) },
];
