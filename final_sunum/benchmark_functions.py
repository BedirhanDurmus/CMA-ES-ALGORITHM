"""
Standart benchmark amaç fonksiyonları (NumPy, vektörel).

Schwefel (SFU / CEC tarzı 2.26):
    f(x) = alpha * d - sum_i x_i * sin(sqrt(|x_i|))
    alpha = 418.9828872724339  (Hansen / BBOB ile uyumlu)
    Global minimum ~0, tipik olarak x_i ≈ 420.9687 (pozitif çeyrekte),
    tanım alanı genelde [-500, 500]^d.

Not: Bazı kaynaklarda yanlışlıkla |x_i| * sin(...) yazılır; SFU sürümünde
dış çarpan x_i'dir (negatif bölgelerde yüzey simetrik değildir).
"""

from __future__ import annotations

import numpy as np

# BBOB / Hansen (purecma benzeri) ile aynı hassasiyet
SCHWEFEL_ALPHA = 418.9828872724339


def schwefel(X: np.ndarray) -> np.ndarray:
    X = np.atleast_2d(np.asarray(X, dtype=float))
    d = X.shape[1]
    return SCHWEFEL_ALPHA * d - np.sum(X * np.sin(np.sqrt(np.abs(X))), axis=1)
