import { sendRichHtml } from '../../lib/richhtml.js'

const html = `<style>*{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent;user-select:none}
  html{background:#04060f}
  body{min-height:588px;background:#04060f;font-family:"Trebuchet MS",sans-serif;color:#eaf2ff;
       display:flex;align-items:center;justify-content:center;padding:14px 10px}
  .card{width:100%;max-width:620px;min-height:518px;padding:14px;border-radius:18px;
        background:linear-gradient(145deg,#141a3a,#04060f);border:1px solid #2c3670;
        box-shadow:0 30px 80px rgba(0,0,0,.55);overflow:hidden}
  .stage{position:relative;border-radius:12px;overflow:hidden;border:1px solid #34406f;background:#04060f}
  canvas{display:block;width:100%;touch-action:none}
  .hud{position:absolute;top:0;left:0;right:0;display:flex;justify-content:space-between;
       padding:10px 12px;font-size:13px;letter-spacing:1px;pointer-events:none;text-shadow:0 2px 6px #000}
  .banner{position:absolute;inset:0;display:none;align-items:center;justify-content:center;
          flex-direction:column;gap:12px;background:rgba(4,6,15,.78);text-align:center;padding:18px}
  .banner h2{font-size:30px;letter-spacing:2px}
  .banner p{font-size:13px;color:#bdc9ee}
  .banner button{cursor:pointer;border:0;border-radius:999px;padding:11px 26px;font-size:14px;
      background:linear-gradient(90deg,#6ee7ff,#a78bfa);color:#04060f;font-weight:700}
  .tip{text-align:center;font-size:11px;opacity:.6;margin-top:10px}
  .kicker{font-size:10px;letter-spacing:3px;color:#8ea0d8;margin-bottom:8px}
</style>
<div class="card">
  <div class="kicker">CBS-SCOVER GAME</div>
  <div class="stage" id="stage">
    <canvas id="cv"></canvas>
    <div class="hud"><span id="score">Score 0</span><span id="wave">Aliens left 0</span></div>
    <div class="banner" id="banner"><h2 id="btitle"></h2><p id="bmsg"></p><button id="bbtn">Play</button></div>
  </div>
  <div class="tip">Drag to aim · tap to fire</div>
</div>
<script>
const cv=document.getElementById('cv'),ctx=cv.getContext('2d'),stage=document.getElementById('stage');
let W=0,H=0;
function resize(){
  const w=Math.max(240,Math.min(600,stage.clientWidth||360));
  W=cv.width=w;H=cv.height=470;
  cv.style.height='470px';
}
addEventListener('resize',resize);resize();

const scoreEl=document.getElementById('score'),waveEl=document.getElementById('wave');
const banner=document.getElementById('banner'),btitle=document.getElementById('btitle'),
      bmsg=document.getElementById('bmsg'),bbtn=document.getElementById('bbtn');

const stars=[];
for(let i=0;i<120;i++)stars.push({x:Math.random(),y:Math.random(),s:Math.random()*2+.4,v:Math.random()*.4+.1});

let aliens=[],bullets=[],score=0,round=0,running=false;
const ship={x:0};
let aimX=0,aimY=0;

function spawn(){
  aliens=[];bullets=[];
  const n=6+Math.floor(Math.random()*5);
  const hue=Math.floor(Math.random()*360);
  for(let i=0;i<n;i++){
    aliens.push({
      x:30+Math.random()*(W-60),
      y:-Math.random()*H*0.7-30,
      r:15+Math.random()*8,
      vx:(Math.random()-.5)*1.1,
      vy:.28+Math.random()*.35+round*.06,
      hue:(hue+i*22)%360,t:Math.random()*6
    });
  }
  waveEl.textContent='Aliens left '+aliens.length;
}

function show(title,msg,btn){running=false;btitle.textContent=title;bmsg.textContent=msg;bbtn.textContent=btn;banner.style.display='flex';}
bbtn.onclick=()=>{banner.style.display='none';running=true;};

function pos(e){
  const t=e.touches&&e.touches[0]?e.touches[0]:e;
  const r=cv.getBoundingClientRect();
  aimX=(t.clientX-r.left)*(W/r.width);
  aimY=(t.clientY-r.top)*(H/r.height);
}
cv.addEventListener('mousemove',pos);
cv.addEventListener('touchmove',e=>{pos(e);e.preventDefault();},{passive:false});
function fire(){
  if(!running)return;
  const dx=aimX-ship.x,dy=aimY-(H-50),d=Math.hypot(dx,dy)||1;
  bullets.push({x:ship.x,y:H-50,vx:dx/d*10,vy:dy/d*10});
}
cv.addEventListener('mousedown',e=>{pos(e);fire();});
cv.addEventListener('touchstart',e=>{pos(e);fire();},{passive:true});

function drawShip(x,y){
  ctx.save();ctx.translate(x,y);
  ctx.fillStyle='#6ee7ff';
  ctx.beginPath();ctx.moveTo(0,-22);ctx.lineTo(17,15);ctx.lineTo(0,7);ctx.lineTo(-17,15);ctx.closePath();ctx.fill();
  ctx.fillStyle='#a78bfa';ctx.fillRect(-22,8,44,6);
  ctx.fillStyle='#ffe066';ctx.beginPath();ctx.arc(0,-3,4,0,7);ctx.fill();
  ctx.restore();
}

function drawAlien(a){
  ctx.save();ctx.translate(a.x,a.y);ctx.rotate(Math.sin(a.t)*.3);
  ctx.beginPath();ctx.arc(0,0,a.r,0,7);
  ctx.fillStyle='hsl('+a.hue+',75%,55%)';ctx.fill();
  ctx.lineWidth=3;ctx.strokeStyle='hsl('+a.hue+',90%,75%)';ctx.stroke();
  ctx.fillStyle='#04060f';
  ctx.beginPath();ctx.arc(-a.r*.32,-a.r*.1,a.r*.18,0,7);ctx.arc(a.r*.32,-a.r*.1,a.r*.18,0,7);ctx.fill();
  ctx.restore();
}

function loop(){
  requestAnimationFrame(loop);
  ctx.fillStyle='#04060f';ctx.fillRect(0,0,W,H);
  stars.forEach(s=>{
    s.y+=s.v/H;if(s.y>1)s.y=0;
    ctx.fillStyle='rgba(158,203,255,.8)';ctx.fillRect(s.x*W,s.y*H,s.s,s.s);
  });

  ship.x+=((aimX||W/2)-ship.x)*.12;
  ship.x=Math.max(24,Math.min(W-24,ship.x));
  drawShip(ship.x,H-50);

  for(let i=bullets.length-1;i>=0;i--){
    const b=bullets[i];b.x+=b.vx;b.y+=b.vy;
    if(b.x<-20||b.x>W+20||b.y<-20||b.y>H+20){bullets.splice(i,1);continue;}
    ctx.fillStyle='#ffe066';ctx.beginPath();ctx.arc(b.x,b.y,4,0,7);ctx.fill();
  }

  for(let i=aliens.length-1;i>=0;i--){
    const a=aliens[i];
    if(running){
      a.t+=.05;a.x+=a.vx;a.y+=a.vy;
      if(a.x<a.r||a.x>W-a.r)a.vx*=-1;
      if(a.y>H-32){show('Overrun!','The aliens got through. Score '+score,'Try again');score=0;round=0;scoreEl.textContent='Score 0';spawn();break;}
    }
    drawAlien(a);
    for(let j=bullets.length-1;j>=0;j--){
      const b=bullets[j];
      if(Math.hypot(a.x-b.x,a.y-b.y)<a.r+4){
        aliens.splice(i,1);bullets.splice(j,1);
        score+=10;scoreEl.textContent='Score '+score;
        waveEl.textContent='Aliens left '+aliens.length;
        if(aliens.length===0){round++;spawn();show('Wave cleared!','Faster aliens incoming. Score '+score,'Next wave');}
        break;
      }
    }
  }
}
spawn();ship.x=W/2;aimX=W/2;aimY=H/2;
show('Alien Killer','Shoot every alien before they reach the bottom.','Start');
loop();
</script>`

let handler = async (m, { EliteProTech }) => {
    try {
        await sendRichHtml(EliteProTech, m.chat, { id: 'elite-alienkiller', title: 'ELITE-PRO-V2 • ALIEN KILLER', html, source: 'eliteprotech' })
    } catch (error) {
        await m.reply(`Unable to send Alien Killer: ${error.message || String(error)}`)
    }
}

handler.command = ['alienkiller']

export default handler
