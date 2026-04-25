"use strict";

const $ = (id) => document.getElementById(id);

/**
 * Splash (foto carousel)
 * - splashMedia <script type="application/json"> içeriğini okur
 * - Tüm görselleri preload eder, yükleme barı preload ilerlemesini gösterir
 * - İki katman arasında crossfade + Ken-Burns zoom ile döndürür
 * - Başla butonu, görseller hazır olunca etkinleşir
 */
(function initSplash() {
  const splash = document.getElementById("splash");
  const btn = document.getElementById("splashStartBtn");
  const fill = document.getElementById("splashProgress");
  const track = document.getElementById("splashLoadTrack");
  const loadWrap = document.getElementById("splashLoadWrap");
  const loadMsg = document.getElementById("splashLoadMsg");
  const captionEl = document.getElementById("splashCaption");
  const captionText = captionEl ? captionEl.querySelector(".splash-caption-text") : null;
  const introPopup = document.getElementById("introPopup");
  const introCloseBtn = document.getElementById("introPopupClose");
  if (!splash || !btn || !fill || !track || !loadWrap) return;

  // ---- Medya listesini topla (foto + benchmark'lar karışık) ----
  let mediaJson = { photos: [], benches: [], finalSlide: null };
  const dataNode = document.getElementById("splashMedia");
  if (dataNode && dataNode.textContent) {
    try { mediaJson = JSON.parse(dataNode.textContent); }
    catch (e) { console.warn("splashMedia JSON parse hatası:", e); }
  }

  /** @type {{src:string,label:string,kind:string,fit?:string}[]} */
  const items = [];
  const photos  = Array.isArray(mediaJson.photos)  ? mediaJson.photos  : [];
  const benches = Array.isArray(mediaJson.benches) ? mediaJson.benches : [];
  const isMobileViewport = window.matchMedia("(max-width: 700px)").matches;

  photos.forEach((p) => items.push({
    src: p.src,
    label: p.label || "",
    kind: "photo",
    fit: p.fit || "contain",
  }));
  benches.forEach((b) => {
    const benchSrc = isMobileViewport && b.surfaceMobile ? b.surfaceMobile : b.surface;
    if (benchSrc) items.push({
      src: benchSrc,
      label: b.name ? `${b.name}` : "Benchmark yüzeyi",
      kind: "bench",
      fit: "contain",
    });
  });
  // Sıra: fotoğraflar -> benchmark kolajı
  const ORDER = items;

  const slides = splash.querySelectorAll(".splash-slide");
  if (!slides.length || !ORDER.length) {
    // Medya yoksa klasik yükleniyor davranışı
    fallbackLoader();
    return;
  }
  const kbClasses = ["kb-a", "kb-b", "kb-c", "kb-d"];
  let curSlot = 0;   // aktif slot index (0=a,1=b)
  let curIdx  = -1;  // ORDER içindeki aktif görsel index
  let dismissed = false;
  let ready = false;
  let rotationTimer = null;
  let loadMsgTimer = null;
  let loadMsgIdx = 0;
  const ROTATE_MS = {
    photo: 3600,
    bench: 5200,
    final: 6400,
    fallback: 4200,
  };

  // --- preload ---
  function preloadAll(onProgress) {
    return new Promise((resolve) => {
      let done = 0;
      const total = ORDER.length;
      const results = new Array(total);
      ORDER.forEach((item, i) => {
        const img = new Image();
        img.onload = img.onerror = () => {
          done += 1;
          results[i] = true;
          onProgress && onProgress(done / total);
          if (done === total) resolve(results);
        };
        img.decoding = "async";
        img.loading = "eager";
        img.src = item.src;
      });
    });
  }

  function updateCaption(item) {
    if (!captionText) return;
    captionText.textContent = item.label || "CMA-ES";
  }

  function swapTo(idx) {
    const nextSlot = 1 - curSlot;
    const target = slides[nextSlot];
    const item = ORDER[idx];
    if (!target || !item) return;

    // Görseli ata, Ken-Burns yönünü değiştir
    target.style.backgroundImage = `url("${item.src}")`;
    target.style.backgroundSize = item.fit === "contain" ? "contain" : "cover";
    target.classList.remove("kb-a", "kb-b", "kb-c", "kb-d");
    target.classList.add(kbClasses[idx % kbClasses.length]);

    // Önce aktifleştir (crossfade), sonra eski slotu kapat
    target.classList.add("is-active");
    const prev = slides[curSlot];
    // Küçük bir gecikmeyle eski kareyi bırak ki fade-out hissedilsin
    setTimeout(() => {
      if (prev && prev !== target) {
        prev.classList.remove("is-active");
      }
    }, 80);

    curSlot = nextSlot;
    curIdx  = idx;
    updateCaption(item);
  }

  function startRotation() {
    if (rotationTimer) return;
    const tick = () => {
      if (dismissed) return;
      const next = (curIdx + 1) % ORDER.length;
      swapTo(next);
      const kind = ORDER[next]?.kind || "fallback";
      const waitMs = ROTATE_MS[kind] || ROTATE_MS.fallback;
      rotationTimer = setTimeout(tick, waitMs);
    };
    const firstKind = ORDER[curIdx]?.kind || "fallback";
    const firstWait = ROTATE_MS[firstKind] || ROTATE_MS.fallback;
    rotationTimer = setTimeout(tick, firstWait);
  }

  function stopRotation() {
    if (rotationTimer) { clearTimeout(rotationTimer); rotationTimer = null; }
  }

  // ---- progress / finish ----
  function setProgress(p) {
    const c = Math.max(0, Math.min(1, p));
    fill.style.transform = `scaleX(${c})`;
    track.setAttribute("aria-valuenow", String(Math.round(c * 100)));
  }

  function finishLoad() {
    if (ready) return;
    ready = true;
    if (loadMsgTimer) {
      clearInterval(loadMsgTimer);
      loadMsgTimer = null;
    }
    setProgress(1);
    loadWrap.classList.add("is-done");
    if (loadMsg) loadMsg.textContent = "";
    btn.hidden = false;
    btn.disabled = false;
    requestAnimationFrame(() => {
      btn.classList.add("ready");
      btn.focus({ preventScroll: true });
    });
  }

  // ---- hide & intro popup ----
  function hide() {
    if (dismissed || !ready) return;
    dismissed = true;
    stopRotation();
    splash.classList.add("hide");
    setTimeout(() => {
      splash.remove();
      if (introPopup) {
        introPopup.hidden = false;
        introPopup.setAttribute("aria-hidden", "false");
      }
    }, 700);
  }

  function closeIntroPopup() {
    if (!introPopup || introPopup.hidden) return;
    introPopup.hidden = true;
    introPopup.setAttribute("aria-hidden", "true");
  }

  if (introPopup) {
    introPopup.addEventListener("click", (e) => {
      if (e.target instanceof Element && e.target.closest("[data-intro-close]")) {
        closeIntroPopup();
      }
    });
  }
  if (introCloseBtn) introCloseBtn.addEventListener("click", closeIntroPopup);

  // ---- olaylar ----
  btn.addEventListener("click", hide);
  document.addEventListener("keydown", (e) => {
    if (!ready) return;
    if (e.key === "Escape" && introPopup && !introPopup.hidden) {
      e.preventDefault(); closeIntroPopup(); return;
    }
    if (e.key === "Enter" || e.key === " " || e.key === "Escape") {
      e.preventDefault(); hide();
    }
  });

  // ---- akış ----
  // 1) ilk kareyi anında göster (gecikmesiz), kısa bir preload fazı başlat
  swapTo(0);
  startRotation();

  // Yükleme sırasında daha canlı durum mesajları döndür
  const loadMessages = [
    "Parametreler hazırlanıyor…",
    "Algoritma ayarları optimize ediliyor…",
    "Benchmark fonksiyonları yükleniyor…",
    "Görsel katmanlar işleniyor…",
    "Simülasyon sahnesi hazırlanıyor…",
    "CMA-ES bileşenleri senkronize ediliyor…",
    "Sunum akışı son kontrollerden geçiyor…",
  ];
  if (loadMsg) {
    loadMsg.textContent = loadMessages[0];
    loadMsgTimer = setInterval(() => {
      if (ready || dismissed) return;
      loadMsgIdx = (loadMsgIdx + 1) % loadMessages.length;
      loadMsg.textContent = loadMessages[loadMsgIdx];
    }, 1050);
  }

  // 2) yükleme barı: sıfırdan yumuşak yükselsin ve daha uzun kalsın
  const MIN_MS = 6200;
  const t0 = performance.now();
  let preloadP = 0;
  let preloadDone = false;
  let visualP = 0;

  preloadAll((p) => {
    preloadP = Math.max(preloadP, p);
  }).then(() => {
    preloadDone = true;
  });

  (function progressTick() {
    const byTime = Math.min(1, (performance.now() - t0) / MIN_MS);
    // Hem preload hem zaman eğrisi birlikte kontrol eder; ani sıçrama engellenir
    const cap = Math.min(preloadP * 0.9, byTime * 0.9);
    // Yumuşak yaklaşım (lerp)
    visualP += (cap - visualP) * 0.09;
    setProgress(visualP);

    const readyForTail = preloadDone && byTime >= 1 && Math.abs(visualP - cap) < 0.004;
    if (!readyForTail) {
      requestAnimationFrame(progressTick);
      return;
    }

    const t1 = performance.now();
    const TAIL = 900;
    (function tailTick() {
      const p = Math.min(1, (performance.now() - t1) / TAIL);
      setProgress(0.9 + 0.1 * p);
      if (p < 1) requestAnimationFrame(tailTick);
      else finishLoad();
    })();
  })();

  function fallbackLoader() {
    // Medya bulunamadığında eski zamana dayalı yükleyiciyi çalıştır
    const DURATION = 2400;
    const t0b = performance.now();
    (function step(){
      const p = Math.min(1, (performance.now() - t0b) / DURATION);
      setProgress(p);
      if (p < 1) requestAnimationFrame(step);
      else finishLoad();
    })();
    btn.addEventListener("click", hide);
  }
})();

