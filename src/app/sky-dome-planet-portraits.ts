import * as THREE from 'three';

/**
 * Original, offline, visually recognizable planet artwork.
 *
 * Astronomical directions come exclusively from the Rust sky-dome response.
 * These are illustrative body portraits, NOT NASA photos, rotational ephemerides,
 * physical apparent diameters, surface maps or lunar phase predictions.
 */
export type PlanetPortraitSpec=Readonly<{
  id:string;
  diameter:number;
  accent:string;
  labelDiameter:number;
}>;
const PLANET_PORTRAITS:Readonly<Record<string,readonly [number,string,number]>>={
  Sun:[11.5,'#ffcb7d',3.0],
  Moon:[9.5,'#f1eff0',2.65],
  Mercury:[7.0,'#aeb2b7',2.45],
  Venus:[8.2,'#e7cda8',2.45],
  Mars:[8.5,'#cf7a57',2.5],
  Jupiter:[11.0,'#c9a995',2.8],
  Saturn:[14.0,'#dec9a6',2.8],
  Uranus:[8.3,'#9edddc',2.45],
  Neptune:[8.2,'#7195c9',2.45],
  Pluto:[7.0,'#b7aa9c',2.4],
  Chiron:[6.6,'#a7b4ae',2.35],
};
export function planetPortraitSpec(id:string):PlanetPortraitSpec|null {
  const values=PLANET_PORTRAITS[id];
  return values?Object.freeze({id,diameter:values[0],accent:values[1],labelDiameter:values[2]}):null;
}
function noise(x:number,y:number,seed:number):number {
  let value=(Math.imul(x+seed,374761393)^Math.imul(y+seed,668265263))>>>0;
  value=Math.imul(value^(value>>>13),1274126177);
  return ((value^(value>>>16))>>>0)/4294967295;
}
function diskGradient(ctx:CanvasRenderingContext2D,base:string):void {
  const grad=ctx.createRadialGradient(100,93,16,134,135,100);
  grad.addColorStop(0,'#fff5e4');
  grad.addColorStop(0.15,base);
  grad.addColorStop(0.77,base);
  grad.addColorStop(1,'#1c2432');
  ctx.fillStyle=grad;
  ctx.fillRect(0,0,256,256);
}
function planetBands(ctx:CanvasRenderingContext2D,seed:number,opacity:number,baseColors:readonly string[]):void {
  for(let i=0;i<16;i++){
    const y=44+i*11;
    const width=5+(i%4)*3;
    const band=baseColors[i%baseColors.length];
    ctx.beginPath();
    for(let x=27;x<=229;x+=5){
      const wave=Math.sin(x*.038+i*1.17)*2.2+Math.sin(x*.11+i)*1.2;
      if(x===27)ctx.moveTo(x,y+wave);
      else ctx.lineTo(x,y+wave);
    }
    for(let x=229;x>=27;x-=5){
      const wave=Math.sin(x*.038+i*1.17)*2.2+Math.sin(x*.11+i)*1.2;
      ctx.lineTo(x,y+wave+width);
    }
    ctx.closePath();ctx.globalAlpha=opacity*(.68+noise(i,seed,3)*.32);
    ctx.fillStyle=band;ctx.fill();
  }
  ctx.globalAlpha=1;
}
function drawCraters(ctx:CanvasRenderingContext2D,seed:number,count:number):void {
  for(let i=0;i<count;i++){
    const x=66+noise(i,4,seed)*126,y=62+noise(i,11,seed)*130;
    const r=1.8+noise(i,19,seed)*10;
    ctx.beginPath();ctx.arc(x,y,r,0,2*Math.PI);
    ctx.strokeStyle='rgba(30,32,44,.25)';
    ctx.lineWidth=1.5+noise(i,31,seed);
    ctx.stroke();
    ctx.beginPath();ctx.arc(x-1.4,y-1.2,Math.max(.8,r-.8),0,2*Math.PI);
    ctx.strokeStyle='rgba(245,242,228,.22)';
    ctx.lineWidth=1.1;ctx.stroke();
  }
}
function ring(ctx:CanvasRenderingContext2D,front:boolean):void {
  ctx.save();ctx.translate(128,128);ctx.rotate(-.28);
  const tracks=[
    {rx:103,ry:29,width:8,color:'rgba(221,204,164,.52)'},
    {rx:97,ry:26,width:5,color:'rgba(241,221,188,.76)'},
    {rx:88,ry:23,width:5,color:'rgba(143,123,102,.58)'},
    {rx:81,ry:21,width:5,color:'rgba(247,225,184,.49)'},
  ];
  for(const track of tracks){
    ctx.beginPath();
    ctx.ellipse(0,0,track.rx,track.ry,0,front?0:Math.PI,front?Math.PI:2*Math.PI);
    ctx.strokeStyle=track.color;ctx.lineWidth=track.width;ctx.stroke();
  }
  ctx.restore();
}

