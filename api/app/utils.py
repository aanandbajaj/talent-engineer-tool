from __future__ import annotations

from collections import Counter
from typing import Iterable


def reconstruct_openalex_abstract(inv_idx: dict[str, list[int]]) -> str:
    if not inv_idx:
        return ""
    max_pos = 0
    for positions in inv_idx.values():
        if positions:
            max_pos = max(max_pos, max(positions))
    words = [None] * (max_pos + 1)
    for word, positions in inv_idx.items():
        for p in positions:
            if p < len(words):
                words[p] = word
    return " ".join(w for w in words if w)


STOPWORDS = set(
    """
    a an the and or of for to in on with from that this these those via using use
    is are was were be been being as by at we our their his her its it they them
    into over under about within without not no yes can could should would may might
    method methods results introduction conclusion abstract study paper dataset data
    model models approach approaches new propose proposed show shows work works
    learning machine deep neural network networks transformer transformers large
    language languages based task tasks performance state art sota
    """.split()
)


def top_keywords(chunks: Iterable[str], k: int = 8) -> list[str]:
    counts: Counter[str] = Counter()
    for text in chunks:
        tokens = [t.lower().strip(".,:;()[]{}\"'\n\t ") for t in text.split()]
        for tok in tokens:
            if not tok or tok in STOPWORDS or not tok.isalpha() or len(tok) < 3:
                continue
            counts[tok] += 1
    return [w for w, _ in counts.most_common(k)]


def normalized_score(value: float, lo: float, hi: float) -> float:
    if hi <= lo:
        return 0.0
    v = max(lo, min(hi, value))
    return (v - lo) / (hi - lo)

