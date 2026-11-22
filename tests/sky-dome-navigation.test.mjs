import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const bundle=await build({stdin:{contents:["import '@angular/compiler';",
  "export {DesktopAppComponent} from './src/app/desktop-app.component';",
  "export {SkyDomeComponent} from './src/app/sky-dome.component';"].join('\n'),
  resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'});
const {DesktopAppComponent,SkyDomeComponent}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

test('opening 3D navigation keeps the selected location and steps the local clock',()=>{
  const app=Object.create(DesktopAppComponent.prototype);
  const chart={id:1,utcIso:'2026-05-12T12:00:00.000Z',timeZone:'Europe/Rome',latMicro:41000000,lngMicro:12000000,placeName:'Luogo fittizio'};
  Object.defineProperty(app,'activeChart',{value:chart});
  Object.assign(app,{view:'chart',mode:'natal',chartPresentation:'wheel',nav:null,skyLive:true,destroyed:false,busy:false,calcBusy:false,locale:'it',cd:{markForCheck(){}}});
  let changes=0;app.scheduleNavRecompute=()=>changes++;
  app.toggleSkyDome();
  assert.equal(app.chartPresentation,'sky3d');assert.equal(app.skyLive,false);
  assert.equal(app.nav.current.timeZone,'Europe/Rome');assert.equal(app.nav.current.placeName,'Luogo fittizio');
  assert.equal(app.adjustNav('hour',1),true);assert.equal(changes,1);
  assert.equal(app.nav.current.utcMs,Date.parse('2026-05-12T13:00:00Z'));
  chart.navigationInstant=app.nav.current.utcMs;
  assert.equal(app.skyDomeUtcIso,'2026-05-12T13:00:00.000Z');
  app.toggleSkyDome();assert.equal(app.chartPresentation,'wheel');
});

test('3D date label uses the reference city local time',()=>{
  const viewer=Object.create(SkyDomeComponent.prototype);
  Object.assign(viewer,{utcIso:'2026-07-01T12:00:00.000Z',timeZone:'Europe/Rome',locale:'it'});
  assert.match(viewer.dateLabel,/14:00/);
  assert.match(viewer.dateLabel,/Europe\/Rome/);
});

test('a historical chart can initialise navigation from its calculated instant',()=>{
  const app=Object.create(DesktopAppComponent.prototype), instant=Date.parse('1800-06-01T10:00:00Z');
  Object.defineProperty(app,'activeChart',{value:{id:2,utcIso:'',navigationInstant:instant,timeZone:'Europe/Rome',latMicro:1,lngMicro:2,placeName:'Luogo fittizio'}});
  Object.assign(app,{view:'chart',mode:'natal',chartPresentation:'wheel',nav:null,destroyed:false,busy:false,calcBusy:false,cd:{markForCheck(){}}});
  app.toggleSkyDome();
  assert.equal(app.nav.current.utcMs,instant);
  assert.equal(app.skyDomeUtcIso,'1800-06-01T10:00:00.000Z');
});
