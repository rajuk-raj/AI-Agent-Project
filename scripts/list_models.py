"""
List models this project's key can actually access.

Removes guesswork about model names and per-project allowlists.
Usage:  python scripts/list_models.py
"""

import json
import sys
import urllib.request
import urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def load_key():
    env = ROOT / ".env.local"
    if not env.exists():
        sys.exit(".env.local not found.")
    for line in env.read_text(encoding="utf-8").splitlines():
        if line.strip().startswith("OPENAI_API_KEY="):
            return line.split("=", 1)[1].strip()
    sys.exit("OPENAI_API_KEY not found in .env.local")


def main():
    key = load_key()
    req = urllib.request.Request(
        "https://api.openai.com/v1/models",
        headers={"Authorization": f"Bearer {key}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            data = json.loads(r.read())
    except urllib.error.HTTPError as e:
        sys.exit(f"HTTP {e.code}: {e.read().decode()[:300]}")

    ids = sorted(m["id"] for m in data.get("data", []))
    print(f"{len(ids)} models accessible to this project\n")

    # Group so the useful ones are easy to spot.
    buckets = {
        "chat / general": [],
        "reasoning": [],
        "other (embeddings, audio, image, moderation)": [],
    }
    for mid in ids:
        low = mid.lower()
        if any(k in low for k in ("embedding", "whisper", "tts", "dall-e", "audio",
                                  "moderation", "image", "realtime", "transcribe", "search")):
            buckets["other (embeddings, audio, image, moderation)"].append(mid)
        elif low.startswith(("o1", "o3", "o4")) or "nano" in low or "reasoning" in low:
            buckets["reasoning"].append(mid)
        else:
            buckets["chat / general"].append(mid)

    for name, items in buckets.items():
        if not items:
            continue
        print(f"  {name}")
        for m in items:
            print(f"    {m}")
        print()

    print("Set LLM_MODEL_* in .env.local to any id from the first two groups.")


if __name__ == "__main__":
    main()