let RUN = null;
let FRAME_IDX = 0;
let PLAY_TIMER = null;

const PLOT_BG = "#0d111c";
const NEON_RING = "#00ffd5";
const PATH_2D = "#ff3355";
const PATH_3D = "#00f0ff";
const GLOBAL_STAR = "#ffd93d";

function renderStaticFormula() {
  const key = $("function").value;
  const box = $("katex-formula");
  const alt = $("katex-alt");
  if (!box) return;

  if (key === "schwefel" && typeof katex !== "undefined") {
    try {
      const a = window.SCHWEFEL_ALPHA_DISPLAY || "418.9829";
      const tex = `f(\\mathbf{x}) = ${a} \\cdot n - \\sum_{i=1}^{n} x_i \\sin\\left(\\sqrt{|x_i|}\\right)`;
      katex.render(tex, box, { displayMode: true, throwOnError: false });
      if (alt) alt.textContent = "for n = 2.";
    } catch {
      box.textContent = window.DEFAULTS[key]?.formula || "";
      if (alt) alt.textContent = "";
    }
  } else {
    const meta = window.DEFAULTS[key];
    box.textContent = meta ? meta.formula : "";
    if (alt) alt.textContent = "";
  }
}

function updateMathLive() {
  const el = $("katex-live");
  if (!el) return;
  const key = $("function").value;
  const opt = window.DEFAULTS[key]?.optimum;

  if (!RUN) {
    el.innerHTML = '<span style="color:#8b93a8">Çalıştırdıktan sonra güncel <span class="hl">f(x)</span> ve küresel minimum bilgisi burada görünür.</span>';
    return;
  }

  const f = RUN.frames[FRAME_IDX];
  const bf = f.best_f;
  const bx = f.best_x;
  const optF = Number(RUN?.meta?.optimum_f);
  const lines = [];

  if (bf != null && Number.isFinite(bf)) {
    lines.push(`Mevcut en iyi: <span class="hl">f(x) ≈ ${bf.toExponential(4)}</span>`);
  }
  if (key === "schwefel" && opt) {
    lines.push(
      `Küresel minimum (bilinen): <span class="hl">x* ≈ (${opt[0].toFixed(4)}, ${opt[1].toFixed(4)})</span>, <span class="hl">f(x*) ≈ ${Number.isFinite(optF) ? optF.toExponential(4) : "0"}</span>`
    );
  } else if (opt) {
    lines.push(
      `Teorik optimum konumu: (${opt[0]}, ${opt[1]})${Number.isFinite(optF) ? `, f(x*) ≈ ${optF.toExponential(4)}` : ""}`
    );
  }
  if (bx && bx[0] != null) {
    lines.push(`En iyi nokta: (${bx[0].toFixed(6)}, ${bx[1].toFixed(6)})`);
  }
  if (Number.isFinite(bf) && Number.isFinite(optF)) {
    lines.push(`Optimuma fark: <span class="hl">Δf ≈ ${(bf - optF).toExponential(4)}</span>`);
  }

  el.innerHTML = lines.join("<br>");
}

