import {spawn} from 'node:child_process';
import {mkdtempSync, readFileSync} from 'node:fs';
import {join} from 'node:path';

const port = 9347;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
if (process.platform !== 'win32') throw new Error('WINDOWS_ONLY');
if (!process.env.VIRGOSTARS_DE441_PATH) throw new Error('FULL_DE441_REQUIRED');
const exe = join(process.cwd(), '.local/target/release/virgostars-desktop-spike.exe');
if (!readFileSync(exe).includes(Buffer.from('it.virgostars.historicalqa'))) throw new Error('ISOLATED_IDENTIFIER_REQUIRED');
try { await fetch(`http://127.0.0.1:${port}/json/version`); throw new Error('DEVTOOLS_PORT_IN_USE'); }
catch (error) { if (error.message === 'DEVTOOLS_PORT_IN_USE') throw error; }
const env = {...process.env, WEBVIEW2_USER_DATA_FOLDER:mkdtempSync(join(process.cwd(), '.local/historical-qa-profile-')),
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1`};
if (process.env.VIRGOSTARS_HISTORICAL_SMOKE_USNO_DIR) env.VIRGOSTARS_USNO_DIR = process.env.VIRGOSTARS_HISTORICAL_SMOKE_USNO_DIR;
else delete env.VIRGOSTARS_USNO_DIR;
delete env.VIRGOSTARS_CHIRON_SPK;
const child = spawn(exe, [], {windowsHide:true, stdio:'ignore', env});
let socket;
try {
  let page;
  for (let i=0;i<70 && !page;i++) {
    await pause(400);
    if (child.exitCode !== null) throw new Error('APP_EXITED');
    try { page=(await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(x=>x.type==='page' && /^https?:\/\/tauri\.localhost\//.test(x.url)); } catch {}
  }
  if (!page) throw new Error('WEBVIEW_UNAVAILABLE');
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve; socket.onerror=reject;});
  let next=0; const pending=new Map();
  socket.onmessage=event=>{const m=JSON.parse(event.data); if (m.id && pending.has(m.id)) {const [ok,fail]=pending.get(m.id); pending.delete(m.id); m.error ? fail(Error('CDP_ERROR')) : ok(m.result);}};
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++next; pending.set(id,[resolve,reject]); socket.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true}); if(r.exceptionDetails) throw Error('EVALUATION_FAILED'); return r.result.value;};
  let ready=false;
  for(let i=0;i<50 && !ready;i++){await pause(300); ready=await evaluate(`!!document.querySelector('.nav-item')`).catch(()=>false);}
  if(!ready) throw Error('UI_NOT_READY');
  const opened=await evaluate(`(() => {const b=[...document.querySelectorAll('.nav-item')].find(x=>/Pianeti storici|Historical planets/.test(x.textContent)); if(!b)return false; b.click(); return true;})()`);
  if(!opened) throw Error('PANEL_NOT_FOUND');
  await pause(250);
  const filled=await evaluate(`(() => {const p=document.querySelector('vs-historical-planets'); const inputs=p?.querySelectorAll('input[type=number]'); if(!inputs || inputs.length!==6)return false; inputs[5].value='3600'; inputs[5].dispatchEvent(new Event('input',{bubbles:true})); p.querySelector('#historical-scenarios').click(); p.querySelector('form').requestSubmit(); return true;})()`);
  if(!filled) throw Error('FORM_NOT_FOUND');
  let result='';
  for(let i=0;i<50 && !result;i++){await pause(300); result=await evaluate(`document.querySelector('vs-historical-planets .result')?.textContent ?? ''`);}
  if(!/Espenak-Meeus 2006/.test(result) || !/63[.,]8/.test(result) || !/meno incertezza|minus uncertainty/.test(result) || !/più incertezza|plus uncertainty/.test(result)) throw Error('MODEL_OR_SCENARIOS_NOT_SHOWN');
  const manual=await evaluate(`(() => {const p=document.querySelector('vs-historical-planets'); const sel=p.querySelectorAll('select')[1]; sel.value='supplied'; sel.dispatchEvent(new Event('change',{bubbles:true})); return true;})()`);
  if(!manual) throw Error('MANUAL_SOURCE_UNAVAILABLE');
  await pause(150);
  await evaluate(`(() => {const p=document.querySelector('vs-historical-planets'); const a=p.querySelectorAll('input[type=number]'); for(const [i,v] of [[0,'-12999'],[5,'100'],[6,'3600']]){a[i].value=v; a[i].dispatchEvent(new Event('input',{bubbles:true}));} const s=p.querySelector('input[type=text]'); s.value='synthetic'; s.dispatchEvent(new Event('input',{bubbles:true})); p.querySelector('form').requestSubmit();})()`);
  result='';
  for(let i=0;i<50 && !result;i++){await pause(300); result=await evaluate(`document.querySelector('vs-historical-planets .result')?.textContent ?? ''`);}
  if(!/synthetic/.test(result) || !/meno incertezza|minus uncertainty/.test(result)) throw Error('ANCIENT_SCENARIOS_NOT_SHOWN');
  await evaluate(`(() => {const p=document.querySelector('vs-historical-planets'); const sel=p.querySelectorAll('select')[1]; sel.value='espenakMeeus2006'; sel.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await pause(150);
  await evaluate(`(() => {const p=document.querySelector('vs-historical-planets'); const year=p.querySelector('input[type=number]'); year.value='-500'; year.dispatchEvent(new Event('input',{bubbles:true})); p.querySelector('#historical-estimate-uncertainty').click(); p.querySelector('form').requestSubmit();})()`);
  result='';
  for(let i=0;i<50 && !result;i++){await pause(300); result=await evaluate(`document.querySelector('vs-historical-planets .result')?.textContent ?? ''`);}
  if(!/Morrison-Stephenson 2004 standard error/.test(result) || !/meno incertezza|minus uncertainty/.test(result)) throw Error('ESTIMATED_UNCERTAINTY_NOT_SHOWN');
  if (process.env.VIRGOSTARS_HISTORICAL_SMOKE_USNO_DIR) {
    await evaluate(`(() => {const p=document.querySelector('vs-historical-planets'); const sel=p.querySelectorAll('select')[1]; sel.value='usno'; sel.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await pause(150);
    await evaluate(`(() => {const p=document.querySelector('vs-historical-planets'); const a=p.querySelectorAll('input[type=number]'); for(const [i,v] of [[0,'2000'],[5,'5']]){a[i].value=v; a[i].dispatchEvent(new Event('input',{bubbles:true}));} p.querySelector('form').requestSubmit();})()`);
    result='';
    for(let i=0;i<50 && !result;i++){await pause(300); result=await evaluate(`document.querySelector('vs-historical-planets .result')?.textContent ?? ''`);}
    if(!/Local USNO-format non-prediction \(source unverified\)/.test(result)) throw Error('USNO_RESULT_NOT_SHOWN');
    if(!/Errore riportato dalla tabella|Error reported by the table/.test(result) || !/non indicato|not provided/.test(result)) throw Error('USNO_UNKNOWN_ERROR_NOT_SHOWN');
  }
  process.stdout.write('WebView2 historical panel: model, BCE estimate, uncertainty and explicit source passed' + (process.env.VIRGOSTARS_HISTORICAL_SMOKE_USNO_DIR ? '; USNO passed.\n' : '. USNO not requested.\n'));
} finally { socket?.close(); child.kill(); }
