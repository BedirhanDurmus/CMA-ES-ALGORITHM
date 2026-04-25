"""CMA-ES interaktif web arayuzu (Flask + Plotly)."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

import cma
import numpy as np
from flask import Flask, jsonify, render_template, request

_HERE = Path(__file__).resolve().parent
_PARENT = _HERE.parent  # final_sunum/
sys.path.insert(0, str(_PARENT))

from benchmark_functions import SCHWEFEL_ALPHA, schwefel as schwefel_fn  # noqa: E402


BENCHMARKS = {
    "schwefel": {
        "label": "Schwefel",
        "bounds": [[-500.0, 500.0], [-500.0, 500.0]],
        "x0": [0.0, 0.0],
        "sigma": 1000.0,
        "formula": (
            f"f(x) = {SCHWEFEL_ALPHA:.13f}·n − Σ x_i sin(√|x_i|) "
            "(SFU; dış çarpan x_i, |x_i| değil)"
        ),
        "optimum": [420.9687, 420.9687],
    },
    "rastrigin": {
        "label": "Rastrigin",
        "bounds": [[-5.12, 5.12], [-5.12, 5.12]],
        "x0": [3.0, 3.0],
        "sigma": 2.0,
        "formula": "f(x) = 10 n + Σ (x_i² − 10 cos(2π x_i))",
        "optimum": [0.0, 0.0],
    },
    "sphere": {
        "label": "Sphere",
        "bounds": [[-5.0, 5.0], [-5.0, 5.0]],
        "x0": [3.0, 3.0],
        "sigma": 1.5,
        "formula": "f(x) = Σ x_i²",
        "optimum": [0.0, 0.0],
    },
    "himmelblau": {
        "label": "Himmelblau",
        "bounds": [[-5.0, 5.0], [-5.0, 5.0]],
        "x0": [0.0, 0.0],
        "sigma": 1.5,
        "formula": "f(x, y) = (x² + y − 11)² + (x + y² − 7)²",
        "optimum": [3.0, 2.0],
    },
    "ackley": {
        "label": "Ackley",
        "bounds": [[-5.0, 5.0], [-5.0, 5.0]],
        "x0": [2.0, 2.0],
        "sigma": 1.0,
        "formula": "Ackley",
        "optimum": [0.0, 0.0],
    },
}


def rastrigin(X: np.ndarray) -> np.ndarray:
    X = np.atleast_2d(X).astype(float)
    d = X.shape[1]
    return 10 * d + np.sum(X**2 - 10 * np.cos(2 * np.pi * X), axis=1)


def sphere(X: np.ndarray) -> np.ndarray:
    X = np.atleast_2d(X).astype(float)
    return np.sum(X**2, axis=1)


def himmelblau(X: np.ndarray) -> np.ndarray:
    X = np.atleast_2d(X).astype(float)
    x, y = X[:, 0], X[:, 1]
    return (x**2 + y - 11) ** 2 + (x + y**2 - 7) ** 2


def ackley(X: np.ndarray) -> np.ndarray:
    X = np.atleast_2d(X).astype(float)
    d = X.shape[1]
    s1 = np.sum(X**2, axis=1)
    s2 = np.sum(np.cos(2 * np.pi * X), axis=1)
    return (
        -20.0 * np.exp(-0.2 * np.sqrt(s1 / d))
        - np.exp(s2 / d)
        + 20.0
        + np.e
    )


FN_MAP = {
    "schwefel": schwefel_fn,
    "rastrigin": rastrigin,
    "sphere": sphere,
    "himmelblau": himmelblau,
    "ackley": ackley,
}


def ellipse_points(mean, cov, n_std=2.0, n=60):
    vals, vecs = np.linalg.eigh(cov)
    vals = np.maximum(vals, 1e-16)
    t = np.linspace(0, 2 * np.pi, n)
    circle = np.vstack([np.cos(t), np.sin(t)])
    scaled = vecs @ np.diag(n_std * np.sqrt(vals)) @ circle
    return (scaled.T + np.asarray(mean)).tolist()


def collect_frames(
    fn, x0, sigma0, bounds, max_iter=60, popsize=None, seed=42
):
    """Iterasyon iterasyon CMA-ES durumunu topla (pycma kütüphanesi ile)."""
    # collect_frames'e gelen bounds formatı: [[low_x, low_y], [high_x, high_y]]
    lower = [float(v) for v in bounds[0]]
    upper = [float(v) for v in bounds[1]]

    opts = {
        "bounds": [lower, upper],
        "seed": int(seed),
        "maxiter": int(max_iter),
        "verbose": -9,
        "tolx": 1e-14,
        "tolfun": 1e-14,
        "tolfunhist": 1e-14,
        "CMA_stds": None,
    }
    if popsize is not None:
        opts["popsize"] = int(popsize)

    es = cma.CMAEvolutionStrategy(list(map(float, x0)), float(sigma0), opts)

    lam = int(es.sp.popsize)
    sp: Any = es.sp
    mu = int(sp.weights.mu)

    frames = []
    best_x = np.asarray(x0, dtype=float).copy()
    best_f = float(fn(best_x.reshape(1, -1))[0])

    mean0 = np.asarray(es.mean, dtype=float)
    C0 = np.asarray(es.C, dtype=float)
    frames.append(
        {
            "iter": 0,
            "mean": mean0.tolist(),
            "mean_f": float(fn(mean0.reshape(1, -1))[0]),
            "sigma": float(es.sigma),
            "ellipse": ellipse_points(mean0, (es.sigma**2) * C0),
            "population": [],
            "fitness": [],
            "selected_idx": [],
            "best_f": float(best_f),
            "best_x": best_x.tolist(),
            "mu": mu,
            "lam": lam,
        }
    )

    it = 0
    while it < max_iter:
        mean_pre = np.asarray(es.mean, dtype=float).copy()
        sigma_pre = float(es.sigma)
        C_pre = np.asarray(es.C, dtype=float).copy()

        X_list = es.ask()
        X = np.asarray(X_list, dtype=float)
        f = np.asarray(fn(X), dtype=float).ravel()

        order = np.argsort(f)
        selected = order[:mu].tolist()

        i_best_local = int(order[0])
        if f[i_best_local] < best_f:
            best_f = float(f[i_best_local])
            best_x = X[i_best_local].copy()

        es.tell(X_list, f.tolist())
        it += 1

        mean_post = np.asarray(es.mean, dtype=float)
        C_post = np.asarray(es.C, dtype=float)

        frames.append(
            {
                "iter": it,
                "mean_pre": mean_pre.tolist(),
                "sigma_pre": sigma_pre,
                "ellipse_pre": ellipse_points(mean_pre, (sigma_pre**2) * C_pre),
                "mean": mean_post.tolist(),
                "mean_f": float(fn(mean_post.reshape(1, -1))[0]),
                "sigma": float(es.sigma),
                "ellipse": ellipse_points(mean_post, (es.sigma**2) * C_post),
                "population": X.tolist(),
                "fitness": f.tolist(),
                "selected_idx": selected,
                "best_f": float(best_f),
                "best_x": best_x.tolist(),
                "mu": mu,
                "lam": lam,
            }
        )

        if es.stop():
            break

    return frames, {
        "best_f": float(best_f),
        "best_x": best_x.tolist(),
        "n_iter": it,
        "n_eval": int(es.countevals),
        "stop": {k: str(v) for k, v in (es.stop() or {}).items()},
    }


def run_multistart_best(
    fn,
    *,
    name: str,
    use_multistart: bool,
    x0,
    sigma0: float,
    bounds,
    max_iter: int,
    popsize: int | None,
    seed: int,
):
    """Multi-modal fonksiyonlarda lokal minimum riskini azaltmak için çoklu deneme."""
    if not use_multistart:
        return collect_frames(
            fn=fn,
            x0=x0,
            sigma0=sigma0,
            bounds=bounds,
            max_iter=max_iter,
            popsize=popsize,
            seed=seed,
        )

    # Schwefel / Rastrigin için daha güçlü arama:
    # - farklı başlangıç tohumları
    # - farklı sigma ölçekleri
    if name in {"schwefel", "rastrigin"}:
        # Sigma'yı aralık genişliğine göre makul bandda tut.
        x_span = abs(bounds[1][0] - bounds[0][0])
        y_span = abs(bounds[1][1] - bounds[0][1])
        max_span = max(x_span, y_span)
        sigma_base = float(np.clip(sigma0, 0.03 * max_span, 0.55 * max_span))
        sigma_scales = [0.65, 1.0, 1.35]
        seeds = [seed + i * 37 for i in range(4)]
    else:
        sigma_base = float(sigma0)
        sigma_scales = [1.0]
        seeds = [seed]

    x0_candidates = [np.asarray(x0, dtype=float)]
    if name == "schwefel":
        # Schwefel çok dalgalı olduğundan farklı başlangıç havuzu kullan.
        # Bu sayede lokal minimuma takılma olasılığı belirgin şekilde azalır.
        sigma_base = float(np.clip(sigma0, 20.0, 180.0))
        x0_candidates.extend(
            [
                np.array([350.0, 350.0], dtype=float),
                np.array([420.9687, 420.9687], dtype=float),
                np.array([-420.9687, 420.9687], dtype=float),
                np.array([420.9687, -420.9687], dtype=float),
            ]
        )
        rng = np.random.default_rng(seed)
        for _ in range(4):
            x0_candidates.append(
                np.array(
                    [
                        rng.uniform(bounds[0][0], bounds[1][0]),
                        rng.uniform(bounds[0][1], bounds[1][1]),
                    ],
                    dtype=float,
                )
            )

    best_frames = None
    best_summary = None
    best_val = np.inf

    for x0_try in x0_candidates:
        for s in seeds:
            for sc in sigma_scales:
                frames, summary = collect_frames(
                    fn=fn,
                    x0=x0_try.tolist(),
                    sigma0=float(sigma_base * sc),
                    bounds=bounds,
                    max_iter=max_iter,
                    popsize=popsize,
                    seed=int(s),
                )
                val = float(summary["best_f"])
                if val < best_val:
                    best_val = val
                    best_frames = frames
                    best_summary = summary

    return best_frames, best_summary


def surface_grid(fn, bounds, n=70):
    xs = np.linspace(bounds[0][0], bounds[0][1], n)
    ys = np.linspace(bounds[1][0], bounds[1][1], n)
    X, Y = np.meshgrid(xs, ys)
    pts = np.column_stack([X.ravel(), Y.ravel()])
    Z = np.asarray(fn(pts)).reshape(X.shape)
    return xs.tolist(), ys.tolist(), Z.tolist()


app = Flask(__name__)


def _to_bool(value, default=True):
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        v = value.strip().lower()
        if v in {"1", "true", "yes", "on", "evet"}:
            return True
        if v in {"0", "false", "no", "off", "hayir", "hayır"}:
            return False
    return default


@app.route("/")
def index():
    return render_template("index.html", benchmarks=BENCHMARKS)


@app.route("/api/run", methods=["POST"])
def api_run():
    data = request.get_json(force=True)
    name = data.get("function", "schwefel").lower()
    if name not in FN_MAP:
        return jsonify({"error": f"unknown function {name}"}), 400
    fn = FN_MAP[name]

    meta = BENCHMARKS[name]
    bounds_default = meta["bounds"]
    try:
        xmin = float(data.get("xmin", bounds_default[0][0]))
        xmax = float(data.get("xmax", bounds_default[0][1]))
        ymin = float(data.get("ymin", bounds_default[1][0]))
        ymax = float(data.get("ymax", bounds_default[1][1]))
        x0 = [float(data.get("x0", meta["x0"][0])), float(data.get("y0", meta["x0"][1]))]
        sigma0 = float(data.get("sigma", meta["sigma"]))
        max_iter = int(data.get("max_iter", 60))
        popsize_raw = data.get("popsize", None)
        popsize = int(popsize_raw) if popsize_raw not in (None, "", "auto") else None
        seed = int(data.get("seed", 42))
        multi_start = _to_bool(data.get("multi_start", True), default=True)
    except (TypeError, ValueError) as exc:
        return jsonify({"error": f"bad parameters: {exc}"}), 400

    bounds = [[xmin, ymin], [xmax, ymax]]

    frames, summary = run_multistart_best(
        fn=fn,
        name=name,
        use_multistart=multi_start,
        x0=x0,
        sigma0=sigma0,
        bounds=bounds,
        max_iter=max_iter,
        popsize=popsize,
        seed=seed,
    )
    grid_n = 140 if name == "schwefel" else 70
    xs, ys, zs = surface_grid(fn, [[xmin, xmax], [ymin, ymax]], n=grid_n)

    optimum = meta["optimum"]
    optimum_f = float(fn(np.asarray(optimum, dtype=float).reshape(1, -1))[0])

    return jsonify(
        {
            "function": name,
            "label": meta["label"],
            "surface": {"x": xs, "y": ys, "z": zs},
            "bounds": {"x": [xmin, xmax], "y": [ymin, ymax]},
            "frames": frames,
            "summary": summary,
            "meta": {
                "optimum": optimum,
                "optimum_f": optimum_f,
                "formula": meta["formula"],
            },
        }
    )


# ============================================================
# Demo: Hava sahası — CMA-ES ile "öğrenen uçak" parkur demosu
# ------------------------------------------------------------
# MLP (8 -> 8 -> 1, tanh) ağırlıkları tek vektör θ (81 boyut).
# CMA-ES θ'yı optimize eder; her birey bir rollout yapar.
# ============================================================

AIRFIELD_WORLD_W = 1.5
AIRFIELD_WORLD_H = 1.0
AIRFIELD_SPEED = 0.025
AIRFIELD_MAX_TURN = 0.25
AIRFIELD_N_IN = 8
AIRFIELD_N_HID = 8
AIRFIELD_N_OUT = 1
AIRFIELD_N_PARAMS = (
    AIRFIELD_N_IN * AIRFIELD_N_HID + AIRFIELD_N_HID
    + AIRFIELD_N_HID * AIRFIELD_N_OUT + AIRFIELD_N_OUT
)  # 64 + 8 + 8 + 1 = 81


def _airfield_unpack(theta: np.ndarray):
    i = 0
    W1 = theta[i:i + AIRFIELD_N_IN * AIRFIELD_N_HID].reshape(
        AIRFIELD_N_HID, AIRFIELD_N_IN
    )
    i += AIRFIELD_N_IN * AIRFIELD_N_HID
    b1 = theta[i:i + AIRFIELD_N_HID]
    i += AIRFIELD_N_HID
    W2 = theta[i:i + AIRFIELD_N_HID * AIRFIELD_N_OUT].reshape(
        AIRFIELD_N_OUT, AIRFIELD_N_HID
    )
    i += AIRFIELD_N_HID * AIRFIELD_N_OUT
    b2 = theta[i:i + AIRFIELD_N_OUT]
    return W1, b1, W2, b2


def _airfield_policy(x: np.ndarray, theta: np.ndarray) -> float:
    W1, b1, W2, b2 = _airfield_unpack(theta)
    h = np.tanh(W1 @ x + b1)
    o = np.tanh(W2 @ h + b2)
    return float(o[0])


def _airfield_features(pos, heading, goal, obstacles):
    """Plane-local frame feature vector (length 8)."""
    c = np.cos(-heading)
    s = np.sin(-heading)
    R = np.array([[c, -s], [s, c]], dtype=float)

    g_rel = R @ (goal - pos)
    g_rel = np.clip(g_rel / max(AIRFIELD_WORLD_W, AIRFIELD_WORLD_H), -1.5, 1.5)

    obs_feats = []
    if obstacles:
        dists = np.array(
            [np.linalg.norm(np.asarray(oc) - pos) for oc, _ in obstacles],
            dtype=float,
        )
        order = np.argsort(dists)[:3]
        for i in order:
            oc, _ = obstacles[i]
            rel = R @ (np.asarray(oc) - pos)
            obs_feats.extend([float(rel[0]), float(rel[1])])

    while len(obs_feats) < 6:
        obs_feats.append(0.0)

    return np.concatenate([g_rel, np.asarray(obs_feats, dtype=float)])


def make_airfield_map(seed: int, difficulty: str):
    rng = np.random.default_rng(int(seed))
    n_obs_map = {"easy": 3, "medium": 5, "hard": 7}
    n_obs = n_obs_map.get(difficulty.lower(), 5)

    start = np.array([0.08, 0.5], dtype=float)
    goal = np.array([AIRFIELD_WORLD_W - 0.08, 0.5], dtype=float)
    goal_r = 0.08

    obstacles: list[dict] = []

    # 1) At least one obstacle directly on the line between start and goal,
    #    to force meaningful learning (otherwise theta=0 flies straight).
    attempts = 0
    while attempts < 300:
        attempts += 1
        cx = rng.uniform(0.45, AIRFIELD_WORLD_W - 0.4)
        cy = rng.uniform(0.46, 0.54)
        r = rng.uniform(0.07, 0.10)
        if np.linalg.norm([cx - start[0], cy - start[1]]) < r + 0.12:
            continue
        if np.linalg.norm([cx - goal[0], cy - goal[1]]) < r + goal_r + 0.05:
            continue
        obstacles.append({"c": [float(cx), float(cy)], "r": float(r)})
        break
    if not obstacles:
        obstacles.append({"c": [0.75, 0.5], "r": 0.09})

    # 2) Fill the rest with random non-overlapping circles.
    attempts = 0
    while len(obstacles) < n_obs and attempts < 5000:
        attempts += 1
        cx = rng.uniform(0.22, AIRFIELD_WORLD_W - 0.22)
        cy = rng.uniform(0.14, AIRFIELD_WORLD_H - 0.14)
        r = rng.uniform(0.06, 0.11)
        if np.linalg.norm([cx - start[0], cy - start[1]]) < r + 0.12:
            continue
        if np.linalg.norm([cx - goal[0], cy - goal[1]]) < r + goal_r + 0.04:
            continue
        ok = True
        for o in obstacles:
            if np.linalg.norm(
                [cx - o["c"][0], cy - o["c"][1]]
            ) < r + o["r"] + 0.035:
                ok = False
                break
        if not ok:
            continue
        obstacles.append({"c": [float(cx), float(cy)], "r": float(r)})

    return {
        "start": start.tolist(),
        "start_heading": 0.0,
        "goal": {"center": goal.tolist(), "radius": goal_r},
        "obstacles": obstacles,
        "bounds": [[0.0, 0.0], [AIRFIELD_WORLD_W, AIRFIELD_WORLD_H]],
    }


def _airfield_rollout(theta, map_data, max_steps: int):
    start = np.asarray(map_data["start"], dtype=float)
    goal = np.asarray(map_data["goal"]["center"], dtype=float)
    goal_r = float(map_data["goal"]["radius"])
    obstacles = [
        (np.asarray(o["c"], dtype=float), float(o["r"]))
        for o in map_data["obstacles"]
    ]

    pos = start.copy()
    heading = float(map_data.get("start_heading", 0.0))
    traj = [[float(pos[0]), float(pos[1]), float(heading)]]

    status = "timeout"
    reached_step = max_steps
    min_goal_dist = float(np.linalg.norm(pos - goal))

    theta_arr = np.asarray(theta, dtype=float)

    for t in range(max_steps):
        feats = _airfield_features(pos, heading, goal, obstacles)
        turn_cmd = _airfield_policy(feats, theta_arr)
        heading += turn_cmd * AIRFIELD_MAX_TURN
        pos = pos + AIRFIELD_SPEED * np.array(
            [np.cos(heading), np.sin(heading)], dtype=float
        )
        traj.append([float(pos[0]), float(pos[1]), float(heading)])

        if not (
            0.0 <= pos[0] <= AIRFIELD_WORLD_W
            and 0.0 <= pos[1] <= AIRFIELD_WORLD_H
        ):
            status = "oob"
            break

        crashed = False
        for oc, orr in obstacles:
            if np.linalg.norm(pos - oc) < orr:
                crashed = True
                break
        if crashed:
            status = "crash"
            break

        d_goal = float(np.linalg.norm(pos - goal))
        if d_goal < min_goal_dist:
            min_goal_dist = d_goal
        if d_goal < goal_r:
            status = "goal"
            reached_step = t + 1
            break

    d_end = float(np.linalg.norm(pos - goal))
    if status == "goal":
        fitness = float(reached_step)
    elif status == "crash":
        fitness = float(max_steps) + 200.0 * min_goal_dist + 50.0
    elif status == "oob":
        fitness = float(max_steps) + 200.0 * min_goal_dist + 100.0
    else:  # timeout
        fitness = float(max_steps) + 200.0 * min_goal_dist

    return {
        "fitness": float(fitness),
        "trajectory": traj,
        "status": status,
        "reached_step": int(reached_step) if status == "goal" else -1,
        "d_end": d_end,
        "min_goal_dist": min_goal_dist,
    }


def optimize_airfield(
    map_data, *, n_iter: int = 25, max_steps: int = 100, seed: int = 42
):
    theta0 = np.zeros(AIRFIELD_N_PARAMS, dtype=float)
    sigma0 = 0.5

    opts = {
        "seed": int(seed) + 1,  # pycma requires seed > 0
        "maxiter": int(n_iter),
        "verbose": -9,
        "tolx": 1e-14,
        "tolfun": 1e-14,
        "tolfunhist": 1e-14,
    }

    es = cma.CMAEvolutionStrategy(theta0.tolist(), sigma0, opts)
    pop_size = int(es.sp.popsize)

    generations = []
    best_f = float("inf")
    best_theta = theta0.copy()

    it = 0
    while it < n_iter:
        thetas = es.ask()
        rollouts = [_airfield_rollout(th, map_data, max_steps) for th in thetas]
        fitnesses = [r["fitness"] for r in rollouts]
        trajectories = [r["trajectory"] for r in rollouts]
        statuses = [r["status"] for r in rollouts]
        reached_count = sum(1 for s in statuses if s == "goal")

        idx = int(np.argmin(fitnesses))
        if fitnesses[idx] < best_f:
            best_f = float(fitnesses[idx])
            best_theta = np.asarray(thetas[idx], dtype=float).copy()

        es.tell(thetas, fitnesses)
        it += 1

        generations.append({
            "iter": it,
            "best_f": float(min(fitnesses)),
            "best_idx": idx,
            "mean_f": float(np.mean(fitnesses)),
            "sigma": float(es.sigma),
            "pop_size": pop_size,
            "reached": reached_count,
            "best_so_far_f": float(best_f),
            "trajectories": trajectories,
            "statuses": statuses,
            "fitnesses": [float(x) for x in fitnesses],
            "best_theta": best_theta.tolist(),
        })

        if es.stop():
            break

    return {
        "generations": generations,
        "summary": {
            "best_f": float(best_f),
            "n_iter": it,
            "n_eval": int(es.countevals),
            "pop_size": pop_size,
            "n_params": AIRFIELD_N_PARAMS,
            "reached_last": (
                int(generations[-1]["reached"]) if generations else 0
            ),
        },
    }


@app.route("/api/airfield-cma", methods=["POST"])
def api_airfield():
    data = request.get_json(force=True) or {}
    try:
        seed = int(data.get("seed", 42))
        difficulty = str(data.get("difficulty", "medium")).lower()
        n_iter = int(data.get("n_iter", 25))
        max_steps = int(data.get("max_steps", 100))
    except (TypeError, ValueError) as exc:
        return jsonify({"error": f"bad parameters: {exc}"}), 400

    n_iter = max(3, min(n_iter, 80))
    max_steps = max(30, min(max_steps, 200))
    if difficulty not in ("easy", "medium", "hard"):
        difficulty = "medium"

    map_data = make_airfield_map(seed=seed, difficulty=difficulty)
    result = optimize_airfield(
        map_data, n_iter=n_iter, max_steps=max_steps, seed=seed
    )

    return jsonify({
        "map": map_data,
        "config": {
            "nn": {
                "layers": [AIRFIELD_N_IN, AIRFIELD_N_HID, AIRFIELD_N_OUT],
                "n_params": AIRFIELD_N_PARAMS,
            },
            "max_steps": max_steps,
            "speed": AIRFIELD_SPEED,
            "max_turn": AIRFIELD_MAX_TURN,
            "seed": seed,
            "difficulty": difficulty,
        },
        "generations": result["generations"],
        "summary": result["summary"],
    })


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False)