function applyDefaults() {
  const key = $("function").value;
  const d = window.DEFAULTS[key];
  if (!d) return;
  $("x0").value = d.x0[0];
  $("y0").value = d.x0[1];
  $("sigma").value = d.sigma;
  $("xmin").value = d.bounds[0][0];
  $("xmax").value = d.bounds[0][1];
  $("ymin").value = d.bounds[1][0];
  $("ymax").value = d.bounds[1][1];
  renderStaticFormula();
  updateMathLive();
}

$("function").addEventListener("change", applyDefaults);
applyDefaults();

function collect() {
  const popRaw = $("popsize").value.trim();
  return {
    function: $("function").value,
    x0: parseFloat($("x0").value),
    y0: parseFloat($("y0").value),
    sigma: parseFloat($("sigma").value),
    max_iter: parseInt($("max_iter").value, 10),
    popsize: popRaw === "" ? null : parseInt(popRaw, 10),
    seed: parseInt($("seed").value, 10),
    xmin: parseFloat($("xmin").value),
    xmax: parseFloat($("xmax").value),
    ymin: parseFloat($("ymin").value),
    ymax: parseFloat($("ymax").value),
    multi_start: $("multi_start") ? $("multi_start").checked : true,
  };
}

function showSimUi(show) {
  ["simCard", "speedCard", "convCard", "playbar"].forEach((id) => {
    const n = $(id);
    if (n) n.hidden = !show;
  });
}

