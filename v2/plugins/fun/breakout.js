import { sendRichHtml } from '../../lib/richhtml.js'

const html = `<style>*{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent;user-select:none}
  html{background:#05082b}
  body{min-height:588px;background:#05082b;font-family:"Trebuchet MS",sans-serif;color:#eaf2ff;
       display:flex;align-items:center;justify-content:center;padding:14px 10px}
  .card{width:100%;max-width:620px;min-height:518px;padding:14px;border-radius:18px;
        background:linear-gradient(145deg,#101a55,#05082b);border:1px solid #2b3a86;
        box-shadow:0 30px 80px rgba(0,0,0,.55);overflow:hidden}
  .kicker{font-size:10px;letter-spacing:3px;color:#8ea0d8;margin-bottom:8px}
  .stage{position:relative;border-radius:12px;overflow:hidden;border:1px solid #3a4a9a;background:#0a1040}
  canvas{display:block;width:100%;touch-action:none}
  .hud{position:absolute;top:0;left:0;right:0;display:flex;justify-content:space-between;gap:8px;
       padding:10px 12px;font-size:12px;letter-spacing:1px;pointer-events:none;text-shadow:0 2px 6px #000}
  .banner{position:absolute;inset:0;display:none;align-items:center;justify-content:center;
          flex-direction:column;gap:12px;background:rgba(5,8,43,.82);text-align:center;padding:18px}
  .banner h2{font-size:30px;letter-spacing:2px}
  .banner p{font-size:13px;color:#bdc9ee}
  .banner button{cursor:pointer;border:0;border-radius:999px;padding:11px 26px;font-size:14px;
      background:linear-gradient(90deg,#22d3ee,#3b82f6);color:#04060f;font-weight:700}
  .tip{text-align:center;font-size:11px;opacity:.6;margin-top:10px}
</style>
<div class="card">
  <div class="kicker">CBS-SCOVER GAME</div>
  <div class="stage" id="stage">
    <canvas id="cv"></canvas>
    <div class="hud"><span id="score">Score 0</span><span id="balls">Balls 1</span><span id="left">Blocks 0</span></div>
    <div class="banner" id="banner"><h2 id="btitle"></h2><p id="bmsg"></p><button id="bbtn">Play</button></div>
  </div>
  <div class="tip">Drag to slide the paddle · grab the glowing drops for extra balls</div>
</div>
<script>
const cv=document.getElementById('cv'),ctx=cv.getContext('2d'),stage=document.getElementById('stage');
let W=0,H=0;
function resize(){
  const w=Math.max(240,Math.min(600,stage.clientWidth||360));
  W=cv.width=w;H=cv.height=470;cv.style.height='470px';
}
resize();

const scoreEl=document.getElementById('score'),leftEl=document.getElementById('left'),ballsEl=document.getElementById('balls');
const banner=document.getElementById('banner'),btitle=document.getElementById('btitle'),
      bmsg=document.getElementById('bmsg'),bbtn=document.getElementById('bbtn');

const PALETTES=[
  ['#e02020','#f07f13','#f2e11c','#2f8fe0','#e01fd0','#1fd03a'],
  ['#22d3ee','#3b82f6','#a855f7','#ec4899','#f59e0b','#84cc16'],
  ['#f43f5e','#fb923c','#facc15','#4ade80','#38bdf8','#c084fc'],
  ['#ef4444','#f97316','#eab308','#10b981','#06b6d4','#d946ef']
];

const LAYOUTS=[
  ()=>true,
  (c,r)=>(c+r)%2===0,
  (c,r,C)=>r<2||c===0||c===C-1,
  (c,r,C)=>Math.abs(c-(C-1)/2)<=r,
  (c)=>c%3!==1,
  (c,r)=>r%2===0||c%2===0
];

let bricks=[],balls=[],drops=[],score=0,round=0,running=false;
const paddle={x:0,y:0,w:100,h:14};
let palette=PALETTES[0];

function layout(){paddle.y=H-40;paddle.w=Math.max(70,Math.min(140,W*0.26));}
layout();

function newBall(x,y,vx,vy){return{x,y,vx,vy,r:7};}

function build(){
  bricks=[];drops=[];
  const cols=7,rows=6,pad=5,top=44,side=14;
  const bw=(W-side*2-pad*(cols-1))/cols;
  const bh=18;
  palette=PALETTES[Math.floor(Math.random()*PALETTES.length)];
  const layoutFn=LAYOUTS[Math.floor(Math.random()*LAYOUTS.length)];
  for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
    if(!layoutFn(c,r,cols,rows))continue;
    bricks.push({x:side+c*(bw+pad),y:top+r*(bh+pad),w:bw,h:bh,
      color:palette[r%palette.length], drop:Math.random()<0.14});
  }
  leftEl.textContent='Blocks '+bricks.length;
  resetBalls();
}

function resetBalls(){
  balls=[newBall(W/2,paddle.y-14,(Math.random()-.5)*4,-6.5)];
  ballsEl.textContent='Balls 1';
}

function show(title,msg,btn){running=false;btitle.textContent=title;bmsg.textContent=msg;bbtn.textContent=btn;banner.style.display='flex';}
bbtn.onclick=()=>{banner.style.display='none';running=true;};

function move(e){
  const t=e.touches&&e.touches[0]?e.touches[0]:e;
  const r=cv.getBoundingClientRect();
  const x=(t.clientX-r.left)*(W/r.width);
  paddle.x=Math.max(paddle.w/2,Math.min(W-paddle.w/2,x));
}
cv.addEventListener('mousemove',move);
cv.addEventListener('touchmove',e=>{move(e);e.preventDefault();},{passive:false});
cv.addEventListener('touchstart',e=>{move(e);},{passive:true});

function splitBalls(){
  const extra=[];
  balls.forEach(b=>{
    const sp=Math.hypot(b.vx,b.vy)||6;
    const a=Math.atan2(b.vy,b.vx);
    extra.push(newBall(b.x,b.y,Math.cos(a+.5)*sp,Math.sin(a+.5)*sp));
    extra.push(newBall(b.x,b.y,Math.cos(a-.5)*sp,Math.sin(a-.5)*sp));
  });
  balls=balls.concat(extra).slice(0,10);
  ballsEl.textContent='Balls '+balls.length;
}

function drawBackground(){
  ctx.fillStyle='#0a1040';ctx.fillRect(0,0,W,H);
  const s=40;
  ctx.save();ctx.globalAlpha=.5;
  for(let y=0;y<H+s;y+=s){
    for(let x=((y/s)%2)*-s;x<W+s;x+=s*2){
      ctx.fillStyle='#0d1550';
      ctx.beginPath();
      ctx.moveTo(x,y);ctx.lineTo(x+s,y+s*0.55);ctx.lineTo(x,y+s*1.1);ctx.lineTo(x-s,y+s*0.55);
      ctx.closePath();ctx.fill();
      ctx.strokeStyle='rgba(30,50,130,.35)';ctx.lineWidth=1;ctx.stroke();
    }
  }
  ctx.restore();
}

function drawBrick(b){
  ctx.save();
  ctx.fillStyle=b.color;ctx.fillRect(b.x,b.y,b.w,b.h);
  const g=ctx.createLinearGradient(0,b.y,0,b.y+b.h);
  g.addColorStop(0,'rgba(255,255,255,.45)');
  g.addColorStop(.4,'rgba(255,255,255,.08)');
  g.addColorStop(1,'rgba(0,0,0,.35)');
  ctx.fillStyle=g;ctx.fillRect(b.x,b.y,b.w,b.h);
  ctx.strokeStyle=b.drop?'#ffe066':'rgba(0,0,0,.7)';
  ctx.lineWidth=b.drop?2.5:1.5;
  ctx.strokeRect(b.x,b.y,b.w,b.h);
  ctx.restore();
}

function drawPaddle(){
  const x=paddle.x-paddle.w/2,y=paddle.y;
  ctx.fillStyle='#e03a1f';
  ctx.fillRect(x,y,16,paddle.h);
  ctx.fillRect(x+paddle.w-16,y,16,paddle.h);
  const g=ctx.createLinearGradient(0,y,0,y+paddle.h);
  g.addColorStop(0,'#e8ecf4');g.addColorStop(.45,'#9aa4b8');g.addColorStop(1,'#5b6474');
  ctx.fillStyle=g;ctx.fillRect(x+13,y,paddle.w-26,paddle.h);
}

function drawBall(b){
  ctx.fillStyle='#7ff3ff';
  ctx.beginPath();ctx.arc(b.x,b.y,b.r,0,7);ctx.fill();
  ctx.fillStyle='rgba(255,255,255,.85)';
  ctx.beginPath();ctx.arc(b.x-b.r*.3,b.y-b.r*.3,b.r*.4,0,7);ctx.fill();
}

function loop(){
  requestAnimationFrame(loop);
  drawBackground();
  bricks.forEach(drawBrick);
  drawPaddle();

  for(let i=drops.length-1;i>=0;i--){
    const d=drops[i];
    if(running)d.y+=2.5;
    ctx.fillStyle='#ffe066';ctx.beginPath();ctx.arc(d.x,d.y,8,0,7);ctx.fill();
    ctx.fillStyle='#04060f';ctx.font='bold 11px sans-serif';ctx.textAlign='center';ctx.fillText('+',d.x,d.y+4);
    if(d.y>paddle.y-8&&d.y<paddle.y+30&&Math.abs(d.x-paddle.x)<paddle.w/2){drops.splice(i,1);splitBalls();continue;}
    if(d.y>H+20)drops.splice(i,1);
  }

  for(let i=balls.length-1;i>=0;i--){
    const b=balls[i];
    if(!b)continue;
    if(running){
      b.x+=b.vx;b.y+=b.vy;
      if(b.x<b.r){b.x=b.r;b.vx*=-1;}
      if(b.x>W-b.r){b.x=W-b.r;b.vx*=-1;}
      if(b.y<b.r){b.y=b.r;b.vy*=-1;}
      if(b.y>paddle.y-b.r&&b.y<paddle.y+paddle.h&&Math.abs(b.x-paddle.x)<paddle.w/2+b.r&&b.vy>0){
        b.vy=-Math.abs(b.vy);
        b.vx+=(b.x-paddle.x)*0.05;
      }
      if(b.y>H+20){
        balls.splice(i,1);ballsEl.textContent='Balls '+balls.length;
        if(balls.length===0){score=0;round=0;scoreEl.textContent='Score 0';build();show('Missed!','All balls got past you.','Try again');}
        continue;
      }
      for(let k=0;k<bricks.length;k++){
        const br=bricks[k];
        if(b.x>br.x-b.r&&b.x<br.x+br.w+b.r&&b.y>br.y-b.r&&b.y<br.y+br.h+b.r){
          const ox=Math.min(Math.abs(b.x-br.x),Math.abs(b.x-(br.x+br.w)));
          const oy=Math.min(Math.abs(b.y-br.y),Math.abs(b.y-(br.y+br.h)));
          if(ox<oy)b.vx*=-1;else b.vy*=-1;
          if(br.drop)drops.push({x:br.x+br.w/2,y:br.y+br.h/2});
          bricks.splice(k,1);
          score+=15;scoreEl.textContent='Score '+score;
          leftEl.textContent='Blocks '+bricks.length;
          if(bricks.length===0){round++;build();show('Cleared!','New colors and block pattern. Score '+score,'Next round');}
          break;
        }
      }
    } else if(banner.style.display!=='flex'){b.x=paddle.x;b.y=paddle.y-14;}
    drawBall(b);
  }
}
paddle.x=W/2;build();
show('Brick Breaker','Clear every block. Catch the glowing drops to split into multiple balls.','Start');
loop();
</script>`

let handler = async (m, { EliteProTech }) => {
    try {
        await sendRichHtml(EliteProTech, m.chat, { id: 'elite-breakout', title: 'ELITE-PRO-V2 • BREAKOUT', html, source: 'eliteprotech' })
    } catch (error) {
        await m.reply(`Unable to send Breakout: ${error.message || String(error)}`)
    }
}

handler.command = ['breakout']

export default handler
