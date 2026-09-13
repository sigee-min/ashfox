import { AUDIO_POLICY } from '@ashfox/audio-core';
import { BuildFailure } from '@ashfox/asset-build';
import { DEFAULT_VIEW, type Prepared, type ViewOptions } from './contract';
import { readInput, readView, record, text } from './read';
import { prepareWorker } from './worker';
import { ChromeRenderer } from './chrome';
import { inspect, capture, exportAsset, mediaRecord } from './operations';
export const observationCapabilities={
  format:'ashfox-observer',version:1,commands:['inspect','capture','replay','export','stdio'],
  methods:['capabilities','load','source','inspect','view','capture','replay','export','cancel','close'],
  inputs:['ashfox-file','png-file','memory-source-graph','base64-png'],media:['image/png','image/gif','audio/wav','model/gltf-binary','application/zip'],
  formats:['glb','gltf','java_block','geckolib5','bedrock','png','wav'],viewDefaults:DEFAULT_VIEW,
  sound:{contract:AUDIO_POLICY,features:['curves','sequences','variation','resonator','loops'],loopCodecs:['wav']},
  guide:'https://ashfox.io/docs/guides/observe/',
  defaults:{transport:'stdio',fileWrites:false},limits:{inputBytes:16*1024*1024,queuedRequests:8,compileSeconds:120,renderSeconds:120,mediaBytes:32*1024*1024}
};
export class ObservationSession {
  private asset?:Prepared;
  private view:ViewOptions=DEFAULT_VIEW;
  readonly renderer=new ChromeRenderer();
  constructor(private readonly executable:string){}
  async run(method:string,params:unknown,signal:AbortSignal):Promise<unknown>{
    if(method==='capabilities'){record(params,[]);return observationCapabilities;}
    if(method==='load'){
      const p=record(params,['input','expectedRevision']);
      if(this.asset&&p.expectedRevision!==this.asset.revision)throw new BuildFailure('observe.stale','load requires the current expectedRevision',2);
      if(!this.asset&&p.expectedRevision!==undefined)throw new BuildFailure('observe.stale','No current revision',2);
      const next=await prepareWorker(this.executable,readInput(p.input),signal);
      if(signal.aborted)throw new BuildFailure('observe.cancelled','Cancelled',130);
      this.asset=next;this.view=DEFAULT_VIEW;
      return {kind:next.kind,revision:next.revision};
    }
    if(method==='close'){record(params,[]);await this.renderer.close();this.asset=undefined;this.view=DEFAULT_VIEW;return {closed:true};}
    if(!this.asset)throw new BuildFailure('observe.empty','Load an asset first',2);
    if(method==='source'){record(params,[]);return {revision:this.asset.revision,files:this.asset.files};}
    const p=record(params,['options','expectedRevision','reset']);
    if(p.expectedRevision!==undefined&&p.expectedRevision!==this.asset.revision)throw new BuildFailure('observe.stale','Revision mismatch',2);
    if(p.reset!==undefined&&typeof p.reset!=='boolean')throw new BuildFailure('observe.contract','reset must be boolean',2);
    const view=readView(p.options??{},p.reset?DEFAULT_VIEW:this.view);
    if(method==='view'){this.view=view;return {revision:this.asset.revision,options:view};}
    if(method==='inspect')return inspect(this.asset,view);
    if(method==='capture'||method==='replay')return {revision:this.asset.revision,...mediaRecord(await capture(this.asset,view,method==='replay',this.renderer,signal))};
    if(method==='export'){
      const media=await exportAsset(this.asset,view);
      if(signal.aborted)throw new BuildFailure('observe.cancelled','Cancelled before output',130);
      return {revision:this.asset.revision,...mediaRecord(media)};
    }
    throw new BuildFailure('observe.method','Unknown method: '+method,2);
  }
}
const failure=(error:unknown)=>({code:error instanceof BuildFailure?error.code:'observe.failure',message:error instanceof Error?error.message:String(error)});
const send=async(value:unknown):Promise<void>=>new Promise((resolve,reject)=>process.stdout.write(JSON.stringify(value)+'\n',error=>error?reject(error):resolve()));
export const stdio=async(executable:string,signal:AbortSignal):Promise<void>=>{
  const session=new ObservationSession(executable);
  let buffer=Buffer.alloc(0),queued=0,chain=Promise.resolve(),active:{id:string;controller:AbortController}|undefined;
  const ids=new Set<string>();
  const cancel=()=>{active?.controller.abort();process.stdin.destroy(new BuildFailure('observe.cancelled','Cancelled',130));};signal.addEventListener('abort',cancel);
  const enqueue=async(line:string)=>{
    let id:unknown=null;
    try {
      const request=record(JSON.parse(line),['id','method','params']);id=text(request.id,'id');
      if(ids.has(String(id)))throw new BuildFailure('observe.id','Duplicate active request ID',2);
      const method=text(request.method,'method'),params=request.params??{};
      if(method==='cancel'){
        const p=record(params,['id']);const target=text(p.id,'id');const cancelled=active?.id===target;
        if(cancelled)active?.controller.abort();
        await send({format:'ashfox-observer',version:1,id,ok:true,result:{cancelled}});return;
      }
      if(queued>=8)throw new BuildFailure('observe.queue','At most 8 requests may be queued',2);
      ids.add(String(id));queued++;
      chain=chain.then(async()=>{
        const controller=new AbortController();active={id:String(id),controller};if(signal.aborted)controller.abort();
        try{const result=await session.run(method,params,controller.signal);await send({format:'ashfox-observer',version:1,id,ok:true,result});}
        catch(error){await send({format:'ashfox-observer',version:1,id,ok:false,error:failure(error)});}
        finally{active=undefined;queued--;ids.delete(String(id));}
      });
    }catch(error){await send({format:'ashfox-observer',version:1,id,ok:false,error:failure(error)});}
  };
  try {
    for await(const chunk of process.stdin){
      buffer=Buffer.concat([buffer,Buffer.from(chunk)]);
      let end;
      while((end=buffer.indexOf(10))>=0){
        if(end>16*1024*1024)throw new BuildFailure('observe.budget','Request exceeds 16 MiB',2);
        const line=buffer.subarray(0,end).toString('utf8');buffer=buffer.subarray(end+1);
        if(line.trim())await enqueue(line);
      }
      if(buffer.length>16*1024*1024)throw new BuildFailure('observe.budget','Request exceeds 16 MiB',2);
    }
    if(buffer.length)await enqueue(buffer.toString('utf8'));
    await chain;
  }finally{active?.controller.abort();await chain;await session.renderer.close();signal.removeEventListener('abort',cancel);}
};
