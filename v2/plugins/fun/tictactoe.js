import { sendRichHtml } from '../../lib/richhtml.js'

const html = `<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{overflow:hidden;background:#080611;font-family:"Trebuchet MS",sans-serif;color:#eaf2ff}
  canvas{display:block;touch-action:none}
  .hud{position:fixed;top:0;left:0;right:0;display:flex;justify-content:space-between;
       padding:14px 18px;font-size:15px;letter-spacing:1px;pointer-events:none;text-shadow:0 2px 6px #000}
  .hud a{pointer-events:auto;color:#f0abfc;text-decoration:none;border:1px solid #f0abfc55;
         padding:4px 12px;border-radius:999px;font-size:13px}
  .banner{position:fixed;inset:0;display:none;align-items:center;justify-content:center;
          flex-direction:column;gap:14px;background:rgba(8,6,17,.8);text-align:center;padding:20px}
  .banner h2{font-size:38px;letter-spacing:3px}
  .banner button{cursor:pointer;border:0;border-radius:999px;padding:12px 28px;font-size:15px;
      background:linear-gradient(90deg,#f0abfc,#818cf8);color:#08060f;font-weight:700}
  .tip{position:fixed;bottom:12px;width:100%;text-align:center;font-size:12px;opacity:.5}
</style>


<div class="hud"><span id="score">You 0 · CPU 0</span><span id="turn">Your turn (X)</span><a href="/home.html">Home</a></div>
<div class="banner" id="banner"><h2 id="btitle"></h2><p id="bmsg"></p><button id="bbtn">Play again</button></div>
<div class="tip">Click or tap a tile to place your mark — the computer sometimes slips up</div>
<canvas id="cv"></canvas>
<script>
const cv=document.getElementById('cv'),ctx=cv.getContext('2d');
let W=0,H=0,S=0,ox=0,oy=0;
function resize(){
  W=cv.width=innerWidth;H=cv.height=innerHeight;
  S=Math.min(W*0.86,H*0.68);ox=(W-S)/2;oy=(H-S)/2+10;
}
addEventListener('resize',resize);resize();

const scoreEl=document.getElementById('score'),turnEl=document.getElementById('turn');
const banner=document.getElementById('banner'),btitle=document.getElementById('btitle'),bmsg=document.getElementById('bmsg');

const imgCache={};
function skin(seed){
  if(!imgCache[seed]){const i=new Image();i.crossOrigin='anonymous';i.src='https://picsum.photos/seed/'+seed+'/150/150';imgCache[seed]=i;}
  return imgCache[seed];
}

let cells=Array(9).fill(0),busy=false,you=0,cpu=0,round=0,tileImg,hue=0,winLine=null;

function buildBoard(){
  cells=Array(9).fill(0);winLine=null;
  tileImg=skin('ttt'+round+'-'+Math.floor(Math.random()*999));
  hue=Math.floor(Math.random()*360);
}
buildBoard();

const LINES=[[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
function winner(b){for(const l of LINES){if(b[l[0]]&&b[l[0]]===b[l[1]]&&b[l[1]]===b[l[2]])return{w:b[l[0]],l};}return{w:0};}

function best(b,who){
  const w=winner(b).w;
  if(w===2)return{s:1};
  if(w===1)return{s:-1};
  if(b.every(v=>v))return{s:0};
  let bestS=who===2?-2:2,move=-1;
  for(let i=0;i<9;i++){
    if(b[i])continue;b[i]=who;
    const s=best(b,who===2?1:2).s;b[i]=0;
    if(who===2?s>bestS:s<bestS){bestS=s;move=i;}
  }
  return{s:bestS,i:move};
}
// AI is tough but beatable: only 10% of the time it plays a random legal move
function cpuMove(){
  const free=cells.map((v,i)=>v?-1:i).filter(i=>i>=0);
  if(!free.length)return -1;
  if(Math.random()<0.10)return free[Math.floor(Math.random()*free.length)];
  const m=best(cells.slice(),2).i;
  return m>=0?m:free[0];
}

function finish(title,msg){busy=true;btitle.textContent=title;bmsg.textContent=msg;banner.style.display='flex';}
document.getElementById('bbtn').onclick=()=>{banner.style.display='none';round++;buildBoard();busy=false;turnEl.textContent='Your turn (X)';};

function afterMove(){
  const r=winner(cells);
  if(r.w){winLine=r.l;
    if(r.w===1){you++;scoreEl.textContent='You '+you+' · CPU '+cpu;finish('You win!','Fresh tile art next round.');}
    else{cpu++;scoreEl.textContent='You '+you+' · CPU '+cpu;finish('CPU wins','The computer took that one.');}
    return true;}
  if(cells.every(v=>v)){finish('Draw','Nobody got three in a row.');return true;}
  return false;
}

function click(e){
  if(busy)return;
  const t=e.changedTouches?e.changedTouches[0]:e;
  const c=Math.floor((t.clientX-ox)/(S/3)),r=Math.floor((t.clientY-oy)/(S/3));
  if(c<0||c>2||r<0||r>2)return;
  const i=r*3+c;
  if(cells[i])return;
  cells[i]=1;
  if(afterMove())return;
  busy=true;turnEl.textContent='CPU thinking…';
  setTimeout(()=>{
    const m=cpuMove();
    if(m>=0)cells[m]=2;
    if(!afterMove()){busy=false;turnEl.textContent='Your turn (X)';}
  },420);
}
addEventListener('click',click);
addEventListener('touchend',click);

function loop(){
  requestAnimationFrame(loop);
  const g=ctx.createLinearGradient(0,0,0,H);
  g.addColorStop(0,'#120a24');g.addColorStop(1,'#080611');
  ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
  const cs=S/3,t=performance.now()*.002;
  for(let i=0;i<9;i++){
    const c=i%3,r=Math.floor(i/3);
    const x=ox+c*cs+4,y=oy+r*cs+4,w=cs-8;
    const pulse=Math.sin(t+i)*2;
    ctx.save();
    ctx.beginPath();ctx.roundRect(x,y+pulse,w,w,14);ctx.clip();
    if(tileImg.complete&&tileImg.naturalWidth)ctx.drawImage(tileImg,x,y+pulse,w,w);
    ctx.globalAlpha=.5;ctx.fillStyle='hsl('+((hue+i*12)%360)+',55%,50%)';ctx.fillRect(x,y+pulse,w,w);
    ctx.restore();
    ctx.strokeStyle=winLine&&winLine.includes(i)?'#ffe066':'rgba(255,255,255,.28)';
    ctx.lineWidth=winLine&&winLine.includes(i)?5:2;
    ctx.beginPath();ctx.roundRect(x,y+pulse,w,w,14);ctx.stroke();

    if(cells[i]){
      const cx=x+w/2,cy=y+pulse+w/2,s=w*0.26;
      ctx.lineWidth=Math.max(7,w*0.1);ctx.lineCap='round';
      if(cells[i]===1){
        ctx.strokeStyle='#6ee7ff';
        ctx.beginPath();ctx.moveTo(cx-s,cy-s);ctx.lineTo(cx+s,cy+s);
        ctx.moveTo(cx+s,cy-s);ctx.lineTo(cx-s,cy+s);ctx.stroke();
      }else{
        ctx.strokeStyle='#fb7185';
        ctx.beginPath();ctx.arc(cx,cy,s,0,7);ctx.stroke();
      }
    }
  }
}
loop();
</script>`

let handler = async (m, { EliteProTech }) => {
    try {
        await sendRichHtml(EliteProTech, m.chat, { id: 'elite-tictactoe', title: 'ELITE-PRO-V2 • TIC TAC TOE', html, source: 'eliteprotech' })
    } catch (error) {
        await m.reply(`Unable to send Tic Tac Toe: ${error.message || String(error)}`)
    }
}

handler.command = ['tictacto', 'tttfun']

export default handler
