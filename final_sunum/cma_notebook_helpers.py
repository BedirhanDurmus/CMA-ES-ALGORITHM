"""CMA-ES notebook helpers: plotting and a thin wrapper around pycma (numpy-only objective)."""

from __future__ import annotations

import numpy as np
import matplotlib.pyplot as plt
from matplotlib.patches import Ellipse
import cma as cma_mod


def plot_3d_surface(fitness_fn, xlim, ylim, n=80):
    """Surface plot for a 2-D objective; fitness_fn accepts an (m, 2) array."""
    x = np.linspace(xlim[0], xlim[1], n)
    y = np.linspace(ylim[0], ylim[1], n)
    X, Y = np.meshgrid(x, y)
    pts = np.column_stack([X.ravel(), Y.ravel()])
    Z = np.asarray(fitness_fn(pts)).reshape(X.shape)

    fig = plt.figure(figsize=(10, 7))
    ax = fig.add_subplot(111, projection="3d")
    surf = ax.plot_surface(
        X, Y, Z, cmap="viridis", linewidth=0, antialiased=True, alpha=0.92
    )
    fig.colorbar(surf, shrink=0.55, aspect=18, label="f(x, y)")
    ax.set_xlabel("$x_1$")
    ax.set_ylabel("$x_2$")
    ax.set_zlabel("$f(x_1,x_2)$")
    ax.set_title("Schwefel — 3D yüzey")
    plt.tight_layout()
    plt.show()


def plot_2d_contour(fitness_fn, xlim, ylim, n=100):
    """Filled contour plot."""
    x = np.linspace(xlim[0], xlim[1], n)
    y = np.linspace(ylim[0], ylim[1], n)
    X, Y = np.meshgrid(x, y)
    pts = np.column_stack([X.ravel(), Y.ravel()])
    Z = np.asarray(fitness_fn(pts)).reshape(X.shape)

    fig, ax = plt.subplots(figsize=(8, 7))
    cf = ax.contourf(X, Y, Z, levels=50, cmap="viridis")
    plt.colorbar(cf, ax=ax, label="f(x, y)")
    ax.set_xlabel("$x_1$")
    ax.set_ylabel("$x_2$")
    ax.set_title("Schwefel — kontur")
    ax.set_xlim(xlim)
    ax.set_ylim(ylim)
    plt.tight_layout()
    plt.show()


def draw_confidence_ellipse(ax, mean, cov, *, n_std=2.0, **kwargs):
    """Draw ellipse for covariance `cov` (e.g. sigma**2 * C) at `mean` (2D)."""
    mean = np.asarray(mean, dtype=float).flatten()
    cov = np.asarray(cov, dtype=float)
    vals, vecs = np.linalg.eigh(cov)
    order = np.argsort(vals)[::-1]
    vals = np.maximum(vals[order], 1e-18)
    vecs = vecs[:, order]
    width = 2 * n_std * np.sqrt(vals[0])
    height = 2 * n_std * np.sqrt(vals[1])
    angle = np.degrees(np.arctan2(vecs[1, 0], vecs[0, 0]))
    ell = Ellipse(mean, width, height, angle=angle, **kwargs)
    ax.add_patch(ell)


def plot_mean_coordinates(trace, initial_mean=None):
    """
    Evolution of the mean — referans sunum stili:
    solda x1, sağda x2 nesile karşı çizgi grafikleri.
    """
    initial_mean = np.asarray(initial_mean if initial_mean is not None else [0.0, 0.0], dtype=float)
    means_after = np.array([t["mean"] for t in trace], dtype=float)
    means = np.vstack([initial_mean.reshape(1, -1), means_after])
    generations = np.arange(len(means))

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 4), sharex=True)
    ax1.plot(generations, means[:, 0], color="C0", linewidth=1.8)
    ax2.plot(generations, means[:, 1], color="C1", linewidth=1.8)
    ax1.set_title("$x_1$")
    ax2.set_title("$x_2$")
    ax1.set_xlabel("Generation")
    ax2.set_xlabel("Generation")
    ax1.grid(True, alpha=0.35)
    ax2.grid(True, alpha=0.35)
    fig.suptitle("Evolution of the mean", y=1.02, fontsize=13)
    plt.tight_layout()
    plt.show()