$("cfgForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  stopPlay();
  $("runBtn").disabled = true;
  $("status").textContent = "Çalışıyor…";
  $("status").style.color = "";
  try {
    const resp = await fetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(collect()),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: resp.statusText }));
      throw new Error(err.error || "run failed");
    }
    RUN = await resp.json();
    FRAME_IDX = 0;
    $("playbar").hidden = false;
    showSimUi(true);
    $("frameSlider").max = RUN.frames.length - 1;
    $("frameSlider").value = 0;
    initPlots();
    initConvPlot();
    renderFrame(0);
    updateMathLive();
    $("status").textContent = `Hazır · ${RUN.frames.length - 1} nesil`;
  } catch (err) {
    $("status").textContent = "Hata: " + err.message;
    $("status").style.color = "var(--neon-red)";
    showSimUi(false);
  } finally {
    $("runBtn").disabled = false;
  }
});

function getDelayMs() {
  const v = parseInt($("speedSlider").value, 10);
  return 940 - v;
}

function speedLabel(ms) {
  if (ms >= 550) return "Slow";
  if (ms >= 180) return "Optimal";
  return "Fast";
}

function updateSpeedReadout() {
  const ms = getDelayMs();
  const z = speedLabel(ms);
  const el = $("speedState");
  if (el) el.textContent = `${z} · ${ms} ms/adım`;
}

$("speedSlider").addEventListener("input", () => {
  updateSpeedReadout();
  if (PLAY_TIMER) {
    stopPlay();
    $("playBtn").click();
  }
});
updateSpeedReadout();

