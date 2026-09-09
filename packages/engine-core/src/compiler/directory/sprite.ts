import { parseSpriteSource, type SpriteSourceUnit } from '../../project/sprite/source';
import { SpriteInputError } from '../../project/sprite/contract';
import type { DirectoryFile } from '../../project/directory/contract';
import { sha256Digest } from '../../provenance/digest';
import { compileItemStudy } from '../sprite/compile';

const relative = (owner: string, target: string): string => {
  if (!target.startsWith('./') && !target.startsWith('../')) throw new Error('Sprite imports must be relative .ashfox paths');
  if (!target.endsWith('.ashfox') || /[\\\x00-\x1f]/.test(target)) throw new Error('Invalid sprite import');
  const parts = owner.split('/').slice(0,-1);
  for (const p of target.split('/')) {
    if (p === '.') continue;
    if (p === '..') { if (!parts.length) throw new Error('Import escapes root'); parts.pop(); }
    else if (!p) throw new Error('Empty import path component'); else parts.push(p);
  }
  return parts.join('/');
};
export const compileDirectorySprite = (files: readonly DirectoryFile[], entry: string) => {
  const units = new Map<string,SpriteSourceUnit>(), visiting = new Set<string>();
  const visit = (path: string): void => {
    if (visiting.has(path)) throw new Error('Sprite import cycle: '+path);
    if (units.has(path)) return;
    if (visiting.size >= 32) throw new Error('Sprite import depth exceeds 32');
    const file = files.find(f=>f.path===path); if (!file) throw new Error('Missing or ignored source: '+path);
    visiting.add(path); const unit = parseSpriteSource(file.source,path);
    if (path !== entry && unit.kind !== 'module') throw new Error('Import must refer to a module: '+path);
    for (const dependency of unit.imports) visit(relative(path,dependency.path));
    units.set(path,unit); visiting.delete(path);
  };
  try {
    visit(entry); const root=units.get(entry)!;
    if (!root.item) throw new Error('Entry must declare sprite');
    const symbol = (path: string, id: unknown): string => 's'+sha256Digest(path+':'+String(id)).slice(-32);
    const resolve = (path: string, reference: unknown, kind: 'masks'|'materials'|'stamps'): string => {
      if (typeof reference !== 'string') throw new Error('Expected source reference');
      const parts=reference.split('.'); let owner=path, id=parts[0]!;
      if (parts.length===2) {
        const imported=units.get(path)!.imports.find(i=>i.alias===parts[0]);
        if (!imported) throw new Error('Unknown import alias '+parts[0]);
        owner=relative(path,imported.path); id=parts[1]!;
      } else if (parts.length!==1) throw new Error('Expected local or alias.name reference');
      if (!units.get(owner)![kind].some(d=>d.id===id)) throw new Error(`Missing ${kind} declaration ${reference}`);
      return symbol(owner,id);
    };
    const study = {format:'ashfox-item-study',version:1,
      masks:[...units].flatMap(([p,u])=>u.masks.map(m=>({...m,id:symbol(p,m.id)}))),
      materials:[...units].flatMap(([p,u])=>u.materials.map(m=>({...m,id:symbol(p,m.id)}))),
      stamps:[...units].flatMap(([p,u])=>u.stamps.map(m=>({...m,id:symbol(p,m.id)}))),
      items:[{...root.item,layers:(root.item.layers as Record<string,unknown>[]).map(l=> l.op==='part'?
        {...l,mask:resolve(entry,l.mask,'masks'),material:resolve(entry,l.material,'materials')}:l.op==='stamp'?
          {...l,stamp:resolve(entry,l.stamp,'stamps')}:l)}]};
    const result=compileItemStudy(JSON.stringify(study),entry);
    return {result,paths:[...units.keys()].sort()};
  } catch(error) {
    return { result:{ok:false as const,diagnostics:[error instanceof SpriteInputError?error.diagnostic:
      {code:'sprite.resolve',file:entry,pointer:'',expected:'closed sprite source graph',actual:error instanceof Error?error.message:String(error)}]},paths:[...units.keys()]};
  }
};
