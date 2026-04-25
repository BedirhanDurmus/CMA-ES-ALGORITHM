"""
Saf NumPy ile CMA-ES (Hansen purecma `tell` mantığına yakın, öğretim amaçlı).

pycma/purecma ile aynı iterasyon güncellemeleri; kovaryans PD için özdeğer tabanı uygulanır.
"""

from __future__ import annotations

import numpy as np
from dataclasses import dataclass
from typing import Callable, Optional


@dataclass
class NumpyCMAESResult:
    best_x: np.ndarray
    best_f: float
    n_eval: int
    n_iter: int
    mean_history: np.ndarray  # (n_iter+1, n)


class NumpyCMAES:
    """
    (mu, lambda)-CMA-ES, minimizasyon.
    `bounds = [[low_1,...,low_n],[high_1,...,high_n]]` verilirse örnekler clip edilir.
    """

    def __init__(
        self,
        x0,
        sigma0: float,
        *,
        bounds: Optional[list] = None,
        seed: Optional[int] = None,
        popsize: Optional[int] = None,
        max_iter: int = 10_000,
        max_eval: Optional[int] = None,
        ftol: float = 0.0,
        xtol: float = 0.0,
    ):
        self.rng = np.random.default_rng(seed)
        self.n = len(x0)
        self.m = np.asarray(x0, dtype=float).copy()
        self.sigma = float(sigma0)
        self.C = np.eye(self.n)
        self.pc = np.zeros(self.n)
        self.ps = np.zeros(self.n)

        if popsize is None:
            self.lam = int(4 + np.floor(3 * np.log(self.n)))
        else:
            self.lam = int(popsize)
        self.mu = self.lam // 2

        raw = np.array(
            [
                np.log(self.mu + 0.5) - np.log(i + 1) if i < self.mu else 0.0
                for i in range(self.lam)
            ]
        )
        w_sum = raw[: self.mu].sum()
        self.w_full = raw / w_sum
        self.w = self.w_full[: self.mu]
        self.mu_eff = np.sum(self.w) ** 2 / np.sum(self.w**2)

        N = self.n
        self.cc = (4 + self.mu_eff / N) / (N + 4 + 2 * self.mu_eff / N)
        self.cs = (self.mu_eff + 2) / (N + self.mu_eff + 5)
        self.c1 = 2 / ((N + 1.3) ** 2 + self.mu_eff)
        self.cmu = min(
            1 - self.c1,
            2 * (self.mu_eff - 2 + 1 / self.mu_eff) / ((N + 2) ** 2 + self.mu_eff),
        )
        self.damps = 2 * self.mu_eff / self.lam + 0.3 + self.cs
        self.chi_n = np.sqrt(N) * (1 - 1 / (4 * N) + 1 / (21 * N**2))

        self.bounds = bounds
        if bounds is not None:
            self._low = np.asarray(bounds[0], dtype=float)
            self._high = np.asarray(bounds[1], dtype=float)

        self.max_iter = max_iter
        self.max_eval = max_eval if max_eval is not None else max_iter * self.lam * 2
        self.ftol = ftol
        self.xtol = xtol  # <= 0 ise bu kriter devre dışı

        self.counteval = 0
        self._best_x = self.m.copy()
        self._best_f = np.inf

    def _inv_sqrt(self, C: np.ndarray) -> np.ndarray:
        w, B = np.linalg.eigh(C)
        w = np.maximum(w, 1e-14)
        return B @ np.diag(1.0 / np.sqrt(w)) @ B.T

    def _symmetrize(self):
        self.C = 0.5 * (self.C + self.C.T)

    def ask(self) -> np.ndarray:
        self._symmetrize()
        ev, B = np.linalg.eigh(self.C)
        ev = np.maximum(ev, 1e-14)
        D = np.sqrt(ev)
        X = np.zeros((self.lam, self.n))
        for k in range(self.lam):
            z = self.rng.standard_normal(self.n)
            X[k] = self.m + self.sigma * (B @ (D * z))
        if self.bounds is not None:
            X = np.clip(X, self._low, self._high)
        return X

    def tell(self, X: np.ndarray, fitness: np.ndarray) -> None:
        """Değerlendirilmiş popülasyonla bir nesil güncelle (purecma tell ile uyumlu akış)."""
        fitness = np.asarray(fitness, dtype=float).ravel()
        order = np.argsort(fitness)
        Xs = X[order]
        fit_sorted = fitness[order]

        if fit_sorted[0] < self._best_f:
            self._best_f = float(fit_sorted[0])
            self._best_x = Xs[0].copy()

        m_old = self.m.copy()
        self.m = np.sum(self.w[:, None] * Xs[: self.mu], axis=0)

        y_step = self.m - m_old
        invsqrt = self._inv_sqrt(self.C)
        z = invsqrt @ y_step

        csn = np.sqrt(self.cs * (2 - self.cs) * self.mu_eff) / self.sigma
        self.ps = (1 - self.cs) * self.ps + csn * z

        self.counteval += len(fitness)
        denom = 1 - (1 - self.cs) ** (2 * self.counteval / self.lam)
        denom = max(denom, 1e-14)
        hsig = (
            1.0
            if (np.sum(self.ps**2) / self.n) / denom < (2 + 4.0 / (self.n + 1))
            else 0.0
        )

        ccn = np.sqrt(self.cc * (2 - self.cc) * self.mu_eff) / self.sigma
        self.pc = (1 - self.cc) * self.pc + ccn * hsig * y_step

        c1a = self.c1 * (1 - (1 - hsig**2) * self.cc * (2 - self.cc))

        self.C *= 1 - c1a - self.cmu * np.sum(self.w_full[: self.mu])
        self.C += self.c1 * np.outer(self.pc, self.pc)
        for k in range(self.mu):
            dx = Xs[k] - m_old
            self.C += self.cmu * self.w[k] * np.outer(dx, dx) / (self.sigma**2)

        cn = self.cs / self.damps
        self.sigma *= np.exp(min(1.0, cn * (np.sum(self.ps**2) / self.n - 1) / 2))

        ev, _ = np.linalg.eigh(self.C)
        if np.min(ev) < 1e-14:
            self.C += (1e-14 - np.min(ev)) * np.eye(self.n)

    def minimize(self, fun: Callable[[np.ndarray], np.ndarray]) -> NumpyCMAESResult:
        """fun(X) -> (m,) — satır bazlı fitness vektörü."""
        means = [self.m.copy()]
        it = 0
        prev_best = np.inf

        while it < self.max_iter and self.counteval < self.max_eval:
            X = self.ask()
            f = np.asarray(fun(X), dtype=float).ravel()
            self.tell(X, f)
            means.append(self.m.copy())
            it += 1

            if np.max(np.linalg.eigvalsh(self.C)) > 1e14:
                break
            if self.ftol > 0 and abs(prev_best - self._best_f) < self.ftol and it > 3:
                break
            prev_best = self._best_f
            ev, _ = np.linalg.eigh(self.C)
            if self.xtol > 0 and self.sigma * np.sqrt(np.max(ev)) < self.xtol:
                break

        return NumpyCMAESResult(
            best_x=self._best_x.copy(),
            best_f=float(self._best_f),
            n_eval=int(self.counteval),
            n_iter=it,
            mean_history=np.vstack(means),
        )
