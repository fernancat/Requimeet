// No providers: layout regression for the complete Brody panel with long content.
const {chromium}=require('playwright'),assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']});try{
for(const [width,height] of [[360,640],[768,768],[1366,768],[1920,1080]]){
 const page=await browser.newPage({viewport:{width,height}});
 await page.route('**/api/**',route=>{const path=new URL(route.request().url()).pathname;let data={enabled:true,jobs:[]};
 if(path.endsWith('/voice'))data={enabled:true,shared:true,version:1,available:true,latest:{id:'reply',kind:'reply',status:'ready',text:'Una respuesta extensa para revisar el contexto. '.repeat(15),createdAt:new Date().toISOString()}};
 if(path.endsWith('/questions'))data=[{id:'q',version:1,text:'¿Cómo funciona el proceso y quién necesita aprobar cada paso? '.repeat(8),status:'PENDING',reason:'Aclarar',priority:'HIGH',answer:'',sourceIds:[],evidenceIds:[]}];
 if(path.endsWith('/requirements'))data=Array.from({length:5},(_,i)=>({id:String(i),text:'Requerimiento visible '+i,status:'PENDING',version:1}));
 return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});});
 await page.goto('http://localhost:5173/login');
 await page.evaluate(async()=>{const {default:React}=await import('/node_modules/.vite/deps/react.js'),{default:ReactDOM}=await import('/node_modules/.vite/deps/react-dom_client.js'),{default:Brody}=await import('/src/features/brody/BrodyAssistant.tsx');const stage=document.createElement('div');stage.style.cssText='display:flex;height:calc(100dvh - 40px);width:min(100%,420px);margin:auto;min-height:0;';document.body.replaceChildren(stage);ReactDOM.createRoot(stage).render(React.createElement(Brody,{code:'QA',token:'fake',canEdit:true,refreshVersion:0,interrupted:false,connected:true}));});
 await page.getByText('Brody responde', {exact:true}).waitFor();
 assert.equal(await page.locator('.brody-bubble').count(),1,'one principal intervention');
 await page.locator('.brody-avatar canvas').waitFor();
 await page.waitForTimeout(600);
 await page.screenshot({path:`/tmp/requimeet-panel-initial-${width}.png`});
 await page.getByRole('button',{name:/Ver aquí/}).click();
 const visible=await page.locator('.brody-detections article').first().evaluate(el=>{const r=el.getBoundingClientRect(),panel=el.closest('.brody-assistant').getBoundingClientRect();return r.top>=panel.top&&r.bottom<=panel.bottom;});
 assert.equal(visible,true,`requirements must be visible after click at ${width}`);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:`/tmp/requimeet-panel-${width}.png`});await page.close();
}
console.log('Panel: requirements visible at 360, 768, 1366 and 1920 pixels; no horizontal overflow.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
