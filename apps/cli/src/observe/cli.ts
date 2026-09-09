import * as fs from 'node:fs';
import { BuildFailure } from '@ashfox/asset-build';
import { ObservationSession, stdio } from './session';
import { readInput } from './read';
const numeric=new Set(['width','height','azimuth','elevation','zoom','time','fps','duration','scale']);
const boolean=new Set(['wireframe','skeleton','textures']);
const inputBytes=async():Promise<Buffer>=>{
  let length=0;const chunks:Buffer[]=[];
  for await(const chunk of process.stdin){const bytes=Buffer.from(chunk);length+=bytes.length;if(length>16*1024*1024)throw new BuildFailure('observe.budget','stdin exceeds 16 MiB',2);chunks.push(bytes);}
  return Buffer.concat(chunks);
};
export const runObservation=async(args:readonly string[],executable:string,signal:AbortSignal):Promise<void>=>{
  const command=args[0];
  if(command==='stdio'){if(args.length!==1)throw new BuildFailure('observe.arguments','stdio accepts no arguments',2);await stdio(executable,signal);return;}
  let file:string|undefined,output:string|undefined,name:string|undefined,stdin=false,inputJson=false,inputFormat='source';
  const options:Record<string,unknown>={};
  for(let i=1;i<args.length;i++){
    const arg=args[i];
    if(arg==='--stdin'){if(stdin)throw new BuildFailure('observe.arguments','Duplicate --stdin',2);stdin=true;continue;}
    if(arg==='--input-json'){inputJson=true;continue;}
    if(arg.startsWith('--')){
      const key=arg.slice(2);if(key in options)throw new BuildFailure('observe.arguments','Duplicate '+arg,2);
      if(boolean.has(key)){options[key]=true;continue;}
      if(key==='no-textures'){options.textures=false;continue;}
      const value=args[++i];if(value===undefined||value.startsWith('--'))throw new BuildFailure('observe.arguments','Missing value for '+arg,2);
      if(key==='output'){output=value;continue;}if(key==='name'){name=value;continue;}
      if(key==='input-format'){if(!['source','png'].includes(value))throw new BuildFailure('observe.arguments','input-format is source or png',2);inputFormat=value;continue;}
      if(key==='model-path'){options.modelPath=value;continue;}
      options[key]=numeric.has(key)?Number(value):value;
    }else{if(file)throw new BuildFailure('observe.arguments','Expected one input',2);file=arg;}
  }
  if((stdin||inputJson)&&file)throw new BuildFailure('observe.arguments','Choose file or stdin',2);
  if(!file&&!stdin&&!inputJson){
    if(process.stdin.isTTY)throw new BuildFailure('observe.arguments','Supply a file or pipe source to stdin',2);
    stdin=true;
  }
  if(name&&!stdin)throw new BuildFailure('observe.arguments','--name requires --stdin',2);
  if(inputJson&&stdin)throw new BuildFailure('observe.arguments','Choose --stdin or --input-json',2);
  if(inputFormat!=='source'&&!stdin)throw new BuildFailure('observe.arguments','input-format requires --stdin',2);
  const bytes=file?undefined:await inputBytes();
  const source=bytes&&inputFormat!=='png'?new TextDecoder('utf-8',{fatal:true}).decode(bytes):undefined;
  const input=readInput(file?{file}:inputJson?JSON.parse(source!):inputFormat==='png'?{png:bytes!.toString('base64')}:{source,...(name?{name}:{})});
  const session=new ObservationSession(executable);
  try{
    await session.run('load',{input},signal);
    const result=await session.run(command,{options},signal);
    let bytes:Buffer;
    if(command==='inspect')bytes=Buffer.from(JSON.stringify(result)+'\n');
    else {
      const media=result as {encoding:string;data:string};
      if(media.encoding!=='base64')throw new BuildFailure('observe.output','Invalid media result',3);
      bytes=Buffer.from(media.data,'base64');
      if(!output&&process.stdout.isTTY)throw new BuildFailure('observe.terminal','Binary stdout requires a pipe, redirection, or --output',2);
    }
    if(signal.aborted)throw new BuildFailure('observe.cancelled','Cancelled before output',130);
    if(output)fs.writeFileSync(output,bytes,{flag:'wx'});
    else await new Promise<void>((resolve,reject)=>process.stdout.write(bytes,error=>error?reject(error):resolve()));
  }finally{await session.renderer.close();}
};