def plot_generations(
    generations,
    trace,
    fitness_fn,
    *,
    xlim,
    ylim,
    cmap="cool",
    mu=None,
):
    """
    Her nesilde: kontur zemini, örneklenen populasyon (seçilen / elenen),
    dağılım mean'i (+), sigma^2 C elipsi (siyah kontur).

    trace kayıtlarında 'population', 'fitness', 'dist_mean', 'dist_sigma', 'dist_C'
    olmalı (CMA.search bunları doldurur).
    """
    n_tr = len(trace)
    gens = [g for g in generations if g < n_tr]
    if not gens:
        raise ValueError("Seçilen nesil indeksleri trace uzunluğu ile uyumsuz.")

    x = np.linspace(xlim[0], xlim[1], 140)
    y = np.linspace(ylim[0], ylim[1], 140)
    X, Y = np.meshgrid(x, y)
    pts = np.column_stack([X.ravel(), Y.ravel()])
    Z = np.asarray(fitness_fn(pts)).reshape(X.shape)

    n_panels = len(gens)
    if n_panels == 6:
        nrows, ncols = 2, 3
        figsize = (11, 7)
    else:
        nrows, ncols = 1, n_panels
        figsize = (3.6 * n_panels, 4)

    fig, axes = plt.subplots(nrows, ncols, figsize=figsize, squeeze=False)
    flat_axes = axes.ravel()

    for ax, g in zip(flat_axes, gens):
        t = trace[g]
        ax.contourf(X, Y, Z, levels=35, cmap=cmap, alpha=0.95)

        dist_mean = t.get("dist_mean")
        dist_sig = t.get("dist_sigma")
        dist_C = t.get("dist_C")
        pop = t.get("population")
        fit = t.get("fitness")

        if dist_mean is not None and dist_sig is not None and dist_C is not None:
            cov_full = (float(dist_sig) ** 2) * np.asarray(dist_C)
            draw_confidence_ellipse(
                ax,
                np.asarray(dist_mean),
                cov_full,
                edgecolor="black",
                facecolor="none",
                linewidth=1.8,
            )
            ax.plot(
                float(dist_mean[0]),
                float(dist_mean[1]),
                "+",
                color="black",
                markersize=12,
                markeredgewidth=2,
                zorder=6,
            )

        if pop is not None and fit is not None:
            pop = np.asarray(pop, dtype=float)
            fit = np.asarray(fit, dtype=float).ravel()
            mu_eff = mu if mu is not None else int(t.get("mu", max(1, len(fit) // 4)))
            idx = np.argsort(fit)
            chosen = idx[:mu_eff]
            rest = idx[mu_eff:]
            ax.scatter(
                pop[rest, 0],
                pop[rest, 1],
                s=8,
                c="white",
                alpha=0.35,
                edgecolors="none",
                zorder=3,
                label="discarded" if g == gens[0] else None,
            )
            ax.scatter(
                pop[chosen, 0],
                pop[chosen, 1],
                s=55,
                facecolors="white",
                edgecolors="black",
                linewidths=0.8,
                zorder=5,
                label="selected" if g == gens[0] else None,
            )

        ax.set_title(f"Generation {g}")
        ax.set_xlim(xlim)
        ax.set_ylim(ylim)
        ax.set_xlabel("$x_1$")
        ax.set_ylabel("$x_2$")

    for j in range(len(gens), len(flat_axes)):
        flat_axes[j].set_visible(False)

    if (
        len(gens)
        and trace[gens[0]].get("population") is not None
        and hasattr(flat_axes[0], "get_legend_handles_labels")
    ):
        h, lab = flat_axes[0].get_legend_handles_labels()
        if h:
            flat_axes[0].legend(h, lab, loc="upper right", fontsize=8)

    plt.tight_layout()
    return fig, flat_axes[: len(gens)]


def _bounds_from_enforce(xlim, ylim):
    """pycma: alt ve üst sınırlar (boyut başına)."""
    return [[xlim[0], ylim[0]], [xlim[1], ylim[1]]]


class CMA:
    """CMA-ES runner: pycma CMAEvolutionStrategy + nesil başına trace kaydı."""

    def __init__(
        self,
        initial_solution,
        initial_step_size,
        fitness_function,
        store_trace=True,
        enforce_bounds=None,
        seed=None,
        cma_options=None,
    ):
        self._x0 = list(initial_solution)
        self._sigma0 = float(initial_step_size)
        self._fitness = fitness_function
        self._store_trace = store_trace
        self._enforce = enforce_bounds
        self._seed = seed
        self._extra_opts = dict(cma_options or {})
        self.trace = []
        self._es = None
        self.generation = 0

    def search(self):
        opts = cma_mod.CMAOptions()
        if self._seed is not None:
            opts.set("seed", self._seed)
        if self._enforce is not None:
            xlim, ylim = self._enforce
            opts.set("bounds", _bounds_from_enforce(xlim, ylim))
        for k, v in self._extra_opts.items():
            opts.set(k, v)

        self._es = cma_mod.CMAEvolutionStrategy(self._x0, self._sigma0, opts)
        self.trace = []

        while not self._es.stop():
            dist_mean = np.array(self._es.mean, copy=True)
            dist_sig = float(self._es.sigma)
            dist_C = np.array(self._es.C, copy=True)
            mu = int(self._es.sp.mu)

            X = self._es.ask()
            arr = np.array(X)
            f = self._fitness(arr)
            f = np.atleast_1d(np.asarray(f, dtype=float)).ravel()
            self._es.tell(X, f.tolist())

            if self._store_trace:
                self.trace.append(
                    {
                        "mean": np.array(self._es.mean, copy=True),
                        "sigma": float(self._es.sigma),
                        "C": np.array(self._es.C, copy=True),
                        "generation": int(self._es.countiter),
                        "dist_mean": dist_mean,
                        "dist_sigma": dist_sig,
                        "dist_C": dist_C,
                        "population": arr.copy(),
                        "fitness": f.copy(),
                        "mu": mu,
                    }
                )

        self.generation = int(self._es.countiter)

    def best_solution(self):
        return np.array(self._es.result.xbest, dtype=float)

    def best_fitness(self):
        return float(self._es.result.fbest)
