# Resume Bullet Optimizer Agent

An autonomous agent that rewrites product-manager resume bullets into STAR format, scores its own output, and refuses to invent facts.

The interesting part isn't the rewriting — it's what the agent does when it *can't* rewrite something well. Most AI resume tools fabricate a plausible metric when the source material lacks one. This one detects that case, stops, and asks the candidate instead.

**Status:** pipeline steps 1–8 working end to end. UI in progress. See [PRD.md](PRD.md) for the full spec.

---

## How it works

```
resume.pdf ──▶ decompose ──▶ competency map ──▶ rewrite ──▶ self-score ──▶ route
                                    │                          │            │
                              coverage report            reason code        ├─▶ accept
                              (what's missing)                              ├─▶ retry (different angle)
                                                                            ├─▶ ask the candidate
                                                                            └─▶ flag for human review
```

### Competency model, not keyword matching

v1 scores bullets against a fixed PM competency model — discovery, prioritization, metrics, cross-functional influence, execution, communication, domain depth — rather than against a scraped job description. That turns the output from a keyword percentage into something actionable:

> *Your resume is heavy on execution and delivery and has almost nothing on discovery or metrics. For Senior PM roles, that's the gap that gets you screened out.*

Deliberately **not** called an "ATS score." No applicant tracking system works this way, and the label should say what the number actually measures.

### Reason codes drive routing

The scorer emits a reason alongside the number, because a retry can fix bad writing but cannot invent data that doesn't exist:

| Reason | Route | Why |
|---|---|---|
| `WEAK_PHRASING` / `NO_STAR_STRUCTURE` / `FORMAT_FAIL` | retry | Rewriting can fix this |
| `NO_QUANTIFIABLE_DATA` | ask the candidate | The metric isn't in the source — retrying invites fabrication |
| `DUPLICATES_EXISTING` | retry | The rewrite borrowed another bullet's achievement |
| `WOULD_REQUIRE_FABRICATION` | flag | Never retried; the model already showed it will invent |

`DUPLICATES_EXISTING` exists because of a real failure found in testing: given the whole resume as context, the rewriter would lift a strong metric from a *neighbouring* bullet. It passed the fabrication check — the claim genuinely was in the source — while making the candidate claim one win twice.

### Hybrid scoring

Format and length are computed in code, not judged by the model:

| Criterion | Weight | Computed by |
|---|---|---|
| Competency signal | 30% | LLM |
| STAR compliance | 30% | LLM |
| Specificity | 25% | Hybrid (regex + LLM) |
| Format & length | 15% | **Code** |

Threshold 70%, max 3 retries per bullet.

---

## Evaluating the agent

The agent grades its own rewrites, and self-evaluation skews generous — so there's a golden set to check the grader against human judgment.

```bash
node scripts/make_labelsheet.mjs                      # generates eval/labels.csv
# label the bullets by hand
node --env-file=.env.local scripts/run_eval.mjs --save baseline
```

Reports agreement with your labels, a confusion matrix showing whether the model is systematically too generous or too harsh, and every disagreement with the model's reasoning. Run after any change to a prompt, the rubric, the threshold, or the model.

The corpus deliberately includes cases where two different models gave opposite answers.

---

## Running it

Requires Node 20+ and an OpenAI API key.

```bash
npm install
cp .env.example .env.local     # add your key
python scripts/smoke_test.py   # verify key, model access, structured outputs
node --env-file=.env.local scripts/run_pipeline.mjs
npm test
```

`MAX_BULLETS=0` processes a whole resume; it defaults to 4 to keep exploratory runs cheap.

### Configuration

Models are set per tool in `.env.local`, so cost and quality can be tuned per step without code changes:

```
LLM_MODEL_DECOMPOSE=gpt-4o-mini
LLM_MODEL_REWRITE=gpt-4o-mini
LLM_MODEL_SCORE=gpt-4o-mini
```

Measured during development on a 15-bullet resume: a reasoning model spent **88% of output tokens on reasoning** and ran 4.5× slower for identical coverage results. Decompose is pure extraction, so reasoning there is pure waste.

---

## Layout

```
api/          Tool implementations, one per pipeline step. Each is one LLM call.
shared/       Provider-independent logic: competency model, scoring, retry loop.
scripts/      Dev harness, smoke test, eval harness.
eval/         Golden-set corpus and labels.
test/         Unit tests — no API key needed, no cost.
```

The retry loop takes injected dependencies so it can be tested with stubs rather than live calls.

---

## Design notes

**Prompts express preferences; schemas express guarantees.** Three constraints were ignored when stated in a prompt and held immediately once moved into a JSON schema enum or into code: forcing a rewrite target, capping questions per bullet, and preventing leading questions. Anything you depend on belongs in the schema.

**The experience doc matters more than it looks.** On a resume with no supporting detail, the agent honestly can't improve most weak bullets — it routes them to the clarification pass instead. Fewer accepted rewrites is the correct outcome, not a regression.
