import {CommonModule} from '@angular/common';
import {
  AfterViewInit, ChangeDetectorRef, Component, ElementRef, EventEmitter, Input, OnChanges, OnDestroy, Output,
  SimpleChanges, ViewChild, inject,
} from '@angular/core';
import * as THREE from 'three';
import {calculateSkyDome} from './native/sky-dome';
import type {SkyDomeData, SkyDomePoint, SkyDomeResult, SkyHouseGrid} from './native/sky-dome-contract';
import {validOverlay, type SkyOverlayPolyline} from './sky-dome-geometry';
import {SkyDomeLens} from './sky-dome-fisheye';
import {
  clampedSkyFov, normalizePitch, skyCameraFrame, skyFisheyeWorldRay,
  skyWorldVector, SKY_FISHEYE_START_DEG,
} from './sky-dome-projection';
import {celestialGlyphUrl, zodiacGlyphUrl} from './astrological-glyphs';
import {planetAccent, skyLightFromSun, starAppearance, labeledCatalogStars, type SkyLight} from './sky-dome-visuals';
import {createPlanetPortrait,planetPortraitSpec} from './sky-dome-planet-portraits';
import {REAL_PLANET_TEXTURES} from './sky-dome-real-textures';
import {findSkyStars} from './sky-dome-star-search';
import {skyFacingPlane} from './sky-dome-billboard';

const NAMES:Readonly<Record<string,readonly [string,string]>>={
  Sun:['Sole','Sun'],Moon:['Luna','Moon'],Mercury:['Mercurio','Mercury'],
  Venus:['Venere','Venus'],Mars:['Marte','Mars'],Jupiter:['Giove','Jupiter'],
  Saturn:['Saturno','Saturn'],Uranus:['Urano','Uranus'],Neptune:['Nettuno','Neptune'],
  Pluto:['Plutone','Pluto'],Chiron:['Chirone','Chiron'],
};
type LayerName='horizon'|'meridian'|'equator'|'grid';
type NativeStatus=SkyDomeResult['kind']|'loading'|'webgl_error';
type PointWithKind={point:SkyDomePoint;kind:'planet'|'star'};
const WORDS={
  it:{
    title:'Cielo 3D',hint:'Trascina per guardare il cielo · Rotellina per ingrandire',
    meridian:'Meridiano',grid:'Griglia',equator:'Equatore',zodiac:'Eclittica',zodiacGrid:'Griglia segni',signs:'Segni',angles:'Angoli',ground:'Terreno',stars:'Stelle',starLabels:'Nomi stelle',planets:'Pianeti',
    atmosphere:'Atmosfera',houseGrid:'Griglia delle case',houseSystem:'Domificazione',houseUnavailable:'Cuspidi non disponibili per questo metodo',
    houseNote:'Cuspidi proiettate sull’eclittica, non superfici spaziali delle case.',
    houseCusps:'Cuspidi delle case',houseFocus:'Punta la cuspide',
    appearance:'Aspetto del cielo',objectDetails:'Coordinate astronomiche',longitude:'Longitudine eclittica',latitude:'Latitudine eclittica',
    rightAscension:'Ascensione retta',declination:'Declinazione',distance:'Distanza geocentrica',
    longitudeSpeed:'Velocità in longitudine',constellation:'Costellazione',catalogId:'ID archivio',
    source:'Effemeridi',sign:'Segno',notAvailable:'Non disponibile',distanceUnit:' UA',speedUnit:' °/giorno',
    realTextureNote:'Mappe planetarie Solar System Scope (CC BY 4.0); orientamento e fasi illustrativi.',
    north:'Nord',east:'Est',south:'Sud',west:'Ovest',zenith:'Zenit',
    altitude:'Altezza',azimuth:'Azimut',approximate:'Posizione stellare approssimata',
    close:'Chiudi',loading:'Calcolo astronomico in corso…',
    not_native:'Il cielo 3D con dati astronomici è disponibile nell’app Desktop.',
    provider_unavailable:'Dati DE441 non disponibili. Configura le effemeridi nelle impostazioni.',
    out_of_range:'Questo istante non è supportato dal calcolo 3D. Il supporto storico arriverà dopo la convalida.',
    invalid_request:'Data o posizione geografica non valide per questa versione.',
    calculation_failed:'Non è stato possibile calcolare il cielo per questo istante.',
    unavailable:'Il calcolo del cielo 3D non è disponibile.',
    webgl_error:'WebGL non disponibile sulla scheda grafica o in questa finestra.',
    note:'Coordinate geometriche senza rifrazione · dimensioni degli astri non in scala.',
    eyebrow:'OSSERVATORIO CELESTE',
    layers:'Livelli del cielo',
    geometry:'Geometria',
    objects:'Corpi celesti',
    reset:'Reimposta',
    field:'Campo visivo',
    direction:'Orientamento',
    statusReady:'Posizioni astronomiche',
    starMagnitude:'Magnitudine',
    findStar:'Cerca una stella',
    findStarHint:'Scrivi almeno due lettere',
    noStarMatches:'Nessuna stella trovata nel catalogo locale',
    belowHorizon:'Sotto l’orizzonte: disattiva Terreno per vederla.',
    lensUnavailable:'Vista fisheye non supportata da questa GPU: prospettiva normale attiva.',
    skyHelp:'Trascina per ruotare anche oltre lo zenit; rotellina per passare alla vista sferica.',
    spherical:'Vista sferica',
    perspective:'Prospettiva',
    nadir:'Nadir',
    allSky:'Tutto il cielo',
    skyLightNote:'Corpi planetari illustrati: non fotografie, fasi o dimensioni fisiche.',
    backToChart:'Torna al grafico',
    noStars:'Catalogo locale delle stelle non disponibile.',
  },
  en:{
    title:'3D Sky',hint:'Drag to look around · Scroll to zoom',
    meridian:'Meridian',grid:'Grid',equator:'Celestial equator',zodiac:'Ecliptic',zodiacGrid:'Zodiac grid',signs:'Signs',angles:'Angles',ground:'Ground',stars:'Stars',starLabels:'Star names',planets:'Planets',
    atmosphere:'Atmosphere',houseGrid:'House cusp grid',houseSystem:'House system',houseUnavailable:'Cusps unavailable for this method',
    houseNote:'Ecliptic cusp projections, not spatial house boundary surfaces.',
    houseCusps:'House cusps',houseFocus:'Point to cusp',
    appearance:'Sky appearance',objectDetails:'Astronomical coordinates',longitude:'Ecliptic longitude',latitude:'Ecliptic latitude',
    rightAscension:'Right ascension',declination:'Declination',distance:'Geocentric distance',
    longitudeSpeed:'Longitude speed',constellation:'Constellation',catalogId:'Catalogue ID',
    source:'Ephemeris',sign:'Sign',notAvailable:'Unavailable',distanceUnit:' AU',speedUnit:' °/day',
    realTextureNote:'Planet maps by Solar System Scope (CC BY 4.0); illustrative orientation and phases.',
    north:'North',east:'East',south:'South',west:'West',zenith:'Zenith',
    altitude:'Altitude',azimuth:'Azimuth',approximate:'Approximate stellar position',
    close:'Close',loading:'Calculating astronomical positions…',
    not_native:'The 3D sky with astronomical data is available in the Desktop app.',
    provider_unavailable:'DE441 data are unavailable. Configure the ephemerides in Settings.',
    out_of_range:'This instant is not supported in 3D yet. Historical support requires separate validation.',
    invalid_request:'Invalid date or observer location for this version.',
    calculation_failed:'Could not calculate the sky for this instant.',
    unavailable:'The 3D sky calculation is unavailable.',
    webgl_error:'WebGL is unavailable on this device or in this window.',
    note:'Geometric coordinates without refraction · body markers not to angular scale.',
    eyebrow:'CELESTIAL OBSERVATORY',
    layers:'Sky layers',
    geometry:'Geometry',
    objects:'Celestial bodies',
    reset:'Reset view',
    field:'Field of view',
    direction:'Direction',
    statusReady:'Astronomical positions',
    starMagnitude:'Magnitude',
    findStar:'Find a star',
    findStarHint:'Type at least two letters',
    noStarMatches:'No matching star in the local catalogue',
    belowHorizon:'Below the horizon: turn off Ground to see it.',
    lensUnavailable:'Fisheye view unavailable on this GPU: normal perspective is active.',
    skyHelp:'Drag beyond the zenith; scroll out for a spherical all-sky view.',
    spherical:'Spherical view',
    perspective:'Perspective',
    nadir:'Nadir',
    allSky:'All-sky',
    skyLightNote:'Illustrated planetary portraits, not photos, physical phases or diameters.',
    backToChart:'Back to chart',
    noStars:'Local star catalogue unavailable.',
  },
} as const;

