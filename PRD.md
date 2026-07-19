# Resume Bullet Optimizer Agent — PRD v1

**Owner:** Raju · **Date:** July 2026 · **Status:** Draft for build
**Supersedes:** `Resume_Bullet_Optimizer_Agent_Plan.docx` (architecture doc — carried forward where noted)

---

## 1. Problem

PM job seekers get screened out at the resume stage, and they can't tell why. The bullets on their resume describe *responsibilities* ("Managed the roadmap for the payments product") rather than *demonstrated competency with evidence* ("Cut payment failure rate 34% by re-sequencing the retry logic roadmap with eng"). They know the bullets are weak. They don't know which ones, what dimension they're weak on, or what a strong version would look like given the facts they actually have.

Existing tools are either generic AI rewriters that fabricate metrics, or paid ATS scanners that return a keyword-match percentage with no explanation of methodology.

## 2. User

**Primary: PM job seekers** — mid-level to senior, applying to product roles, resume already exists in some form.

Narrowing to PM (rather than all knowledge work) is a deliberate scope decision. It lets us hardcode a PM competency model, a PM-specific STAR rubric, and a PM keyword taxonomy. Generic rewriting produces generic bullets; the narrowing is what makes the output good.

**Jobs to be done:**
1. "Tell me which of my bullets are actually weak, and why."
2. "Rewrite them without making anything up."
3. "Tell me what my resume is missing for the roles I want."

## 3. Goals / Non-goals

**Goals**
- Autonomous end-to-end run: user provides input once, reviews finished output.
- Every rewritten bullet is traceable to a claim in the user's source documents.
- Every score shown to the user has a derivation the user (and Raju, on demo day) can explain.
- The agent self-evaluates and self-corrects before presenting results.

**Non-goals (v1)**
- Mock interview / question generation (Module A — future)
- Session history, login, persistence
- Multi-agent orchestration (single agent, multiple tools)
- Full resume rewriting — bullets only, not summary/education/formatting
- Non-PM roles

## 4. Success metrics

**Quality — the metrics that validate the architecture**

| Metric | Target | How measured |
|---|---|---|
| Self-scorer agreement with human labels | ≥80% on accept/reject | Golden set (§8) |
| First-pass acceptance rate | 60–75% | Instrumented across runs |
| Fabrication rate | 0 | Manual audit, 50 bullets |
| Blind human preference (original vs optimized) | ≥70% prefer optimized | Manual, 30 pairs |

First-pass acceptance is a self-diagnostic, not a goal to maximize. ~95% means the scorer is too lenient; ~30% means the rewriter is bad. The band is the signal.

**Product**

| Metric | Target |
|---|---|
| End-to-end run time | <90s for a 2-page resume |
| Runs completing without error | ≥95% |
| Optimized bullets kept by user (kept ÷ optimized) | ≥60% |
| Clarification-pass completion rate | ≥40% |

**Portfolio bar (qualitative):** every number rendered in the UI has a derivation Raju can explain in one sentence. If it can't be explained, it gets cut.

## 5. Scope

### v1 — Competency-model path
Resume + optional experience doc → decompose → score against the PM competency model → rewrite weak bullets → self-score with reason codes → clarification pass → deliver.

No web search. No JD parsing. This removes the flakiest external dependency (JD scraping) and leads with the differentiated feature.

### v2 — JD path
Upload/paste JD, or company+role → web search → generate fallback. Gap analysis against JD requirements. Keyword coverage scoring. Everything else reuses v1 tooling.

### Later
Module A (mock interviews), session persistence, multi-role support.

## 6. User flows

### 6.1 Inputs

| Input | Methods | Required |
|---|---|---|
| Resume | Upload PDF/DOCX, or paste | **Yes** |
| Experience doc | Upload PDF/DOCX, or paste | No |
| Target seniority | Dropdown (APM / PM / Senior PM / Group PM / Director) | No, defaults to PM |

*(v2 adds: JD upload/paste/URL, company name, role name.)*