function initPlots() {
  const { surface, bounds, label } = RUN;
  const isPhone = window.matchMedia("(max-width: 760px)").matches;
  const sxMin = Math.min(...surface.x);
  const sxMax = Math.max(...surface.x);
  const syMin = Math.min(...surface.y);
  const syMax = Math.max(...surface.y);
  const opt = RUN.meta.optimum;
  const ox = opt[0];
  const oy = opt[1];
  const oz = objectiveValueAt([[ox, oy]])[0];

  Plotly.newPlot(
    "plot2d",
    [
      {
        type: "contour",
        x: surface.x,
        y: surface.y,
        z: surface.z,
        colorscale: "Magma",
        contours: { coloring: "heatmap" },
        showscale: !isPhone,
        colorbar: {
          len: 0.7,
          thickness: 12,
          tickfont: { color: "#9aa0aa", size: 10 },
          title: { text: "f(x)", font: { color: "#9aa0aa", size: 11 } },
        },
        hoverinfo: "skip",
        opacity: 0.98,
      },
      {
        type: "scatter",
        mode: "lines",
        name: "Arama yolu",
        x: [],
        y: [],
        line: { color: PATH_2D, width: 3 },
      },
      {
        type: "scatter",
        mode: "markers",
        name: "Elenen",
        x: [],
        y: [],
        marker: { color: "#ff6b7a", size: 6, symbol: "x" },
      },
      {
        type: "scatter",
        mode: "markers",
        name: "Seçilen",
        x: [],
        y: [],
        marker: { color: "#fff38a", size: 7, line: { color: "#222", width: 0.5 } },
      },
      {
        type: "scatter",
        mode: "lines",
        name: "CMA-ES elipsi",
        x: [],
        y: [],
        line: { color: NEON_RING, width: 2.5 },
      },
      {
        type: "scatter",
        mode: "markers",
        name: "Merkez m",
        x: [],
        y: [],
        marker: { color: "#ffffff", size: 11, symbol: "cross", line: { width: 1 } },
      },
      {
        type: "scatter",
        mode: "markers",
        name: "En iyi",
        x: [],
        y: [],
        marker: { color: "#39ffb8", size: 12, symbol: "star", line: { color: "#0a180e", width: 0.5 } },
      },
      {
        type: "scatter",
        mode: "markers",
        name: "Global minimum",
        x: [ox],
        y: [oy],
        marker: {
          color: GLOBAL_STAR,
          size: 14,
          symbol: "star",
          line: { color: "#332200", width: 0.5 },
        },
      },
    ],
    {
      title: {
        text: `${label} — Kontur (Magma)`,
        font: { color: "#dce4ff", size: isPhone ? 16 : 14 },
      },
      paper_bgcolor: PLOT_BG,
      plot_bgcolor: PLOT_BG,
      font: { color: "#e6e7ea" },
      xaxis: {
        range: [sxMin, sxMax],
        title: "x₁",
        gridcolor: "rgba(255,255,255,0.06)",
        zerolinecolor: "rgba(255,255,255,0.12)",
      },
      yaxis: {
        range: [syMin, syMax],
        title: "x₂",
        scaleanchor: "x",
        scaleratio: 1,
        gridcolor: "rgba(255,255,255,0.06)",
        zerolinecolor: "rgba(255,255,255,0.12)",
      },
      margin: isPhone ? { l: 46, r: 10, t: 56, b: 42 } : { l: 52, r: 24, t: 48, b: 44 },
      legend: {
        orientation: "h",
        y: isPhone ? -0.17 : -0.22,
        font: { size: isPhone ? 11 : 10 },
        bgcolor: "rgba(0,0,0,0)",
      },
    },
    { responsive: true, displaylogo: false, displayModeBar: !isPhone }
  );

  Plotly.newPlot(
    "plot3d",
    [
      {
        type: "surface",
        x: surface.x,
        y: surface.y,
        z: surface.z,
        colorscale: "Twilight",
        showscale: !isPhone,
        colorbar: {
          len: 0.55,
          thickness: 10,
          tickfont: { color: "#9aa0aa", size: 9 },
        },
        opacity: 0.92,
        hoverinfo: "skip",
        lighting: { ambient: 0.42, diffuse: 0.88, specular: 0.25 },
      },
      {
        type: "scatter3d",
        mode: "markers",
        name: "Popülasyon",
        x: [],
        y: [],
        z: [],
        marker: { color: "#fff38a", size: 3.5 },
      },
      {
        type: "scatter3d",
        mode: "lines",
        name: "Yörünge",
        x: [],
        y: [],
        z: [],
        line: { color: PATH_3D, width: 5 },
      },
      {
        type: "scatter3d",
        mode: "lines",
        name: "Arama halkası",
        x: [],
        y: [],
        z: [],
        line: { color: NEON_RING, width: 3 },
      },
      {
        type: "scatter3d",
        mode: "markers",
        name: "Merkez m",
        x: [],
        y: [],
        z: [],
        marker: { color: "#ffffff", size: 5, symbol: "cross" },
      },
      {
        type: "scatter3d",
        mode: "markers",
        name: "En iyi",
        x: [],
        y: [],
        z: [],
        marker: { color: "#39ffb8", size: 5, symbol: "diamond" },
      },
      {
        type: "scatter3d",
        mode: "markers",
        name: "Global minimum",
        x: [ox],
        y: [oy],
        z: [oz],
        marker: { color: GLOBAL_STAR, size: 6, symbol: "star" },
      },
    ],
    {
      title: {
        text: `${label} — Yüzey (Twilight)`,
        font: { color: "#dce4ff", size: isPhone ? 16 : 14 },
      },
      paper_bgcolor: PLOT_BG,
      font: { color: "#e6e7ea" },
      scene: {
        bgcolor: PLOT_BG,
        aspectmode: isPhone ? "manual" : "cube",
        aspectratio: isPhone ? { x: 1.05, y: 1.05, z: 0.62 } : undefined,
        xaxis: {
          title: "x₁",
          range: [sxMin, sxMax],
          backgroundcolor: PLOT_BG,
          gridcolor: "rgba(255,255,255,0.08)",
        },
        yaxis: {
          title: "x₂",
          range: [syMin, syMax],
          backgroundcolor: PLOT_BG,
          gridcolor: "rgba(255,255,255,0.08)",
        },
        zaxis: {
          title: "f(x)",
          backgroundcolor: PLOT_BG,
          gridcolor: "rgba(255,255,255,0.08)",
        },
      },
      margin: isPhone ? { l: 0, r: 0, t: 58, b: 0 } : { l: 0, r: 0, t: 48, b: 0 },
      showlegend: !isPhone,
      legend: isPhone ? undefined : {
        font: { size: 10 },
        bgcolor: "rgba(0,0,0,0)",
      },
    },
    { responsive: true, displaylogo: false, displayModeBar: !isPhone }
  );

  if (isPhone) {
    Plotly.relayout("plot3d", {
      "scene.camera.eye": { x: 1.45, y: 1.35, z: 0.75 },
      "scene.camera.center": { x: 0, y: 0, z: -0.08 },
    });
    // CSS mobil yüksekliği uygulandıktan sonra tekrar ölçülendir
    setTimeout(() => {
      try { Plotly.Plots.resize("plot2d"); } catch (_) {}
      try { Plotly.Plots.resize("plot3d"); } catch (_) {}
    }, 140);
  }
}

