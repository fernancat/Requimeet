/** Real providers + two browser clients. Supply synthetic speech mentioning Brody.
 * Requires running services and private apps/server/.env. Uses isolated QA accounts;
 * generated provider audio may consume credits. Never uses a physical microphone. */
const fs = require('fs');
const { chromium } = require('playwright');
require('dotenv').config({ path: 'apps/server/.env', quiet: true });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
if (!process.argv.includes('--real-providers')) throw Error('Esta prueba consume créditos. Usa --real-providers solo con autorización explícita.');
const clip = process.argv[2];
if (!clip) throw Error('Usage: node scripts/verify-brody-tts.cjs <synthetic-mention.mp3>');
let meeting, host, guest, browser;
const report = { events: [] };
async function api(path, token, method = 'GET', body) {
 const r = await fetch('http://localhost:3000/api'+path, {method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 if (!r.ok) throw Error(path+' HTTP '+r.status); return r.json();
}
async function waitFor(fn, timeout = 45000) { const deadline = Date.now()+timeout; while(Date.now()<deadline) {const v=await fn(); if(v) return v; await new Promise(r=>setTimeout(r,200));} throw Error('Timed out waiting for QA condition'); }
async function pageFor(user) {
 const context=await browser.newContext({viewport:{width:1366,height:900}}); const page=await context.newPage();
 await page.addInitScript(({token,code})=>{
  localStorage.setItem('requimeet.hostToken',token); sessionStorage.setItem('requimeet.media.'+code,JSON.stringify({audioEnabled:true,videoEnabled:false}));
  const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia=async constraints=>{
   if(!constraints.audio)return original(constraints);
   if(!window.qaMic){const ctx=new AudioContext(),dest=ctx.createMediaStreamDestination();window.qaMic={ctx,dest};}
   await window.qaMic.ctx.resume();return window.qaMic.dest.stream;
  };
  window.qaVoice=[];
  const create=AudioContext.prototype.createBufferSource;
  AudioContext.prototype.createBufferSource=function(){const src=create.call(this); let playback=false; const connect=src.connect.bind(src),start=src.start.bind(src),stop=src.stop.bind(src);
   src.connect=function(dest,...args){playback=dest===src.context.destination;return connect(dest,...args)};
   src.start=function(...args){if(playback)window.qaVoice.push({kind:'start',at:Date.now(),offset:args[1]||0});return start(...args)};
   src.stop=function(...args){if(playback)window.qaVoice.push({kind:'stop',at:Date.now()});return stop(...args)};return src;};
  new MutationObserver(()=>{const speaking=document.querySelector('.brody-assistant')?.dataset.speaking;if(window.qaSpeaking!==speaking){window.qaSpeaking=speaking;window.qaVoice.push({kind:'human',speaking,at:Date.now()})}}).observe(document,{attributes:true,subtree:true,attributeFilter:['data-speaking']});
 },{token:user.accessToken,code:meeting.code});
 await page.goto('http://localhost:5173/m/'+meeting.code); await page.locator('.brody-assistant').waitFor(); return page;
}
(async()=>{
 try {
  const suffix=Date.now();
  host=await api('/auth/register','', 'POST',{email:`tts-host-${suffix}@example.com`,password:require('crypto').randomBytes(20).toString('hex'),displayName:'QA anfitrión'});
  guest=await api('/auth/register','', 'POST',{email:`tts-guest-${suffix}@example.com`,password:require('crypto').randomBytes(20).toString('hex'),displayName:'QA participante'});
  meeting=await api('/meetings',host.accessToken,'POST',{title:'QA voz v4 Turbo y turnos'});
  await api('/meetings/'+meeting.code+'/start',host.accessToken,'POST');
  await prisma.participant.create({data:{meetingId:meeting.id,hostUserId:guest.user.id,displayName:'QA participante',role:'guest'}});
  await prisma.question.create({data:{meetingId:meeting.id,text:'¿Quién podrá aprobar los cambios y qué validaciones necesitan antes de guardar una solicitud? Podemos revisar primero los permisos y después las excepciones de cada proceso.',normalizedText:'qa voz',category:'permissions',priority:'HIGH',reason:'Prueba de voz',sourceIds:[]}});
  browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
  const hp=await pageFor(host),gp=await pageFor(guest);
  await hp.getByRole('button',{name:'Activar voz de Brody'}).click({timeout:30000});
  await hp.getByLabel('Compartir voz con todos').click();
  await waitFor(()=>hp.getByLabel('Compartir voz con todos').isChecked());
  await gp.getByRole('button',{name:'Escuchar a Brody',exact:true}).click({timeout:30000});
  await waitFor(async()=>await hp.evaluate(()=>window.qaVoice.some(e=>e.kind==='start')) && await gp.evaluate(()=>window.qaVoice.some(e=>e.kind==='start')));
  report.sharedPlayback=true;
  await gp.evaluate(async b64=>{const {ctx,dest}=window.qaMic;const buffer=await ctx.decodeAudioData(Uint8Array.from(atob(b64),c=>c.charCodeAt(0)).buffer);const src=ctx.createBufferSource();src.buffer=buffer;src.connect(dest);src.start();},fs.readFileSync(clip).toString('base64'));
  await waitFor(async()=>await hp.evaluate(()=>window.qaVoice.some(e=>e.kind==='stop')) && await gp.evaluate(()=>window.qaVoice.some(e=>e.kind==='stop')),15000);
  report.bothInterrupted=true;
  const reply=await waitFor(async()=>{const s=await api('/meetings/'+meeting.code+'/voice',host.accessToken);if(s.latest?.kind==='reply'&&s.latest.status==='failed')throw Error(s.latest.error);return s.latest?.kind==='reply'&&s.latest.status==='ready'?s.latest:null;},60000);
  report.reply={text:reply.text,status:reply.status};
  await waitFor(async()=>await hp.locator('.brody-voice').innerText().then(s=>s.includes('Brody está hablando')),15000);
  report.hostEvents=await hp.evaluate(()=>window.qaVoice);report.guestEvents=await gp.evaluate(()=>window.qaVoice);
  await hp.screenshot({path:'/tmp/requimeet-brody-tts-host.png'}); await gp.setViewportSize({width:360,height:800});await gp.screenshot({path:'/tmp/requimeet-brody-tts-mobile.png'});
  console.log(JSON.stringify(report,null,2));
 } catch(e) {console.error('QA failure:',e.message);throw e;} finally {
  await browser?.close();
  if(meeting) {await api('/meetings/'+meeting.code+'/end',host.accessToken,'POST').catch(()=>{});for(const model of ['requirement','transcriptSegment','chatMessage','participant','joinRequest'])await prisma[model].deleteMany({where:{meetingId:meeting.id}});await prisma.meeting.delete({where:{id:meeting.id}});}
  for(const user of [host,guest])if(user)await prisma.hostUser.delete({where:{id:user.user.id}}).catch(()=>{});
  await prisma.$disconnect();
 }
})().catch(e=>{console.error(e.message);process.exitCode=1});
