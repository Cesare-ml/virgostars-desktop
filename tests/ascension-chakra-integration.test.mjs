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

test('transits retain natal apogee, dodecatemoria and Arabic part options',()=>{
  const app=Object.create(DesktopAppComponent.prototype), settings=defaultChartSettings();
  const active={id:7,timeUnknown:false,data:{planets:{Sun:{longitude:30}}}};
  Object.defineProperty(app,'activeChart',{value:active});
  Object.assign(app,{chartSettings:settings,chartSkin:'virgostars',theme:'light',mode:'transits',
    transitChart:{},synastryTransitChart:null,directionChart:null,zodiacMode:'dodecatemoria',zodiacPoint:'Sun',
    chakraOpen:false,monomeriEnabled:false,kleroiEnabled:false,apogeeOpen:true,apogeeChartId:7,
    apogeeEvents:[{instant:1,longitude:123,speed:-1}],apogeePreview:null,arabicPartsOpen:true,
    arabicPartsGroup:'custom',arabicCustomPlanet:'Sun',arabicCustomDestination:'ascendant'});
  const options=app.options();
  assert.equal(options.mostraTransiti,true);
  assert.equal(options.dodecatemoriAttivi,true);
  assert.equal(options.dodecatemore,'Sun');
  assert.equal(options.mostraPartiArabe,true);
  assert.deepEqual(options.apogeeLongitudes,[123]);
});

test('selecting an apogee event previews that instant and selecting again restores the butterfly',async()=>{
  const app=Object.create(DesktopAppComponent.prototype), base={id:7,timeZone:'Europe/Rome',latMicro:1,lngMicro:2,placeName:'Luogo fittizio'};
  Object.defineProperty(app,'activeChart',{value:base});
  Object.assign(app,{apogeeOpen:true,apogeeEvents:[{instant:1000,longitude:123,speed:-1}],apogeeSelected:null,
    apogeePreview:null,apogeePreviewTicket:0,activeChartId:7,destroyed:false,initialized:false,locale:'it',cd:{markForCheck(){}}});
  let input;
  app.computeChart=async value=>{input=value;return {id:8};};
  await app.selectApogeeEvent(1000);
  assert.equal(input.utcIso,new Date(1000).toISOString());
  assert.equal(app.apogeeSelected,1000);assert.equal(app.apogeePreview.id,8);
  await app.selectApogeeEvent(1000);
  assert.equal(app.apogeeSelected,null);assert.equal(app.apogeePreview,null);
});

test('a slow apogee preview cannot replace a newer selection',async()=>{
  const app=Object.create(DesktopAppComponent.prototype), base={id:7,timeZone:'UTC',latMicro:1,lngMicro:2,placeName:'Fittizio'};
  Object.defineProperty(app,'activeChart',{value:base});
  Object.assign(app,{apogeeOpen:true,apogeeEvents:[{instant:1000},{instant:2000}],apogeeSelected:null,
    apogeePreview:null,apogeePreviewTicket:0,activeChartId:7,destroyed:false,initialized:false,locale:'it',cd:{markForCheck(){}}});
  let release;const delayed=new Promise(resolve=>{release=resolve;});
  app.computeChart=async input=>input.utcIso===new Date(1000).toISOString() ? delayed : {id:9};
  const first=app.selectApogeeEvent(1000);
  await app.selectApogeeEvent(2000);
  release({id:8});await first;
  assert.equal(app.apogeeSelected,2000);assert.equal(app.apogeePreview.id,9);
});