function initConvPlot() {
  const xs = [];
  const ys = [];
  RUN.frames.forEach((fr, i) => {
    if (i === 0) return;
    if (fr.best_f != null && Number.isFinite(fr.best_f)) {
      xs.push(fr.iter);
      ys.push(fr.best_f);
    }
  });

  Plotly.newPlot(
    "convPlot",
    [
      {
        x: xs,
        y: ys,
        mode: "lines",
        line: { color: "#39ffb8", width: 2, shape: "linear" },
        fill: "tozeroy",
        fillcolor: "rgba(57,255,184,0.07)",
        hovertemplate: "iter %{x}<br>f %{y:.6f}<extra></extra>",
      },
    ],
    {
      paper_bgcolor: "transparent",
      plot_bgcolor: "rgba(6,10,18,0.45)",
      margin: { l: 44, r: 6, t: 4, b: 28 },
      xaxis: {
        title: "İterasyon",
        gridcolor: "rgba(255,255,255,0.06)",
        color: "#8b93a8",
        zeroline: false,
      },
      yaxis: {
        title: "En iyi f(x)",
        gridcolor: "rgba(255,255,255,0.06)",
        color: "#8b93a8",
        zeroline: false,
      },
      font: { size: 10, color: "#8b93a8" },
      showlegend: false,
    },
    { displaylogo: false, responsive: true }
  );
}

function fnValueAt(xyArr) {
  return objectiveValueAt(xyArr);
}

function objectiveValueAt(xyArr) {
  const key = RUN?.function || $("function")?.value || "schwefel";
  const alpha = Number(window.SCHWEFEL_ALPHA_DISPLAY || "418.9828872724339");

  return xyArr.map(([xRaw, yRaw]) => {
    const x = Number(xRaw);
    const y = Number(yRaw);

    if (key === "sphere") {
      return x * x + y * y;
    }
    if (key === "rastrigin") {
      return 20 + (x * x - 10 * Math.cos(2 * Math.PI * x)) + (y * y - 10 * Math.cos(2 * Math.PI * y));
    }
    if (key === "himmelblau") {
      const a = x * x + y - 11;
      const b = x + y * y - 7;
      return a * a + b * b;
    }
    if (key === "ackley") {
      const s1 = x * x + y * y;
      const s2 = Math.cos(2 * Math.PI * x) + Math.cos(2 * Math.PI * y);
      return -20 * Math.exp(-0.2 * Math.sqrt(s1 / 2)) - Math.exp(s2 / 2) + 20 + Math.E;
    }
    // schwefel (varsayılan)
    return 2 * alpha - (x * Math.sin(Math.sqrt(Math.abs(x))) + y * Math.sin(Math.sqrt(Math.abs(y))));
  });
}

function surfaceInterpAt(xyArr) {
  const { surface } = RUN;
  const xs = surface.x;
  const ys = surface.y;
  const Z = surface.z;
  return xyArr.map(([x, y]) => {
    const i = clamp(binarySearch(xs, x), 0, xs.length - 2);
    const j = clamp(binarySearch(ys, y), 0, ys.length - 2);
    const x0 = xs[i];
    const x1 = xs[i + 1];
    const y0 = ys[j];
    const y1 = ys[j + 1];
    const tx = (x - x0) / (x1 - x0 || 1);
    const ty = (y - y0) / (y1 - y0 || 1);
    const z00 = Z[j][i];
    const z10 = Z[j][i + 1];
    const z01 = Z[j + 1][i];
    const z11 = Z[j + 1][i + 1];
    return (
      (1 - tx) * (1 - ty) * z00 +
      tx * (1 - ty) * z10 +
      (1 - tx) * ty * z01 +
      tx * ty * z11
    );
  });
}

