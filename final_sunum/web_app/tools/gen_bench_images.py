"""
High-quality benchmark function images for the splash carousel.

Her fonksiyon için:
  1) 3D yüzey (shaded, izohipsli)
  2) 2D kontur (logaritmik seviyeler + global minimum vurgusu)

Çıktı: web_app/static/splash/bench_<name>_<kind>.png
"""
from __future__ import annotations

import os
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import cm
from matplotlib.colors import LinearSegmentedColormap, LogNorm, Normalize
from mpl_toolkits.mplot3d import Axes3D  # noqa: F401

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, "..", "static", "splash"))
os.makedirs(OUT, exist_ok=True)

# ---------- Benchmark Fonksiyonları ----------
def sphere(x, y):        return x**2 + y**2
def rastrigin(x, y, A=10):
    return 2*A + (x**2 - A*np.cos(2*np.pi*x)) + (y**2 - A*np.cos(2*np.pi*y))
def schwefel(x, y):
    return 418.9829*2 - (x*np.sin(np.sqrt(np.abs(x))) + y*np.sin(np.sqrt(np.abs(y))))
def ackley(x, y, a=20, b=0.2, c=2*np.pi):
    r = np.sqrt(0.5*(x**2 + y**2))
    return -a*np.exp(-b*r) - np.exp(0.5*(np.cos(c*x)+np.cos(c*y))) + a + np.e
def himmelblau(x, y):
    return (x**2 + y - 11)**2 + (x + y**2 - 7)**2
def griewank(x, y):
    return 1 + (x**2 + y**2)/4000 - np.cos(x) * np.cos(y/np.sqrt(2))
def levy(x, y):
    w1, w2 = 1 + (x-1)/4.0, 1 + (y-1)/4.0
    return (np.sin(np.pi*w1)**2
            + (w1-1)**2 * (1 + 10*np.sin(np.pi*w1+1)**2)
            + (w2-1)**2 * (1 + np.sin(2*np.pi*w2)**2))
def zakharov(x, y):
    s1 = x**2 + y**2
    s2 = 0.5*(1*x + 2*y)
    return s1 + s2**2 + s2**4

BENCHES = [
    ("sphere",     sphere,     ( -5.12,   5.12), (0.0, 0.0)),
    ("rastrigin",  rastrigin,  ( -5.12,   5.12), (0.0, 0.0)),
    ("schwefel",   schwefel,   (-500.0, 500.0),  (420.9687, 420.9687)),
    ("ackley",     ackley,     ( -5.0,    5.0),  (0.0, 0.0)),
    ("himmelblau", himmelblau, ( -5.0,    5.0),  (3.0, 2.0)),
    ("griewank",   griewank,   (-10.0,   10.0),  (0.0, 0.0)),
    ("levy",       levy,       ( -10.0,  10.0),  (1.0, 1.0)),
    ("zakharov",   zakharov,   ( -5.0,   10.0),  (0.0, 0.0)),
]

# Proje ile tutarlı neon-cyan tabanlı palet
NEON_CMAP = LinearSegmentedColormap.from_list(
    "neon_cma", [
        (0.00, "#0b1530"),
        (0.15, "#1b3570"),
        (0.35, "#2b6dff"),
        (0.55, "#41f2ff"),
        (0.75, "#ffd079"),
        (0.92, "#ff6b9a"),
        (1.00, "#fff4c1"),
    ],
)

BG = "#070912"

def _prep_grid(bounds, n=360):
    xs = np.linspace(bounds[0], bounds[1], n)
    ys = np.linspace(bounds[0], bounds[1], n)
    X, Y = np.meshgrid(xs, ys)
    return X, Y

def _save(fig, name, suffix):
    out = os.path.join(OUT, f"bench_{name}_{suffix}.png")
    fig.savefig(out, dpi=180, bbox_inches="tight", facecolor=BG)
    plt.close(fig)
    print(f"[OK] {out}")

def make_surface(name, fn, bounds, opt):
    X, Y = _prep_grid(bounds, n=260)
    Z = fn(X, Y)
    fig = plt.figure(figsize=(10.4, 6.5), facecolor=BG)
    ax = fig.add_subplot(111, projection="3d")
    ax.set_facecolor(BG)
    ls = matplotlib.colors.LightSource(azdeg=315, altdeg=55)
    norm = Normalize(vmin=np.nanmin(Z), vmax=np.nanmax(Z))
    rgb = ls.shade(Z, cmap=NEON_CMAP, vert_exag=0.35, blend_mode="soft", norm=norm)
    ax.plot_surface(X, Y, Z, facecolors=rgb, linewidth=0, antialiased=True, shade=False,
                    rcount=260, ccount=260)
    ax.contour(X, Y, Z, 14, offset=np.nanmin(Z), cmap=NEON_CMAP, alpha=0.6)
    try:
        ox, oy = opt
        oz = fn(np.array([[ox]]), np.array([[oy]]))[0, 0]
        ax.scatter([ox], [oy], [oz], s=60, c="#fff4c1", edgecolors="#ff6b9a", linewidths=1.4, depthshade=False)
    except Exception:
        pass
    ax.set_title(name.upper(), color="#cfe1ff", fontsize=18, fontweight="bold", pad=6)
    ax.set_xticks([]); ax.set_yticks([]); ax.set_zticks([])
    ax.xaxis.set_pane_color((0, 0, 0, 0))
    ax.yaxis.set_pane_color((0, 0, 0, 0))
    ax.zaxis.set_pane_color((0, 0, 0, 0))
    ax.grid(False)
    ax.view_init(elev=32, azim=-55)
    _save(fig, name, "surface")

def make_contour(name, fn, bounds, opt):
    X, Y = _prep_grid(bounds, n=500)
    Z = fn(X, Y)
    fig, ax = plt.subplots(figsize=(10.4, 6.5), facecolor=BG)
    ax.set_facecolor(BG)
    Zs = Z - np.nanmin(Z) + 1e-6
    norm = LogNorm(vmin=max(np.nanmin(Zs), 1e-3), vmax=np.nanmax(Zs))
    ax.imshow(Zs, extent=(bounds[0], bounds[1], bounds[0], bounds[1]),
              origin="lower", cmap=NEON_CMAP, norm=norm, interpolation="bilinear", aspect="auto")
    ax.contour(X, Y, Zs, levels=20, colors="#8cd4ff", alpha=0.35, linewidths=0.55, norm=norm)
    ax.contour(X, Y, Zs, levels=8,  colors="#ffd079", alpha=0.55, linewidths=0.9,  norm=norm)
    try:
        ox, oy = opt
        ax.plot(ox, oy, "o", markerfacecolor="#fff4c1", markeredgecolor="#ff6b9a",
                markersize=10, markeredgewidth=1.6)
    except Exception:
        pass
    ax.set_xticks([]); ax.set_yticks([])
    for sp in ax.spines.values(): sp.set_visible(False)
    ax.set_title(f"{name.upper()} — kontur", color="#cfe1ff", fontsize=18, fontweight="bold", pad=6)
    _save(fig, name, "contour")

def main():
    for name, fn, bounds, opt in BENCHES:
        try:
            make_surface(name, fn, bounds, opt)
            make_contour(name, fn, bounds, opt)
        except Exception as e:
            print(f"[FAIL] {name}: {e}")

if __name__ == "__main__":
    main()
