import { compileSoundSource, parseSoundSource, AUDIO_POLICY, type SoundProduct } from '@ashfox/audio-core';
import { readDirectoryWorkspace, isDirectorySource, directoryPath } from '../../project/directory/read';
import type { DirectoryFile, DirectoryWorkspace } from '../../project/directory/contract';
import { lexProgramSource } from '../../project/program/syntax/lex';
import { compileDirectorySprite } from './sprite';
import type { SpriteProduct } from '../sprite/contract';
import { sha256Digest } from '../../provenance/digest';
import { SPRITE_POLICY, SpriteInputError } from '../../project/sprite/contract';
import { sealWorkspaceCandidate } from '../../project/workspace/seal';
import { DEFAULT_WORKSPACE_LIMITS, ASHFOX_WORKSPACE_COMPILER_FINGERPRINT, type AuthoredAssetWorkspace, type WorkspaceEntrySelector } from '../../project/workspace';
import { compileAssetWorkspaceEntry } from '../program/asset/compile';
import type { CompiledModel } from '../../model/compiled';
import { applyWorkspaceChangeSet } from '../program/asset/workspaceChange';
import { computeWorkspaceHash } from '../../project/workspace/hash';

export type DirectoryProduct = {readonly kind:'sprite';readonly entry:WorkspaceEntrySelector;readonly sourcePath:string;readonly sprite:SpriteProduct} |
  {readonly kind:'model';readonly entry:WorkspaceEntrySelector;readonly sourcePath:string;readonly model:CompiledModel;readonly workspace:AuthoredAssetWorkspace} |
  {readonly kind:'sound';readonly entry:WorkspaceEntrySelector;readonly sourcePath:string;readonly sounds:readonly SoundProduct[]};
export type DirectoryCompilation = {readonly ok:true;readonly config:DirectoryWorkspace;readonly sourceHash:string;readonly buildKey:string;readonly products:readonly DirectoryProduct[]} |
  {readonly ok:false;readonly diagnostics:readonly {readonly code:string;readonly file:string;readonly message:string}[]};
const ordered = (v:unknown):unknown => Array.isArray(v)?v.map(ordered):v&&typeof v==='object'?
  Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,x])=>[k,ordered(x)])):v;
