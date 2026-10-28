import { sendRichHtml } from '../../lib/richhtml.js'

const html = `<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html { background: #05060f; }
  html, body { min-height: 588px; background: #05060f;
    font-family: 'Courier New', monospace; touch-action: none; }
  body { display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 10px; padding: 16px 10px; min-height: 588px; }
  #hud { font-size: 14px !important; }
  #banner .big { font-size: 34px !important; }
  #banner .small, #hint { font-size: 13px !important; }
  #hud { display: flex; gap: 28px; color: #fff; font-weight: bold;
    font-size: clamp(13px, 2.4vh, 20px); letter-spacing: 1px; text-transform: uppercase; }
  #hud span { color: #ffe600; }
  #wrap { position: relative; }
  canvas { display: block; border-radius: 10px; box-shadow: 0 0 40px rgba(40,60,255,.35); background: #000; }
  #banner { position: absolute; inset: 0; display: none; align-items: center; justify-content: center;
    flex-direction: column; gap: 8px; background: rgba(0,0,10,.55); border-radius: 10px;
    color: #ffe600; font-weight: bold; text-align: center; pointer-events: none; }
  #banner .big { font-size: clamp(22px, 5vh, 44px); text-shadow: 0 0 18px currentColor; }
  #banner .small { font-size: clamp(12px, 2.4vh, 18px); color: #fff; }
  #hint { color: #8a8fb5; font-size: clamp(10px, 1.8vh, 14px); letter-spacing: 1px; }
  #pad { display: grid; grid-template-columns: repeat(3, 56px); grid-template-rows: repeat(2, 48px);
    gap: 6px; margin-top: 4px; }
  #pad button { background: rgba(45,55,180,.35); border: 2px solid #4a5aff; border-radius: 10px;
    color: #ffe600; font-size: 20px; font-weight: bold; cursor: pointer; user-select: none;
    -webkit-user-select: none; touch-action: none; }
  #pad button:active { background: rgba(90,107,255,.6); }
  #pad .up { grid-column: 2; grid-row: 1; }
  #pad .left { grid-column: 1; grid-row: 2; }
  #pad .down { grid-column: 2; grid-row: 2; }
  #pad .right { grid-column: 3; grid-row: 2; }
</style>
  <div id="hud">
    <div>Score <span id="score">0</span></div>
    <div>Round <span id="round">1</span></div>
    <div>Lives <span id="lives">3</span></div>
  </div>
  <div id="wrap">
    <canvas id="game"></canvas>
    <div id="banner"><div class="big" id="bannerBig"></div><div class="small" id="bannerSmall"></div></div>
  </div>
  <div id="pad">
    <button class="up" data-dir="0,-1" aria-label="Up">▲</button>
    <button class="left" data-dir="-1,0" aria-label="Left">◀</button>
    <button class="down" data-dir="0,1" aria-label="Down">▼</button>
    <button class="right" data-dir="1,0" aria-label="Right">▶</button>
  </div>
  <div id="hint">Hold arrow keys / WASD / arrow buttons to move — release to stop</div>

<script>
(() => {
  // ---------- Maze (21 cols x 23 rows). 0=wall, 1=pellet, 2=empty, 3=power ----------
  const COLS = 21, ROWS = 23;

  // ---------- Skins (randomized after every win) ----------
  const SKINS = [
    { wall:"#2b3bff", wallGlow:"#5a6bff", pac:"#ffe600", pellet:"#ffd9a0", bg:"#000010", ghosts:["#ff3b3b","#ffb8de","#00e8ff","#ffb847"] },
    { wall:"#00c853", wallGlow:"#4dff96", pac:"#ffffff", pellet:"#a7ffeb", bg:"#001008", ghosts:["#ff5252","#ffab40","#e040fb","#69f0ae"] },
    { wall:"#d500f9", wallGlow:"#ff6bff", pac:"#76ff03", pellet:"#f8bbd0", bg:"#0e0014", ghosts:["#ff1744","#ffea00","#18ffff","#ff9100"] },
    { wall:"#ff6d00", wallGlow:"#ffa040", pac:"#40c4ff", pellet:"#ffe082", bg:"#140800", ghosts:["#d50000","#64ffda","#eeff41","#ff80ab"] },
    { wall:"#00b8d4", wallGlow:"#62ebff", pac:"#ffab00", pellet:"#b2ebf2", bg:"#001418", ghosts:["#ff3d00","#c6ff00","#ff4081","#7c4dff"] },
    { wall:"#e8e8ff", wallGlow:"#ffffff", pac:"#ffe600", pellet:"#90caf9", bg:"#0a0a14", ghosts:["#ff1744","#f50057","#00b0ff","#ff6e40"] },
  ];

  // ---------- State ----------
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const scoreEl = document.getElementById("score"), roundEl = document.getElementById("round"), livesEl = document.getElementById("lives");
  const banner = document.getElementById("banner"), bannerBig = document.getElementById("bannerBig"), bannerSmall = document.getElementById("bannerSmall");

  let map = [], skin = SKINS[0], round = 1, score = 0, lives = 3;
  let pac, ghosts = [], pelletsLeft = 0;
  let state = "play"; // play | win | dead | gameover
  let stateTimer = 0, mouth = 0, frightenedTimer = 0, tick = 0, spawnGrace = 0;

  function resize() {
    const availW = Math.max(240, Math.min(600, (document.body.clientWidth || 380) - 20));
    const s = Math.max(12, Math.min(20, Math.floor(availW / COLS)));
    canvas.width = COLS * s; canvas.height = ROWS * s;
    canvas.style.width = (COLS * s) + 'px';
    canvas.style.height = (ROWS * s) + 'px';
    canvas.dataset.cell = s;
  }
  addEventListener("resize", resize); resize();
  const cell = () => +canvas.dataset.cell;

  // flood fill from pac spawn: every remaining pellet must be reachable
  function allReachable() {
    const seen = new Set(["10,20"]), q = [[10, 20]];
    while (q.length) {
      const [c, r] = q.pop();
      for (const [dc, dr] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nc = c + dc, nr = r + dr, k = nc + "," + nr;
        if (map[nr] && map[nr][nc] !== 0 && !seen.has(k)) { seen.add(k); q.push([nc, nr]); }
      }
    }
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++)
      if ((map[r][c] === 1 || map[r][c] === 3) && !seen.has(c + "," + r)) return false;
    return true;
  }

  // Maze generator: corridors are always exactly 1 grid cell wide,
  // so every block keeps one grid space from the next block (like the reference).
  function buildMap(extraCaps) {
    const HALF = Math.floor(COLS / 2); // carve the left half, then mirror it
    const protectedCell = (c, r) =>
      (r === 20 && c >= 8 && c <= 12) ||      // pac spawn corridor
      (r === 10 && c >= 9 && c <= 12) ||      // ghost home row
      (c === HALF && r >= 9 && r <= 20);      // center column linking both
    for (let attempt = 0; attempt < 40; attempt++) {
      map = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
      // depth-first carve on the odd-cell lattice of the left half
      const seen = new Set(["1,1"]);
      map[1][1] = 1;
      const stack = [[1, 1]];
      while (stack.length) {
        const [c, r] = stack[stack.length - 1];
        const nbrs = [];
        for (const [dc, dr] of [[2,0],[-2,0],[0,2],[0,-2]]) {
          const nc = c + dc, nr = r + dr;
          if (nc >= 1 && nc <= HALF - 1 && nr >= 1 && nr <= ROWS - 2 && !seen.has(nc + "," + nr))
            nbrs.push([nc, nr, dc, dr]);
        }
        if (!nbrs.length) { stack.pop(); continue; }
        const [nc, nr, dc, dr] = nbrs[(Math.random() * nbrs.length) | 0];
        map[r + dr / 2][c + dc / 2] = 1;
        map[nr][nc] = 1;
        seen.add(nc + "," + nr);
        stack.push([nc, nr]);
      }
      // mirror to the right half and join the halves with the center column
      for (let r = 1; r < ROWS - 1; r++)
        for (let c = 1; c < HALF; c++) map[r][COLS - 1 - c] = map[r][c];
      for (let r = 1; r < ROWS - 1; r++) map[r][HALF] = 1;
      // open a few extra loops so ghosts can circle around
      let loops = 0, guard = 0;
      while (loops < 8 && guard++ < 400) {
        const c = 1 + ((Math.random() * (COLS - 2)) | 0);
        const r = 1 + ((Math.random() * (ROWS - 2)) | 0);
        if (map[r][c] !== 0 || protectedCell(c, r)) continue;
        const h = map[r][c - 1] !== 0 && map[r][c + 1] !== 0;
        const v = map[r - 1][c] !== 0 && map[r + 1][c] !== 0;
        if (h || v) { map[r][c] = 1; loops++; }
      }
      // guaranteed open areas
      for (let c = 8; c <= 12; c++) map[20][c] = 1;
      for (let c = 9; c <= 12; c++) map[10][c] = 1;
      // no dead ends: every corridor cell must have at least two ways in/out.
      // open a wall next to each dead end, joining it to another corridor
      // (creates loops, never blocks anything)
      let removed = 0; guard = 0;
      let foundDeadEnd = true;
      while (foundDeadEnd && guard++ < 200) {
        foundDeadEnd = false;
        for (let r = 1; r < ROWS - 1; r++) for (let c = 1; c < COLS - 1; c++) {
          if (map[r][c] === 0 || protectedCell(c, r)) continue;
          const openDirs = [];
          for (const [dc, dr] of [[1,0],[-1,0],[0,1],[0,-1]])
            if (map[r + dr][c + dc] !== 0) openDirs.push([dc, dr]);
          if (openDirs.length === 1) {
            // try to open a wall cell that has corridor on its far side
            const [dc, dr] = openDirs[0];
            const walls = [[1,0],[-1,0],[0,1],[0,-1]]
              .filter(([wc, wr]) => !(wc === dc && wr === dr) &&
                !protectedCell(c + wc, r + wr) &&
                map[r + wr][c + wc] === 0 &&
                map[r + wr * 2] && map[r + wr * 2][c + wc * 2] !== 0 &&
                map[r + wr * 2][c + wc * 2] !== undefined);
            if (walls.length) {
              const [wc, wr] = walls[(Math.random() * walls.length) | 0];
              map[r + wr][c + wc] = 1;
              removed++;
            }
            foundDeadEnd = true;
          }
        }
      }
      if (allReachable()) break;
    }
    // power pellets at the four corners (nearest open cell)
    for (const [tc, tr] of [[1,1],[COLS-2,1],[1,ROWS-2],[COLS-2,ROWS-2]]) {
      let best = null, bd = 1e9;
      for (let r = 1; r < ROWS - 1; r++) for (let c = 1; c < COLS - 1; c++)
        if (map[r][c] === 1) {
          const d = Math.abs(c - tc) + Math.abs(r - tr);
          if (d < bd) { bd = d; best = [c, r]; }
        }
      if (best) map[best[1]][best[0]] = 3;
    }
    pelletsLeft = map.flat().filter(v => v === 1 || v === 3).length;
  }

  function spawnActors() {
    spawnGrace = 2.5;
    frightenedTimer = 0;
    pac = { x: 9, y: 20, dir: {x:0,y:0}, next: {x:0,y:0}, speed: 6.2 };
    const gDefs = [
      { c: 9, r: 10, color: 0 }, { c: 10, r: 10, color: 1 },
      { c: 11, r: 10, color: 2 }, { c: 12, r: 10, color: 3 },
    ];
    ghosts = gDefs.map((g, i) => ({
      x: g.c, y: g.r, homeC: g.c, homeR: g.r, color: g.color,
      dir: { x: 0, y: 0 }, speed: 5.0 + Math.min(round * 0.25, 2), eaten: false, id: i,
    }));
  }

  function newRound() {
    skin = SKINS[Math.floor(Math.random() * SKINS.length)];
    buildMap(Math.min(14 + (round - 1) * 10, 80)); // blocks grow more complex each win
    spawnActors();
    roundEl.textContent = round;
  }

  function startGame() {
    score = 0; lives = 3; round = 1;
    scoreEl.textContent = 0; livesEl.textContent = 3;
    newRound(); state = "play";
  }

  // ---------- Movement helpers ----------
  const passable = (c, r) => r >= 0 && r < ROWS && c >= 0 && c < COLS && map[r][c] !== 0;

  // Grid movement: walk cell-center to cell-center; decide direction only at centers.
  function advance(a, dt, speed, chooseDir) {
    let remaining = speed * dt;
    let guard = 8;
    while (remaining > 1e-6 && guard-- > 0) {
      if (a.tx === undefined || (a.x === a.tx && a.y === a.ty)) {
        if (a.tx !== undefined) { a.x = a.tx; a.y = a.ty; }
        const cx = Math.round(a.x), cy = Math.round(a.y);
        chooseDir(a, cx, cy);
        if ((!a.dir.x && !a.dir.y) || !passable(cx + a.dir.x, cy + a.dir.y)) {
          a.dir = { x: 0, y: 0 };
          a.tx = undefined;
          return;
        }
        a.tx = cx + a.dir.x; a.ty = cy + a.dir.y;
      }
      const d = Math.hypot(a.tx - a.x, a.ty - a.y);
      const move = Math.min(d, remaining);
      a.x += (a.tx - a.x) / d * move; a.y += (a.ty - a.y) / d * move;
      remaining -= move;
      if (Math.hypot(a.tx - a.x, a.ty - a.y) < 1e-4) { a.x = a.tx; a.y = a.ty; }
    }
  }

    function moveActor(a, dt) {
    advance(a, dt, a.speed, (actor, cx, cy) => {
      if (actor.next.x || actor.next.y) {
        if (passable(cx + actor.next.x, cy + actor.next.y)) actor.dir = { ...actor.next };
        else actor.dir = { x: 0, y: 0 };
      } else {
        actor.dir = { x: 0, y: 0 }; // no key held: stop at the next cell center
      }
    });
  }

  function ghostAI(g, dt) {
    const spd = g.eaten ? 9 : (frightenedTimer > 0 ? g.speed * 0.6 : g.speed);
    advance(g, dt, spd, (actor, cx, cy) => {
      const opts = [{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1}]
        .filter(d => passable(cx + d.x, cy + d.y) && !(d.x === -actor.dir.x && d.y === -actor.dir.y));
      const choices = opts.length ? opts : [{ x: -actor.dir.x, y: -actor.dir.y }];
      if (g.eaten) {
        // only when eaten do ghosts head somewhere specific: back home
        const target = { x: g.homeC, y: g.homeR };
        choices.sort((p, q) =>
          (Math.hypot(cx + p.x - target.x, cy + p.y - target.y)) -
          (Math.hypot(cx + q.x - target.x, cy + q.y - target.y)));
        actor.dir = choices[0];
        return;
      }
      // ghosts simply roam the maze; they never hunt Pac-Man
      const straight = choices.find(d => d.x === actor.dir.x && d.y === actor.dir.y);
      actor.dir = (straight && Math.random() < 0.6)
        ? straight
        : choices[Math.floor(Math.random() * choices.length)];
    });
    // reached home after being eaten
    if (g.eaten && Math.abs(g.x - g.homeC) < 0.4 && Math.abs(g.y - g.homeR) < 0.4) g.eaten = false;
  }

  // ---------- Update ----------
  function update(dt) {
    if (state !== "play") {
      stateTimer -= dt;
      if (stateTimer <= 0) {
        if (state === "win") { round++; banner.style.display = "none"; newRound(); state = "play"; }
        else if (state === "dead") { banner.style.display = "none"; spawnActors(); state = "play"; }
        else if (state === "gameover") { banner.style.display = "none"; startGame(); }
      }
      return;
    }

    tick += dt; mouth += dt * 10;
    if (frightenedTimer > 0) frightenedTimer -= dt;
    if (spawnGrace > 0) spawnGrace -= dt;

    moveActor(pac, dt, true);
    const pc = Math.round(pac.x), pr = Math.round(pac.y);
    if (Math.abs(pac.x - pc) < 0.2 && Math.abs(pac.y - pr) < 0.2) {
      const v = map[pr] && map[pr][pc];
      if (v === 1) { map[pr][pc] = 2; score += 10; pelletsLeft--; }
      else if (v === 3) { map[pr][pc] = 2; score += 50; pelletsLeft--; frightenedTimer = 6; }
      scoreEl.textContent = score;
      if (pelletsLeft <= 0) {
        state = "win"; stateTimer = 2.6;
        bannerBig.textContent = "YOU WIN!";
        bannerSmall.textContent = "New skin + more blocks incoming…";
        banner.style.display = "flex";
        return;
      }
    }

    for (const g of ghosts) {
      ghostAI(g, dt);
      const d = Math.hypot(g.x - pac.x, g.y - pac.y);
      if (d < 0.55 && !g.eaten && spawnGrace <= 0) {
        if (frightenedTimer > 0) { g.eaten = true; score += 200; scoreEl.textContent = score; }
        else {
          lives--; livesEl.textContent = lives;
          if (lives <= 0) {
            state = "gameover"; stateTimer = 3;
            bannerBig.textContent = "GAME OVER";
            bannerSmall.textContent = "Final score " + score + " — restarting…";
          } else {
            state = "dead"; stateTimer = 1.6;
            bannerBig.textContent = "OUCH!";
            bannerSmall.textContent = lives + (lives === 1 ? " life" : " lives") + " left";
          }
          banner.style.display = "flex";
          return;
        }
      }
    }
  }

  // ---------- Draw ----------
  function draw() {
    const s = cell();
    ctx.fillStyle = skin.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // walls
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (map[r][c] === 0) {
        ctx.fillStyle = skin.wall;
        ctx.fillRect(c * s, r * s, s, s);
        ctx.fillStyle = skin.wallGlow;
        ctx.fillRect(c * s + s * 0.18, r * s + s * 0.18, s * 0.64, s * 0.64);
        ctx.fillStyle = skin.wall;
        ctx.fillRect(c * s + s * 0.3, r * s + s * 0.3, s * 0.4, s * 0.4);
      } else if (map[r][c] === 1) {
        ctx.fillStyle = skin.pellet;
        ctx.beginPath();
        ctx.arc(c * s + s / 2, r * s + s / 2, s * 0.09, 0, 7);
        ctx.fill();
      } else if (map[r][c] === 3) {
        ctx.fillStyle = skin.pellet;
        ctx.beginPath();
        ctx.arc(c * s + s / 2, r * s + s / 2, s * (0.2 + 0.05 * Math.sin(tick * 6)), 0, 7);
        ctx.fill();
      }
    }

    // pac-man
    const px = pac.x * s + s / 2, py = pac.y * s + s / 2, rad = s * 0.42;
    const angle = Math.atan2(pac.dir.y, pac.dir.x);
    const m = (Math.abs(Math.sin(mouth)) * 0.35 + 0.05) * Math.PI;
    ctx.fillStyle = skin.pac;
    ctx.beginPath();
    ctx.moveTo(px, py);
    if (pac.dir.x || pac.dir.y) ctx.arc(px, py, rad, angle + m, angle - m + Math.PI * 2);
    else ctx.arc(px, py, rad, m, Math.PI * 2 - m);
    ctx.closePath(); ctx.fill();

    // ghosts
    for (const g of ghosts) {
      const gx = g.x * s + s / 2, gy = g.y * s + s / 2, gr = s * 0.4;
      let body = skin.ghosts[g.color];
      if (g.eaten) body = "rgba(120,120,160,0.4)";
      else if (frightenedTimer > 0) body = frightenedTimer < 2 && Math.floor(tick * 6) % 2 ? "#ffffff" : "#2233ff";
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.arc(gx, gy - gr * 0.15, gr, Math.PI, 0);
      const foot = gr / 3;
      for (let i = 0; i < 6; i++) {
        ctx.lineTo(gx + gr - (i * 2 + 1) * foot / 2 - foot / 2, gy + gr * 0.85 + (i % 2 ? -foot * 0.5 : 0));
      }
      ctx.closePath(); ctx.fill();
      // eyes
      const ex = g.dir.x * gr * 0.12, ey = g.dir.y * gr * 0.12;
      for (const side of [-1, 1]) {
        ctx.fillStyle = "#fff";
        ctx.beginPath(); ctx.arc(gx + side * gr * 0.35, gy - gr * 0.2, gr * 0.22, 0, 7); ctx.fill();
        ctx.fillStyle = "#1a2bff";
        ctx.beginPath(); ctx.arc(gx + side * gr * 0.35 + ex, gy - gr * 0.2 + ey, gr * 0.11, 0, 7); ctx.fill();
      }
    }
  }

  // ---------- Input (hold to move, release to stop) ----------
  const DIRS = { ArrowUp:{x:0,y:-1}, ArrowDown:{x:0,y:1}, ArrowLeft:{x:-1,y:0}, ArrowRight:{x:1,y:0},
    w:{x:0,y:-1}, s:{x:0,y:1}, a:{x:-1,y:0}, d:{x:1,y:0}, W:{x:0,y:-1}, S:{x:0,y:1}, A:{x:-1,y:0}, D:{x:1,y:0} };
  const held = new Set(); // direction keys currently held
  const keyName = k => ({ ArrowUp:"U", ArrowDown:"D", ArrowLeft:"L", ArrowRight:"R",
    w:"U", s:"D", a:"L", d:"R", W:"U", S:"D", A:"L", D:"R" })[k];
  const VEC = { U:{x:0,y:-1}, D:{x:0,y:1}, L:{x:-1,y:0}, R:{x:1,y:0} };
  function applyHeld() {
    const last = [...held].pop();
    pac.next = last ? { ...VEC[last] } : { x: 0, y: 0 };
  }
  addEventListener("keydown", e => {
    if (DIRS[e.key]) { const n = keyName(e.key); held.delete(n); held.add(n); applyHeld(); e.preventDefault(); }
  });
  addEventListener("keyup", e => {
    if (DIRS[e.key]) { held.delete(keyName(e.key)); applyHeld(); }
  });
  // on-screen arrow buttons
  for (const btn of document.querySelectorAll("#pad button")) {
    const [dx, dy] = btn.dataset.dir.split(",").map(Number);
    const press = e => { e.preventDefault(); pac.next = { x: dx, y: dy }; };
    const release = () => { pac.next = { x: 0, y: 0 }; };
    btn.addEventListener("pointerdown", press);
    btn.addEventListener("pointerup", release);
    btn.addEventListener("pointerleave", release);
    btn.addEventListener("pointercancel", release);
    btn.addEventListener("contextmenu", e => e.preventDefault());
  }

  // ---------- Loop ----------
  let last = performance.now();
  function loop(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    update(dt); draw();
    requestAnimationFrame(loop);
  }
  startGame();
  requestAnimationFrame(loop);
})();
</script>`

let handler = async (m, { EliteProTech }) => {
    try {
        await sendRichHtml(EliteProTech, m.chat, { id: 'elite-pacman', title: 'ELITE-PRO-V2 • PAC-MAN', html, source: 'eliteprotech' })
    } catch (error) {
        await m.reply(`Unable to send Pac-Man: ${error.message || String(error)}`)
    }
}

handler.command = ['pacman']

export default handler
