import { chromeShutdown } from './shutdown';
import { findChrome } from '../onboarding/browser';
import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { BuildFailure } from '@ashfox/asset-build';
declare const ASHFOX_OBSERVER_BUNDLE: string;
interface Reply { id?: number; result?: Record<string, unknown>; error?: {message:string} }
export class ChromeRenderer {
  private child?: ChildProcess;
  private closing?:Promise<void>;
  private shutdown?: () => Promise<void>;
  private profile?: string;
  private pipe?: Writable;
  private serial=0;
  private buffer=Buffer.alloc(0);
  private session?: string;
  private readonly pending=new Map<number,{resolve:(v:Record<string,unknown>)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  async start():Promise<void> {
    if(this.closing)await this.closing;
    if(this.child)return;
    const executable=findChrome();
    if(!executable)throw new BuildFailure('capture.browser','Chrome/Chromium is required for rendering. Set ASHFOX_CHROME_PATH to its executable.',3);
    this.profile=fs.mkdtempSync(path.join(os.tmpdir(),'ashfox-render-'));
    const child=spawn(executable,['--headless=new','--remote-debugging-pipe','--disable-background-networking','--disable-component-update','--disable-extensions','--no-first-run','--no-default-browser-check','--use-angle=swiftshader','--enable-unsafe-swiftshader','--user-data-dir='+this.profile,'about:blank'],{stdio:['ignore','ignore','ignore','pipe','pipe']});
    this.child=child;this.pipe=child.stdio[3] as Writable;
    const pipe=this.pipe;
    this.shutdown=chromeShutdown(child,()=>{
      pipe.write(JSON.stringify({id:++this.serial,method:'Browser.close'})+'\0',error=>{if(error)child.kill('SIGTERM');});
    });
    pipe.on('error',error=>this.fail(error));
    (child.stdio[4] as Readable).on('data',(chunk:Buffer)=>{
      this.buffer=Buffer.concat([this.buffer,chunk]);
      if(this.buffer.length>96*1024*1024){this.fail(new Error('Renderer response exceeds 96 MiB'));void this.close();return;}
      let end;
      while((end=this.buffer.indexOf(0))>=0){
        const data=this.buffer.subarray(0,end).toString();this.buffer=this.buffer.subarray(end+1);
        let reply:Reply;try{reply=JSON.parse(data);}catch(error){this.fail(error instanceof Error?error:new Error(String(error)));continue;}
        if(reply.id===undefined)continue;
        const pending=this.pending.get(reply.id);if(!pending)continue;
        clearTimeout(pending.timer);this.pending.delete(reply.id);
        if(reply.error)pending.reject(new Error(reply.error.message));else pending.resolve(reply.result??{});
      }
    });
    child.once('error',error=>this.fail(error));child.once('exit',()=>this.fail(new Error('Renderer process exited')));
    try {
      const target=await this.call('Target.createTarget',{url:'about:blank'});
      const attached=await this.call('Target.attachToTarget',{targetId:target.targetId,flatten:true});
      this.session=String(attached.sessionId);
      await this.call('Runtime.enable',{},this.session);
      await this.evaluate('document.head.innerHTML = '+JSON.stringify('<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\' \'unsafe-eval\'; img-src data: blob:; style-src \'unsafe-inline\'">'));
      await this.evaluate(ASHFOX_OBSERVER_BUNDLE);
    }catch(error){await this.close();throw error;}
  }
  private fail(error:Error):void {for(const pending of this.pending.values()){clearTimeout(pending.timer);pending.reject(error);}this.pending.clear();}
  private call(method:string,params:Record<string,unknown>,sessionId?:string):Promise<Record<string,unknown>> {
    return new Promise((resolve,reject)=>{
      const id=++this.serial;
      const timer=setTimeout(()=>{this.pending.delete(id);reject(new BuildFailure('capture.timeout','Renderer exceeded 120 seconds',3));void this.close();},120000);
      this.pending.set(id,{resolve,reject,timer});
      this.pipe!.write(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})})+'\0',error=>{if(error){clearTimeout(timer);this.pending.delete(id);reject(error);}});
    });
  }
  async evaluate(expression:string):Promise<unknown> {
    const reply=await this.call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},this.session);
    if(reply.exceptionDetails)throw new BuildFailure('capture.render',JSON.stringify(reply.exceptionDetails),3);
    const result=reply.result as {value?:unknown}|undefined;
    return result?.value;
  }
  close():Promise<void> {
    if(this.closing)return this.closing;
    this.closing=this.stop().finally(()=>{this.closing=undefined;});
    return this.closing;
  }
  private async stop():Promise<void> {
    this.child=undefined;this.session=undefined;
    this.fail(new BuildFailure('capture.cancelled','Renderer stopped',130));
    await this.shutdown?.();this.shutdown=undefined;this.pipe=undefined;
    if(this.profile){await fs.promises.rm(this.profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});this.profile=undefined;}
    this.buffer=Buffer.alloc(0);
  }
}
