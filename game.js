(() => {
  'use strict';
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d', { alpha: false });
  const shell = document.getElementById('gameShell');
  const $ = (id) => document.getElementById(id);
  const ui = { score:$('score'), speed:$('speed'), fill:$('speedFill'), gear:$('gear'), mult:$('multiplier'), combo:$('combo'), drift:$('driftState'), label:$('driftLabel'), hint:$('driftHint'), best:$('best'), lap:$('lap'), card:$('startCard'), pause:$('pauseScreen'), toast:$('toast'), status:$('statusText') };
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b-a)*t;
  const smooth = (a,b,t) => { t=clamp((t-a)/(b-a),0,1); return t*t*(3-2*t); };
  const hypot = Math.hypot;
  let W=innerWidth, H=innerHeight, DPR=1, focal=760;
  let now=0, last=performance.now(), started=false, paused=false, muted=false;
  let best=Number(localStorage.getItem('apex-best')||0), score=0, combo=1, driftTime=0, bankTimer=0, toastTimer=0, shake=0, lap=1;
  ui.best.textContent=String(best).padStart(6,'0');
  function resize(){ W=innerWidth; H=innerHeight; DPR=Math.min(devicePixelRatio||1,2);focal=Math.min(800,W*1.17,H*1.12);canvas.width=Math.round(W*DPR);canvas.height=Math.round(H*DPR);canvas.style.width=W+'px';canvas.style.height=H+'px';ctx.setTransform(DPR,0,0,DPR,0,0); }
  addEventListener('resize',resize,{passive:true});resize();
  const keys=Object.create(null), touch={left:false,right:false,gas:false,brake:false,drift:false};
  addEventListener('keydown',e=>{ const k=e.key.toLowerCase(); if(['arrowup','arrowdown','arrowleft','arrowright',' ','w','a','s','d','shift','escape'].includes(k))e.preventDefault(); keys[k]=true; if(k==='escape'&&started)togglePause(); if((k==='enter'||k===' ')&&!started)startGame(); },{passive:false});
  addEventListener('keyup',e=>{keys[e.key.toLowerCase()]=false;});
  document.querySelectorAll('[data-control]').forEach(btn=>{const name=btn.dataset.control;const down=e=>{e.preventDefault();touch[name]=true;btn.classList.add('pressed');};const up=e=>{e.preventDefault();touch[name]=false;btn.classList.remove('pressed');};btn.addEventListener('pointerdown',down);['pointerup','pointercancel','pointerleave'].forEach(ev=>btn.addEventListener(ev,up));});
  function controls(){return {steer:(keys.a||keys.arrowleft||touch.left?-1:0)+(keys.d||keys.arrowright||touch.right?1:0), throttle:keys.w||keys.arrowup||touch.gas, brake:keys.s||keys.arrowdown||touch.brake, hand:keys[' ']||keys.shift||touch.drift};}
  // Closed mountain pass, sampled as a smooth Catmull-Rom road.
  const anchors=[[-5,-10],[3,12],[30,21],[59,9],[73,-14],[63,-38],[40,-53],[13,-50],[-7,-35],[-20,-12],[-42,1],[-64,17],[-73,39],[-58,59],[-31,63],[-5,50],[8,31]];
  function catmull(p0,p1,p2,p3,t){const t2=t*t,t3=t2*t;return .5*((2*p1)+(-p0+p2)*t+(2*p0-5*p1+4*p2-p3)*t2+(-p0+3*p1-3*p2+p3)*t3);}
  const road=[];const STEPS=12;
  for(let i=0;i<anchors.length;i++)for(let j=0;j<STEPS;j++){const t=j/STEPS,p0=anchors[(i-1+anchors.length)%anchors.length],p1=anchors[i],p2=anchors[(i+1)%anchors.length],p3=anchors[(i+2)%anchors.length];road.push({x:catmull(p0[0],p1[0],p2[0],p3[0],t),z:catmull(p0[1],p1[1],p2[1],p3[1],t)});}
  const roadWidth=10.4;
  function roadAt(pos){let bestD=1e9,bestI=0,bestT=0,closest={x:0,z:0},tangent={x:0,z:1};for(let i=0;i<road.length;i++){const a=road[i],b=road[(i+1)%road.length],dx=b.x-a.x,dz=b.z-a.z,l=dx*dx+dz*dz,t=clamp(((pos.x-a.x)*dx+(pos.z-a.z)*dz)/l,0,1),x=a.x+dx*t,z=a.z+dz*t,d=(pos.x-x)**2+(pos.z-z)**2;if(d<bestD){bestD=d;bestI=i;bestT=t;closest={x,z};const n=hypot(dx,dz);tangent={x:dx/n,z:dz/n};}}return {distance:Math.sqrt(bestD),index:bestI,t:bestT,point:closest,tangent};}
  let start=roadAt({x:0,z:0});
  // Position starts on the main straight.
  const startIndex=STEPS, first=road[startIndex], next=road[(startIndex+1)%road.length];
  const car={x:first.x,z:first.z,yaw:Math.atan2(next.x-first.x,next.z-first.z),vx:0,vz:0,steer:0,spin:0,slip:0,groundDist:0,offroad:false};
  let cameraYaw=car.yaw;
  const particles=[], trees=[];
  // Place pines and dry scrub along both shoulders.
  for(let i=0;i<road.length;i+=5){const p=road[i],n=road[(i+1)%road.length],dx=n.x-p.x,dz=n.z-p.z,len=hypot(dx,dz),nx=dz/len,nz=-dx/len;for(const side of [-1,1]){const spread=roadWidth*.5+3.3+Math.random()*5.3;trees.push({x:p.x+nx*spread,z:p.z+nz*spread,size:2.4+Math.random()*3.2,kind:Math.random()<.78?'pine':'rock',hue:Math.random()});}}
  const rocks=[];for(let i=0;i<road.length;i+=13){const p=road[i],n=road[(i+1)%road.length],dx=n.x-p.x,dz=n.z-p.z,len=hypot(dx,dz),nx=dz/len,nz=-dx/len;rocks.push({x:p.x+nx*(roadWidth*.5+1.6),z:p.z+nz*(roadWidth*.5+1.6),size:.4+Math.random()*.6});}
  const camHeight=9.4,camFollow=17;
  function project(x,z,height=0){const dx=x-car.x,dz=z-car.z,cy=Math.cos(cameraYaw),sy=Math.sin(cameraYaw);const lateral=dx*cy-dz*sy,forward=dx*sy+dz*cy,depth=camFollow+forward;const safe=Math.max(2.6,depth);return {x:W*.5+lateral*focal/safe,y:H*.30+focal*(camHeight-height)/safe,scale:focal/safe,depth};}
  function worldPoint(lateral,forward,up=0){const cy=Math.cos(car.yaw),sy=Math.sin(car.yaw);return {x:car.x+lateral*cy+forward*sy,z:car.z-lateral*sy+forward*cy,y:up};}
  function poly(points,fill,stroke=null,width=1){if(points.length<3)return;ctx.beginPath();ctx.moveTo(points[0].x,points[0].y);for(let i=1;i<points.length;i++)ctx.lineTo(points[i].x,points[i].y);ctx.closePath();if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=width;ctx.stroke();}}
  function line(a,b,color,width=1){ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();}
  function roundRect(x,y,w,h,r){ctx.beginPath();ctx.roundRect(x,y,w,h,r);}
  function drawSky(){
    const sky=ctx.createLinearGradient(0,0,0,H*.57);sky.addColorStop(0,'#677f98');sky.addColorStop(.4,'#e1a17f');sky.addColorStop(.72,'#f3c08a');sky.addColorStop(1,'#f9d79c');ctx.fillStyle=sky;ctx.fillRect(0,0,W,H);
    // Sun flare and atmospheric bands.
    const sunX=W*.73,sunY=H*.25,sunR=Math.min(W,H)*.082;const halo=ctx.createRadialGradient(sunX,sunY,2,sunX,sunY,sunR*2.7);halo.addColorStop(0,'#fff6d8dd');halo.addColorStop(.15,'#ffe9bd99');halo.addColorStop(1,'#ffb87b00');ctx.fillStyle=halo;ctx.fillRect(sunX-sunR*3,sunY-sunR*3,sunR*6,sunR*6);ctx.fillStyle='#fff0d3';ctx.beginPath();ctx.arc(sunX,sunY,sunR*.53,0,TAU);ctx.fill();
    for(let layer=0;layer<3;layer++){const base=H*(.34+layer*.038),amp=H*(.045-layer*.005);ctx.beginPath();ctx.moveTo(0,H*.55);for(let x=0;x<=W+12;x+=12){const xx=x/W*TAU*2.5+layer*1.6;const y=base+Math.sin(xx)*amp+Math.sin(xx*2.2+1.4)*amp*.38;ctx.lineTo(x,y);}ctx.lineTo(W,H*.58);ctx.closePath();ctx.fillStyle=['#7b7180','#636978','#485965'][layer];ctx.fill();}
    const ground=ctx.createLinearGradient(0,H*.41,0,H);ground.addColorStop(0,'#657252');ground.addColorStop(.4,'#435543');ground.addColorStop(1,'#263b35');ctx.fillStyle=ground;ctx.fillRect(0,H*.41,W,H*.59);
    // Distant warm haze at the horizon.
    const haze=ctx.createLinearGradient(0,H*.39,0,H*.55);haze.addColorStop(0,'#f0b37b00');haze.addColorStop(.55,'#e9b28288');haze.addColorStop(1,'#d7ad7900');ctx.fillStyle=haze;ctx.fillRect(0,H*.38,W,H*.2);
  }
  function roadEdges(i){const p=road[i],n=road[(i+1)%road.length],before=road[(i-1+road.length)%road.length],after=road[(i+1)%road.length],dx=after.x-before.x,dz=after.z-before.z,len=hypot(dx,dz),nx=dz/len,nz=-dx/len;return {l:{x:p.x+nx*roadWidth*.5,z:p.z+nz*roadWidth*.5},r:{x:p.x-nx*roadWidth*.5,z:p.z-nz*roadWidth*.5},p,n,nx,nz};}
  function drawRoad(){
    const chunks=[];
    for(let i=0;i<road.length;i++){const e=roadEdges(i),en=roadEdges((i+1)%road.length),mid=project((e.p.x+e.n.x)*.5,(e.p.z+e.n.z)*.5);if(mid.depth<camFollow+1)continue;chunks.push({i,e,en,depth:mid.depth});}
    chunks.sort((a,b)=>b.depth-a.depth);
    for(const c of chunks){const {i,e,en}=c;const lp=project(e.l.x,e.l.z),rp=project(e.r.x,e.r.z),ln=project(en.l.x,en.l.z),rn=project(en.r.x,en.r.z);const shoulder=roadWidth*.5+1.15;const lso=project(e.p.x+e.nx*shoulder,e.p.z+e.nz*shoulder),rso=project(e.p.x-e.nx*shoulder,e.p.z-e.nz*shoulder),lsn=project(e.n.x+e.nx*shoulder,e.n.z+e.nz*shoulder),rsn=project(e.n.x-e.nx*shoulder,e.n.z-e.nz*shoulder);
      poly([lso,lp,ln,lsn],'#817261');poly([rp,rso,rsn,rn],'#817261');
      const tint=(Math.floor(i/4)%2===0)?'#ddd1b0':'#a85e49';poly([lp,rp,rn,ln],tint);
      poly([lp,rp,rn,ln],'#343a3b');
      if(i%19<7){poly([project(e.p.x+e.nx*(roadWidth*.5-.2),e.p.z+e.nz*(roadWidth*.5-.2)),project(e.p.x+e.nx*(roadWidth*.5-.78),e.p.z+e.nz*(roadWidth*.5-.78)),project(e.n.x+e.nx*(roadWidth*.5-.78),e.n.z+e.nz*(roadWidth*.5-.78)),project(e.n.x+e.nx*(roadWidth*.5-.2),e.n.z+e.nz*(roadWidth*.5-.2))],'#e8e2d0');poly([project(e.p.x-e.nx*(roadWidth*.5-.2),e.p.z-e.nz*(roadWidth*.5-.2)),project(e.p.x-e.nx*(roadWidth*.5-.78),e.p.z-e.nz*(roadWidth*.5-.78)),project(e.n.x-e.nx*(roadWidth*.5-.78),e.n.z-e.nz*(roadWidth*.5-.78)),project(e.n.x-e.nx*(roadWidth*.5-.2),e.n.z-e.nz*(roadWidth*.5-.2))],'#d3c9b0');}
      if(i%14<6){const a=project(e.p.x,e.p.z),b=project(e.n.x,e.n.z);line(a,b,'#f4e3b8',Math.max(1.1,a.scale*.07));}
      if(i>=startIndex&&i<startIndex+2){for(let k=0;k<14;k++){ const a=-roadWidth*.5+roadWidth*k/14,b=-roadWidth*.5+roadWidth*(k+1)/14;const p0=project(e.p.x+e.nx*a,e.p.z+e.nz*a),p1=project(e.p.x+e.nx*b,e.p.z+e.nz*b),n1=project(e.n.x+e.nx*b,e.n.z+e.nz*b),n0=project(e.n.x+e.nx*a,e.n.z+e.nz*a);poly([p0,p1,n1,n0],k%2?'#e7e2d5':'#252a2b');}}
    }
  }
  function drawPine(item){const p=project(item.x,item.z),s=p.scale*item.size;if(p.depth<3||p.x<-s*3||p.x>W+s*3||p.y>H+s*2||p.y<-s*6)return;
    if(item.kind==='rock'){ctx.fillStyle='#414640';ctx.beginPath();ctx.ellipse(p.x,p.y,s*.55,s*.23,0,0,TAU);ctx.fill();ctx.fillStyle='#777468';ctx.beginPath();ctx.ellipse(p.x-s*.12,p.y-s*.1,s*.38,s*.19,-.25,Math.PI,TAU);ctx.fill();return;}
    const h=s*2.7,w=s*.72;ctx.fillStyle='#222e2b';ctx.beginPath();ctx.ellipse(p.x,p.y,s*.54,s*.2,0,0,TAU);ctx.fill();ctx.fillStyle='#59493d';ctx.fillRect(p.x-s*.09,p.y-h*.18,s*.18,h*.23);
    for(let j=0;j<3;j++){const top=p.y-h*(.42+j*.23),base=p.y-h*(.04+j*.18),spread=w*(1-j*.16);ctx.beginPath();ctx.moveTo(p.x,top);ctx.lineTo(p.x+spread,base);ctx.lineTo(p.x-spread,base);ctx.closePath();ctx.fillStyle=['#354839','#3e5841','#4a6346'][Math.min(2,j)];ctx.fill();ctx.beginPath();ctx.moveTo(p.x,top);ctx.lineTo(p.x+spread*.18,base);ctx.lineTo(p.x-spread*.38,base);ctx.closePath();ctx.fillStyle='#637550';ctx.globalAlpha=.6;ctx.fill();ctx.globalAlpha=1;}
  }
  function drawScenery(){const visible=trees.concat(rocks).map(o=>({...o,depth:project(o.x,o.z).depth})).filter(o=>o.depth>camFollow+2&&o.depth<110).sort((a,b)=>b.depth-a.depth);visible.forEach(drawPine);}
  function addSmoke(){const speed=hypot(car.vx,car.vz),slip=Math.abs(car.slip);if(speed<5||(!input.hand&&slip<.23))return;const rate=(input.hand?1:slip)*clamp(speed/13,.3,1.8);if(Math.random()<rate*.72){for(const side of [-1,1]){const p=worldPoint(side*.77,-1.62);particles.push({x:p.x,z:p.z,life:.8+Math.random()*.55,max:.8+Math.random()*.55,size:.35+Math.random()*.48,vx:car.vx*.12+(Math.random()-.5)*1.3,vz:car.vz*.12+(Math.random()-.5)*1.3,smoke:true});}}}
  function drawParticles(dt){for(let i=particles.length-1;i>=0;i--){const p=particles[i];p.life-=dt;if(p.life<=0){particles.splice(i,1);continue;}p.x+=p.vx*dt;p.z+=p.vz*dt;p.size+=dt*(p.smoke?1.05:.45);const q=project(p.x,p.z);if(q.depth<2)continue;const fade=clamp(p.life/p.max,0,1),rad=Math.max(1,p.size*q.scale);ctx.globalAlpha=fade*(p.smoke?.3:.24);ctx.fillStyle=p.smoke?'#e4e0d9':'#c5b493';ctx.beginPath();ctx.ellipse(q.x,q.y,rad,rad*.58,0,0,TAU);ctx.fill();ctx.globalAlpha=1;}}
  function localPoly(coords,fill,stroke,width=1){poly(coords.map(([l,f,h=0])=>{const p=worldPoint(l,f,h);return project(p.x,p.z,p.y);}),fill,stroke,width);}
  function drawWheel(lateral,forward,steer=0){const c=Math.cos(steer),s=Math.sin(steer),coords=[[-.23,-.43],[.23,-.43],[.23,.43],[-.23,.43]].map(([x,f])=>[lateral+x*c+f*s,forward-x*s+f*c]);localPoly(coords,'#141819','#89908b',.7);const a=worldPoint(lateral-.14,forward),b=worldPoint(lateral+.14,forward);line(project(a.x,a.z,.04),project(b.x,b.z,.04),'#666e6a',.65);}
  function drawCar(){const speed=hypot(car.vx,car.vz),bodyBob=Math.sin(now*9)*Math.min(.035,speed*.0018);const center=project(car.x,car.z);const sc=center.scale;if(center.depth<3)return;
    ctx.save();ctx.globalAlpha=.35;ctx.fillStyle='#111619';ctx.beginPath();ctx.ellipse(center.x,center.y+sc*.34,sc*1.72,sc*.6,-.04,0,TAU);ctx.fill();ctx.restore();
    // Electric underglow and lower sill.
    ctx.save();ctx.globalAlpha=.25;localPoly([[-1,-1.7],[1,-1.7],[.94,1.8],[-.94,1.8]],'#ff6c3e');ctx.restore();
    drawWheel(-.91,-1.18,car.steer*.45);drawWheel(.91,-1.18,car.steer*.45);drawWheel(-.91,1.18);drawWheel(.91,1.18);
    // Widebody shell, sculpted bumpers, and front splitter.
    localPoly([[-.85,-2.05],[.85,-2.05],[1.04,-1.62],[1.03,1.75],[.79,2.23],[-.79,2.23],[-1.03,1.75],[-1.04,-1.62]],'#bb422f','#f3a27c',.85);
    localPoly([[-.99,-1.46],[-.84,-1.72],[.84,-1.72],[.99,-1.46],[.92,.93],[-.92,.93]],'#e66b43','#ffb17e',.65);
    localPoly([[-.99,-1.48],[-.72,-1.59],[-.64,-1.4],[.64,-1.4],[.72,-1.59],[.99,-1.48],[.94,-1.26],[-.94,-1.26]],'#9e352b');
    // Roof / panoramic glass; inset geometry gives a convincing little coupe silhouette.
    localPoly([[-.72,-.83],[-.58,-1.15],[.58,-1.15],[.72,-.83],[.67,.65],[.53,.91],[-.53,.91],[-.67,.65]],'#252f35','#f4b184',.55);
    localPoly([[-.59,-.76],[-.49,-1.05],[.49,-1.05],[.59,-.76],[.53,-.34],[-.53,-.34]],'#718991');
    localPoly([[-.52,-.23],[.52,-.23],[.49,.57],[-.49,.57]],'#43565c');
    localPoly([[-.57,.68],[.57,.68],[.65,.96],[-.65,.96]],'#d77d59');
    // Race stripe, rear wing, lamps and bright windscreen glints.
    localPoly([[-.12,-1.9],[.12,-1.9],[.15,-1.55],[-.15,-1.55]],'#f6d88c');
    localPoly([[-.93,-1.95],[-.82,-2.22],[.82,-2.22],[.93,-1.95],[.81,-1.83],[-.81,-1.83]],'#272a2a','#d2a17c',.55);
    localPoly([[-.86,1.82],[-.55,1.89],[-.62,2.04],[-.91,2.00]],'#ffb09a');localPoly([[.86,1.82],[.55,1.89],[.62,2.04],[.91,2.00]],'#ffb09a');
    localPoly([[-.83,-1.72],[-.58,-1.7],[-.56,-1.55],[-.87,-1.57]],'#fff0c1');localPoly([[.83,-1.72],[.58,-1.7],[.56,-1.55],[.87,-1.57]],'#fff0c1');
    // Front wheel angle indicator and exhaust glints.
    if(Math.abs(car.steer)>.08){ctx.globalAlpha=.28;localPoly([[-.28,-2.35],[.28,-2.35],[.16,-2.05],[-.16,-2.05]],'#fff2cc');ctx.globalAlpha=1;}
  }
  let input={steer:0,throttle:false,brake:false,hand:false};
  let audio=null;
  function initAudio(){if(audio)return;const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;const ac=new AC(),master=ac.createGain();master.gain.value=muted?0:.58;master.connect(ac.destination);const engineGain=ac.createGain(),engineFilter=ac.createBiquadFilter();engineFilter.type='lowpass';engineFilter.frequency.value=700;engineGain.gain.value=.0001;engineFilter.connect(engineGain);engineGain.connect(master);
    const low=ac.createOscillator(),high=ac.createOscillator();low.type='sawtooth';high.type='triangle';low.frequency.value=48;high.frequency.value=96;const mix=ac.createGain();mix.gain.value=.31;low.connect(engineFilter);high.connect(mix);mix.connect(engineFilter);low.start();high.start();
    const buffer=ac.createBuffer(1,ac.sampleRate*2,ac.sampleRate),data=buffer.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=(Math.random()*2-1)*.34;const noise=ac.createBufferSource();noise.buffer=buffer;noise.loop=true;const squeal=ac.createBiquadFilter();squeal.type='bandpass';squeal.frequency.value=1250;squeal.Q.value=.75;const tireGain=ac.createGain();tireGain.gain.value=0;noise.connect(squeal);squeal.connect(tireGain);tireGain.connect(master);noise.start();audio={ac,master,low,high,engineFilter,engineGain,tireGain,squeal};}
  function updateAudio(){if(!audio)return;const speed=hypot(car.vx,car.vz),rpm=clamp(speed/43,0,1),rev=(input.throttle?.22:0)+rpm*.8;const t=audio.ac.currentTime;audio.low.frequency.setTargetAtTime(38+rpm*106+rev*28,t,.055);audio.high.frequency.setTargetAtTime(78+rpm*220+rev*60,t,.06);audio.engineFilter.frequency.setTargetAtTime(360+rpm*1350+rev*700,t,.09);audio.engineGain.gain.setTargetAtTime(started&&!paused?.045+rpm*.095:.0001,t,.09);const squeal=started&&!paused?clamp((Math.abs(car.slip)-.12)*.35+(input.hand&&speed>7?.2:0),0,.38):0;audio.tireGain.gain.setTargetAtTime(squeal,t,.08);audio.squeal.frequency.setTargetAtTime(800+Math.abs(car.slip)*950,t,.1);audio.master.gain.setTargetAtTime(muted?0:.58,t,.04);}
  function startGame(){if(started)return;started=true;paused=false;shell.classList.add('started');ui.card.classList.add('hidden');ui.status.textContent='ENGINE ON · LET IT SLIDE';initAudio();if(audio&&audio.ac.state==='suspended')audio.ac.resume();}
  function togglePause(){if(!started)return;paused=!paused;ui.pause.classList.toggle('open',paused);ui.status.textContent=paused?'PAUSED':'ENGINE ON · LET IT SLIDE';if(!paused&&audio&&audio.ac.state==='suspended')audio.ac.resume();}
  $('startButton').addEventListener('click',startGame);$('resumeButton').addEventListener('click',togglePause);
  $('soundToggle').addEventListener('click',()=>{muted=!muted;$('soundToggle').classList.toggle('is-muted',muted);$('soundIcon').textContent=muted?'♩':'♫';if(!audio)initAudio();if(audio)audio.master.gain.setTargetAtTime(muted?0:.58,audio.ac.currentTime,.04);});
  function resetCar(){const p=road[startIndex],n=road[(startIndex+1)%road.length];car.x=p.x;car.z=p.z;car.yaw=Math.atan2(n.x-p.x,n.z-p.z);car.vx=car.vz=0;car.slip=0;score+=Math.floor(driftPoints);driftPoints=0;driftTime=0;combo=1;particles.length=0;previousIndex=startIndex;}
  let driftPoints=0,previousIndex=startIndex,toastVisible=0;
  function bankDrift(){if(driftTime>.45&&driftPoints>0){const points=Math.floor(driftPoints);score+=points;toastTimer=.9;ui.toast.innerHTML=`DRIFT BANKED <b>+${points.toLocaleString()}</b>`;ui.toast.classList.add('show');if(score>best){best=score;localStorage.setItem('apex-best',best);ui.best.textContent=String(best).padStart(6,'0');}}driftPoints=0;driftTime=0;combo=1;}
  function simulate(dt){input=controls();if(keys.r){keys.r=false;resetCar();}
    const fwd={x:Math.sin(car.yaw),z:Math.cos(car.yaw)},right={x:Math.cos(car.yaw),z:-Math.sin(car.yaw)};let longitudinal=car.vx*fwd.x+car.vz*fwd.z,lateral=car.vx*right.x+car.vz*right.z;let speed=hypot(car.vx,car.vz);
    const track=roadAt(car),roadEdge=roadWidth*.5;car.offroad=track.distance>roadEdge*.88;car.groundDist=track.distance;
    if(input.throttle)longitudinal+=dt*(car.offroad?8.5:15.5)*(longitudinal<0?1.7:1);
    if(input.brake)longitudinal-=Math.sign(longitudinal||1)*dt*22;
    if(!input.throttle&&!input.brake)longitudinal*=Math.exp(-dt*(car.offroad?.35:.18));
    longitudinal=clamp(longitudinal,-12,44);
    const turnSpeed=clamp(Math.abs(longitudinal)/18,0,1.15),reverse=longitudinal<-.4?-1:1;
    const yawRate=input.steer*turnSpeed*(input.hand?.68:.48)*reverse;car.yaw+=yawRate*dt;
    // The handbrake loosens rear grip without making the car spin instantly; steering feeds a controllable slip angle.
    const grip=car.offroad?1.45:(input.hand?.78:4.15);lateral*=Math.exp(-grip*dt);lateral-=input.steer*longitudinal*dt*(input.hand?.34:.075);
    if(car.offroad){longitudinal*=Math.exp(-dt*.52);if(track.distance>roadEdge+5){const pull=clamp((track.distance-roadEdge-5)*.045,0,.7);car.vx+=(track.point.x-car.x)*pull*dt;car.vz+=(track.point.z-car.z)*pull*dt;}}
    const nf={x:Math.sin(car.yaw),z:Math.cos(car.yaw)},nr={x:Math.cos(car.yaw),z:-Math.sin(car.yaw)};car.vx=nf.x*longitudinal+nr.x*lateral;car.vz=nf.z*longitudinal+nr.z*lateral;car.x+=car.vx*dt;car.z+=car.vz*dt;car.steer=lerp(car.steer,input.steer,1-Math.exp(-dt*8));car.spin+=longitudinal*dt*.55;car.slip=Math.atan2(lateral,Math.max(1,Math.abs(longitudinal)));
    const drifting=speed>6&&Math.abs(car.slip)>.12&&!car.offroad;
    if(drifting){driftTime+=dt;combo=clamp(combo+dt*.32,1,8);const angle=clamp((Math.abs(car.slip)-.14)/.58,0,1),flow=clamp(speed/17,.35,1.8);driftPoints+=dt*(42+angle*112)*flow*combo*(input.hand?1.28:1);shake=Math.max(shake,angle*.9);}
    else if(driftTime>.48)bankDrift();else if(driftTime>0){driftTime=Math.max(0,driftTime-dt*1.6);combo=lerp(combo,1,dt*1.2);}
    if(car.offroad&&Math.random()<dt*4&&speed>8){particles.push({x:car.x+(Math.random()-.5)*1.3,z:car.z+(Math.random()-.5)*1.3,life:.45,max:.45,size:.25+Math.random()*.25,vx:car.vx*.12,vz:car.vz*.12,smoke:false});}
    addSmoke();const index=track.index;if(previousIndex>road.length*.92&&index<startIndex+2){lap++;ui.lap.textContent=String(lap).padStart(2,'0');}previousIndex=index;
    toastTimer=Math.max(0,toastTimer-dt);if(toastTimer<=0)ui.toast.classList.remove('show');shake=Math.max(0,shake-dt*1.7);
    if(score>best){best=score;localStorage.setItem('apex-best',best);ui.best.textContent=String(best).padStart(6,'0');}
    const total=score+Math.floor(driftPoints);ui.score.textContent=String(total).padStart(6,'0');ui.mult.textContent=combo.toFixed(1);ui.combo.classList.toggle('active',drifting);ui.drift.classList.toggle('active',drifting);ui.label.textContent=drifting?'DRIFTING':'READY TO SLIDE';ui.hint.textContent=drifting?`${Math.round(Math.abs(car.slip)*57.3)}° ANGLE · ${Math.floor(driftPoints).toLocaleString()} PTS`:(car.offroad?'GET BACK ON TRACK':'FIND YOUR ANGLE');
    const kmh=Math.round(speed*3.6);ui.speed.textContent=String(kmh).padStart(3,'0');ui.fill.style.width=clamp(kmh/160*100,0,100)+'%';ui.gear.textContent=speed<1?'N':String(clamp(Math.floor(speed/8)+1,1,6));if(car.offroad)ui.status.textContent='OFF TRACK · GRIP LOST';else ui.status.textContent='ENGINE ON · LET IT SLIDE';
  }
  function drawScene(dt){drawSky();ctx.save();if(shake>.02){const magnitude=shake*Math.min(4,Math.max(1,W*.003));ctx.translate((Math.random()-.5)*magnitude,(Math.random()-.5)*magnitude*.65);}drawRoad();drawScenery();drawParticles(dt);drawCar();ctx.restore();
    // Fine drifting sparks only on the asphalt edge, kept restrained for a clean cockpit-free view.
    if(started&&!paused&&input.hand&&hypot(car.vx,car.vz)>15&&Math.abs(car.slip)>.28&&Math.random()<.16){const p=worldPoint((Math.random()-.5)*1.5,-1.7);const q=project(p.x,p.z);ctx.fillStyle='#ffcf79';ctx.globalAlpha=.7;ctx.fillRect(q.x,q.y,2,2);ctx.globalAlpha=1;}
  }
  function frame(timestamp){const dt=Math.min(.04,Math.max(0,(timestamp-last)/1000));last=timestamp;now=timestamp/1000;if(started&&!paused)simulate(dt);const delta=Math.atan2(Math.sin(car.yaw-cameraYaw),Math.cos(car.yaw-cameraYaw));cameraYaw+=delta*(1-Math.exp(-dt*5.2));drawScene(started&&!paused?dt:0);updateAudio();requestAnimationFrame(frame);}
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&started&&!paused)togglePause();});
  addEventListener('blur',()=>{for(const k in keys)keys[k]=false;for(const k in touch)touch[k]=false;});
  // Avoid mobile browser panning/zooming while driving.
  document.addEventListener('contextmenu',e=>e.preventDefault());
  requestAnimationFrame(frame);
})();
