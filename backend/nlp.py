from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
import os
from typing import Iterable, List, Optional

import numpy as np


@dataclass
class SemanticMatch:
    text: str
    score: float


@lru_cache(maxsize=1)
def get_embedding_model():
    if os.getenv("USE_SENTENCE_TRANSFORMERS", "").lower() not in {"1", "true", "yes"}:
        return None
    try:
        from sentence_transformers import SentenceTransformer
    except Exception:  # pragma: no cover - optional dependency
        return None
    try:
        return SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")
    except Exception:  # pragma: no cover - model unavailable or offline
        return None


def embed_texts(texts: Iterable[str]) -> np.ndarray:
    model = get_embedding_model()
    items = list(texts)
    if not items:
        return np.zeros((0, 384), dtype=np.float32)
    if model is None:
        return simple_fallback_embeddings(items)
    vectors = model.encode(items, normalize_embeddings=True)
    return np.asarray(vectors, dtype=np.float32)


def simple_fallback_embeddings(texts: List[str]) -> np.ndarray:
    vectors = []
    for text in texts:
        vec = np.zeros(384, dtype=np.float32)
        for idx, token in enumerate(text.lower().split()):
            vec[(hash(token) + idx) % 384] += 1.0
        norm = np.linalg.norm(vec)
        vectors.append(vec / norm if norm else vec)
    return np.vstack(vectors)


def cosine_similarity_matrix(query: str, texts: List[str]) -> List[SemanticMatch]:
    if not texts:
        return []
    vectors = embed_texts([query, *texts])
    query_vec = vectors[0]
    corpus = vectors[1:]
    scores = corpus @ query_vec
    matches = [SemanticMatch(text=text, score=float(score)) for text, score in zip(texts, scores)]
    return sorted(matches, key=lambda item: item.score, reverse=True)


def choose_relevant_memories(query: str, memories: List[str], limit: int = 3) -> List[str]:
    if not memories:
        return []
    ranked = cosine_similarity_matrix(query, memories)
    return [match.text for match in ranked[:limit]]


def semantic_affinity(a: str, b: str) -> float:
    vectors = embed_texts([a, b])
    if len(vectors) < 2:
        return 0.0
    return float(vectors[0] @ vectors[1])
