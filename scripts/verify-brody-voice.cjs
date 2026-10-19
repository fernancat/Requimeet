/**
 * Real browser microphone-path check. Uses pre-recorded WAV speech, not a physical mic.
 * Run from repo root: node scripts/verify-brody-voice.cjs /path/to/clips /path/to/results
 * Requires running local services and privately configured real providers.
 * Provide round1.wav; after READY/ROUND_RESULT, supply round2.wav answering the shown
 * follow-up (up to 150s). Creates an isolated test account/meeting and ends it.
 * Providers may charge. Tokens are never saved in the report.
 */
const {createRequire}=require('module'),fs=require('fs');
const req=createRequire(process.cwd()+'/package.json');
const {chromium}=req('playwright'); const {io}=req('socket.io-client');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const path=require('path');
const clips=process.argv[2], artifacts=process.argv[3];
if(!clips||!artifacts)throw Error('Usage: node scripts/verify-brody-voice.cjs <clips-dir> <results-dir>');
fs.mkdirSync(artifacts,{recursive:true});
const reportFile=path.join(artifacts,'voice-report.json');
const report={started:new Date().toISOString(),rounds:[],events:[]};
let token,meeting,browser,socket;
async function api(path,method='GET',body){const r=await fetch('http://localhost:3000/api'+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});if(!r.ok)throw Error(path+' HTTP '+r.status);return r.json()}
async function main(){
 const reg=await api('/auth/register','POST',{email:'voice-'+Date.now()+'@example.com',password:require('crypto').randomBytes(20).toString('hex'),displayName:'Prueba de voz Brody'});token=reg.accessToken;
 meeting=await api('/meetings','POST',{title:'Prueba integral de voz sintética y latencia de Brody'});
 await api('/meetings/'+meeting.code+'/start','POST');
 socket=io('http://localhost:3000',{auth:{token},transports:['websocket']});
 await new Promise((r,j)=>{socket.on('connect',r);socket.on('connect_error',j)});
 await new Promise(r=>socket.emit('meeting:subscribe',{code:meeting.code},r));
 socket.on('processing:result',e=>{if(e.kind?.includes('transcript'))report.events.push({at:Date.now(),kind:e.kind,text:e.payload?.text,isFinal:e.isFinal})});
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{}),args:['--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
 const page=await browser.newPage({viewport:{width:1366,height:900}});
 await page.addInitScript(({token,code})=>{
 localStorage.setItem('requimeet.hostToken',token);
 sessionStorage.setItem('requimeet.media.'+code,JSON.stringify({audioEnabled:true,videoEnabled:false}));
 const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
 navigator.mediaDevices.getUserMedia=async constraints=>{
 if(!constraints.audio)return original(constraints);
 if(!window.testAudio){const ctx=new AudioContext(); const dest=ctx.createMediaStreamDestination(); const osc=ctx.createOscillator(),gain=ctx.createGain();gain.gain.value=0;osc.connect(gain).connect(dest);osc.start();window.testAudio={ctx,dest}}
 await window.testAudio.ctx.resume();return window.testAudio.dest.stream;
 };
 window.brodyChanges=[];
 new MutationObserver(()=>{const text=document.querySelector('.brody-question')?.textContent; if(text&&window.brodyChanges.at(-1)?.text!==text)window.brodyChanges.push({at:Date.now(),text})}).observe(document,{subtree:true,childList:true,characterData:true});
 },{token,code:meeting.code});
 await page.goto('http://localhost:5173/m/'+meeting.code);
 await page.locator('.brody-question').waitFor({timeout:30000});
 await page.waitForFunction(()=>!!window.testAudio);
 await sleep(4000);
 console.log('READY',await page.locator('.brody-question').innerText());
 for(let round=1;round<=2;round++){
 const file=path.join(clips,'round'+round+'.wav');
 const deadline=Date.now()+150000;while(!fs.existsSync(file)){if(Date.now()>deadline)throw Error('Falta audio ronda '+round);await sleep(300)}
 const before=await page.locator('.brody-question').innerText();
 const audio=fs.readFileSync(file).toString('base64');
 const times=await page.evaluate(async audio=>{
 const {ctx,dest}=window.testAudio;const buffer=await ctx.decodeAudioData(Uint8Array.from(atob(audio),c=>c.charCodeAt(0)).buffer);
 const src=ctx.createBufferSource();src.buffer=buffer;src.connect(dest);
 const start=Date.now();src.start();await new Promise(r=>src.onended=r);
 return {start,end:Date.now(),duration:buffer.duration};
 },audio);
 console.log('AUDIO_END',round,JSON.stringify(times));
 let changed;const until=Date.now()+90000;
 while(Date.now()<until){
 const changes=await page.evaluate(()=>window.brodyChanges);
 changed=changes.find(c=>c.at>=times.start&&c.text!==before);
 if(changed)break;await sleep(100);
 }
 const questions=await api('/meetings/'+meeting.code+'/questions');
 const analysis=await api('/meetings/'+meeting.code+'/analysis');
 const result={round,before,...times,next:changed,latencyMs:changed?changed.at-times.end:null,questions,analysis};
 report.rounds.push(result);
 await page.screenshot({path:path.join(artifacts,'voice-round'+round+'.png'),fullPage:true});
 fs.writeFileSync(reportFile,JSON.stringify(report,null,2));
 console.log('ROUND_RESULT',JSON.stringify(result));
 if(!changed)throw Error('Brody no avanzó en 90 segundos');
 const answered=questions.find(q=>q.text===before);
 if(!answered?.automaticResolution||answered.status!=='RESOLVED')throw Error('La pregunta cambió sin resolver automáticamente la anterior');
 }
 const settledUntil=Date.now()+45000;
 while(Date.now()<settledUntil){
   await sleep(1000);
   const analysis=await api('/meetings/'+meeting.code+'/analysis');
   const transcripts=await api('/meetings/'+meeting.code+'/transcripts');
   report.final={analysis,transcripts,questions:await api('/meetings/'+meeting.code+'/questions'),requirements:await api('/meetings/'+meeting.code+'/requirements')};
   if(!analysis.jobs.some(j=>['queued','running'].includes(j.status))&&transcripts.items.every(s=>s.isFinal&&s.analyzedRevision===s.revision))break;
 }
 if(!report.final.transcripts.items.length||report.final.transcripts.items.some(s=>!s.isFinal||s.analyzedRevision!==s.revision))throw Error('Quedaron fragmentos sin procesar');
 if(report.final.analysis.jobs.some(j=>j.status!=='completed'))throw Error('Quedaron trabajos fallidos o sin terminar');
 console.log('DONE');
}
main().catch(e=>{report.error=e.message;console.error('FAIL',e.message);process.exitCode=1}).finally(async()=>{
 fs.writeFileSync(reportFile,JSON.stringify(report,null,2));
 if(meeting)await api('/meetings/'+meeting.code+'/end','POST').catch(()=>{});
 socket?.disconnect();await browser?.close();
});