export const compileDirectoryWorkspace = (configuration:string, files:readonly DirectoryFile[]):DirectoryCompilation => {
  try {
    const config=readDirectoryWorkspace(configuration);
    if(files.length>512 || files.reduce((n,f)=>n+new TextEncoder().encode(f.source).length,0)>8*1024*1024) throw new Error('Workspace source budget exceeded');
    const declared=new Set(config.packages.flatMap(p=>[...p.manifest.entries,...p.manifest.modules].map(e=>[p.root,e.path].filter(Boolean).join('/'))));
    const seen=new Set<string>();
    for(const f of files){
      if(!directoryPath(f.path)||!isDirectorySource(config,f.path)||!declared.has(f.path)||seen.has(f.path.toLowerCase()))throw new Error('Undeclared, ignored or duplicate source: '+f.path);
      seen.add(f.path.toLowerCase());
    }
    for(const p of declared)if(!files.some(f=>f.path===p))throw new Error('Missing source: '+p);
    const products:DirectoryProduct[]=[],spritePaths=new Set<string>();
    const entries=config.packages.flatMap(p=>p.manifest.entries.map(e=>({entry:{packageName:p.name,entryName:e.name},path:[p.root,e.path].filter(Boolean).join('/')})));
    if(!entries.length)throw new Error('Workspace must declare an entry');
    const modelEntries:typeof entries=[];
    let soundSeconds=0, soundCount=0;
    for(const e of entries){
      const text=files.find(f=>f.path===e.path)!.source;
      const tokens=lexProgramSource(text).tokens;
      if(tokens[2]?.value==='sprite'){
        const compiled=compileDirectorySprite(files,e.path);
        if(!compiled.result.ok)return {ok:false,diagnostics:compiled.result.diagnostics.map(d=>({code:d.code,file:d.file,message:d.pointer+': '+d.expected+'; '+d.actual}))};
        const sprite=compiled.result.products[0]!;
        if(sprite.id!==e.entry.entryName)throw new Error('Entry name must match sprite id: '+e.path);
        products.push({kind:'sprite',entry:e.entry,sourcePath:e.path,sprite});
        compiled.paths.forEach(p=>spritePaths.add(p));
      }else if(tokens[2]?.value==='sound'){
        const recipe=parseSoundSource(text,e.path);
        soundSeconds+=recipe.duration*recipe.variants.length;
        if(++soundCount>32 || soundSeconds>60)throw new Error('Sound workspace budget exceeded');
        if(recipe.id!==e.entry.entryName)throw new Error('Entry name must match sound id: '+e.path);
        const sounds=compileSoundSource(text,e.path);
        products.push({kind:'sound',entry:e.entry,sourcePath:e.path,sounds});
        spritePaths.add(e.path);
      }else modelEntries.push(e);
    }
    if(modelEntries.length){
      const packages=config.packages.map(p=>({...p,manifest:{...p.manifest,
        entries:p.manifest.entries.filter(e=>modelEntries.some(m=>m.entry.packageName===p.name&&m.entry.entryName===e.name)),
        modules:p.manifest.modules.filter(e=>!spritePaths.has([p.root,e.path].filter(Boolean).join('/')))}}));
      const manifest={format:'ashfox-workspace' as const,version:1 as const,packages};
      const base:AuthoredAssetWorkspace={files:[],manifest,lock:{format:'ashfox-lock',version:1,compilerFingerprint:ASHFOX_WORKSPACE_COMPILER_FINGERPRINT,packages:[]}};
      const sealed=sealWorkspaceCandidate(base,files.filter(f=>!spritePaths.has(f.path)),manifest,DEFAULT_WORKSPACE_LIMITS);
      if(!sealed.ok)throw new Error(JSON.stringify(sealed.diagnostics));
      const checked=applyWorkspaceChangeSet(sealed.value,{expectedWorkspaceHash:computeWorkspaceHash(sealed.value),writes:[],deletes:[]});
      if(!checked.ok)throw new Error(JSON.stringify(checked.diagnostics));
      for(const e of modelEntries){const result=compileAssetWorkspaceEntry(checked.workspace,e.entry);
        if(!result.ok)throw new Error(JSON.stringify(result.diagnostics));
        products.push({kind:'model',entry:e.entry,sourcePath:e.path,model:result.model,workspace:checked.workspace});}
    } else if(files.some(f=>!spritePaths.has(f.path)))throw new Error('Every declared module must be reachable');
    for(const target of config.exports){
      const p=products.find(p=>p.entry.packageName===target.entry.packageName&&p.entry.entryName===target.entry.entryName)!;
      if(!({sprite:['png'],model:['glb','java_block','geckolib5','bedrock'],sound:['wav']} as const)[p.kind].some(format=>format===target.format))throw new Error('Export format does not match entry kind: '+target.name);
    }
    for (const pack of config.packs ?? []) for (const sound of pack.format === 'minecraft_java' ? pack.sounds : []) {
      const target = config.exports.find(e => e.name === sound.source)!;
      const product = products.find(p => p.entry.packageName === target.entry.packageName && p.entry.entryName === target.entry.entryName);
      if (product?.kind !== 'sound') throw new Error('Pack sound source kind mismatch: ' + sound.source);
      if (sound.variants !== 'all' && sound.variants.some(v => !product.sounds.some(s => s.variant === v.id))) {
        throw new Error('Unknown sound variant in pack: ' + pack.name + '/' + sound.id);
      }
    }
    products.sort((a,b)=>{const left=a.entry.packageName+':'+a.entry.entryName,right=b.entry.packageName+':'+b.entry.entryName;return left<right?-1:left>right?1:0;});
    const sourceHash=sha256Digest(JSON.stringify(ordered({config,files:[...files].sort((a,b)=>a.path<b.path?-1:1)})));
    const buildKey=sha256Digest(sourceHash+SPRITE_POLICY+AUDIO_POLICY+ASHFOX_WORKSPACE_COMPILER_FINGERPRINT+':directory-v2');
    return {ok:true,config,sourceHash,buildKey,products:Object.freeze(products)};
  }catch(error){return {ok:false,diagnostics:[{code:error instanceof SpriteInputError?error.diagnostic.code:'workspace.compile',
    file:error instanceof SpriteInputError?error.diagnostic.file:'.ashfoxworkspace',message:error instanceof Error?error.message:String(error)}]};}
};