function binarySearch(arr, v) {
  let lo = 0;
  let hi = arr.length - 1;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (arr[m] <= v) lo = m + 1;
    else hi = m;
  }
  return Math.max(0, lo - 1);
}

function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}

function buildPath(idx) {
  const px = [];
  const py = [];
  const pz = [];
  for (let i = 1; i <= idx; i++) {
    const fr = RUN.frames[i];
    if (fr.best_x && fr.best_x[0] != null) {
      px.push(fr.best_x[0]);
      py.push(fr.best_x[1]);
      const z =
        typeof fr.best_f === "number" && Number.isFinite(fr.best_f)
          ? fr.best_f
          : objectiveValueAt([fr.best_x])[0];
      pz.push(z);
    }
  }
  return { px, py, pz };
}

function updateConvCursor() {
  const fr = RUN.frames[FRAME_IDX];
  const iter = fr.iter;
  Plotly.relayout("convPlot", {
    shapes: [
      {
        type: "line",
        x0: iter,
        x1: iter,
        y0: 0,
        y1: 1,
        yref: "paper",
        line: { color: "rgba(0,255,213,0.55)", width: 1, dash: "dot" },
      },
    ],
  });
}

function renderFrame(idx) {
  if (!RUN) return;
  const f = RUN.frames[idx];
  const pop = f.population || [];
  const sel = new Set(f.selected_idx || []);
  const discardedX = [];
  const discardedY = [];
  const selectedX = [];
  const selectedY = [];
  pop.forEach((p, k) => {
    if (sel.has(k)) {
      selectedX.push(p[0]);
      selectedY.push(p[1]);
    } else {
      discardedX.push(p[0]);
      discardedY.push(p[1]);
    }
  });
  const ell = f.ellipse || [];
  const ellX = ell.map((p) => p[0]);
  const ellY = ell.map((p) => p[1]);
  const ellZ = ell.length ? surfaceInterpAt(ell) : [];
  let ellX3 = ellX;
  let ellY3 = ellY;
  let ellZ3 = ellZ;
  const closed =
    ellX.length > 2 &&
    Math.abs(ellX[0] - ellX[ellX.length - 1]) < 1e-9 &&
    Math.abs(ellY[0] - ellY[ellY.length - 1]) < 1e-9;
  if (ellX.length && !closed) {
    ellX3 = ellX.concat(ellX[0]);
    ellY3 = ellY.concat(ellY[0]);
    ellZ3 = ellZ.concat(ellZ[0]);
  }

  const m = f.mean || [null, null];
  const best = f.best_x || [null, null];
  const { px, py, pz } = buildPath(idx);

  Plotly.restyle("plot2d", { x: [px], y: [py] }, [1]);
  Plotly.restyle("plot2d", { x: [discardedX], y: [discardedY] }, [2]);
  Plotly.restyle("plot2d", { x: [selectedX], y: [selectedY] }, [3]);
  Plotly.restyle("plot2d", { x: [ellX], y: [ellY] }, [4]);
  Plotly.restyle("plot2d", { x: [[m[0]]], y: [[m[1]]] }, [5]);
  Plotly.restyle("plot2d", { x: [[best[0]]], y: [[best[1]]] }, [6]);

  const popZ =
    pop.length && f.fitness?.length === pop.length
      ? f.fitness
      : objectiveValueAt(pop);

  let mZ = null;
  if (m[0] !== null && m[1] !== null) {
    mZ = typeof f.mean_f === "number" ? f.mean_f : objectiveValueAt([m])[0];
  }
  let bestZ = null;
  if (best[0] !== null && best[1] !== null) {
    bestZ = typeof f.best_f === "number" ? f.best_f : objectiveValueAt([best])[0];
  }

  Plotly.restyle("plot3d", { x: [pop.map((p) => p[0])], y: [pop.map((p) => p[1])], z: [popZ] }, [1]);
  Plotly.restyle("plot3d", { x: [px], y: [py], z: [pz] }, [2]);
  Plotly.restyle("plot3d", { x: [ellX3], y: [ellY3], z: [ellZ3] }, [3]);
  Plotly.restyle("plot3d", { x: [[m[0]]], y: [[m[1]]], z: [[mZ]] }, [4]);
  Plotly.restyle("plot3d", { x: [[best[0]]], y: [[best[1]]], z: [[bestZ]] }, [5]);

  FRAME_IDX = idx;
  $("frameSlider").value = idx;
  $("frameLabel").textContent = `${idx} / ${RUN.frames.length - 1}`;

  const bf = f.best_f;
  $("convIterLabel").textContent = `İterasyon: ${f.iter}`;
  $("convBestLabel").textContent =
    bf != null && Number.isFinite(bf) ? `Best f(x): ${bf.toExponential(4)}` : "Best f(x): —";

  updateConvCursor();
  updateMathLive();
}

