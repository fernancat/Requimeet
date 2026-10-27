/** Offline provider test: two browsers and a previously generated MP3. No API credits.
 * Start the Vite frontend, then: node scripts/verify-brody-tts-browser.cjs /path/to/fixture.mp3 */
const {chromium}=require('playwright'),fs=require('fs'),assert=require('node:assert/strict');
const audio=fs.readFileSync(process.argv[2]);
let state={enabled:false,shared:false,version:1,available:true,latest:null}, synthesis=0;
const q={id:'qa-question',version:1,text:'¿Quién autoriza los cambios?',status:'PENDING'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--autoplay-policy=no-user-gesture-required']});
 try {
 const pages=[];
 for(const canEdit of [true,false]){
  const page=await browser.newPage({viewport:{width:canEdit?1366:360,height:800}});pages.push(page);
  await page.route('**/api/**',async route=>{
   const request=route.request(),path=new URL(request.url()).pathname;
   if(path.endsWith('/audio'))return route.fulfill({status:200,contentType:'audio/mpeg',body:audio});
   if(path.endsWith('/voice/question')){synthesis++;state.latest={id:'q-audio',key:'question:qa-question:1',kind:'question',status:'ready',text:q.text,error:null,createdAt:new Date().toISOString()};}
   if(request.method()==='PATCH'){state={...state,...request.postDataJSON(),version:state.version+1};}
   return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(state)});
  });
  await page.goto('http://localhost:5173/login');
  await page.evaluate(async({canEdit,q})=>{
   const {default:React}=await import('/node_modules/.vite/deps/react.js'),{default:ReactDOM}=await import('/node_modules/.vite/deps/react-dom_client.js');const {createRoot}=ReactDOM;
   const {default:Voice}=await import('/src/features/brody/BrodyVoice.tsx');
   const div=document.createElement('div');div.style.padding='16px';document.body.replaceChildren(div);const root=createRoot(div);
   let speaking=true,version=0;
   window.qaEvents=[]; const original=AudioContext.prototype.createBufferSource;
   AudioContext.prototype.createBufferSource=function(){const src=original.call(this),start=src.start.bind(src),stop=src.stop.bind(src);
    src.start=function(...args){window.qaEvents.push({type:'start',speaking,at:Date.now()});return start(...args)};
    src.stop=function(...args){window.qaEvents.push({type:'stop',speaking,at:Date.now()});return stop(...args)};return src;};
   window.qaRender=(value)=>{speaking=value;root.render(React.createElement(Voice,{code:'QA',token:canEdit?'host':'guest',canEdit,connected:true,speaking,refreshVersion:++version,question:q}));};
   window.qaRevise=()=>{q.status='ASKED';q.version=2;window.qaRender(false)};
   window.qaRender(true);
  },{canEdit,q});
 }
 const [host,guest]=pages;
 await host.getByRole('button',{name:'Activar voz de Brody'}).click();
 await host.getByLabel('Compartir voz con todos').click();
 await host.waitForFunction(()=>document.querySelector('input[type=checkbox]')?.checked);
 await guest.evaluate(()=>window.qaRender(true));
 await guest.getByRole('button',{name:'Escuchar a Brody',exact:true}).click();
 await sleep(1800);assert.equal(synthesis,0,'must not synthesize question while human speaks');
 await host.evaluate(()=>window.qaRender(false));
 await host.waitForFunction(()=>window.qaEvents.some(e=>e.type==='start'));
 await guest.evaluate(()=>window.qaRender(true));await sleep(1600);
 assert.equal(await guest.evaluate(()=>window.qaEvents.filter(e=>e.type==='start').length),0,'must not play arriving audio during speech');
 await guest.evaluate(()=>window.qaRender(false));
 await guest.waitForFunction(()=>window.qaEvents.some(e=>e.type==='start'));
 await Promise.all(pages.map(p=>p.evaluate(()=>window.qaRender(true))));
 await sleep(150);
 for(const page of pages){const ev=await page.evaluate(()=>window.qaEvents);assert.ok(ev.some(e=>e.type==='stop'));assert.ok(ev.filter(e=>e.type==='start').every(e=>!e.speaking));}
 state.latest={id:'reply',key:'mention:fixture',kind:'reply',status:'ready',text:'Podemos aclarar quién autoriza los cambios.',error:null,createdAt:new Date().toISOString()};
 await Promise.all(pages.map(p=>p.evaluate(()=>window.qaRender(true))));await sleep(400);
 const before=await guest.evaluate(()=>window.qaEvents.filter(e=>e.type==='start').length);await sleep(1300);
 assert.equal(await guest.evaluate(()=>window.qaEvents.filter(e=>e.type==='start').length),before);
 await Promise.all(pages.map(p=>p.evaluate(()=>window.qaRender(false))));
 await guest.waitForFunction(n=>window.qaEvents.filter(e=>e.type==='start').length>n,before);
 await host.screenshot({path:'/tmp/requimeet-voice-desktop.png'});await guest.screenshot({path:'/tmp/requimeet-voice-mobile.png'});
 assert.equal(await guest.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'mobile overflow');
 await host.getByLabel('Compartir voz con todos').click();await host.waitForFunction(()=>!document.querySelector('input[type=checkbox]')?.checked);
 await guest.evaluate(()=>window.qaRender(false));await sleep(300);
 assert.equal(await guest.getByRole('button',{name:'Silenciar en mi equipo'}).count(),0);
 console.log(JSON.stringify({providerCalls:0,questionRequests:synthesis,sharedPlayback:true,noPlaybackDuringSpeech:true,bothInterrupted:true,replyAfterPause:true,revokedSharing:true,mobileWidth:360}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
