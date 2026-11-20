import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

// Exercise the component methods with synthetic snapshots, without starting a native host.
const bundle=await build({stdin:{contents:["import '@angular/compiler';",
  "export {DesktopAppComponent} from './src/app/desktop-app.component';",
  "export {defaultChartSettings} from './src/app/chart-settings';"].join('\n'),
  resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'});
const {DesktopAppComponent,defaultChartSettings}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

test('switching from a pending Mars search to Sun displays only the Sun result',async()=>{
  const app=Object.create(DesktopAppComponent.prototype), hour=3_600_000, day=24*hour;
  Object.assign(app,{ascensionsBodies:['Sun','Mars'],ascensionsAxes:['AS','MC','DS','IC'],ascensionsBody:'Mars',
    ascensionsAxis:'AS',ascensionsTicket:0,ascensionsBusy:false,ascensionsBase:{utcIso:new Date(18*hour).toISOString()},
    ascensionsError:false,destroyed:false,cd:{markForCheck(){}},clearEventPreview(){},planetLabel:name=>name});
  let release;const pending=new Promise(resolve=>{release=resolve;});let first=true;
  const snapshot=time=>({bodies:[{id:'Mars',longitudeDeg:180},{id:'Sun',longitudeDeg:60}],
    houses:[{ascendantDeg:((time/day*360)%360+360)%360,mcDeg:0}]});
  app.eventSnapshot=async (_base,time)=>{if(first){first=false;await pending;}return snapshot(time);};
  const shown=[];
  app.showEventPreview=async (_base,instant,name,ticket,validate)=>{
    if(ticket!==app.ascensionsTicket) return;
    const chart=snapshot(instant);
    assert.equal(validate({data:{planets:{Sun:{longitude:60},Mars:{longitude:180}},
      as:chart.houses[0].ascendantDeg,mc:0}}),true);
    shown.push({instant,name});
  };
  app.changeAscensionBody('Mars');
  app.changeAscensionBody('Sun');
  for(let i=0;i<50 && app.ascensionsBusy;i++) await new Promise(resolve=>setImmediate(resolve));
  assert.equal(app.ascensionsBusy,false);
  assert.equal(shown.length,1);assert.equal(shown[0].name,'Sun · AS');
  assert.ok(Math.abs(shown[0].instant-4*hour)<1000);
  release();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(shown.length,1);
});

test('chakra hides aspects only while active and preserves the user preference',()=>{
  const app=Object.create(DesktopAppComponent.prototype), settings=defaultChartSettings();
  Object.assign(app,{chartSettings:settings,chartSkin:'virgostars',theme:'light',mode:'natal',chakraOpen:true,
    chakraSelected:'Anahata',sessionCharts:[],activeChartId:null,directionChart:null,zodiacMode:null,
    monomeriEnabled:false,kleroiEnabled:false,arabicPartsOpen:false,apogeeOpen:false});
  assert.equal(app.options().mostraAspetti,false);
  assert.equal(settings.showAspects,true);
  app.chakraOpen=false;
  assert.equal(app.options().mostraAspetti,true);
  settings.showAspects=false;
  assert.equal(app.options().mostraAspetti,false);
});