The experience doc is a free-form brain dump — projects, metrics, things not yet on the resume. It's the raw material that makes rewrites specific rather than reworded. It is optional because most users don't have one prepared; §6.3 recovers the missing information instead.

### 6.2 Agent run (autonomous)

User clicks **Optimize**, watches a live progress log, cannot intervene.

### 6.3 Clarification pass (optional, post-run)

Agent surfaces ≤5 targeted questions for bullets it could not quantify from source material:

> You wrote *"Improved the onboarding flow."* By how much did it improve, and over what period?

User answers any subset (or skips entirely). Agent re-runs the rewriter + scorer for **only** those bullets. Output is complete and usable without this step.

### 6.4 Review

Per bullet: original vs optimized side by side, score breakdown, competency tag, "why" note. Actions: Keep · Revert · Edit · Regenerate-with-prompt.

Plus: competency coverage before/after, flagged bullets, gap summary, Copy All / Download .txt / Start Over.

## 7. Agent specification

### 7.1 PM competency model

The scoring backbone for v1. Every bullet is tagged with the competency it demonstrates (or `NONE`).

| # | Competency | What a strong bullet shows |
|---|---|---|
| 1 | Discovery & user research | Talked to users, synthesized findings, changed direction based on evidence |
| 2 | Prioritization & roadmap | Made a tradeoff, cut something, sequenced against a constraint |
| 3 | Metrics & data-informed decisions | Defined a metric, moved it, or killed something because of it |
| 4 | Cross-functional influence | Aligned eng/design/sales/legal without authority |
| 5 | Execution & delivery | Shipped, on a timeline, through obstacles |
| 6 | Stakeholder & exec communication | Presented up, secured buy-in or budget |
| 7 | Domain / technical depth | Demonstrated credibility in the problem space |

**Why this matters:** it converts the no-JD path from a fallback into the primary insight. *"Your resume is heavy on execution and delivery, and has almost nothing on discovery or metrics — for Senior PM roles, that's the gap that gets you screened out"* is more useful than a keyword percentage, and it's honest about what it measures.

