from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional


@dataclass
class GeminiSettings:
    api_key: Optional[str] = None
    model: str = "gemini-2.0-flash"


def get_gemini_settings() -> GeminiSettings:
    return GeminiSettings(
        api_key=os.getenv("GEMINI_API_KEY"),
        model=os.getenv("GEMINI_MODEL", "gemini-2.0-flash"),
    )


def generate_text(prompt: str, context: str = "") -> str:
    settings = get_gemini_settings()
    if not settings.api_key:
        return ""
    try:
        from google import genai
    except Exception:
        return ""

    client = genai.Client(api_key=settings.api_key)
    parts = [{"text": prompt}]
    if context:
        parts.append({"text": context})
    response = client.models.generate_content(
        model=settings.model,
        contents=[{"role": "user", "parts": parts}],
    )
    return getattr(response, "text", "") or ""