$("playBtn").addEventListener("click", () => {
  if (!RUN) return;
  if (PLAY_TIMER) return;
  const schedule = () => {
    PLAY_TIMER = setTimeout(() => {
      PLAY_TIMER = null;
      if (!RUN) return;
      if (FRAME_IDX >= RUN.frames.length - 1) return;
      renderFrame(FRAME_IDX + 1);
      if (FRAME_IDX < RUN.frames.length - 1) schedule();
    }, getDelayMs());
  };
  schedule();
});

$("pauseBtn").addEventListener("click", stopPlay);
$("resetBtn").addEventListener("click", () => {
  stopPlay();
  renderFrame(0);
});

$("frameSlider").addEventListener("input", (e) => {
  stopPlay();
  renderFrame(parseInt(e.target.value, 10));
});

function stopPlay() {
  if (PLAY_TIMER) {
    clearTimeout(PLAY_TIMER);
    PLAY_TIMER = null;
  }
}

/* ----------------- How it Works — tam ekran sunum ----------------- */
(function initHowModal() {
  const modal = document.getElementById("howModal");
  const btn = document.getElementById("howBtn");
  if (!modal || !btn) return;

  const panels = modal.querySelectorAll('[role="tabpanel"]');
  const tabs = modal.querySelectorAll('[role="tab"]');
  const panelScroll = modal.querySelector(".how-panels");

  const showTab = (tab) => {
    if (!tab) return;
    const panelId = tab.getAttribute("aria-controls");
    tabs.forEach((t) => {
      const on = t === tab;
      t.classList.toggle("is-active", on);
      t.setAttribute("aria-selected", on ? "true" : "false");
    });
    panels.forEach((p) => {
      const on = p.id === panelId;
      p.classList.toggle("is-active", on);
      if (on) {
        p.removeAttribute("hidden");
        p.style.display = "block";
      } else {
        p.setAttribute("hidden", "");
        p.style.display = "none";
      }
    });
    if (panelScroll) panelScroll.scrollTop = 0;
  };

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => showTab(tab));
  });

  const open = () => {
    modal.hidden = false;
    document.body.style.overflow = "hidden";
    const first = modal.querySelector('[role="tab"].is-active') || tabs[0];
    showTab(first);
    first?.focus?.();
  };
  const close = () => {
    modal.hidden = true;
    document.body.style.overflow = "";
    btn.focus();
  };

  btn.addEventListener("click", open);
  modal.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.hidden) close();
  });

  const demoSch = document.getElementById("howDemoSchwefel");
  const demoSph = document.getElementById("howDemoSphere");
  if (demoSch) {
    demoSch.addEventListener("click", () => {
      const fnEl = $("function");
      const ms = $("multi_start");
      const mi = $("max_iter");
      if (fnEl) fnEl.value = "schwefel";
      if (ms) ms.checked = true;
      if (mi) mi.value = "80";
      if (typeof applyDefaults === "function") applyDefaults();
      close();
    });
  }
  if (demoSph) {
    demoSph.addEventListener("click", () => {
      const fnEl = $("function");
      const ms = $("multi_start");
      const mi = $("max_iter");
      if (fnEl) fnEl.value = "sphere";
      if (ms) ms.checked = false;
      if (mi) mi.value = "40";
      if (typeof applyDefaults === "function") applyDefaults();
      close();
    });
  }

  const demoRas = document.getElementById("howDemoRastrigin");
  if (demoRas) {
    demoRas.addEventListener("click", () => {
      const fnEl = $("function");
      const ms = $("multi_start");
      const mi = $("max_iter");
      if (fnEl) fnEl.value = "rastrigin";
      if (ms) ms.checked = true;
      if (mi) mi.value = "80";
      if (typeof applyDefaults === "function") applyDefaults();
      close();
    });
  }

  const demoHim = document.getElementById("howDemoHimmelblau");
  if (demoHim) {
    demoHim.addEventListener("click", () => {
      const fnEl = $("function");
      const ms = $("multi_start");
      const mi = $("max_iter");
      if (fnEl) fnEl.value = "himmelblau";
      if (ms) ms.checked = false;
      if (mi) mi.value = "40";
      if (typeof applyDefaults === "function") applyDefaults();
      close();
    });
  }
})();
