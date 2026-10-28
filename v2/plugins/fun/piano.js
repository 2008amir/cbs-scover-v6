import { sendRichHtml } from '../../lib/richhtml.js'

  

const html = `
<style>
*{
  box-sizing:border-box;
  -webkit-tap-highlight-color:transparent;
  user-select:none
}
  html {
    background: radial-gradient(ellipse at top, #2a1f6e 0%, #110d2e 60%, #070513 100%) #110d2e;
    min-height: 588px;
  }
  body {
    background: radial-gradient(ellipse at top, #2a1f6e 0%, #110d2e 60%, #070513 100%) #110d2e;
    min-height: 588px;
    margin: 0;
    color: #fff;
    font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    display: flex; align-items: center; justify-content: center;
    padding: 14px 10px; touch-action: manipulation;
  }
  .card {
    width: 100%; max-width: 620px; min-height: 518px;
    background: rgba(30, 23, 75, 0.92);
    border: 1px solid rgba(120, 110, 200, 0.25);
    border-radius: 28px;
    padding: 22px 18px 26px;
    box-shadow: 0 30px 80px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.08);
    display: flex; flex-direction: column; gap: 14px; justify-content: center;
  }
  header { text-align: left; }
  .kicker { font-size: 11px; letter-spacing: 4px; color: #a9a4d8; text-transform: uppercase; }
  h1 { font-size: 28px; font-weight: 800; margin: 6px 0 4px; letter-spacing: -0.5px; }
  .sub { color: #b8b3e6; font-size: 13px; }

  #board {
    position: relative;
    background: #0c0a1f;
    border-radius: 18px;
    padding: 10px;
    height: 260px;
    box-shadow: inset 0 4px 20px rgba(0,0,0,0.6);
    user-select: none;
  }

  .wk {
    position: absolute; top: 10px;
    background: linear-gradient(180deg, #ffffff 0%, #f2f0ff 85%, #e4e0f7 100%);
    border: 1px solid #c7c4df;
    border-radius: 0 0 10px 10px;
    display: flex; align-items: flex-end; justify-content: center;
    padding-bottom: 12px; color: #2e2c4a; font-weight: 700; font-size: 15px;
    cursor: pointer; transition: background .05s, transform .05s, box-shadow .05s;
    z-index: 1;
  }
  .wk .label { opacity: .45; font-size: 11px; margin-left: 4px; font-weight: 600; }
  .wk:hover { background: linear-gradient(180deg, #f8f5ff 0%, #e8e2ff 85%, #d9d0ff 100%); }
  .wk.on {
    background: linear-gradient(180deg, #b6a7ff 0%, #7d6af3 100%);
    color: #fff; transform: translateY(2px);
    box-shadow: 0 0 16px rgba(138, 120, 255, 0.7), inset 0 -2px 0 rgba(0,0,0,0.2);
  }

  .bk {
    position: absolute; top: 10px;
    background: linear-gradient(180deg, #302a55 0%, #16122e 85%, #0a0818 100%);
    border: 1px solid #1a1630;
    border-radius: 0 0 8px 8px;
    color: #e9e6ff; font-size: 11px; font-weight: 600;
    display: flex; align-items: flex-end; justify-content: center;
    padding-bottom: 9px; cursor: pointer; z-index: 3;
    transition: background .05s, transform .05s, box-shadow .05s;
  }
  .bk:hover { background: linear-gradient(180deg, #4c417d 0%, #251d42 100%); }
  .bk.on {
    background: linear-gradient(180deg, #9b87ff 0%, #5e4bd1 100%);
    color: #fff; transform: translateY(2px);
    box-shadow: 0 0 14px rgba(155, 135, 255, 0.7);
  }

  .controls {
    display: flex; gap: 10px; align-items: center; justify-content: center; flex-wrap: wrap;
  }
  .btn {
    background: linear-gradient(180deg, #5b4cd8 0%, #4537b8 100%);
    border: none; color: #fff; font-size: 14px; font-weight: 700;
    border-radius: 14px; padding: 13px 18px; cursor: pointer;
    transition: transform .08s, filter .15s, box-shadow .15s;
    box-shadow: 0 6px 18px rgba(69, 55, 184, 0.4);
  }
  .btn:hover { filter: brightness(1.12); }
  .btn:active { transform: scale(0.96); }
  .btn.secondary { background: linear-gradient(180deg, #332a6b 0%, #241c52 100%); box-shadow: none; }
  .readout {
    background: #151130; border: 1px solid rgba(120,110,200,0.2);
    border-radius: 16px; padding: 12px 20px; text-align: center;
    font-size: 18px; font-weight: 700; color: #d6d0ff; min-width: 70px;
  }

  .slider-wrap { display: flex; align-items: center; gap: 10px; color: #b8b3e6; font-size: 13px; }
  input[type=range] { accent-color: #7d6af3; width: 110px; }

  .hint { text-align: center; color: #a9a4d8; font-size: 12px; line-height: 1.5; }
  .hint b { color: #d6d0ff; }

  @media (max-width: 560px) {
    .card { padding: 16px 12px 20px; }
    h1 { font-size: 22px; }
    #board { height: 210px; }
    .readout { font-size: 15px; padding: 10px 14px; }
    .btn { padding: 11px 14px; font-size: 13px; }
    .wk { font-size: 13px; padding-bottom: 8px; }
    .bk { font-size: 10px; padding-bottom: 6px; }
  }
</style>
<div id="body">
<div class="card">
  <header>
    <div class="kicker">CBS-SCOVER</div>
    <h1>🎹 Piano</h1>
  </header>

  <div id="board"></div>

  <div class="controls">
    <button class="btn secondary" id="down">− Octave</button>
    <div class="readout" id="readout">Octave 4</div>
    <button class="btn secondary" id="up">+ Octave</button>
  </div>

  <div class="controls" style="gap:16px">
    <button class="btn" id="center">Center C4</button>
    <div class="slider-wrap">
      <span>V</span>
      <input type="range" id="volume" min="0" max="100" value="80">
    </div>
  </div>
</div>
</div>
<script>
const WHITE = ['C','D','E','F','G','A','B'];
const LETTERS = ['A','S','D','F','G','H','J'];
const BLACK = [
  ['C#', 0, 'W'], ['D#', 1, 'E'], ['F#', 3, 'T'],
  ['G#', 4, 'Y'], ['A#', 5, 'U']
];
const SEMI = { C:0, 'C#':1, D:2, 'D#':3, E:4, F:5, 'F#':6, G:7, 'G#':8, A:9, 'A#':10, B:11 };

let octave = 4;
let ctx = null;
let volume = 0.8;
const activeNotes = new Set();
const board = document.getElementById('board');
const readout = document.getElementById('readout');
const volumeEl = document.getElementById('volume');

function ensureAudio() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function freq(note, oct) {
  const midi = 12 * (oct + 1) + SEMI[note];
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function play(note, oct = octave) {
  ensureAudio();
  const f = freq(note, oct);
  const t = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.value = volume;
  master.connect(ctx.destination);

  const harmonics = [
    [1, 0.55], [2, 0.28], [3, 0.18], [4, 0.10], [5, 0.06], [6, 0.04]
  ];

  const release = 1.6;
  harmonics.forEach(([m, a]) => {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = m === 1 ? 'sine' : 'triangle';
    osc.frequency.value = f * m;

    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(a * 0.6, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0005, t + release);

    osc.connect(g);
    g.connect(master);
    osc.start(t);
    osc.stop(t + release + 0.05);
  });

  readout.textContent = note + oct;
  const el = [...board.children].find(c => c.dataset.note === note);
  if (el) {
    el.classList.add('on');
    setTimeout(() => el.classList.remove('on'), 180);
  }
  if (navigator.vibrate) navigator.vibrate(6);
}

function layout() {
  board.innerHTML = '';
  const w = board.clientWidth - 20;
  const h = board.clientHeight - 20;
  const ww = w / 7;

  WHITE.forEach((n, i) => {
    const el = document.createElement('div');
    el.className = 'wk';
    el.dataset.note = n;
    el.style.left = (10 + i * ww) + 'px';
    el.style.width = (ww - 2) + 'px';
    el.style.height = h + 'px';
    el.innerHTML = n + '<span class="label">' + LETTERS[i] + '</span>';
    board.appendChild(el);
  });

  BLACK.forEach(([n, i, k]) => {
    const el = document.createElement('div');
    el.className = 'bk';
    el.dataset.note = n;
    el.style.left = (10 + (i + 1) * ww - ww * 0.28) + 'px';
    el.style.width = (ww * 0.56) + 'px';
    el.style.height = (h * 0.62) + 'px';
    el.innerHTML = n + '<span class="label" style="margin-left:3px;opacity:.5">' + k + '</span>';
    board.appendChild(el);
  });
}

function setOctave(v) {
  octave = Math.max(0, Math.min(7, v));
  readout.textContent = 'Oct ' + octave;
}

function pointerPlay(e) {
  const n = e.target.dataset.note;
  if (n) play(n);
}

board.addEventListener('pointerdown', pointerPlay);
board.addEventListener('pointerover', e => {
  if (e.buttons && e.target.dataset.note) play(e.target.dataset.note);
});

board.addEventListener('touchstart', e => {
  e.preventDefault();
  const n = e.target.dataset.note;
  if (n) play(n);
}, { passive: false });

document.getElementById('up').onclick = () => setOctave(octave + 1);
document.getElementById('down').onclick = () => setOctave(octave - 1);
document.getElementById('center').onclick = () => setOctave(4);
volumeEl.oninput = () => { volume = parseInt(volumeEl.value, 10) / 100; };

window.addEventListener('keydown', e => {
  if (e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
  const k = e.key.toUpperCase();
  if (k === 'Z') { e.preventDefault(); return setOctave(octave - 1); }
  if (k === 'X') { e.preventDefault(); return setOctave(octave + 1); }
  const wi = LETTERS.indexOf(k);
  if (wi > -1) { e.preventDefault(); return play(WHITE[wi]); }
  const b = BLACK.find(x => x[2] === k);
  if (b) { e.preventDefault(); return play(b[0]); }
});

window.addEventListener('resize', layout);
layout();
readout.textContent = 'Oct ' + octave;

// Allow triggering a note from URL query, e.g. ?play=C4
const params = new URLSearchParams(location.search);
if (params.has('play')) {
  const n = params.get('play').toUpperCase();
  const match = n.match(/^([A-G]#?)(\d)$/);
  if (match) setTimeout(() => play(match[1], parseInt(match[2], 10)), 600);
}
  </script>
`;
let handler = async (m, { EliteProTech }) => {
    try {
        await sendRichHtml(EliteProTech, m.chat, { id: 'elite-piano', title: 'ELITE-PRO-V2 • PIANO', html, source: 'eliteprotech' })
    } catch (error) {
        await m.reply(`Unable to send Piano: ${error.message || String(error)}`)
    }
}

handler.command = ['piano']

export default handler

