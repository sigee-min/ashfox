import { Worker } from 'node:worker_threads';
import { BuildFailure } from '@ashfox/asset-build';
import type { Prepared, SourceInput } from './contract';
export const prepareWorker=(file:string,input:SourceInput,signal:AbortSignal):Promise<Prepared>=>new Promise((resolve,reject)=>{
  if(signal.aborted){reject(new BuildFailure('observe.cancelled','Cancelled',130));return;}
  const worker=new Worker(file,{workerData:{observe:input},resourceLimits:{maxOldGenerationSizeMb:256}});
  let settled=false;
  const finish=(error?:Error,value?:Prepared):void=>{if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',cancel);void worker.terminate().then(()=>error?reject(error):resolve(value!));};
  const cancel=()=>finish(new BuildFailure('observe.cancelled','Cancelled',130));
  const timer=setTimeout(()=>finish(new BuildFailure('observe.timeout','Compilation exceeded 120 seconds',3)),120000);
  signal.addEventListener('abort',cancel,{once:true});
  worker.once('message',(reply:{ok:boolean;value?:Prepared;message?:string;code?:string;exitCode?:number})=>reply.ok?finish(undefined,reply.value):finish(new BuildFailure(reply.code??'observe.compile',reply.message??'Compilation failed',reply.exitCode??1)));
  worker.once('error',error=>finish(error));worker.once('exit',code=>{if(!settled)finish(new Error('Compiler exited without result: '+code));});
});
