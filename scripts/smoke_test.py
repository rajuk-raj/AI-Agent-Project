"""
Pre-flight check for the OpenAI account. Run before building further.

Reads OPENAI_API_KEY from .env.local (never prints it), then verifies:
  1. the key authenticates
  2. the configured model is reachable on this account
  3. strict structured outputs work (every tool depends on this)
  4. reports token usage so per-run cost can be estimated

Usage:  python scripts/smoke_test.py
"""

import json
import os
import sys
import urllib.request
import urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = ROOT / ".env.local"


def load_env(path):
    """Minimal .env parser - avoids a dependency just to read five lines."""
    values = {}
    if not path.exists():
        return values
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        values[k.strip()] = v.strip().strip('"').strip("'")
    return values


def fail(msg, hint=None):
    print(f"\n  FAIL  {msg}")
    if hint:
        print(f"        {hint}")
    sys.exit(1)


def main():
    env = load_env(ENV_FILE)
    key = env.get("OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY", "")
    model = env.get("LLM_MODEL_SCORE") or "gpt-4o-mini"

    print("Resume Bullet Optimizer - pre-flight check")
    print("=" * 46)

    if not ENV_FILE.exists():
        fail(".env.local not found.",
             "Run:  Copy-Item .env.example .env.local   then add your key.")
    if not key:
        fail("OPENAI_API_KEY is empty in .env.local.",
             "Paste your key after OPENAI_API_KEY= (no quotes needed).")

    # Never print the key. Fingerprint only, so you can tell which one is loaded.
    print(f"  key      loaded ({len(key)} chars, ends ...{key[-4:]})")
    print(f"  model    {model}")

    # A strict schema exercises the exact mechanism every tool relies on.
    schema = {
        "type": "object",
        "properties": {
            "ok": {"type": "boolean"},
            "verb": {"type": "string"},
        },
        "required": ["ok", "verb"],
        "additionalProperties": False,
    }

    def build_payload(include_temperature):
        p = {
            "model": model,
            "messages": [
                {"role": "system", "content": "You extract data. Reply only via the schema."},
                {"role": "user", "content": 'Bullet: "Shipped the payments retry flow." Set ok=true and verb to the opening verb, lowercased.'},
            ],
            "response_format": {
                "type": "json_schema",
                "json_schema": {"name": "smoke", "strict": True, "schema": schema},
            },
            # Generous budget: on reasoning models, internal reasoning tokens are
            # billed against this limit. Too low and the model spends the whole
            # allowance thinking and returns empty content.
            "max_completion_tokens": 2000,
        }
        if include_temperature:
            p["temperature"] = 0
        return p

    def post(payload):
        req = urllib.request.Request(
            "https://api.openai.com/v1/chat/completions",
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read())

    def http_error_detail(e):
        try:
            return json.loads(e.read()).get("error", {})
        except Exception:
            return {}

    supports_temperature = True
    try:
        body = post(build_payload(True))
    except urllib.error.HTTPError as e:
        detail = http_error_detail(e)
        code, msg, param = detail.get("code", ""), detail.get("message", str(e)), detail.get("param", "")

        # Reasoning models reject temperature. Detect and retry rather than fail.
        if e.code == 400 and (param == "temperature" or "temperature" in msg.lower()):
            supports_temperature = False
            print("  note     model rejects 'temperature' - retrying without it")
            try:
                body = post(build_payload(False))
            except urllib.error.HTTPError as e2:
                d2 = http_error_detail(e2)
                fail(f"HTTP {e2.code}: {d2.get('message', str(e2))}")
            except Exception as e2:
                fail(f"Could not reach the API: {e2}")
        elif e.code == 401:
            fail(f"Authentication rejected: {msg}",
                 "Key is invalid or revoked. Generate a new one at platform.openai.com/api-keys")
        elif code == "insufficient_quota":
            fail("Account has no available credit.",
                 "The API bills separately from ChatGPT Plus. Add credit at platform.openai.com/billing")
        elif code == "model_not_found" or "does not exist" in msg.lower():
            fail(f"Model '{model}' is not available on this account.",
                 "Check platform.openai.com/docs/models and update LLM_MODEL_* in .env.local")
        elif e.code == 429:
            fail(f"Rate limited: {msg}", "Wait a moment and retry, or lower LLM_MAX_RPM.")
        else:
            fail(f"HTTP {e.code}: {msg}")
    except Exception as e:
        fail(f"Could not reach the API: {e}", "Check your network connection.")

    choice = body["choices"][0]
    if choice["message"].get("refusal"):
        fail(f"Model refused: {choice['message']['refusal']}")

    usage = body.get("usage", {})
    reasoning = (usage.get("completion_tokens_details") or {}).get("reasoning_tokens", 0)
    content = choice["message"].get("content") or ""

    if not content.strip():
        fail(
            f"Model returned empty content (finish_reason={choice.get('finish_reason')}, "
            f"reasoning_tokens={reasoning}).",
            "Reasoning consumed the whole token budget. Raise maxOutputTokens in api/_llm.js.",
        )

    try:
        data = json.loads(content)
    except json.JSONDecodeError:
        fail("Model returned unparseable output despite a strict schema.")

    if set(data) != {"ok", "verb"}:
        fail(f"Schema not honored. Got keys: {sorted(data)}")

    print("  auth     OK")
    print("  schema   OK  -> " + json.dumps(data))
    print(f"  tokens   {usage.get('prompt_tokens', 0)} in / "
          f"{usage.get('completion_tokens', 0)} out"
          + (f"  (of which {reasoning} reasoning)" if reasoning else ""))

    print("\n  PASS - account is ready. Safe to build against.\n")

    # Report what the model actually supports so config matches reality.
    print("  Apply to .env.local:")
    print(f"    LLM_OMIT_TEMPERATURE={'true' if not supports_temperature else 'false'}")
    if reasoning:
        print(f"\n  This is a reasoning model ({reasoning} reasoning tokens on a trivial call).")
        print("  Reasoning tokens are billed as output and count against max_completion_tokens,")
        print("  so per-run cost and token budgets both need re-baselining.")


if __name__ == "__main__":
    main()