export function createPlanetPortrait(id:string):THREE.CanvasTexture|null {
  const spec=planetPortraitSpec(id);
  if(!spec)return null;
  const canvas=document.createElement('canvas');
  canvas.width=256;canvas.height=256;
  const ctx=canvas.getContext('2d');
  if(!ctx)return null;
  if(id==='Saturn')ring(ctx,false);
  const radius=id==='Saturn'?61:id==='Sun'?77:72;
  ctx.save();
  ctx.beginPath();ctx.arc(128,128,radius,0,Math.PI*2);
  ctx.clip();
  ctx.fillStyle=spec.accent;
  ctx.fillRect(0,0,256,256);

  if(id==='Jupiter'||id==='Saturn'){
    planetBands(ctx,id==='Jupiter'?4:6,.72,
      id==='Jupiter'
        ?['#8f5849','#e2c4a5','#d7a487','#a77969','#f8e4c5']
        :['#b6a080','#efdfc1','#c8ac84','#f2e1c2']);
    if(id==='Jupiter'){
      ctx.save();ctx.translate(160,162);ctx.rotate(-.14);
      ctx.fillStyle='rgba(172,92,72,.72)';
      ctx.beginPath();ctx.ellipse(0,0,16,8,0,0,Math.PI*2);ctx.fill();ctx.restore();
    }
  }else if(id==='Mars'){
    for(let i=0;i<13;i++){
      const x=53+noise(i,2,8)*150,y=55+noise(i,9,8)*140;
      ctx.fillStyle=i%3===0?'rgba(80,48,44,.39)':'rgba(239,177,120,.24)';
      ctx.beginPath();ctx.ellipse(x,y,7+noise(i,3,5)*23,4+noise(i,6,5)*11,
        noise(i,20,5)*2,0,Math.PI*2);ctx.fill();
    }
    ctx.fillStyle='rgba(248,231,209,.79)';
    ctx.beginPath();ctx.ellipse(126,69,26,8,-.3,0,Math.PI*2);ctx.fill();
  }else if(id==='Moon'||id==='Mercury'||id==='Pluto'||id==='Chiron'){
    for(let i=0;i<30;i++){
      const x=48+noise(i,4,2)*157,y=50+noise(i,7,3)*151;
      ctx.fillStyle=i%2===0?'rgba(50,57,65,.15)':'rgba(242,232,211,.11)';
      ctx.beginPath();ctx.ellipse(x,y,5+noise(i,2,5)*14,3+noise(i,15,6)*11,
        noise(i,18,7)*3,0,Math.PI*2);ctx.fill();
    }
    drawCraters(ctx,3,id==='Moon'?30:20);
  }else if(id==='Venus'){
    planetBands(ctx,9,.18,['#fff7e1','#d7c6ad','#efdfc3']);
  }else if(id==='Uranus'||id==='Neptune'){
    planetBands(ctx,id==='Uranus'?12:14,.17,
      id==='Uranus'?['#c2f0e7','#80c3c8']:['#91acdf','#415caa']);
  }else if(id==='Sun'){
    for(let i=0;i<42;i++){
      const x=36+noise(i,3,13)*186,y=32+noise(i,17,13)*195;
      const r=3+noise(i,9,13)*13;
      ctx.fillStyle=i%2?'rgba(255,190,84,.18)':'rgba(255,241,170,.25)';
      ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();
    }
  }
  // Sphere shading: subtle glancing light and limb darkening, not a physical phase.
  const shading=ctx.createRadialGradient(96,92,18,134,133,104);
  shading.addColorStop(0,'rgba(255,255,255,.26)');
  shading.addColorStop(.40,'rgba(255,255,255,.015)');
  shading.addColorStop(.79,'rgba(27,24,38,.20)');
  shading.addColorStop(1,'rgba(12,17,27,.76)');
  ctx.fillStyle=shading;ctx.fillRect(0,0,256,256);
  ctx.restore();
  if(id==='Saturn')ring(ctx,true);
  if(id==='Sun'){
    // A drawn corona adds visual warmth; it is not an angular solar diameter.
    const aura=ctx.createRadialGradient(128,128,radius-4,128,128,117);
    aura.addColorStop(0,'rgba(255,195,90,.10)');
    aura.addColorStop(1,'rgba(255,195,90,0)');
    ctx.fillStyle=aura;
    ctx.beginPath();ctx.arc(128,128,117,0,Math.PI*2);ctx.fill();
  }
  const texture=new THREE.CanvasTexture(canvas);
  texture.colorSpace=THREE.SRGBColorSpace;
  texture.needsUpdate=true;
  return texture;
}
