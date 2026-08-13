#!/usr/bin/env node
const WS_URL=process.env.BRIDGE_WS_URL??'ws://bridge:8080/telemetry',PARAMETER='LOG_DISARMED'
const targets=[{name:'copter',sysId:1,compId:1},{name:'plane',sysId:2,compId:1}],frames=new Map(),seen=new Set(),originals=new Map()
let socket=null,sequence=0,stopping=false
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms)),nextId=label=>`${label}-${++sequence}-${Date.now()}`
async function connect(deadline){while(Date.now()<deadline){try{const ws=new WebSocket(WS_URL);await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('connect timeout')),3000);ws.addEventListener('open',()=>{clearTimeout(timer);resolve()},{once:true});ws.addEventListener('error',()=>{clearTimeout(timer);reject(new Error('connect failed'))},{once:true})});return ws}catch{await delay(1000)}}throw new Error('bridge unavailable')}
async function waitFrame(id,deadline){while(Date.now()<deadline){const frame=frames.get(id);if(frame?.status==='failed')throw new Error(`${id}: ${frame.reason}`);if(frame?.status==='complete')return frame;await delay(50)}throw new Error(`${id}: transaction timeout`)}
async function read(target,label){const requestId=nextId(`${target.name}-${label}-read`);socket.send(JSON.stringify({type:'requestParameter',requestId,sysId:target.sysId,compId:target.compId,name:PARAMETER}));return (await waitFrame(requestId,Date.now()+15000)).value.value}
async function write(target,value,label){const requestId=nextId(`${target.name}-${label}-write`);socket.send(JSON.stringify({type:'writeParameter',requestId,sysId:target.sysId,compId:target.compId,name:PARAMETER,value,actor:'sitl-parameter-write-controller',timestampMs:Date.now(),confirmation:true}));await waitFrame(requestId,Date.now()+15000)}
async function verify(target,expected,label){const actual=await read(target,label);if(Math.abs(actual-expected)>1e-6)throw new Error(`${target.name}: expected ${PARAMETER}=${expected}, got ${actual}`)}
async function restore(){if(socket?.readyState!==WebSocket.OPEN)return;for(const target of targets){const original=originals.get(target.name);if(original===undefined)continue;try{await write(target,original,'cleanup');await verify(target,original,'cleanup');console.log(`${target.name}: restored ${PARAMETER}=${original}`)}catch(error){console.error(`cleanup ${target.name} failed: ${error.message}`);process.exitCode=1}}}
async function run(){socket=await connect(Date.now()+120000);socket.addEventListener('message',event=>{const frame=JSON.parse(event.data.toString());if(frame.type==='parameterRead'||frame.type==='parameterWrite')frames.set(frame.requestId,frame);if(frame.messageName==='HEARTBEAT')seen.add(`${frame.sysId}:${frame.compId}`)})
 while(!stopping&&targets.some(target=>!seen.has(`${target.sysId}:${target.compId}`)))await delay(100);if(stopping)throw new Error('stopped by signal')
 for(const target of targets)originals.set(target.name,await read(target,'original'))
 for(const target of targets){const other=targets.find(candidate=>candidate!==target),original=originals.get(target.name),desired=original===0?1:0
   await write(target,desired,'test');await verify(target,desired,'post-write');await verify(other,originals.get(other.name),'isolation')
   console.log(`${target.name} ${target.sysId}:${target.compId}: wrote/read ${PARAMETER}=${desired}; ${other.name} unchanged`)
   await write(target,original,'restore');await verify(target,original,'restore')}
 console.log('parameter-write SITL acceptance passed for both explicit targets')}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stopping=true})
try{await run()}finally{await restore();socket?.close()}