Coverage expectations vary by target seniority (a Director-level resume needs stakeholder communication signal that an APM resume doesn't).

### 7.2 Pipeline

| Step | Tool | Output |
|---|---|---|
| 1. Parse | File Parser (PDF.js / mammoth.js, client-side) | Clean text per document |
| 2. Decompose | LLM, structured output | Tagged bullet list: text, section, company, role, dates |
| 3. Competency map | LLM, structured output | Per-bullet competency tag + strength (strong/weak/none), coverage report |
| 4. Rewrite | LLM | STAR-format rewrite for each weak bullet |
| 5. Self-score | Hybrid (code + LLM) | Composite score + **reason code** per bullet |
| 6. Retry / route | Orchestrator logic | Accept, retry, route to clarification, or flag |
| 7. Compile | Code | Final output object |
| 8. Clarify *(conditional)* | LLM + user input | Re-run of 4–6 for questioned bullets only |

Step 3 replaces the original plan's "Gap Analysis" for v1; that step returns in v2 with JD requirements as the comparison target.

### 7.3 Scoring rubric

| Criterion | Weight | Computed by |
|---|---|---|
| Competency signal | 30% | LLM |
| STAR compliance | 30% | LLM |
| Specificity | 25% | Hybrid — regex for numeric presence, LLM for whether the number is meaningful |
| Format & length | 15% | **Code** — ≤150 chars, single line, LaTeX-safe, action-verb-first |

Composite = weighted average. **Threshold: 70%** (configurable).

Making format/length deterministic removes 15% of the score from LLM judgment entirely, and the specificity regex removes part of another 25%. In v2, keyword match becomes a code-computed string match, pushing the objective share above 45%.

### 7.4 Reason codes — the routing mechanism

The self-scorer emits a reason code alongside the number. This is what makes retries meaningful rather than wasteful.

| Reason code | Cause | Routing |
|---|---|---|
| `WEAK_PHRASING` | Passive voice, no action verb, vague verb | Retry (rewriting can fix this) |
| `NO_STAR_STRUCTURE` | Missing action, context, or result | Retry |
| `TOO_LONG` / `FORMAT_FAIL` | >150 chars, multi-line, unsafe chars | Retry |
| `NO_QUANTIFIABLE_DATA` | Source documents contain no metric for this claim | **Skip retries → clarification pass** |
| `WOULD_REQUIRE_FABRICATION` | Improving would mean inventing a claim | **Never retry → flag for human review** |

**Rationale:** the original plan's 3× retry loop assumes every weak bullet is a *writing* problem. Many are *data* problems — no amount of rewriting invents a metric that isn't in the source. Burning three LLM calls to rediscover that wastes money and, worse, pressures the model toward fabrication. Reason codes route each failure to the mechanism that can actually fix it.

**Retry strategy** (for retryable codes only): attempt 1 — different angle; attempt 2 — different action verb + restructure; attempt 3 — accept best of all attempts. After 3, flag as *Needs Human Review*.

### 7.5 Tool contracts

| Tool | In | Out |
|---|---|---|
| File Parser | File blob | `{text, sourceType}` |
| Resume Decomposer | Resume text, exp doc text | `Bullet[]` |
| Competency Mapper | `Bullet[]`, seniority | `ScoredBullet[]`, `CoverageReport` |
| STAR Rewriter | `Bullet`, source context, attempt#, prior attempts | `{rewrite, rationale}` |
| Self-Scorer | `{original, rewrite, sourceContext}` | `{scores, composite, reasonCode}` |
| Question Generator | `Bullet[]` with `NO_QUANTIFIABLE_DATA` | `Question[]` (≤5) |
| Report Compiler | All of the above | `OutputReport` |

Every LLM tool uses **structured outputs** (`output_config.format` with a JSON schema) so responses are guaranteed parseable — no regex-scraping model output.

### 7.6 Scoring the resume overall

**Competency Coverage**, computed in code, identically before and after:

```
coverage = (competencies with ≥1 strong bullet) / 7
```

Displayed alongside a per-competency bullet count. Before/after use the same function, so the delta is real.

**We do not call this an ATS score.** No applicant tracking system scores resumes this way, and claiming otherwise is the kind of thing that reads as naïve to anyone who knows the space. The label is "Competency Coverage," and the methodology is shown on hover.

## 8. Eval plan

This section is what separates this from a project that merely ships an agent.

**The problem:** the agent grades itself. Same model, same context, and self-evaluation skews generous. Nothing in the architecture validates the grader.

**The golden set:** ~30 bullets — a mix of genuinely strong, mediocre, and weak, spanning all 7 competencies and 3 seniority levels. Each hand-labeled by Raju with: accept/reject, primary competency, and the reason it fails (mapped to the reason-code taxonomy).

**What it measures:**

1. **Accept/reject agreement** — does the scorer's ≥70% call match the human call? Target ≥80%. *This is the number that validates the whole architecture.*
2. **Threshold calibration** — sweep 60/65/70/75/80 against the golden set and pick the threshold that maximizes agreement rather than assuming 70 is right.
3. **Reason-code accuracy** — when the scorer says `NO_QUANTIFIABLE_DATA`, is that actually true? Misrouting here sends users pointless questions.
4. **Competency-tag accuracy** — does the tag match the human label?

**Cadence:** run before launch, and after any change to the rubric, the threshold, or a scoring prompt. Results checked into the repo.

**Fabrication audit:** separately, 50 rewrites manually checked against source documents. Any invented claim is a P0 bug — this is the one metric with zero tolerance.

## 9. Guardrails

**No fabrication.** Rewrites draw only on claims present in the resume or experience doc. The self-scorer explicitly checks for introduced claims and penalizes them. If a bullet cannot be improved without inventing something, it's flagged (`WOULD_REQUIRE_FABRICATION`), never silently improved. Regenerate-with-prompt is subject to the same check — a user prompt asking for an unsupported claim is refused with an explanation.

**Scoring integrity.** The rubric is fixed and shown to the user. The agent cannot inflate its own scores. If the threshold isn't met after 3 retries, the bullet is honestly flagged rather than accepted.

**Honest scoring.** Never labeled "ATS match." Before/after use identical methodology. No keyword stuffing — bullets must stay readable, and the specificity criterion penalizes stuffed text.

**Agent boundaries.** The agent may parse, analyze, rewrite, score, retry, and ask clarifying questions. It may not modify the user's original files, persist data, or make external calls beyond the LLM API. Retries capped at 3/bullet. Tool failures are logged and fall back — never a silent crash.

**Privacy.** Fully stateless. No database, no accounts, no analytics on resume content. Resume text is sent to the LLM API and nowhere else. API keys live in Vercel env vars, never client-side.

**Regeneration limits.** Regenerate runs only the rewriter + scorer for that one bullet. Rejected versions are not repeated. After 5 user-driven regenerations, the UI suggests moving on.

## 10. Architecture

### 10.1 Shape

```
React (Vite + Tailwind)          Vercel serverless
┌──────────────────────┐         ┌─────────────────────┐
│ Client orchestrator  │────────▶│ /api/decompose      │
│  - holds run state   │         │ /api/map-competency │
│  - drives step loop  │         │ /api/rewrite        │
│  - renders live log  │◀────────│ /api/score          │
└──────────────────────┘         │ /api/questions      │
         │                       └─────────────────────┘
         │ client-side                      │
         ▼                                  ▼
   PDF.js / mammoth.js              Claude API (key server-side)
```

**Why the orchestrator lives in the client:** Vercel's free tier caps serverless functions at ~10s. The full pipeline is 6+ LLM calls plus retries — 30–90s realistically. Splitting into per-step endpoints keeps every call comfortably inside the limit, keeps the app on the free tier, gives the progress log for free (each step return is a log line), and makes each step independently testable.

**Tradeoff:** run state lives in browser memory, so a refresh loses the run. Accepted for v1; the run is under 90s. Mitigation: warn on `beforeunload` during an active run.

**API key never reaches the client.** Parsing is client-side (no file upload cost); every LLM call goes through a serverless proxy.

### 10.2 Model configuration

Single LLM service layer; provider and model set by env var so the abstraction stays swappable (a stated goal of the original plan).

**Default: `claude-opus-4-8`** for all tools.

Per-tool model assignment is a config value, so cost/quality can be tuned per step without code changes. Current pricing per million tokens, for planning:

| Model | Input | Output |
|---|---|---|
| `claude-opus-4-8` | $5.00 | $25.00 |
| `claude-sonnet-5` | $3.00 ($2.00 intro thru 2026-08-31) | $15.00 ($10.00 intro) |
| `claude-haiku-4-5` | $1.00 | $5.00 |

The scorer is the highest-volume call (once per rewrite, plus retries) and the most mechanical, so it's the natural first candidate if per-run cost needs to come down — but that's a decision to make against measured cost and measured scorer agreement, not upfront. Changing the scorer model invalidates the golden-set calibration; re-run §8 after any such change.

**Request configuration:**
- `thinking: {type: "adaptive"}` — set explicitly; omitting it on Opus 4.8 means no thinking. Rewriter and competency mapper benefit most.
- `output_config: {effort: ...}` — `high` for rewriter/mapper, `low` for scorer and question generation.
- `output_config: {format: {type: "json_schema", schema: ...}}` on every structured tool.
- **Prompt caching** on the source-document context. The resume + experience doc are re-sent on every rewrite and score call — with 14 bullets and retries that's 30+ requests sharing the same prefix. Put `cache_control: {type: "ephemeral"}` on the last source-context block. Note Opus 4.8's minimum cacheable prefix is 4096 tokens; short resumes won't cache, which is fine.
- `max_tokens`: 4000 for rewrite/score (short outputs), 16000 for decompose.

## 11. Build phases

| # | Deliverable | Days |
|---|---|---|
| 1 | UI scaffold — input, progress log, output shells | 1–2 |
| 2 | Client-side file parsing + text normalization | 2–3 |
| 3 | LLM service layer + first serverless endpoint (decompose) | 3–4 |
| 4 | Client orchestrator — step loop, state machine, progress log | 4–5 |
| 5 | Competency model + mapper tool | 5–6 |
| 6 | STAR rewriter | 6–7 |
| 7 | Self-scorer + reason codes + retry/routing logic | 7–9 |
| 8 | **Golden set + eval harness** | 9–10 |
| 9 | Threshold calibration against golden set | 10 |
| 10 | Clarification pass (questions + targeted re-run) | 10–11 |
| 11 | Output UI — comparison cards, coverage viz, per-bullet actions | 11–13 |
| 12 | Regenerate-with-prompt | 13 |
| 13 | Fabrication audit + fixes | 14 |
| 14 | Deploy, end-to-end test, polish | 14–15 |

**~15 days** (10–12 compressed with Claude Code). Phase 8 is deliberately placed before the output UI — calibrating the threshold before building the UI that displays scores avoids rebuilding the display around a number that turns out to be wrong.

## 12. UI

**Screen 1 — Input.** Resume (required), experience doc (optional, with a hint explaining what it is and why it helps), seniority dropdown. CTA: *Optimize My Resume*.

**Screen 2 — Agent working.** Full-screen styled log, real-time. Step progress ("Step 4 of 7 — Rewriting bullets"). Estimate: ~60s. No intervention possible. The log shows reasoning, not just status:

```
Parsing resume... 14 bullets found across 3 roles.
Mapping to PM competency model...
  Execution & delivery: 6 bullets (strong)
  Metrics & data: 1 bullet (weak)
  Discovery & research: 0 bullets  ← gap
Rewriting bullet 1 of 6...
  Scored 82% — accepted.
Rewriting bullet 2 of 6...
  Scored 54% — reason: WEAK_PHRASING. Retrying with a different angle...
  Retry scored 76% — accepted.
Rewriting bullet 3 of 6...
  Scored 61% — reason: NO_QUANTIFIABLE_DATA. Skipping retries, queued for clarification.
Complete. Coverage 3/7 → 5/7. 4 optimized, 8 kept, 1 flagged, 2 questions queued.
```

**Screen 3 — Output.** Coverage before/after (visual, per-competency). Bullet cards: original (grey) vs optimized (highlighted), score breakdown, competency tag, why-note, actions. Flagged section. Gap summary. Clarification prompt if questions are queued. Export.

## 13. Risks & open questions

| Risk | Impact | Mitigation |
|---|---|---|
| Self-scorer agrees with itself, not with humans | Core architecture claim is unsupported | Golden set (§8) — this is exactly what it tests. If agreement is <80%, make more of the rubric deterministic before shipping. |
| Rewriter fabricates under pressure | Credibility-destroying | `WOULD_REQUIRE_FABRICATION` routing + 50-bullet audit + zero tolerance |
| Client-held state lost on refresh | User re-runs | `beforeunload` warning; accepted for v1 |
| PDF parsing fails on image-only or unusual resumes | Hard stop for that user | Detect empty extraction, show a clear "paste instead" fallback |
| Competency model is wrong or contested | Whole v1 scoring rests on it | Validate against 5–10 real PM job descriptions before building; it's a config file, cheap to revise |
| Per-run cost higher than expected | Not viable to share publicly | Instrument token usage per run in phase 7; prompt caching; per-tool model config is already a lever |
| 30-bullet golden set is too small for confident claims | Overstated eval results | Present as "n=30" explicitly; never round a 26/30 into a clean percentage claim |

**Open questions**
1. Does the competency model need seniority-specific weighting, or is a flat 7-way coverage measure sufficient for v1?
2. Should flagged (`WOULD_REQUIRE_FABRICATION`) bullets show the agent's reasoning, or just the flag?
3. Is 150 characters the right cap? It came from LaTeX single-line rendering — worth verifying against real PM resume templates.
