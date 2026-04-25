/* ==========================================================
   Hava sahası — CMA-ES ile öğrenen uçak demosu
   Sadece /api/airfield-cma yanıtını kare kare oynatır.
   ========================================================== */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const els = {
    canvas: $("airfieldCanvas"),
    start: $("airfieldStart"),
    pause: $("airfieldPause"),
    reset: $("airfieldReset"),
    difficulty: $("airfieldDifficulty"),
    seed: $("airfieldSeed"),
    iter: $("airfieldIter"),
    speed: $("airfieldSpeed"),
    genFill: $("airfieldGenFill"),
    genLabel: $("airfieldGenLabel"),
    stepFill: $("airfieldStepFill"),
    stepLabel: $("airfieldStepLabel"),
    statIter: $("afStatIter"),
    statBest: $("afStatBest"),
    statCur: $("afStatCur"),
    statSigma: $("afStatSigma"),
    statReached: $("afStatReached"),
    statPop: $("afStatPop"),
    statEval: $("afStatEval"),
    nn: $("airfieldNN"),
    spark: $("airfieldSpark"),
    status: $("airfieldStatus"),
  };

  if (!els.canvas) return;

  const state = {
    data: null,
    currentGen: 0,
    stepFloat: 0,
    running: false,
    autoAdvance: true,
    loopHandle: 0,
    lastTs: 0,
    bestEvalSoFar: Infinity,
  };

  // ------------------------------------------------------------
  // Canvas high-DPI setup
  // ------------------------------------------------------------
  const ctx = els.canvas.getContext("2d");
  let dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));

  function resizeCanvas() {
    const rect = els.canvas.getBoundingClientRect();
    const cssW = Math.max(320, Math.round(rect.width));
    const cssH = Math.max(220, Math.round(rect.height));
    dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
    els.canvas.width = Math.round(cssW * dpr);
    els.canvas.height = Math.round(cssH * dpr);
    render();
  }
  window.addEventListener("resize", resizeCanvas, { passive: true });

  // ------------------------------------------------------------
  // World-to-pixel mapping. World is [0, worldW] x [0, worldH].
  // The play area is padded inside the canvas; we fit-contain.
  // ------------------------------------------------------------
  function getViewport() {
    const cw = els.canvas.width;
    const ch = els.canvas.height;
    const pad = Math.round(18 * dpr);
    const availW = cw - 2 * pad;
    const availH = ch - 2 * pad;
    const worldW = state.data?.map?.bounds?.[1]?.[0] ?? 1.5;
    const worldH = state.data?.map?.bounds?.[1]?.[1] ?? 1.0;
    const scale = Math.min(availW / worldW, availH / worldH);
    const drawW = worldW * scale;
    const drawH = worldH * scale;
    const ox = (cw - drawW) / 2;
    const oy = (ch - drawH) / 2;
    return { ox, oy, scale, drawW, drawH, worldW, worldH, dpr: dpr };
  }

  const W2P = (v, x, y) => [v.ox + x * v.scale, v.oy + (v.worldH - y) * v.scale];

  /** Parse rgba(...) / rgb(...) → {r,g,b,a}; fallback white */
  function parseColor(s) {
    const m = String(s).match(/rgba?\(\s*([^)]+)\s*\)/i);
    if (!m) return { r: 210, g: 225, b: 255, a: 1 };
    const p = m[1].split(",").map((x) => parseFloat(x.trim()));
    return {
      r: p[0] ?? 255,
      g: p[1] ?? 255,
      b: p[2] ?? 255,
      a: p.length > 3 ? p[3] : 1,
    };
  }

  function shadeColor(s, dr, dg, db) {
    const c = parseColor(s);
    const r = Math.min(255, Math.max(0, Math.round(c.r + dr)));
    const g = Math.min(255, Math.max(0, Math.round(c.g + dg)));
    const b = Math.min(255, Math.max(0, Math.round(c.b + db)));
    return `rgba(${r},${g},${b},${c.a})`;
  }

  /** Deterministic 0..1 from obstacle index + salt */
  function obstacleRand(seed, salt) {
    let h = (seed + 1) * 374761393 + (salt + 1) * 668265263;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h >>> 0) % 1000000) / 1000000;
  }

  /** Kümülüs bulut kümesi — fiziksel çarpışma dairesiyle uyumlu görsel */
  function drawCumulusCloud(px, py, radiusPx, variant) {
    const puff = (ox, oy, rr, bright) => {
      const g = ctx.createRadialGradient(
        px + ox,
        py + oy,
        rr * 0.15,
        px + ox,
        py + oy,
        rr
      );
      if (bright) {
        g.addColorStop(0, "rgba(255, 255, 255, 0.95)");
        g.addColorStop(0.45, "rgba(232, 242, 255, 0.72)");
        g.addColorStop(1, "rgba(140, 170, 210, 0.08)");
      } else {
        g.addColorStop(0, "rgba(245, 250, 255, 0.88)");
        g.addColorStop(0.5, "rgba(190, 210, 235, 0.45)");
        g.addColorStop(1, "rgba(70, 95, 130, 0.12)");
      }
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(px + ox, py + oy, rr, 0, Math.PI * 2);
      ctx.fill();
    };

    ctx.save();
    const shOx = radiusPx * 0.07;
    const shOy = radiusPx * 0.11;
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = "rgba(8, 14, 28, 0.55)";
    ctx.beginPath();
    ctx.ellipse(px + shOx, py + shOy, radiusPx * 0.94, radiusPx * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    const layers = [
      [0, -radiusPx * 0.06, radiusPx * 0.72, true],
      [-radiusPx * 0.42, radiusPx * 0.08, radiusPx * 0.52, false],
      [radiusPx * 0.38, radiusPx * 0.12, radiusPx * 0.48, false],
      [-radiusPx * 0.22, -radiusPx * 0.26, radiusPx * 0.42, true],
      [radiusPx * 0.18, -radiusPx * 0.2, radiusPx * 0.4, true],
      [0, radiusPx * 0.28, radiusPx * 0.44, false],
      [-radiusPx * 0.52, -radiusPx * 0.05, radiusPx * 0.38, false],
      [radiusPx * 0.52, -radiusPx * 0.08, radiusPx * 0.36, false],
    ];
    for (let i = 0; i < layers.length; i++) {
      const jitter = radiusPx * 0.06 * (obstacleRand(variant, i * 7) - 0.5);
      const [ox0, oy0, rr0, br] = layers[i];
      puff(ox0 + jitter, oy0 + jitter * 0.5, rr0 * (0.92 + obstacleRand(variant, i + 30) * 0.12), br);
    }

    ctx.strokeStyle = "rgba(180, 205, 235, 0.35)";
    ctx.lineWidth = 1.25 * dpr;
    ctx.setLineDash([5 * dpr, 4 * dpr]);
    ctx.beginPath();
    ctx.arc(px, py, radiusPx * 0.98, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // ------------------------------------------------------------
  // Rendering
  // ------------------------------------------------------------
  function clearCanvas() {
    ctx.save();
    ctx.fillStyle = "#060b1d";
    ctx.fillRect(0, 0, els.canvas.width, els.canvas.height);
    ctx.restore();
  }

  function drawBackground(v) {
    // outer world rect
    ctx.save();
    const grad = ctx.createLinearGradient(v.ox, v.oy, v.ox, v.oy + v.drawH);
    grad.addColorStop(0, "rgba(36, 74, 138, 0.35)");
    grad.addColorStop(1, "rgba(10, 18, 40, 0.55)");
    ctx.fillStyle = grad;
    ctx.fillRect(v.ox, v.oy, v.drawW, v.drawH);

    // grid
    ctx.strokeStyle = "rgba(120, 180, 255, 0.10)";
    ctx.lineWidth = 1 * v.dpr;
    const gridStep = 0.1;
    for (let x = 0; x <= v.worldW + 1e-9; x += gridStep) {
      const [px] = W2P(v, x, 0);
      ctx.beginPath();
      ctx.moveTo(px, v.oy);
      ctx.lineTo(px, v.oy + v.drawH);
      ctx.stroke();
    }
    for (let y = 0; y <= v.worldH + 1e-9; y += gridStep) {
      const [, py] = W2P(v, 0, y);
      ctx.beginPath();
      ctx.moveTo(v.ox, py);
      ctx.lineTo(v.ox + v.drawW, py);
      ctx.stroke();
    }

    // border
    ctx.strokeStyle = "rgba(120, 180, 255, 0.55)";
    ctx.lineWidth = 1.5 * v.dpr;
    ctx.strokeRect(v.ox, v.oy, v.drawW, v.drawH);
    ctx.restore();
  }

  function drawObstacles(v) {
    const obs = state.data?.map?.obstacles || [];
    ctx.save();
    obs.forEach((o, idx) => {
      const [px, py] = W2P(v, o.c[0], o.c[1]);
      const r = o.r * v.scale;
      drawCumulusCloud(px, py, r, idx);
    });
    ctx.restore();
  }

  function drawGoal(v) {
    const g = state.data?.map?.goal;
    if (!g) return;
    const [px, py] = W2P(v, g.center[0], g.center[1]);
    const r = g.radius * v.scale;
    const w = v.dpr;
    ctx.save();
    const grad = ctx.createRadialGradient(px, py, r * 0.12, px, py, r);
    grad.addColorStop(0, "rgba(95, 210, 150, 0.55)");
    grad.addColorStop(0.65, "rgba(35, 95, 65, 0.22)");
    grad.addColorStop(1, "rgba(20, 55, 40, 0.06)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();

    // Pist çizgisi (iniş şeridi)
    ctx.strokeStyle = "rgba(220, 255, 235, 0.75)";
    ctx.lineWidth = 2.2 * w;
    ctx.setLineDash([r * 0.22, r * 0.14]);
    ctx.beginPath();
    ctx.moveTo(px - r * 0.75, py);
    ctx.lineTo(px + r * 0.75, py);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = "rgba(160, 255, 200, 0.9)";
    ctx.lineWidth = 1.5 * w;
    ctx.beginPath();
    ctx.arc(px, py, r * 0.98, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = "rgba(230, 255, 240, 0.95)";
    ctx.font = `${11 * w}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("RWY", px, py - r * 0.35);
    ctx.font = `${10 * w}px system-ui, sans-serif`;
    ctx.fillStyle = "rgba(200, 240, 215, 0.75)";
    ctx.fillText("▼ iniş", px, py + r * 0.28);
    ctx.restore();
  }

  function drawStart(v) {
    const s = state.data?.map?.start;
    if (!s) return;
    const [px, py] = W2P(v, s[0], s[1]);
    ctx.save();
    ctx.fillStyle = "rgba(120, 180, 255, 0.55)";
    ctx.beginPath();
    ctx.arc(px, py, 6 * v.dpr, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(180, 220, 255, 0.85)";
    ctx.lineWidth = 1.5 * v.dpr;
    ctx.stroke();
    ctx.restore();
  }

  function clampTrajIndex(traj, step) {
    if (!traj || !traj.length) return -1;
    return Math.min(traj.length - 1, Math.max(0, step));
  }

  /**
   * Üstten bakış yolcu uçağı: gövde, kanat, motor gondolaları, yatay/ dikey kuyruk.
   * +X uçuş yönü (burun). heading simülasyonla uyumlu.
   */
  function drawPlane(v, x, y, heading, scale, color, alpha) {
    const [px, py] = W2P(v, x, y);
    const L = 12.5 * v.dpr * scale;
    const w = v.dpr;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(px, py);
    ctx.rotate(-heading);

    const body = color;
    const wing = shadeColor(color, -18, -12, -8);
    const dark = shadeColor(color, -32, -28, -24);
    const light = shadeColor(color, 22, 18, 12);

    // Gölge
    ctx.save();
    ctx.globalAlpha = alpha * 0.4;
    ctx.fillStyle = "rgba(0, 8, 24, 0.45)";
    ctx.beginPath();
    ctx.ellipse(1.5 * w, 2.2 * w, L * 0.58, L * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Ana kanat
    ctx.fillStyle = wing;
    ctx.beginPath();
    const wx = -L * 0.1;
    ctx.moveTo(wx - L * 0.04, -L * 0.5);
    ctx.lineTo(wx + L * 0.3, -L * 0.44);
    ctx.lineTo(wx + L * 0.34, L * 0.44);
    ctx.lineTo(wx - L * 0.04, L * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.22)";
    ctx.lineWidth = 1 * w;
    ctx.stroke();

    // Kanat altı motor gondolaları (üstten bakış)
    for (const sy of [-1, 1]) {
      ctx.fillStyle = dark;
      ctx.beginPath();
      ctx.ellipse(-L * 0.02, sy * L * 0.44, L * 0.11, L * 0.065, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(40, 45, 55, 0.92)";
      ctx.beginPath();
      ctx.ellipse(-L * 0.1, sy * L * 0.44, L * 0.042, L * 0.052, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Gövde
    const fus = ctx.createLinearGradient(L * 0.55, 0, -L * 0.58, 0);
    fus.addColorStop(0, light);
    fus.addColorStop(0.42, body);
    fus.addColorStop(1, dark);
    ctx.fillStyle = fus;
    ctx.beginPath();
    ctx.ellipse(0, 0, L * 0.5, L * 0.125, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.42)";
    ctx.lineWidth = 1.15 * w;
    ctx.stroke();

    // Burun / kokpit camı
    ctx.fillStyle = "rgba(140, 185, 235, 0.88)";
    ctx.beginPath();
    ctx.ellipse(L * 0.4, 0, L * 0.09, L * 0.062, 0, 0, Math.PI * 2);
    ctx.fill();

    // Yatay stabilizör
    ctx.fillStyle = wing;
    ctx.beginPath();
    ctx.moveTo(-L * 0.46, -L * 0.2);
    ctx.lineTo(-L * 0.38, -L * 0.16);
    ctx.lineTo(-L * 0.38, L * 0.16);
    ctx.lineTo(-L * 0.46, L * 0.2);
    ctx.closePath();
    ctx.fill();

    // Dikey stabilizör (üstten ince gövde)
    ctx.fillStyle = shadeColor(color, -26, -22, -18);
    ctx.beginPath();
    ctx.moveTo(-L * 0.52, 0);
    ctx.lineTo(-L * 0.68, -L * 0.07);
    ctx.lineTo(-L * 0.78, 0);
    ctx.lineTo(-L * 0.68, L * 0.07);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  function drawTrail(v, traj, stepIdx, color, alpha, width) {
    if (!traj || traj.length < 2) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = width * v.dpr;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    const end = clampTrajIndex(traj, stepIdx);
    for (let i = 0; i <= end; i++) {
      const [px, py] = W2P(v, traj[i][0], traj[i][1]);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.restore();
  }

  function render() {
    clearCanvas();
    if (!state.data) {
      drawPlaceholder();
      return;
    }
    const v = getViewport();
    drawBackground(v);
    drawObstacles(v);
    drawGoal(v);
    drawStart(v);

    const gen = state.data.generations[state.currentGen];
    if (!gen) return;

    const step = Math.floor(state.stepFloat);
    const trajs = gen.trajectories;
    const statuses = gen.statuses;
    const bestIdx = gen.best_idx;

    // Non-best trails + planes
    for (let i = 0; i < trajs.length; i++) {
      if (i === bestIdx) continue;
      const traj = trajs[i];
      const idx = clampTrajIndex(traj, step);
      if (idx < 0) continue;
      const [x, y, h] = traj[idx];
      const finished = step >= traj.length - 1;
      const status = statuses[i];

      // trail
      const trailColor =
        status === "goal"
          ? "rgba(120,255,180,0.35)"
          : status === "crash"
          ? "rgba(255,120,140,0.22)"
          : "rgba(150,190,255,0.22)";
      drawTrail(v, traj, step, trailColor, 0.85, 1.1);

      // marker at final position for finished ones
      if (finished) {
        const markColor =
          status === "goal"
            ? "rgba(120,255,180,0.95)"
            : status === "crash"
            ? "rgba(255,120,140,0.85)"
            : "rgba(200,160,255,0.75)";
        drawPlane(v, x, y, h, 0.85, markColor, 0.75);
      } else {
        drawPlane(v, x, y, h, 0.85, "rgba(170, 210, 255, 0.9)", 0.92);
      }
    }

    // Best individual on top, with thicker trail
    if (trajs[bestIdx]) {
      const bt = trajs[bestIdx];
      drawTrail(v, bt, step, "rgba(255, 210, 90, 0.55)", 1, 2.4);
      const idx = clampTrajIndex(bt, step);
      const [x, y, h] = bt[idx];
      // halo
      const [px, py] = W2P(v, x, y);
      ctx.save();
      const halo = ctx.createRadialGradient(px, py, 2 * v.dpr, px, py, 18 * v.dpr);
      halo.addColorStop(0, "rgba(255, 235, 140, 0.55)");
      halo.addColorStop(1, "rgba(255, 235, 140, 0)");
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(px, py, 18 * v.dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      drawPlane(v, x, y, h, 1.3, "rgba(255, 210, 90, 1)", 1);
    }

    // Top-left overlay: generation & step
    drawOverlay(v, gen, step);
  }

  function drawOverlay(v, gen, step) {
    ctx.save();
    ctx.fillStyle = "rgba(10, 20, 44, 0.78)";
    ctx.strokeStyle = "rgba(140, 180, 255, 0.35)";
    ctx.lineWidth = 1 * v.dpr;
    const x = v.ox + 10 * v.dpr;
    const y = v.oy + 10 * v.dpr;
    const w = 220 * v.dpr;
    const h = 48 * v.dpr;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 8 * v.dpr);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "rgba(210, 230, 255, 0.95)";
    ctx.font = `${12 * v.dpr}px system-ui, sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    const total = state.data.generations.length;
    const maxStep = state.data.config.max_steps;
    ctx.fillText(
      `Jenerasyon ${gen.iter} / ${total}`,
      x + 10 * v.dpr,
      y + 8 * v.dpr
    );
    ctx.fillStyle = "rgba(255, 210, 90, 0.95)";
    ctx.fillText(
      `best: ${gen.best_f.toFixed(1)} · ulaşan: ${gen.reached}/${gen.pop_size}`,
      x + 10 * v.dpr,
      y + 26 * v.dpr
    );
    ctx.restore();
  }

  function drawPlaceholder() {
    const cw = els.canvas.width;
    const ch = els.canvas.height;
    ctx.save();
    ctx.fillStyle = "rgba(200, 220, 255, 0.55)";
    ctx.font = `${14 * dpr}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(
      "▶ Başlat'a basın — CMA-ES uçakları eğitsin.",
      cw / 2,
      ch / 2
    );
    ctx.restore();
  }

  // ------------------------------------------------------------
  // Neural network visualization (SVG)
  // ------------------------------------------------------------
  const NN_IN = 8;
  const NN_HID = 8;
  const NN_OUT = 1;
  const NN_N = NN_IN * NN_HID + NN_HID + NN_HID * NN_OUT + NN_OUT; // 81

  function unpackTheta(theta) {
    let i = 0;
    const W1 = [];
    for (let r = 0; r < NN_HID; r++) {
      const row = [];
      for (let c = 0; c < NN_IN; c++) row.push(theta[i++]);
      W1.push(row);
    }
    const b1 = theta.slice(i, i + NN_HID);
    i += NN_HID;
    const W2 = [];
    for (let r = 0; r < NN_OUT; r++) {
      const row = [];
      for (let c = 0; c < NN_HID; c++) row.push(theta[i++]);
      W2.push(row);
    }
    const b2 = theta.slice(i, i + NN_OUT);
    return { W1, b1, W2, b2 };
  }

  function renderNN(theta) {
    if (!els.nn) return;
    const svg = els.nn;
    // clear
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (!theta || theta.length !== NN_N) return;
    const { W1, W2 } = unpackTheta(theta);

    const vbW = 300;
    const vbH = 200;
    const padL = 20;
    const padR = 20;
    const padT = 14;
    const padB = 14;
    const colX = [
      padL,
      padL + (vbW - padL - padR) * 0.5,
      vbW - padR,
    ];
    const layerCount = [NN_IN, NN_HID, NN_OUT];
    const positions = layerCount.map((n, li) => {
      const usableH = vbH - padT - padB;
      const ys =
        n === 1
          ? [vbH / 2]
          : Array.from({ length: n }, (_, k) => padT + (usableH * k) / (n - 1));
      return ys.map((y) => ({ x: colX[li], y }));
    });

    // max |w| for normalization
    let maxAbs = 0;
    for (const row of W1) for (const w of row) maxAbs = Math.max(maxAbs, Math.abs(w));
    for (const row of W2) for (const w of row) maxAbs = Math.max(maxAbs, Math.abs(w));
    if (maxAbs < 1e-6) maxAbs = 1;

    const ns = "http://www.w3.org/2000/svg";

    // connections input -> hidden
    for (let h = 0; h < NN_HID; h++) {
      for (let i2 = 0; i2 < NN_IN; i2++) {
        const w = W1[h][i2];
        const a = Math.abs(w) / maxAbs;
        if (a < 0.04) continue;
        const line = document.createElementNS(ns, "line");
        line.setAttribute("x1", positions[0][i2].x);
        line.setAttribute("y1", positions[0][i2].y);
        line.setAttribute("x2", positions[1][h].x);
        line.setAttribute("y2", positions[1][h].y);
        line.setAttribute(
          "stroke",
          w >= 0 ? "rgba(120, 220, 255,"
                 : "rgba(255, 140, 170,"
        );
        line.setAttribute("stroke", (w >= 0 ? `rgba(120,220,255,${(0.15 + 0.7 * a).toFixed(3)})`
                                            : `rgba(255,140,170,${(0.15 + 0.7 * a).toFixed(3)})`));
        line.setAttribute("stroke-width", (0.4 + 2.2 * a).toFixed(2));
        svg.appendChild(line);
      }
    }
    // connections hidden -> output
    for (let o = 0; o < NN_OUT; o++) {
      for (let h = 0; h < NN_HID; h++) {
        const w = W2[o][h];
        const a = Math.abs(w) / maxAbs;
        if (a < 0.04) continue;
        const line = document.createElementNS(ns, "line");
        line.setAttribute("x1", positions[1][h].x);
        line.setAttribute("y1", positions[1][h].y);
        line.setAttribute("x2", positions[2][o].x);
        line.setAttribute("y2", positions[2][o].y);
        line.setAttribute("stroke", w >= 0 ? `rgba(120,220,255,${(0.15 + 0.7 * a).toFixed(3)})`
                                           : `rgba(255,140,170,${(0.15 + 0.7 * a).toFixed(3)})`);
        line.setAttribute("stroke-width", (0.6 + 2.6 * a).toFixed(2));
        svg.appendChild(line);
      }
    }

    // nodes
    const nodeColors = ["#9bc6ff", "#ffd86b", "#7cffcb"];
    positions.forEach((layer, li) => {
      for (const p of layer) {
        const c = document.createElementNS(ns, "circle");
        c.setAttribute("cx", p.x);
        c.setAttribute("cy", p.y);
        c.setAttribute("r", li === 2 ? 6 : 5);
        c.setAttribute("fill", "rgba(10, 20, 44, 0.9)");
        c.setAttribute("stroke", nodeColors[li]);
        c.setAttribute("stroke-width", "1.4");
        svg.appendChild(c);
      }
    });

    // layer labels
    const labels = [
      { x: colX[0], y: vbH - 2, t: "girdi (8)" },
      { x: colX[1], y: vbH - 2, t: "gizli (8, tanh)" },
      { x: colX[2], y: vbH - 2, t: "dönüş" },
    ];
    for (const lb of labels) {
      const t = document.createElementNS(ns, "text");
      t.setAttribute("x", lb.x);
      t.setAttribute("y", lb.y);
      t.setAttribute("fill", "rgba(200, 220, 255, 0.75)");
      t.setAttribute("font-size", "9");
      t.setAttribute("text-anchor", "middle");
      t.textContent = lb.t;
      svg.appendChild(t);
    }
  }

  // ------------------------------------------------------------
  // Sparkline: best_f and mean_f vs generation
  // ------------------------------------------------------------
  function renderSpark(upToGenIdx) {
    const cv = els.spark;
    if (!cv) return;
    const cctx = cv.getContext("2d");
    const rect = cv.getBoundingClientRect();
    const cssW = Math.max(180, Math.round(rect.width));
    const cssH = Math.max(60, Math.round(rect.height));
    const dp = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
    if (cv.width !== cssW * dp || cv.height !== cssH * dp) {
      cv.width = cssW * dp;
      cv.height = cssH * dp;
    }
    const W = cv.width, H = cv.height;
    cctx.clearRect(0, 0, W, H);
    // background
    cctx.fillStyle = "rgba(10, 18, 40, 0.55)";
    cctx.fillRect(0, 0, W, H);

    if (!state.data) return;
    const gens = state.data.generations.slice(0, upToGenIdx + 1);
    if (gens.length === 0) return;

    const bests = gens.map((g) => g.best_so_far_f);
    const means = gens.map((g) => g.mean_f);
    const lo = Math.min(...bests, ...means);
    const hi = Math.max(...bests, ...means);
    const padX = 8 * dp;
    const padY = 10 * dp;
    const plotW = W - 2 * padX;
    const plotH = H - 2 * padY;
    const span = Math.max(1e-6, hi - lo);
    const total = state.data.generations.length;

    function plot(values, color, width) {
      cctx.strokeStyle = color;
      cctx.lineWidth = width * dp;
      cctx.lineJoin = "round";
      cctx.lineCap = "round";
      cctx.beginPath();
      for (let i = 0; i < values.length; i++) {
        const x = padX + (total > 1 ? (i / (total - 1)) * plotW : plotW / 2);
        const y = padY + plotH - ((values[i] - lo) / span) * plotH;
        if (i === 0) cctx.moveTo(x, y);
        else cctx.lineTo(x, y);
      }
      cctx.stroke();
    }

    plot(means, "rgba(160, 200, 255, 0.45)", 1.2);
    plot(bests, "rgba(255, 210, 90, 0.95)", 1.8);

    // axis labels
    cctx.fillStyle = "rgba(200, 220, 255, 0.75)";
    cctx.font = `${10 * dp}px system-ui, sans-serif`;
    cctx.textAlign = "left";
    cctx.textBaseline = "top";
    cctx.fillText(`best: ${bests[bests.length - 1].toFixed(1)}`, 6 * dp, 4 * dp);
    cctx.textAlign = "right";
    cctx.fillText(`σ ~ ${gens[gens.length - 1].sigma.toFixed(3)}`, W - 6 * dp, 4 * dp);
  }

  // ------------------------------------------------------------
  // Sidebar stat updates
  // ------------------------------------------------------------
  function updateStats() {
    if (!state.data) return;
    const g = state.data.generations[state.currentGen];
    const s = state.data.summary;
    els.statIter.textContent = `${g.iter}/${state.data.generations.length}`;
    els.statBest.textContent = isFinite(g.best_so_far_f)
      ? g.best_so_far_f.toFixed(2)
      : "—";
    els.statCur.textContent = g.best_f.toFixed(2);
    els.statSigma.textContent = g.sigma.toFixed(3);
    els.statReached.textContent = `${g.reached}/${g.pop_size}`;
    els.statPop.textContent = g.pop_size;
    els.statEval.textContent = s.n_eval;
  }

  function updateProgress() {
    if (!state.data) return;
    const total = state.data.generations.length;
    const gPct = ((state.currentGen + 1) / total) * 100;
    els.genFill.style.width = `${gPct.toFixed(1)}%`;
    els.genLabel.textContent = `Jenerasyon ${state.currentGen + 1} / ${total}`;

    const gen = state.data.generations[state.currentGen];
    const maxStep = Math.max(...gen.trajectories.map((t) => t.length - 1));
    const sPct = Math.min(100, (state.stepFloat / Math.max(1, maxStep)) * 100);
    els.stepFill.style.width = `${sPct.toFixed(1)}%`;
    els.stepLabel.textContent = `Adım ${Math.floor(state.stepFloat)} / ${maxStep}`;
  }

  function applyGenSnapshot() {
    if (!state.data) return;
    const gen = state.data.generations[state.currentGen];
    renderNN(gen.best_theta);
    renderSpark(state.currentGen);
    updateStats();
    updateProgress();
  }

  // ------------------------------------------------------------
  // Animation loop
  // ------------------------------------------------------------
  function maxStepForGen(gen) {
    let m = 0;
    for (const t of gen.trajectories) m = Math.max(m, t.length - 1);
    return m;
  }

  function tick(ts) {
    if (!state.running || !state.data) return;
    if (!state.lastTs) state.lastTs = ts;
    const dt = Math.min(0.1, (ts - state.lastTs) / 1000);
    state.lastTs = ts;

    const speedMul = parseFloat(els.speed.value || "3");
    // stepsPerSecond scales with speed slider (1..6 → ~6..36 steps/s)
    const stepsPerSec = 6 + 5 * (speedMul - 1);
    state.stepFloat += stepsPerSec * dt;

    const gen = state.data.generations[state.currentGen];
    const endStep = maxStepForGen(gen);

    if (state.stepFloat >= endStep + 2) {
      // advance generation
      if (state.currentGen < state.data.generations.length - 1) {
        state.currentGen += 1;
        state.stepFloat = 0;
        applyGenSnapshot();
      } else {
        // playback finished
        stopLoop();
        setStatus(
          `Eğitim bitti. En iyi skor: ${state.data.summary.best_f.toFixed(2)} adım. ` +
          `Son jenerasyonda ulaşan: ${state.data.summary.reached_last}/${state.data.generations[state.data.generations.length - 1].pop_size}.`,
          "ok"
        );
        els.reset.disabled = false;
        els.pause.disabled = true;
        els.start.disabled = false;
        return;
      }
    }

    render();
    updateProgress();
    state.loopHandle = requestAnimationFrame(tick);
  }

  function startLoop() {
    if (state.running) return;
    state.running = true;
    state.lastTs = 0;
    els.pause.disabled = false;
    state.loopHandle = requestAnimationFrame(tick);
  }

  function stopLoop() {
    state.running = false;
    if (state.loopHandle) cancelAnimationFrame(state.loopHandle);
    state.loopHandle = 0;
  }

  function setStatus(msg, kind) {
    if (!els.status) return;
    els.status.textContent = msg;
    els.status.dataset.kind = kind || "";
  }

  // ------------------------------------------------------------
  // API
  // ------------------------------------------------------------
  async function fetchRun() {
    const nIter = Math.max(5, Math.min(parseInt(els.iter.value || "18", 10), 24));
    const baseBody = {
      seed: parseInt(els.seed.value || "42", 10),
      difficulty: els.difficulty.value || "easy",
      n_iter: nIter,
      max_steps: 80,
    };
    const attempts = [
      baseBody,
      { ...baseBody, difficulty: "easy", n_iter: Math.min(10, baseBody.n_iter), max_steps: 70 },
    ];
    let lastError = null;

    for (let i = 0; i < attempts.length; i++) {
      const body = attempts[i];
      const ctrl = new AbortController();
      const timeoutId = setTimeout(() => ctrl.abort(), 45000);
      let resp;
      try {
        resp = await fetch("/api/airfield-cma", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
      } catch (err) {
        clearTimeout(timeoutId);
        if (err && err.name === "AbortError") {
          lastError = new Error("İstek zaman aşımına uğradı. İterasyon sayısını düşürüp tekrar deneyin.");
          continue;
        }
        lastError = err instanceof Error ? err : new Error(String(err));
        continue;
      } finally {
        clearTimeout(timeoutId);
      }

      if (resp.ok) return resp.json();
      const txt = await resp.text().catch(() => "");
      lastError = new Error(`HTTP ${resp.status}: ${txt || resp.statusText}`);
    }

    throw lastError || new Error("Demo çalıştırılamadı.");
  }

  async function onStart() {
    try {
      stopLoop();
      els.start.disabled = true;
      els.pause.disabled = true;
      els.reset.disabled = true;
      setStatus("CMA-ES eğitimi yürütülüyor… (birkaç saniye)", "info");
      render();
      const t0 = performance.now();
      const data = await fetchRun();
      const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
      state.data = data;
      state.currentGen = 0;
      state.stepFloat = 0;
      state.bestEvalSoFar = Infinity;
      applyGenSnapshot();
      render();
      setStatus(
        `Eğitim tamamlandı (${elapsed}s). ${data.generations.length} jenerasyon · pop ${data.summary.pop_size} · θ=${data.summary.n_params}. Oynatma başlıyor…`,
        "info"
      );
      startLoop();
      els.reset.disabled = false;
    } catch (err) {
      setStatus(`Hata: ${err.message || err}`, "err");
      els.start.disabled = false;
    }
  }

  function onPause() {
    if (state.running) {
      stopLoop();
      els.pause.textContent = "▶ Devam";
      setStatus("Duraklatıldı.", "info");
    } else if (state.data && state.currentGen < state.data.generations.length) {
      els.pause.textContent = "⏸ Duraklat";
      setStatus("Oynatma devam ediyor…", "info");
      startLoop();
    }
  }

  function onReset() {
    stopLoop();
    state.currentGen = 0;
    state.stepFloat = 0;
    els.pause.textContent = "⏸ Duraklat";
    if (state.data) {
      applyGenSnapshot();
      render();
      setStatus("Başa alındı. Başlat ile yeni eğitim veya Devam ile oynatmayı sürdür.", "info");
      els.start.disabled = false;
      els.pause.disabled = true;
    } else {
      setStatus("Başlat'a basarak CMA-ES eğitimini çalıştır.", "");
    }
  }

  // ------------------------------------------------------------
  // Wire up
  // ------------------------------------------------------------
  els.start.addEventListener("click", onStart);
  els.pause.addEventListener("click", onPause);
  els.reset.addEventListener("click", onReset);

  // Ensure canvas sizes correctly when demo tab becomes visible.
  const demoTabBtn = document.getElementById("how-tab-demo");
  if (demoTabBtn) {
    demoTabBtn.addEventListener("click", () => {
      requestAnimationFrame(resizeCanvas);
    });
  }
  // Also resize shortly after load in case panel is initially visible.
  setTimeout(resizeCanvas, 50);
  // Initial placeholder
  resizeCanvas();
})();