@Component({
  selector:'vs-sky-dome',
  standalone:true,
  imports:[CommonModule],
  templateUrl:'./sky-dome.component.html',
  styleUrls:['./sky-dome.component.css'],
})
export class SkyDomeComponent implements AfterViewInit,OnChanges,OnDestroy {
  @Input({required:true}) utcIso='';
  @Input({required:true}) latMicro=0;
  @Input({required:true}) lngMicro=0;
  @Input() locale:'it'|'en'='it';
  @Input() houseSystem='egizia';
  @Input() houseSystemName='';
  @Output() houseSystemSelected=new EventEmitter<string>();
  /** Future natal zodiac/house/primary direction curves: never synthesized in the renderer. */
  @Input() overlays:readonly SkyOverlayPolyline[]=[];
  @Output() closed=new EventEmitter<void>();
  @ViewChild('viewport',{static:true}) private viewport!:ElementRef<HTMLDivElement>;
  private readonly cd=inject(ChangeDetectorRef);
  private scene:THREE.Scene|null=null;
  private camera:THREE.PerspectiveCamera|null=null;
  private renderer:THREE.WebGLRenderer|null=null;
  private skyLens:SkyDomeLens|null=null;
  private observer:ResizeObserver|null=null;
  private frame=0;
  private generation=0;
  private destroyed=false;
  private webglFailed=false;
  fisheyeUnavailable=false;
  private markerGroup:THREE.Group|null=null;
  private markerGeneration=0;
  private markerTextures:THREE.Texture[]=[];
  private portraitTextures=new Map<string,THREE.CanvasTexture>();
  private sparkleTexture:THREE.CanvasTexture|null=null;
  private selectionTexture:THREE.CanvasTexture|null=null;
  private selectionRing:THREE.Mesh<THREE.PlaneGeometry,THREE.MeshBasicMaterial>|null=null;
  private overlayGroup:THREE.Group|null=null;
  private layerGroups:Partial<Record<LayerName,THREE.Group>>={};
  private ground:THREE.Mesh|null=null;
  private compassGroup:THREE.Group|null=null;
  private compassTextures:THREE.Texture[]=[];
  private zodiacGroup:THREE.Group|null=null;
  private zodiacTextures:THREE.Texture[]=[];
  private zodiacGeneration=0;
  private houseGroup:THREE.Group|null=null;
  private houseTextures:THREE.Texture[]=[];
  private angleGroup:THREE.Group|null=null;
  private angleTextures:THREE.Texture[]=[];
  private targets:THREE.Object3D[]=[];
  private pointer:{x:number;y:number;lastX:number;lastY:number;dragged:boolean}|null=null;
  private yaw=180;
  private pitch=24;
  private data:SkyDomeData|null=null;
  status:NativeStatus='loading';
  selected:PointWithKind|null=null;
  showAtmosphere=true;
  showHouses=true;
  selectedCuspIndex:number|null=null;
  showMeridian=true;
  showGrid=false;
  showEquator=false;
  showZodiac=true;
  showZodiacGrid=true;
  showSigns=true;
  showAngles=true;
  showGround=false;
  showStars=true;
  showStarLabels=true;
  showPlanets=true;
  starQuery='';

