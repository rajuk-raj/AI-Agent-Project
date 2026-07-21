# Resume Bullet Optimizer Agent

An agent that rewrites product-manager resume points into STAR format against a target job description, scores its own output, and refuses to invent facts.

The interesting part isn't the rewriting — it's what the agent does when it *can't* rewrite something well. Most AI resume tools fabricate a plausible metric when the source material lacks one. This one detects that case, stops, and says what's missing instead.

**Status:** working end to end. The one outstanding item is the golden-set labels that validate the self-scorer — see [Evaluating the agent](#evaluating-the-agent). See [PRD.md](PRD.md) for the full spec.

---

## How it works

You give it four things once — resume, experience notes, job description, target level — then work through your resume a section at a time.

```
setup ──▶ find sections ──▶ pick a section ──▶ per point:
                                                  │
                                    rewrite ──▶ self-score ──▶ route
                                       ▲                        │
                                       └── retry, new angle ◀────┤
                                                                 ├─▶ accept
                                                                 ├─▶ needs a result from you
                                                                 └─▶ left as-is (would fabricate)
```

Each point gets its own box: your original, the JD-tailored line, a match percentage, and a rephrase button. The retries, the rejected drafts, and the fabrication catches all happen inside that box — you see the verdict, not the noise.

### Two numbers, both explainable

**Quality** is what the agent thinks of the writing, scored against a fixed PM competency model — discovery, prioritization, metrics, cross-functional influence, execution, communication, domain depth. That's what produces the actionable version of a coverage report:

> *Your resume is heavy on execution and delivery and has almost nothing on discovery or metrics. For Senior PM roles, that's the gap that gets you screened out.*

**JD match** is fit to the posting you're targeting: term overlap between the point and the single JD requirement it best answers. Computed in code (`shared/jdMatch.js`), so it costs no API call, never drifts between runs, and can be checked by hand — the UI names the requirement matched and lists the words that hit.

Deliberately **not** called an "ATS score." No applicant tracking system works this way, and the label should say what the number actually measures.

### The JD is a lens, not a source

A job posting is full of appealing phrases — *"led cross-functional teams"*, *"drove 30% growth"* — that are claims about the **role**, not facts about you. So the JD reaches the rewriter, to decide which of your real accomplishments to lead with and in what vocabulary, and is kept out of the evidence the fabrication check reads.

Without that split, the agent could launder a job requirement into your resume — worse than inventing a metric, because it isn't even your work.

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

**`eval/labels.csv` is currently unlabelled**, so the self-scorer is not yet validated against anything — the central claim of the architecture is unsupported until those 30 bullets are labelled by hand. Labelling them with a model would measure the scorer against itself and prove nothing, which is precisely the problem the golden set exists to solve.

---

## Running it

Requires Node 20+ and an OpenAI API key.

```bash
npm install
cp .env.example .env.local     # add your key
npm run dev                    # the app, at localhost:5173
```

`SERPER_API_KEY` is optional — without it, JD search is unavailable and you paste or upload the posting instead.

Development harnesses, none of which need the UI:

```bash
python scripts/smoke_test.py   # verify key, model access, structured outputs
node --env-file=.env.local scripts/run_pipeline.mjs
npm test                       # no API key needed, no cost
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
api/          Tool implementations, one per step. Each is one LLM call.
shared/       Provider-independent logic: competency model, scoring,
              retry loop, JD matching. Runs in the browser and in Node.
src/          React app: setup screen, section workspace, point cards.
scripts/      Dev harness, smoke test, eval harness.
eval/         Golden-set corpus and labels.
test/         Unit tests — no API key needed, no cost.
```

State lives in the browser, not on a server: each `/api` route is one short call so it fits a free-tier serverless timeout, and the session sits in `localStorage` so a refresh loses nothing.

The retry loop takes injected dependencies so it can be tested with stubs rather than live calls.

---

## Design notes

**Prompts express preferences; schemas express guarantees.** Three constraints were ignored when stated in a prompt and held immediately once moved into a JSON schema enum or into code: forcing a rewrite target, capping questions per bullet, and preventing leading questions. Anything you depend on belongs in the schema.

**The experience doc matters more than it looks.** On a resume with no supporting detail, the agent honestly can't improve most weak bullets — it says what's missing instead. Fewer accepted rewrites is the correct outcome, not a regression.

**Anything a user might act on gets computed, not judged.** Format, length, and JD match are all code. That isn't only about cost: a number the model produces can't be explained to the person reading it, and an unexplainable percentage on a resume tool is indistinguishable from the keyword-match theatre this was built to avoid.
