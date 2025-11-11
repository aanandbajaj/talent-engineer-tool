from __future__ import annotations

import hashlib
from typing import Iterable, List
from array import array
import math

try:
    import numpy as np  # type: ignore
    USE_NUMPY = True
except Exception:  # pragma: no cover
    np = None  # type: ignore
    USE_NUMPY = False

from .config import get_settings


settings = get_settings()


class SimpleEmbedder:
    """Hashing-based bag-of-words embedder for prototypes.

    - Lowercase, split on whitespace, basic punctuation strip
    - Hash tokens to a fixed-dim vector with signed counts
    - L2 normalize
    """

    def __init__(self, dim: int | None = None):
        self.dim = dim or settings.embed_dim

    def _tokenize(self, text: str) -> list[str]:
        return [
            t.strip(".,:;()[]{}\"'\n\t !?-_/").lower()
            for t in text.split()
            if t and t.isascii()
        ]

    def embed(self, text: str):
        if USE_NUMPY:
            vec = np.zeros(self.dim, dtype=np.float32)
            for tok in self._tokenize(text):
                h = int(hashlib.md5(tok.encode("utf-8")).hexdigest(), 16)
                i = h % self.dim
                sign = -1.0 if (h >> 1) & 1 else 1.0
                vec[i] += sign
            n = float(np.linalg.norm(vec))
            if n > 0:
                vec /= n
            return vec
        else:
            vec: List[float] = [0.0] * self.dim
            for tok in self._tokenize(text):
                h = int(hashlib.md5(tok.encode("utf-8")).hexdigest(), 16)
                i = h % self.dim
                sign = -1.0 if (h >> 1) & 1 else 1.0
                vec[i] += sign
            # L2 normalize
            norm = math.sqrt(sum(v * v for v in vec))
            if norm > 0:
                vec = [v / norm for v in vec]
            return vec

    def embed_bytes(self, text: str) -> bytes:
        v = self.embed(text)
        if USE_NUMPY:
            return v.astype("float32").tobytes()
        arr = array("f", [float(x) for x in v])
        return arr.tobytes()

    def embed_many(self, texts: Iterable[str]):
        return [self.embed(t) for t in texts]


def cosine_similarity(a, b) -> float:
    if USE_NUMPY:
        if a.shape != b.shape:
            raise ValueError("shape mismatch")
        denom = float(np.linalg.norm(a) * np.linalg.norm(b))
        if denom == 0:
            return 0.0
        return float(np.dot(a, b) / denom)
    # list-based
    if len(a) != len(b):
        raise ValueError("shape mismatch")
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    denom = na * nb
    return dot / denom if denom else 0.0