  word(key:keyof typeof WORDS.it):string { return WORDS[this.locale][key]; }
  bodyName(id:string):string {return NAMES[id]?.[this.locale==='it'?0:1]??id;}
  bodyGlyph(id:string):string {return celestialGlyphUrl(id);}
  formatted(v:number):string{return v.toFixed(2)+'°';}
  get warning():string|null {
    return this.status==='ready'?null:this.word(this.status==='loading'?'loading':this.status);
  }
  get approximateStars():boolean{return !!this.data?.stars.some(s=>s.approximate);}
  get starCount():number{return this.data?.stars.length??0;}
  get availableHouseGrids():readonly SkyHouseGrid[]{return this.data?.houseGrids??[];}
  get hasRealPlanetTextures():boolean{return Object.keys(REAL_PLANET_TEXTURES).length>0;}
  get planetTextureNote():string {
    return this.word(this.hasRealPlanetTextures?'realTextureNote':'skyLightNote');
  }
  get activeHouseGrid():SkyHouseGrid|null{
    return this.data?.houseGrids.find(grid=>grid.id===this.houseSystem)??null;
  }
  get cuspRows():readonly {index:number;house:number;longitude:number;azimuth:number;altitude:number}[] {
    const grid=this.activeHouseGrid;
    if(!grid)return [];
    return grid.cuspLongitudesDeg.map((longitude,index)=>({
      index,house:index+1,longitude,
      azimuth:grid.separators[index][4].azimuthNorthEastDeg,
      altitude:grid.separators[index][4].altitudeDeg,
    }));
  }
  cuspRoman(index:number):string {
    return ['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'][index]??'';
  }
  formatCusp(longitude:number):string {
    return (((longitude%30)+30)%30).toFixed(2)+'°';
  }
  cuspSign(longitude:number):string {
    return this.signNames()[Math.floor(((longitude%360)+360)%360/30)]??'';
  }
  cuspGlyph(longitude:number):string {
    return zodiacGlyphUrl(Math.floor(((longitude%360)+360)%360/30));
  }
  focusCusp(index:number):void {
    const row=this.cuspRows[index];
    if(!row||!this.showHouses)return;
    this.selectedCuspIndex=index;
    this.look(row.azimuth,row.altitude);
    this.buildHouseGrid();
    this.cd.markForCheck();
  }
  houseLabel(id:string):string {
    const italian:Readonly<Record<string,string>>={
      egizia:'Egizia',placido:'Placido',koch:'Koch','regio-montano':'Regiomontano',porfirio:'Porfirio',
    };
    const english:Readonly<Record<string,string>>={
      egizia:'Egyptian / Vehlow',placido:'Placidus',koch:'Koch','regio-montano':'Regiomontanus',porfirio:'Porphyry',
    };
    return (this.locale==='it'?italian:english)[id]??id;
  }
  selectHouseSystem(event:Event):void {
    const value=(event.target as HTMLSelectElement).value;
    if(this.data?.houseGrids.some(grid=>grid.id===value)){
      this.houseSystemSelected.emit(value);
    }
  }
  private signNames():readonly string[]{
    return this.locale==='it'
      ? ['Ariete','Toro','Gemelli','Cancro','Leone','Vergine','Bilancia','Scorpione','Sagittario','Capricorno','Acquario','Pesci']
      : ['Aries','Taurus','Gemini','Cancer','Leo','Virgo','Libra','Scorpio','Sagittarius','Capricorn','Aquarius','Pisces'];
  }
  get selectedSign():string|null {
    const longitude=this.selected?.point.eclipticLongitudeDeg;
    if(longitude===undefined||longitude===null)return null;
    const value=((longitude%360)+360)%360;
    return this.signNames()[Math.floor(value/30)]??null;
  }
  get selectedSignImage():string {
    const longitude=this.selected?.point.eclipticLongitudeDeg;
    return longitude===undefined||longitude===null?'':zodiacGlyphUrl(Math.floor(((longitude%360)+360)%360/30));
  }
  valueText(value:number|null|undefined,suffix='°',digits=3):string {
    return value===null||value===undefined?this.word('notAvailable'):value.toFixed(digits)+suffix;
  }
  close():void { this.closed.emit(); }
  clearSelection():void {
    this.selected=null;
    this.updateSelectionRing();
    this.cd.markForCheck();
  }
  get light():SkyLight {
    const sun=this.data?.planets.find(p=>p.id==='Sun');
    return skyLightFromSun(sun?.altitudeDeg??null);
  }
  get viewDirection():string {
    const frame=skyCameraFrame(this.yaw,this.pitch);
    return frame?frame.headingDeg.toFixed(0)+'° · '+frame.altitudeDeg.toFixed(0)+'°':'—';
  }
  get isSpherical():boolean {return !this.fisheyeUnavailable && (this.camera?.fov??75)>=SKY_FISHEYE_START_DEG;}
  get fieldOfView():number { return Math.round(this.camera?.fov??75); }
  get visiblePlanetCount():number{return this.data?.planets.length??0;}
  get planetDock():readonly SkyDomePoint[] { return this.data?.planets??[]; }
  get starMatches():readonly SkyDomePoint[] {
    return this.showStars && this.status==='ready'
      ? findSkyStars(this.data?.stars??[],this.starQuery,7):[];
  }
  onStarQuery(event:Event):void {
    const input=event.target as HTMLInputElement;
    this.starQuery=input.value.slice(0,60);
    this.cd.markForCheck();
  }
  clearStarQuery():void {this.starQuery='';this.cd.markForCheck();}
  onStarSearchKey(event:KeyboardEvent):void {
    if(event.key==='Escape'){this.clearStarQuery();event.preventDefault();}
  }
  focusStar(point:SkyDomePoint):void {
    // The result must be one of the host-supplied stars, never a local guess.
    if(!this.showStars || this.status!=='ready' || !this.data?.stars.includes(point))return;
    this.selected={point,kind:'star'};
    this.look(point.azimuthNorthEastDeg,point.altitudeDeg);
    this.updateSelectionRing();
    this.clearStarQuery();
    this.cd.markForCheck();
  }
  focusPlanet(id:string):void {
    const point=this.data?.planets.find(body=>body.id===id);
    if(!point || !this.showPlanets || this.status!=='ready')return;
    this.selected={point,kind:'planet'};
    this.look(point.azimuthNorthEastDeg,Math.max(-85,Math.min(85,point.altitudeDeg)));
    this.updateSelectionRing();
    this.cd.markForCheck();
  }
  glyphMissing(event:Event):void {
    const img=event.target as HTMLImageElement;
    img.hidden=true;
    const label=img.nextElementSibling as HTMLElement|null;
    if(label)label.hidden=false;
  }
  get dateLabel():string {
    const instant=new Date(this.utcIso);
    if(!Number.isFinite(instant.getTime()))return this.utcIso;
    try {
      return new Intl.DateTimeFormat(this.locale==='it'?'it-IT':'en-GB',{
        dateStyle:'medium',timeStyle:'short',timeZone:'UTC',
      }).format(instant)+' UTC';
    }catch{return this.utcIso;}
  }

