import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  skyMarkerVisibility,canPickSkyMarker,
} from '../src/app/sky-dome-marker-layers.ts';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('all eight marker layer states keep independent planet/star/name visibility',()=>{
  for(const planets of [false,true]){
    for(const stars of [false,true]){
      for(const names of [false,true]){
        const state=skyMarkerVisibility(planets,stars,names);
        assert.deepEqual(state,{planets,stars,starLabels:stars&&names});
        assert.equal(canPickSkyMarker('planet',false,state),planets);
        assert.equal(canPickSkyMarker('star',false,state),stars);
        assert.equal(canPickSkyMarker('star',true,state),stars&&names);
      }
    }
  }
});

test('hiding star names never hides stars or changes existing planetary visibility',()=>{
  const initial=skyMarkerVisibility(true,true,true);
  const withoutNames=skyMarkerVisibility(true,true,false);
  assert.equal(initial.planets,withoutNames.planets);
  assert.equal(initial.stars,withoutNames.stars);
  assert.equal(withoutNames.starLabels,false);
  assert.equal(canPickSkyMarker('star',true,withoutNames),false);
  assert.equal(canPickSkyMarker('star',false,withoutNames),true);
  assert.equal(canPickSkyMarker('planet',false,withoutNames),true);
});

test('layer buttons preserve photos and GPU marker geometry instead of rebuilding all bodies',()=>{
  const component=read('src/app/sky-dome.component.ts');
  const start=component.indexOf('  toggleLayer(');
  const end=component.indexOf('  showAllSky():void',start);
  assert.ok(start>0&&end>start);
  const toggles=component.slice(start,end);
  assert.doesNotMatch(toggles,/this\.buildMarkers\(\)/);
  for(const layer of ['stars','starLabels','planets']){
    assert.match(toggles,new RegExp("case '"+layer+"':"));
  }
  assert.match(toggles,/this\.updateMarkerVisibility\(\)/);
  assert.match(component,/private updateMarkerVisibility\(\):void/);
  assert.match(component,/this\.planetMarkerGroup\.visible=visibility\.planets/);
  assert.match(component,/this\.starPointGroup\.visible=visibility\.stars/);
  assert.match(component,/this\.starLabelGroup\.visible=visibility\.starLabels/);
  assert.match(component,/group\.add\(planetGroup,starGroup,namesGroup\)/);
  assert.match(component,/this\.markerGroup=group/);
  assert.match(component,/this\.applyAtmosphericStarlight\(\);\s*this\.scene\.add\(group\)/);
});

test('actual catalogue star labels are selectable but not through hidden layers',()=>{
  const component=read('src/app/sky-dome.component.ts');
  const label=component.slice(component.indexOf('for(const star of labeledCatalogStars('));
  assert.match(label,/namePlate\.userData\['skyPoint'\]=\{point:star,kind:'star'\}/);
  assert.match(label,/namesGroup\.add\(namePlate\)/);
  assert.match(label,/this\.targets\.push\(namePlate\)/);
  assert.match(component,/canPickSkyMarker\(pickedKind,obj\.parent===this\.starLabelGroup,visibility\)/);
  assert.doesNotMatch(component,/syntheticStar|fakeStar|Math\.random\(/);
});

test('native sky updates still rebuild and dispose old marker groups exactly on data changes',()=>{
  const component=read('src/app/sky-dome.component.ts');
  const load=component.slice(component.indexOf('  private async load():Promise<void> {'),component.indexOf('  private disposeTree('));
  assert.match(load,/this\.buildMarkers\(\)/);
  const build=component.slice(component.indexOf('  private buildMarkers():void {'),component.indexOf('  toggleLayer('));
  assert.match(build,/this\.disposeTree\(this\.markerGroup\)/);
  assert.match(build,/for\(const texture of this\.markerTextures\)texture\.dispose\(\)/);
  assert.match(component,/this\.planetMarkerGroup=null;/);
  assert.match(component,/this\.starPointGroup=null;this\.starLabelGroup=null;/);
});