  ngOnChanges(changes:SimpleChanges):void {
    if(changes['utcIso']||changes['latMicro']||changes['lngMicro']) void this.load();
    if(changes['latMicro']&&this.scene) this.buildEquator();
    if(changes['locale']&&this.scene) this.buildCardinalLabels();
    if(changes['overlays']&&this.scene)this.buildOverlays();
    if(changes['houseSystem']){
      this.selectedCuspIndex=null;
      if(this.scene)this.buildHouseGrid();
    }
  }
  ngAfterViewInit():void {
    try {
      this.scene=new THREE.Scene();
      this.scene.background=null;
      // Graphic volume lighting, NOT the actual physical phase angle.
      this.scene.add(new THREE.AmbientLight(0xffffff,1.75));
      const planetLight=new THREE.DirectionalLight(0xfff4df,2.0);
      planetLight.position.set(-45,65,-40);
      this.scene.add(planetLight);
      this.camera=new THREE.PerspectiveCamera(75,1,0.1,180);
      this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'low-power'});
      this.renderer.setClearColor(0x000000,0);
      this.renderer.setPixelRatio(Math.min(2,window.devicePixelRatio||1));
      // Constrain the cubemap size to the GPU's actual capability, with
      // perspective fallback on devices that cannot support a cube target.
      const gl=this.renderer.getContext();
      const maximum=Number(gl.getParameter(gl.MAX_CUBE_MAP_TEXTURE_SIZE));
      const side:256|512|1024|0=maximum>=1024?1024:maximum>=512?512:maximum>=256?256:0;
      if(side){
        try{this.skyLens=new SkyDomeLens(side);}
        catch{this.fisheyeUnavailable=true;}
      }else{
        this.fisheyeUnavailable=true;
      }
      this.renderer.domElement.setAttribute('aria-hidden','true');
      this.viewport.nativeElement.appendChild(this.renderer.domElement);
      this.renderer.domElement.addEventListener('pointerdown',this.pointerDown);
      this.renderer.domElement.addEventListener('pointermove',this.pointerMove);
      this.renderer.domElement.addEventListener('pointerup',this.pointerUp);
      this.renderer.domElement.addEventListener('pointercancel',this.pointerCancel);
      this.renderer.domElement.addEventListener('wheel',this.wheel,{passive:false});
      this.renderer.domElement.addEventListener('webglcontextlost',this.contextLost);
      this.buildScaffold();
      this.buildCardinalLabels();
      this.buildEquator();
      this.buildZodiac();
      this.buildHouseGrid();
      this.buildAngles();
      this.buildOverlays();
      this.buildMarkers();
      this.look(180,24);
      this.observer=new ResizeObserver(()=>this.resize());
      this.observer.observe(this.viewport.nativeElement);
      this.resize();
    }catch {
      this.webglFailed=true;
      this.status='webgl_error';
      this.cd.markForCheck();
    }
  }
  ngOnDestroy():void {
    this.destroyed=true;
    ++this.generation;
    if(this.frame)cancelAnimationFrame(this.frame);
    this.observer?.disconnect();
    const canvas=this.renderer?.domElement;
    if(canvas){
      canvas.removeEventListener('pointerdown',this.pointerDown);
      canvas.removeEventListener('pointermove',this.pointerMove);
      canvas.removeEventListener('pointerup',this.pointerUp);
      canvas.removeEventListener('pointercancel',this.pointerCancel);
      canvas.removeEventListener('wheel',this.wheel);
      canvas.removeEventListener('webglcontextlost',this.contextLost);
      canvas.remove();
    }
    ++this.zodiacGeneration;
    ++this.markerGeneration;
    if(this.scene)this.disposeTree(this.scene);
    for(const texture of this.markerTextures)texture.dispose();
    this.markerTextures=[];
    for(const texture of this.portraitTextures.values())texture.dispose();
    this.portraitTextures.clear();
    this.sparkleTexture?.dispose();
    this.sparkleTexture=null;
    this.selectionTexture?.dispose();
    this.selectionTexture=null;
    for(const texture of this.houseTextures)texture.dispose();
    this.houseTextures=[];
    for(const texture of this.angleTextures)texture.dispose();
    this.angleTextures=[];
    for(const texture of this.zodiacTextures)texture.dispose();
    this.zodiacTextures=[];
    for(const texture of this.compassTextures)texture.dispose();
    this.compassTextures=[];
    this.skyLens?.dispose();
    this.skyLens=null;
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
    this.renderer=null;this.scene=null;this.camera=null;this.targets=[];
  }
  private async load():Promise<void> {
    const ticket=++this.generation;
    if(!this.webglFailed)this.status='loading';
    this.selected=null;this.data=null;this.clearStarQuery();
    this.buildMarkers();
    this.buildZodiac();
    this.buildHouseGrid();
    this.buildAngles();
    this.cd.markForCheck();
    const result=await calculateSkyDome({utcIso:this.utcIso,latMicro:this.latMicro,lngMicro:this.lngMicro});
    if(this.destroyed||ticket!==this.generation)return;
    this.status=this.webglFailed?'webgl_error':result.kind;
    this.data=result.kind==='ready'?result.data:null;
    this.buildMarkers();
    this.buildZodiac();
    this.buildHouseGrid();
    this.buildAngles();
    this.cd.markForCheck();
  }
  private disposeTree(node:THREE.Object3D):void {
    node.traverse(obj=>{
      const candidate=obj as THREE.Mesh;
      candidate.geometry?.dispose();
      if(candidate.material) {
        for(const m of (Array.isArray(candidate.material)?candidate.material:[candidate.material]))m.dispose();
      }
    });
  }
  private line(points:THREE.Vector3[],color:number,opacity=1):THREE.Line {
    const material=new THREE.LineBasicMaterial({color,transparent:opacity<1,opacity,depthWrite:false});
    return new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),material);
  }
  private curve(points:THREE.Vector3[],color:number,opacity=1,group?:THREE.Group):void {
    (group??this.scene)?.add(this.line(points,color,opacity));
  }
  private vec(az:number,alt:number,r=100):THREE.Vector3 {
    const p=skyWorldVector(az,alt,r);
    return new THREE.Vector3(p?.x??0,p?.y??0,p?.z??0);
  }
  private buildScaffold():void {
    if(!this.scene)return;
    const horizon=new THREE.Group();
    this.curve(Array.from({length:361},(_,a)=>this.vec(a,0,98)),0x64ccbb,0.93,horizon);
    this.scene.add(horizon);this.layerGroups.horizon=horizon;

    const meridian=new THREE.Group();
    // Full 360° meridian: N -> zenith -> S above the horizon.
    this.curve(Array.from({length:181},(_,a)=>this.vec(a<=90?0:180,a<=90?a:180-a,99)),0xf1bd7c,0.9,meridian);
    // S -> nadir -> N below the horizon (subdued and dashed).
    const underground=new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(Array.from({length:181},(_,a)=>
        this.vec(a<=90?180:0,a<=90?-a:a-180,99))),
      new THREE.LineDashedMaterial({
        color:0xf1bd7c,dashSize:2,gapSize:1.6,transparent:true,opacity:0.46,depthWrite:false,
      }),
    );
    underground.computeLineDistances();
    meridian.add(underground);
    this.scene.add(meridian);this.layerGroups.meridian=meridian;

    const grid=new THREE.Group();
    for(const alt of [-60,-30,30,60])this.curve(
      Array.from({length:121},(_,i)=>this.vec(i*3,alt,99)),0x7589aa,0.19,grid);
    for(let az=0;az<360;az+=30)this.curve(
      Array.from({length:61},(_,i)=>this.vec(az,-90+i*3,99)),0x7589aa,0.17,grid);
    grid.visible=this.showGrid;this.scene.add(grid);this.layerGroups.grid=grid;

    const geometry=new THREE.SphereGeometry(96,64,32,0,Math.PI*2,Math.PI/2,Math.PI/2);
    const material=new THREE.MeshBasicMaterial({color:0x172536,side:THREE.BackSide});
    this.ground=new THREE.Mesh(geometry,material);
    this.ground.visible=this.showGround;
    this.scene.add(this.ground);
  }
  /** Real in-sky cardinal labels; not just camera-direction shortcuts. */
  private buildCardinalLabels():void {
    if(!this.scene)return;
    if(this.compassGroup){this.scene.remove(this.compassGroup);this.disposeTree(this.compassGroup);}
    for(const texture of this.compassTextures)texture.dispose();
    this.compassTextures=[];
    const group=new THREE.Group();
    const labels:readonly (readonly [string,number])[]=[
      ['N',0],['E',90],['S',180],[this.locale==='it'?'O':'W',270],
    ];
    for(const [letter,az] of labels){
      const canvas=document.createElement('canvas');
      canvas.width=128;canvas.height=128;
      const ctx=canvas.getContext('2d');
      if(!ctx)continue;
      ctx.fillStyle='rgba(6,17,31,.75)';
      ctx.beginPath();ctx.arc(64,64,36,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#e4f1f9';ctx.font='700 62px sans-serif';
      ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(letter,64,68);
      const texture=new THREE.CanvasTexture(canvas);
      this.compassTextures.push(texture);
      const label=skyFacingPlane(texture,this.vec(az,4,96),11,11);
      group.add(label);
    }
    this.scene.add(group);
    this.compassGroup=group;
    this.draw();
  }
  private buildEquator():void {
    if(!this.scene)return;
    if(this.layerGroups.equator) {
      this.scene.remove(this.layerGroups.equator);this.disposeTree(this.layerGroups.equator);
    }
    const group=new THREE.Group();
    const latitude=this.latMicro/1e6*Math.PI/180;
    if(Number.isFinite(latitude)&&Math.abs(latitude)<=Math.PI/2){
      const points=Array.from({length:361},(_,i)=>{
        const t=i*Math.PI/180;
        return new THREE.Vector3(
          99*Math.cos(t),99*Math.sin(t)*Math.cos(latitude),
          99*Math.sin(t)*Math.sin(latitude));
      });
      this.curve(points,0x9a92e8,0.9,group);
    }
    group.visible=this.showEquator;
    this.scene.add(group);this.layerGroups.equator=group;this.draw();
  }
  /**
   * Render the true tropical ecliptic in 12 native-calculated thirty-degree
   * arcs. Sign glyphs come exclusively from the approved asset pack; no
   * astronomical or zodiac angles are synthesized in the WebView.
   */
  private buildZodiac():void {
    const generation=++this.zodiacGeneration;
    if(!this.scene)return;
    if(this.zodiacGroup){
      this.scene.remove(this.zodiacGroup);
      this.disposeTree(this.zodiacGroup);
    }
    for(const tex of this.zodiacTextures)tex.dispose();
    this.zodiacTextures=[];
    const group=new THREE.Group();
    this.scene.add(group);
    this.zodiacGroup=group;
    if(!this.data || (!this.showZodiac && !this.showZodiacGrid && !this.showSigns)){this.draw();return;}
    if(this.showZodiacGrid) {
      const grid=this.data.zodiacGrid;
      const drawGridLine=(line:readonly {azimuthNorthEastDeg:number;altitudeDeg:number}[],color:number,opacity:number):void=>{
        this.curve(line.map(p=>this.vec(p.azimuthNorthEastDeg,p.altitudeDeg,99.4)),color,opacity,group);
      };
      drawGridLine(grid.northEdge,0xdeb777,0.27);
      drawGridLine(grid.southEdge,0xdeb777,0.27);
      for(const line of grid.signDividers)drawGridLine(line,0xeed2a3,0.39);
      for(const line of grid.decadeTicks)drawGridLine(line,0xe2b977,0.16);
    }
    const loader=new THREE.TextureLoader();
    for(const sign of this.data.zodiacSegments){
      const color=sign.signIndex%2===0?0xe1bb75:0xc99f6a;
      if(this.showZodiac){
        this.curve(sign.points.map(point=>this.vec(
          point.azimuthNorthEastDeg,point.altitudeDeg,99.5
        )),color,0.82,group);
        // A small mark at every genuine 30-degree sign boundary.
        const boundary=sign.points[0];
        const tick=new THREE.Mesh(new THREE.SphereGeometry(0.42,8,6),
          new THREE.MeshBasicMaterial({color:0xf5d89d}));
        tick.position.copy(this.vec(boundary.azimuthNorthEastDeg,boundary.altitudeDeg,99.5));
        group.add(tick);
      }
      if(this.showSigns){
        const url=zodiacGlyphUrl(sign.signIndex);
        if(!url)continue;
        // Keep an unlabelled sky if an asset is missing: never substitute an emoji.
        const texture=loader.load(url,()=>{
          if(this.destroyed || generation!==this.zodiacGeneration)return;
          const label=skyFacingPlane(texture,this.vec(
            sign.label.azimuthNorthEastDeg,sign.label.altitudeDeg,98.5
          ),8,8);
          group.add(label);
          this.draw();
        });
        this.zodiacTextures.push(texture);
      }
    }
    this.draw();
  }
  /**
   * Cusp intersections for the CURRENT, natively computed house system.
   * These small lines cross only the +/-8° ecliptic reference band; they are
   * NOT the true spatial/mundane house surfaces.
   */
  private buildHouseGrid():void {
    if(!this.scene)return;
    if(this.houseGroup){
      this.scene.remove(this.houseGroup);
      this.disposeTree(this.houseGroup);
    }
    for(const texture of this.houseTextures)texture.dispose();
    this.houseTextures=[];
    const group=new THREE.Group();
    this.scene.add(group);
    this.houseGroup=group;
    const grid=this.activeHouseGrid;
    if(!this.showHouses || !grid){this.draw();return;}
    const romans=['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'];
    for(let index=0;index<12;index++){
      const line=grid.separators[index];
      const vectors=line.map(point=>this.vec(point.azimuthNorthEastDeg,point.altitudeDeg,99.16));
      const focused=this.selectedCuspIndex===index;
      this.curve(vectors,focused?0xf1e5b8:(index===0||index===9?0xa8e9ce:0x75bca7),
        focused?1:(index===0||index===9?0.83:0.58),group);
      const label=grid.labels[index];
      const canvas=document.createElement('canvas');
      canvas.width=128;canvas.height=64;
      const ctx=canvas.getContext('2d');
      if(!ctx)continue;
      ctx.fillStyle='rgba(12,38,37,.75)';
      ctx.beginPath();ctx.roundRect(1,5,126,54,15);ctx.fill();
      ctx.strokeStyle='rgba(125,215,180,.55)';
      ctx.lineWidth=2;ctx.stroke();
      ctx.font='600 27px sans-serif';
      ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.fillStyle='#c4ebdd';
      ctx.fillText(romans[index],64,33);
      const texture=new THREE.CanvasTexture(canvas);
      this.houseTextures.push(texture);
      group.add(skyFacingPlane(texture,
        this.vec(label.azimuthNorthEastDeg,label.altitudeDeg,98.7),5.5,2.8));
    }
    this.draw();
  }
  /** Chart angles are projected at their actual ecliptic/horizon intersections. */
  private buildAngles():void {
    if(!this.scene)return;
    if(this.angleGroup){
      this.scene.remove(this.angleGroup);
      this.disposeTree(this.angleGroup);
    }
    for(const texture of this.angleTextures)texture.dispose();
    this.angleTextures=[];
    const group=new THREE.Group();
    this.scene.add(group);this.angleGroup=group;
    if(!this.showAngles || !this.data){this.draw();return;}
    const colors:Record<'ASC'|'DSC'|'MC'|'IC',string>={
      ASC:'#f6ca58',DSC:'#79dca2',MC:'#ba94eb',IC:'#dfc5ff',
    };
    for(const angle of this.data.angles){
      const color=colors[angle.id];
      const pos=angle.position;
      const canvas=document.createElement('canvas');
      canvas.width=256;canvas.height=128;
      const ctx=canvas.getContext('2d');
      if(!ctx)continue;
      ctx.fillStyle='rgba(11,19,32,0.88)';
      ctx.fillRect(22,10,212,72);
      ctx.strokeStyle=color;ctx.lineWidth=4;
      ctx.strokeRect(22,10,212,72);
      ctx.font='700 45px sans-serif';
      ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.fillStyle=color;ctx.fillText(angle.id,128,47);
      ctx.beginPath();ctx.moveTo(116,84);ctx.lineTo(140,84);ctx.lineTo(128,107);
      ctx.closePath();ctx.fill();
      const texture=new THREE.CanvasTexture(canvas);
      this.angleTextures.push(texture);
      group.add(skyFacingPlane(texture,
        this.vec(pos.azimuthNorthEastDeg,pos.altitudeDeg,99),11,5.5));
    }
    this.draw();
  }
  private buildOverlays():void {
    if(!this.scene)return;
    if(this.overlayGroup){this.scene.remove(this.overlayGroup);this.disposeTree(this.overlayGroup);}
    const group=new THREE.Group();
    const colors={zodiac:0xc5a0ff,houses:0x87d9ae,'primary-directions':0xffa1a1};
    for(const overlay of this.overlays.slice(0,32)){
      if(!validOverlay(overlay))continue;
      const points=overlay.points.map(p=>this.vec(p.azimuthNorthEastDeg,p.altitudeDeg,97));
      this.curve(points,colors[overlay.kind],0.8,group);
    }
    this.scene.add(group);this.overlayGroup=group;this.draw();
  }
  /**
   * A small original radial sprite, shared by every *real catalogue point*.
   * This is a rendering effect; it does not imply any spectral class.
   */
  private radialTexture():THREE.CanvasTexture|null {
    if(this.sparkleTexture)return this.sparkleTexture;
    const canvas=document.createElement('canvas');
    canvas.width=128;canvas.height=128;
    const ctx=canvas.getContext('2d');
    if(!ctx)return null;
    const gradient=ctx.createRadialGradient(64,64,1,64,64,63);
    gradient.addColorStop(0,'rgba(255,255,255,1)');
    gradient.addColorStop(0.12,'rgba(255,255,255,.95)');
    gradient.addColorStop(0.30,'rgba(255,255,255,.4)');
    gradient.addColorStop(0.65,'rgba(255,255,255,.1)');
    gradient.addColorStop(1,'rgba(255,255,255,0)');
    ctx.fillStyle=gradient;
    ctx.fillRect(0,0,128,128);
    this.sparkleTexture=new THREE.CanvasTexture(canvas);
    return this.sparkleTexture;
  }
  private selectionOutline():THREE.CanvasTexture|null {
    if(this.selectionTexture)return this.selectionTexture;
    const canvas=document.createElement('canvas');
    canvas.width=128;canvas.height=128;
    const ctx=canvas.getContext('2d');
    if(!ctx)return null;
    ctx.strokeStyle='#faf1ce';
    ctx.lineWidth=3;
    ctx.beginPath();ctx.arc(64,64,48,0,Math.PI*2);ctx.stroke();
    ctx.strokeStyle='rgba(255,243,211,.24)';
    ctx.lineWidth=12;ctx.beginPath();ctx.arc(64,64,48,0,Math.PI*2);ctx.stroke();
    this.selectionTexture=new THREE.CanvasTexture(canvas);
    return this.selectionTexture;
  }
  private updateSelectionRing():void {
    if(!this.markerGroup)return;
    if(this.selectionRing){
      this.markerGroup.remove(this.selectionRing);
      this.selectionRing.geometry.dispose();
      this.selectionRing.material.dispose();
      this.selectionRing=null;
    }
    if(!this.selected){this.draw();return;}
    const texture=this.selectionOutline();
    if(!texture)return;
    const {point}=this.selected;
    const radius=this.selected.kind==='star'?7:(planetPortraitSpec(point.id)?.diameter??9)+3;
    const ring=skyFacingPlane(texture,
      this.vec(point.azimuthNorthEastDeg,point.altitudeDeg,98.5),radius,radius);
    this.markerGroup.add(ring);
    this.selectionRing=ring;
    this.draw();
  }
  private portraitTexture(id:string):THREE.CanvasTexture|null {
    const existing=this.portraitTextures.get(id);
    if(existing)return existing;
    const texture=createPlanetPortrait(id);
    if(texture)this.portraitTextures.set(id,texture);
    return texture;
  }
  private starNameTexture(name:string):THREE.CanvasTexture|null {
    const canvas=document.createElement('canvas');
    canvas.width=512;canvas.height=96;
    const ctx=canvas.getContext('2d');
    if(!ctx)return null;
    const label=name.length>28?name.slice(0,27)+'…':name;
    ctx.font='600 31px sans-serif';
    ctx.textBaseline='middle';ctx.textAlign='left';
    const width=Math.min(480,ctx.measureText(label).width+25);
    ctx.fillStyle='rgba(8,18,34,.55)';
    ctx.beginPath();ctx.roundRect(8,13,width,68,14);ctx.fill();
    ctx.fillStyle='#e3e9fc';
    ctx.shadowColor='rgba(70,105,180,.55)';ctx.shadowBlur=9;
    ctx.fillText(label,20,48,455);
    const texture=new THREE.CanvasTexture(canvas);
    texture.colorSpace=THREE.SRGBColorSpace;
    return texture;
  }
  private buildMarkers():void {
    if(!this.scene)return;
    const generation=++this.markerGeneration;
    if(this.markerGroup){
      this.scene.remove(this.markerGroup);
      this.disposeTree(this.markerGroup);
    }
    for(const texture of this.markerTextures)texture.dispose();
    this.markerTextures=[];
    this.selectionRing=null;
    const group=new THREE.Group();
    this.targets=[];
    const data=this.data;
    if(data){
      if(this.showPlanets){
        const loader=new THREE.TextureLoader();
        for(const point of data.planets){
          const spec=planetPortraitSpec(point.id);
          if(!spec)continue;
          const position=this.vec(point.azimuthNorthEastDeg,point.altitudeDeg,100);
          const accent=planetAccent(point.id);
          // Soft glow: not a physical angular diameter or planetary magnitude.
          const glow=this.radialTexture();
          if(glow){
            const halo=skyFacingPlane(
              glow,position.clone().multiplyScalar(1.002),
              spec.diameter*1.8,spec.diameter*1.8,
              {color:accent,blending:THREE.AdditiveBlending,opacity:0.72,renderOrder:0},
            );
            group.add(halo);
          }

          const portrait=this.portraitTexture(point.id);
          let fallbackPlane:THREE.Object3D|null=null;
          if(portrait){
            const disc=skyFacingPlane(portrait,position.clone().multiplyScalar(0.998),
              spec.diameter,spec.diameter,{renderOrder:1});
            disc.userData['skyPoint']={point,kind:'planet'} as PointWithKind;
            group.add(disc);this.targets.push(disc);
            fallbackPlane=disc;
          }else{
            const fallback=new THREE.Mesh(
              new THREE.SphereGeometry(0.9,12,10),
              new THREE.MeshBasicMaterial({color:accent}),
            );
            fallback.position.copy(position);
            fallback.userData['skyPoint']={point,kind:'planet'} as PointWithKind;
            group.add(fallback);this.targets.push(fallback);
            fallbackPlane=fallback;
          }
          const realMap=REAL_PLANET_TEXTURES[point.id];
          if(realMap?.startsWith('data:image/jpeg;base64,')){
            const globeMaterial=point.id==='Sun'
              ? new THREE.MeshBasicMaterial({color:0xffffff})
              : new THREE.MeshStandardMaterial({color:0xffffff,roughness:1,metalness:0});
            const globe=new THREE.Mesh(
              new THREE.SphereGeometry(spec.diameter*0.5,36,24),globeMaterial,
            );
            globe.position.copy(position.clone().multiplyScalar(0.998));
            globe.quaternion.setFromUnitVectors(
              new THREE.Vector3(0,0,1),
              globe.position.clone().normalize().negate(),
            );
            globe.visible=false;
            globe.renderOrder=1;
            globe.userData['skyPoint']={point,kind:'planet'} as PointWithKind;
            group.add(globe);
            let saturnRing:THREE.Mesh|null=null;
            if(point.id==='Saturn'){
              const geometry=new THREE.RingGeometry(spec.diameter*.52,spec.diameter*.95,72);
              const material=new THREE.MeshBasicMaterial({
                color:0xd3bd92,side:THREE.DoubleSide,
                transparent:true,opacity:0.72,depthWrite:false,
              });
              const ring=new THREE.Mesh(geometry,material);
              ring.position.copy(globe.position);
              ring.quaternion.copy(globe.quaternion);
              ring.rotateX(.38);
              ring.visible=false;
              group.add(ring);
              saturnRing=ring;
            }
            const realTexture=loader.load(realMap,()=>{
              if(this.destroyed||generation!==this.markerGeneration)return;
              realTexture.colorSpace=THREE.SRGBColorSpace;
              globeMaterial.map=realTexture;
              globeMaterial.needsUpdate=true;
              globe.visible=true;
              if(saturnRing)saturnRing.visible=true;
              if(fallbackPlane){
                fallbackPlane.visible=false;
                this.targets=this.targets.filter(target=>target!==fallbackPlane);
              }
              this.targets.push(globe);
              this.draw();
            },undefined,()=>{/* The illustrated portrait remains as a fallback. */});
            this.markerTextures.push(realTexture);
          }

          // The official glyph is deliberately a small badge, not the body.
          const texture=loader.load(celestialGlyphUrl(point.id),()=>{
            if(this.destroyed||generation!==this.markerGeneration)return;
            const glyph=skyFacingPlane(texture,position.clone().multiplyScalar(0.915),
              spec.labelDiameter,spec.labelDiameter,
              {anchorX:0.10,anchorY:0.10,renderOrder:2});
            glyph.userData['skyPoint']={point,kind:'planet'} as PointWithKind;
            group.add(glyph);
            this.targets.push(glyph);
            this.draw();
          },undefined,()=>{ /* Portrait remains present without glyph artwork. */ });
          this.markerTextures.push(texture);
        }
      }
      if(this.showStars){
        for(let bin=0;bin<4;bin++){
          const stars=data.stars.filter(star=>starAppearance(star.magnitude).bin===bin);
          if(!stars.length)continue;
          const coords=new Float32Array(stars.length*3);
          stars.forEach((star,i)=>{
            const point=this.vec(star.azimuthNorthEastDeg,star.altitudeDeg,100);
            coords[i*3]=point.x;coords[i*3+1]=point.y;coords[i*3+2]=point.z;
          });
          const geometry=new THREE.BufferGeometry();
          geometry.setAttribute('position',new THREE.BufferAttribute(coords,3));
          const appearance=starAppearance(stars[0].magnitude);
          const dots=new THREE.Points(geometry,new THREE.PointsMaterial({
            map:this.radialTexture(),
            size:appearance.sizePx,sizeAttenuation:false,
            color:0xf1f4ff,transparent:true,opacity:appearance.opacity,
            depthTest:true,depthWrite:false,blending:THREE.AdditiveBlending,
          }));
          dots.userData['skyStars']=stars;
          group.add(dots);
          this.targets.push(dots);
        }
        if(this.showStarLabels){
          for(const star of labeledCatalogStars(data.stars)){
            const texture=this.starNameTexture(star.id);
            if(!texture)continue;
            this.markerTextures.push(texture);
            group.add(skyFacingPlane(texture,
              this.vec(star.azimuthNorthEastDeg,star.altitudeDeg,99.2),
              13,2.45,{anchorX:0.03,anchorY:0.5,opacity:0.89}));
          }
        }
      }
    }
    this.markerGroup=group;
    this.scene.add(group);
    this.updateSelectionRing();
    this.draw();
  }
  toggleLayer(name:'meridian'|'grid'|'equator'|'zodiac'|'zodiacGrid'|'houses'|'atmosphere'|'signs'|'angles'|'ground'|'stars'|'planets'|'starLabels'):void {
    switch(name){
      case 'meridian':this.showMeridian=!this.showMeridian;break;
      case 'grid':this.showGrid=!this.showGrid;break;
      case 'equator':this.showEquator=!this.showEquator;break;
      case 'zodiac':this.showZodiac=!this.showZodiac;this.buildZodiac();break;
      case 'zodiacGrid':this.showZodiacGrid=!this.showZodiacGrid;this.buildZodiac();break;
      case 'houses':this.showHouses=!this.showHouses;this.buildHouseGrid();break;
      case 'atmosphere':this.showAtmosphere=!this.showAtmosphere;break;
      case 'signs':this.showSigns=!this.showSigns;this.buildZodiac();break;
      case 'angles':this.showAngles=!this.showAngles;this.buildAngles();break;
      case 'ground':this.showGround=!this.showGround;break;
      case 'stars':this.showStars=!this.showStars;if(!this.showStars && this.selected?.kind==='star')this.selected=null;this.buildMarkers();break;
      case 'starLabels':this.showStarLabels=!this.showStarLabels;this.buildMarkers();break;
      case 'planets':this.showPlanets=!this.showPlanets;if(!this.showPlanets && this.selected?.kind==='planet')this.selected=null;this.buildMarkers();break;
    }
    if(this.layerGroups.meridian)this.layerGroups.meridian.visible=this.showMeridian;
    if(this.layerGroups.grid)this.layerGroups.grid.visible=this.showGrid;
    if(this.layerGroups.equator)this.layerGroups.equator.visible=this.showEquator;
    if(this.ground)this.ground.visible=this.showGround;
    this.draw();
  }
  showAllSky():void {
    if(!this.camera)return;
    // A hemisphere fits into a central disc; the extra 20° exposes the
    // opposite side for the ground/sky transitions seen in Stellarium.
    this.camera.fov=this.fisheyeUnavailable?84:200;
    this.camera.updateProjectionMatrix();
    this.look(this.yaw,90);
    this.cd.markForCheck();
  }
  resetView():void {
    if(this.camera){this.camera.fov=75;this.camera.updateProjectionMatrix();}
    this.look(180,24);
    this.cd.markForCheck();
  }
  onKeyDown(event:KeyboardEvent):void {
    if(event.ctrlKey||event.metaKey||event.altKey)return;
    const step=event.shiftKey?15:5;
    let handled=true;
    switch(event.key){
      case 'ArrowLeft':this.look((this.yaw-step+360)%360,this.pitch);break;
      case 'ArrowRight':this.look((this.yaw+step)%360,this.pitch);break;
      case 'ArrowUp':this.look(this.yaw,this.pitch+step);break;
      case 'ArrowDown':this.look(this.yaw,this.pitch-step);break;
      case '+':case '=':this.adjustField(-5);break;
      case '-':case '_':this.adjustField(5);break;
      case 'Home':this.resetView();break;
      default:handled=false;
    }
    if(handled){event.preventDefault();this.cd.markForCheck();}
  }
  zoomSky(change:number):void {
    this.adjustField(change);
    this.cd.markForCheck();
  }
  private adjustField(change:number):void {
    if(!this.camera)return;
    this.camera.fov=Math.min(this.fisheyeUnavailable?84:220,clampedSkyFov(this.camera.fov+change));
    this.camera.updateProjectionMatrix();
    // The objects have not moved: only their display projection changes.
    this.draw(false);
  }
  look(az:number,alt:number):void {
    const frame=skyCameraFrame(az,alt);
    if(!frame)return;
    this.yaw=((az%360)+360)%360;
    this.pitch=normalizePitch(alt);
    if(this.camera){
      // Stable through both poles. Three.js camera local -Z = forward.
      const rotation=new THREE.Matrix4().makeBasis(
        new THREE.Vector3(frame.right.x,frame.right.y,frame.right.z),
        new THREE.Vector3(frame.up.x,frame.up.y,frame.up.z),
        new THREE.Vector3(frame.back.x,frame.back.y,frame.back.z),
      );
      this.camera.quaternion.setFromRotationMatrix(rotation);
      this.camera.updateMatrixWorld();
    }
    this.draw(false);
  }
  private resize():void {
    if(!this.camera||!this.renderer)return;
    const w=Math.max(1,this.viewport.nativeElement.clientWidth);
    const h=Math.max(1,this.viewport.nativeElement.clientHeight);
    this.camera.aspect=w/h;this.camera.updateProjectionMatrix();
    this.renderer.setSize(w,h,false);this.draw(false);
  }
  private draw(sceneChanged=true):void {
    if(sceneChanged)this.skyLens?.invalidate();
    if(!this.renderer||!this.scene||!this.camera||this.frame)return;
    this.frame=requestAnimationFrame(()=>{
      this.frame=0;
      if(this.renderer&&this.scene&&this.camera&&!this.webglFailed){
        try{
          if(this.skyLens)this.skyLens.render(this.renderer,this.scene,this.camera);
          else this.renderer.render(this.scene,this.camera);
        }catch{
          if(this.skyLens){
            // A failed cube target or shader must not erase the ordinary sky.
            try{this.skyLens.dispose();}catch{/* GPU already lost */}
            this.skyLens=null;
            this.fisheyeUnavailable=true;
            this.camera.fov=Math.min(this.camera.fov,84);
            this.camera.updateProjectionMatrix();
            try{this.renderer.render(this.scene,this.camera);}
            catch{this.webglFailed=true;this.status='webgl_error';}
          }else{
            this.webglFailed=true;this.status='webgl_error';
          }
          this.cd.markForCheck();
        }
      }
    });
  }
  private pointerDown=(event:PointerEvent):void=>{
    if(event.button!==0)return;
    this.pointer={x:event.clientX,y:event.clientY,lastX:event.clientX,lastY:event.clientY,dragged:false};
    this.renderer?.domElement.setPointerCapture(event.pointerId);
  };
  private pointerMove=(event:PointerEvent):void=>{
    if(!this.pointer)return;
    const dx=event.clientX-this.pointer.lastX,dy=event.clientY-this.pointer.lastY;
    if(Math.abs(event.clientX-this.pointer.x)+Math.abs(event.clientY-this.pointer.y)>5)this.pointer.dragged=true;
    this.pointer.lastX=event.clientX;this.pointer.lastY=event.clientY;
    this.look(this.yaw-dx*0.27,this.pitch+dy*0.27);
    this.cd.markForCheck();
  };
  private pointerUp=(event:PointerEvent):void=>{
    const drag=this.pointer?.dragged??true;
    this.pointer=null;
    if(this.renderer?.domElement.hasPointerCapture(event.pointerId))this.renderer.domElement.releasePointerCapture(event.pointerId);
    if(!drag)this.pick(event);
  };
  private pointerCancel=():void=>{this.pointer=null;};
  private wheel=(event:WheelEvent):void=>{
    event.preventDefault();
    if(!this.camera)return;
    const step=(this.camera.fov>=110?8:5)*Math.sign(event.deltaY);
    if(step!==0)this.adjustField(step);
    this.cd.markForCheck();
  };
  private contextLost=(event:Event):void=>{
    event.preventDefault();this.webglFailed=true;this.status='webgl_error';this.cd.markForCheck();
  };
  private pick(event:PointerEvent):void {
    if(!this.camera||!this.renderer)return;
    const bounds=this.renderer.domElement.getBoundingClientRect();
    if(bounds.width<=0||bounds.height<=0)return;
    const ndc=new THREE.Vector2(
      ((event.clientX-bounds.left)/bounds.width)*2-1,
      1-((event.clientY-bounds.top)/bounds.height)*2);
    const ray=new THREE.Raycaster();
    ray.params.Points.threshold=1.6;
    if(this.camera.fov>=SKY_FISHEYE_START_DEG){
      const frame=skyCameraFrame(this.yaw,this.pitch);
      const dir=frame?skyFisheyeWorldRay(ndc.x,ndc.y,this.camera.aspect,this.camera.fov,frame):null;
      if(!dir){this.clearSelection();return;}
      ray.set(new THREE.Vector3(0,0,0),new THREE.Vector3(dir.x,dir.y,dir.z).normalize());
    }else{
      ray.setFromCamera(ndc,this.camera);
    }
    let chosen:PointWithKind|null=null;
    for(const hit of ray.intersectObjects(this.targets,false)){
      const obj=hit.object;
      const objectPoint=obj.userData['skyPoint'] as PointWithKind|undefined;
      const stars=obj.userData['skyStars'] as SkyDomePoint[]|undefined;
      chosen=objectPoint??(stars && hit.index!==undefined ? {point:stars[hit.index],kind:'star'} : null);
      if(chosen)break;
    }
    if(chosen && this.showGround && chosen.point.altitudeDeg<0)chosen=null;
    this.selected=chosen;
    this.updateSelectionRing();
    this.cd.markForCheck();
  }
}
