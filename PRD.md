# Resume Bullet Optimizer Agent — PRD v1.4

**Owner:** Raju · **Date:** July 2026 · **Status:** Workspace flow shipping end to end; eval labels outstanding
**Supersedes:** `Resume_Bullet_Optimizer_Agent_Plan.docx` (architecture doc — carried forward where noted)
**Repo:** https://github.com/rajuk-raj/AI-Agent-Project

## Changelog — v1.6 → v1.7 (bands, roster scoring, two guardrail bugs)

**Every match now carries a band beside the percentage** — *strong fit* ≥60, *partial fit* ≥30, *weak fit* below — plus the point gain when a rewrite improves on the original. The percentage alone was being read as a school grade: 42% on a good line looks like failure, when term overlap with verbose requirement sentences simply tops out low.

**Rosters are scored against the things the posting names**, not against prose overlap — a list of eleven tools has no sentence to overlap with. The card reads "3 of 5 · strong fit", and the working panel names which ones and what is missing.

The denominator excludes prose keywords. Measured: a Tools line holding *every* tool the posting named scored "3 of 13 — weak fit", because the other ten keywords were phrases like "merchant activation" that belong in a bullet, not a tool list. Proper nouns and acronyms are the filter, with a fallback for Title Cased postings where capitalisation carries no signal. Gaps are computed resume-wide — scoped to one section, the panel told a candidate they don't list SQL while SQL sat in their Technical Skills line two boxes away.

**Bug: experience notes were treated as rival bullets.** `siblingClaims` fed every note into the rewriter as an achievement belonging to another point. So "Ran weekly experiments on the signup funnel" was refused the "34% to 52%" from the note about that exact work — `DUPLICATES_EXISTING` firing on the one source the rewrite was supposed to draw from, which defeats the experience doc's entire purpose (§4.1 note 6). Only resume content counts as claimed elsewhere.

**Bug: sections were mis-filed with no notes supplied.** The model tagged a job `source: "experience"` on an empty notes field, filing it under a tab the user had no reason to open. Forced in code.

**Open — the self-scorer is rejecting sound rewrites.** In a live run, two of two well-grounded drafts were refused: *"Built merchant activation dashboards in Mixpanel, reducing reporting time from 2 days to 2 hours"* was called a duplicate of a bullet it shares nothing with, and a correct funnel rewrite was flagged as fabricating a phrase it did not contain. Both are supported verbatim by the notes.

This is exactly the failure §8 exists to quantify, and it cannot be fixed by adjusting prompts on a hunch — the reason codes are wrong, not just strict, and guessing at them risks trading a false reject for a false accept, which is far worse. **`eval/labels.csv` is still unlabelled.** Until it isn't, nothing measures how often the grader is right.

## Changelog — v1.5 → v1.6 (every section reachable)

**Sections were being silently dropped.** The extraction prompt said to skip "a bare skills list" and education without accomplishments, so a resume's Skills & Tools block never appeared and could not be found by search. A heading the user cannot reach is a part of their resume the product refuses to touch without saying so. The rule is now: index everything except contact details.

**Nested headings are preserved.** `parentHeading` on each section, so "Certification & Training" holding two programmes reads the way it does on the page instead of as two unrelated entries. Bold inline labels — `Technical Skills:`, `Tools:` — become sections in their own right under their parent.

**Rosters are reordered, not rewritten** (`kind: 'list'`). A skills line has no action and no result, so there is nothing for the STAR rewriter to do with it; asking a model to "tailor my skills to this job" is the single prompt most likely to add a skill the candidate never claimed, and a skills list is exactly what gets probed in a screening call.

So `shared/listTailor.js` does it in code: split the list, move the items the posting asks for to the front, keep relative order otherwise, and verify the output is a permutation of the input before returning. Reordering cannot invent. It also costs no API call — measured on an 11-item Tools line, Figma / JIRA / Mixpanel moved to the front for zero tokens.

## Changelog — v1.4 → v1.5 (STAR in the schema, JD chased not guaranteed)

**STAR moved from the prompt into the schema.** The rewriter must now return `star.situationTask`, `star.action`, and `star.result`, quoted from its own output, with `result` nullable. Same lesson as §13's other three constraints: stating STAR as a rule produced bullets the model *called* STAR, while requiring the parts makes a missing Result a fact the code can act on. The UI now says plainly when Situation and Action are present but the documents state no outcome.

**The loop aims each point at 90% JD match** (`JD_MATCH_TARGET`). When a rewrite is accurate but distant from the posting, it retries with the requirement it came closest to and the words it didn't use.

**A guaranteed 90% was requested and is not implementable.** Three measurements, all on live runs:

| Case | Result |
|---|---|
| Bullet ideally suited to the posting — "weekly experiments on the SME activation funnel, activation 28% → 41%" against a Growth PM ad | **25%**, and a targeted retry moved it 0 points |
| KYC bullet chased across 4 attempts | JD match fell **25% → 13%**, and the rewrite traded "drop-off from 41% to 23%" for "enhance onboarding efficiency" |
| Typical accepted rewrites | 60–80% where the posting's wording overlaps, far lower where it doesn't |

The ceiling is structural. Requirements are verbose sentences ("6+ years of experience…", "Think in systems, love solving root problems") and a 150-character bullet cannot overlap most of their words while staying readable. Forcing every point over 90% means stuffing the posting's vocabulary into bullets, which §9 forbids, which recruiters discard on sight, and which turns the number into a measurement of itself. A metric optimised to a fixed target stops carrying information.

So the target is an **aim with rails**, and the UI reports what was actually reached:

- the chase stops as soon as an attempt fails to beat the previous best — one wasted call, not three
- a higher JD match can never promote a rewrite the scorer rejected; only accepted attempts are eligible
- a rewrite stating a real outcome always beats one that dropped it, whatever it scores on fit
- an accept banked early survives a later attempt that fails

**"Left as-is" now means the original stands.** Rejected drafts were being displayed under "FINAL LINE — TAILORED TO THE JD" beside a "left as-is" badge, and with a JD loaded that could advertise a *drop* in match as the tailored version. The draft moved to the working panel.

**Open — the number's calibration.** A perfect bullet scoring 25% reads as a broken tool. The fix is presentation, not another rewrite pass: normalise against the best score that requirement can support, or show bands rather than a raw percentage. Not done here because it changes what every number on screen means.

## Changelog — v1.3 → v1.4 (JD-first workspace)

The four inputs are now supplied together and up front: **resume, experience notes, job description, target level.** The JD moved from a panel inside the workspace to the setup screen, because it changes what every rewrite optimises for — collecting it after the analysis meant the first section was written against no target.

**Sections are chosen per document.** A Resume / Experience notes switcher sits at the top of the workspace. The two are different jobs — resume points get reworked in place, notes are raw material coming onto the resume for the first time — and mixing them in one list obscured that.

**Each point box now carries a JD match percentage**, before and after. New module `shared/jdMatch.js`.

**It is not called an ATS score**, which is what was originally asked for. Per §9, the label has to say what the number measures: term overlap between the bullet and the single JD requirement it best answers. Every percentage in the UI names that requirement and lists the words that matched, so any number can be checked by hand. Calling it an ATS score would claim knowledge of a scoring system no applicant tracking system actually implements.

It is computed **in code, not by the model** — the same reasoning as the format criterion in §7.3. It costs no call, so every point can show a before *and* after; it is deterministic, so the same bullet never scores differently twice; and it is inspectable. The denominator is floored at 3 terms and capped at 6, so a one-word requirement can't award 100% on an incidental match and a rambling one isn't unmatchable by a 150-character bullet.

**The JD still never reaches the fabrication check.** Match scoring reads the JD to rank wording; nothing in that path can put a posting's claim into a candidate's bullet. The §1.3 split holds.

**STAR remains best-effort, not forced.** A point whose source material contains no outcome gets the strongest STAR-shaped version the documents support and a "needs a result from you" note. Emitting a complete STAR sentence for every point would mean inventing Results, which is the failure the product exists to refuse.

**Removed:** the retired autonomous run's leftovers — `src/lib/orchestrator.js`, `InputScreen.jsx`, `OutputScreen.jsx`, `ProgressLog.jsx`, and the unused `generate` prompts in `api/_prompts.js`. Nothing imported them after v1.2. The `api/generate.js` route named in the v1.2 changelog was itself superseded by point-by-point rewriting and no longer exists.

**Known limitation:** section-level coverage counts requirements a bullet cannot answer — "5+ years in product management" is a biography fact, not an achievement — so the "speaks to N of M" denominator reads low. Honest but pessimistic; splitting requirements into demonstrable and biographical is a v1.5 item.

## Changelog — v1.2 → v1.3 (JD path)

The v2 JD path from v1.0, brought forward. Company + role → Serper search → fetch the posting → structure it. The user reviews what was found and can paste or replace it.

**The JD is a lens, not a source.** This is the load-bearing design decision. A job posting is full of appealing phrases — *"led cross-functional teams"*, *"drove 30% growth"* — that are claims about the **role**, not facts about the candidate. So the JD:

- goes into the **rewriter's** prompt, to decide which true accomplishment to lead with and what vocabulary to use
- is **excluded** from the documents the scorer's fabrication check treats as evidence

Without that split, the agent could launder a job requirement into someone's resume — worse than fabricating a metric, because it isn't even their work.

Verified: the same bullet, same source notes, aimed at an ops-efficiency role vs a risk-platform role, produced *"Streamlined disputes process, reducing manual handling by 60%"* vs *"Aligned risk, engineering, and legal teams on evidence format"*. Different emphasis, no invented facts.

**Provenance is always shown**, per §4.3: `pasted` / `fetched from a live posting` / `assembled from search snippets`, with the source URL and a warning when the JD is fragments rather than a real ad.

**Explicitly not built: generating a JD from the model's knowledge of a company.** It would read plausibly, be unverifiable, and mean tailoring a resume to an invented standard — the same failure the product refuses everywhere else. If search finds nothing, the user pastes the posting or proceeds without one.

**Security:** fetched pages are untrusted input. They are wrapped as data, the extraction prompt instructs the model to ignore any instructions found inside them, and URL fetching is restricted to public http/https hosts.

## Changelog — v1.1 → v1.2 (flow change)

**The product is now a directed workspace, not a one-shot autonomous run.** Requested after using v1.1: optimizing a whole resume in one pass is not how anyone actually writes one. People work on a section, get it right, then move on.

| Was (v1.1) | Now (v1.2) |
|---|---|
| Upload → agent processes every bullet → review results | Upload once → ask for a section → refine it → ask for the next |
| Agent decides what to work on | **You** decide, per request |
| Rewrites existing bullets only | Generates new bullets from experience notes **and** reworks existing ones |
| Inputs re-entered per run | Inputs persist for the session (`localStorage`) |
| Full-screen progress log | Self-correction runs inside each generation; surfaced per bullet as "working · N%" |

**This changes the autonomy story, and that should be stated plainly rather than papered over.** The original plan's framing — *"AI Tool: user drives every step"* vs *"AI Agent: agent runs autonomously"* — put the product on the autonomous side. v1.2 moves the human back between steps.

What makes it still an agent is unchanged and now runs per generation: it decides whether to rework an existing bullet or write a new one, scores its own drafts, silently retries the ones a rewrite can fix, drops the ones that would duplicate or fabricate, and refuses user instructions it cannot honour. The demo-day line shifts from *"it runs unattended"* to *"you never see the drafts it rejected."*

**New:** `api/generate.js` (request → heading + bullets) and `api/refine.js` (bullet + instruction → revision, or a refusal). Refusal is the notable one: asked to "say it increased productivity by 40%", the agent declines and names the missing evidence rather than complying.

**Retired:** the whole-resume autonomous run. One product, not two half-maintained paths.

## Changelog — v1.0 → v1.1

Revisions forced by building the thing. Each is a claim in v1.0 that contact with a real resume disproved.

| # | Change | Why |
|---|---|---|
| 1 | Provider is **OpenAI (`gpt-4o-mini`)**, not Claude | §10.2 rewritten. Measured, not assumed — see below. |
| 2 | Added reason code **`DUPLICATES_EXISTING`** | The rewriter lifted metrics from *neighbouring bullets*. Passed the fabrication check (the claim was genuinely in the source) while making the candidate claim one win twice. 3 of 4 rewrites were contaminated before this was caught. |
| 3 | Rewrite queue is **everything not `strong`**, not just `weak` | Gating on `weak` silently dropped duty statements the model happened to label `none` — the exact bullets the product exists to fix. Six of ten were being skipped. |
| 4 | Added **`potentialCompetency`** (schema-enforced) | Bullets tagged `NONE` gave the rewriter no target. |
| 5 | Run time target **revised: 2–4 min**, not <90s | Measured: 23 model calls for a 10-bullet resume. |
| 6 | Experience doc reclassified **optional → strongly recommended** | Without one, most weak bullets have no supporting data and route to clarification. Fewer rewrites is the honest outcome, but the input screen must say so. |
| 7 | Reasoning models rejected for this pipeline | Measured: 88% of output tokens spent on reasoning, 4.5× slower, identical coverage. |
| 8 | Golden set moved **before** the rewriter in priority | Two models disagreed outright on the same bullets. Neither can be ground truth. |

**Still open:** gap-aware targeting doesn't work yet. Coverage correctly flags Prioritization and Cross-functional influence as missing, but the mapper assigns `potentialCompetency` per bullet with no view of those gaps, so it keeps aiming at Domain instead. The bullets that could close the gaps exist; the targeting doesn't reach them.

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

| Metric | Target | Status |
|---|---|---|
| End-to-end run time | **2–4 min** for a 1-page resume | Measured: ~2 min / 23 calls for 10 bullets |
| Runs completing without error | ≥95% | Not yet measured |
| Optimized bullets kept by user (kept ÷ optimized) | ≥60% | Needs real users |
| Clarification-pass completion rate | ≥40% | Needs real users |

*Revised in v1.1.* The original <90s target was written before any calls were made. The pipeline is one call per step plus two per rewrite attempt; a 10-bullet resume is 23 calls. Sub-90s is not reachable without parallelising bullets, which the free-tier rate limits do not allow. The progress log is the mitigation — a 2-minute wait is acceptable when the user can watch the agent working, and unacceptable behind a spinner.

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
| Resume | Upload PDF/DOCX/TXT, or paste | **Yes** |
| Experience doc | Upload PDF/DOCX/TXT, or paste | Optional — **strongly recommended** |
| Target seniority | Dropdown (APM / PM / Senior PM / Group PM / Director) | No, defaults to PM |

*(v2 adds: JD upload/paste/URL, company name, role name.)*

The experience doc is a free-form brain dump — projects, metrics, things not yet on the resume. It's the raw material that makes rewrites specific rather than reworded.

**Reclassified in v1.1.** v1.0 called this "optional" and treated §6.3 as the fallback. Testing showed the fallback *is* the common path without it: on a resume with no supporting detail, most weak bullets have no data to draw on, so the agent honestly parks them as questions rather than improving them. On the sample resume that meant 2 improved and 3 parked. That is correct behavior, but "we couldn't help with most of your resume" is a poor first impression, so the input screen now warns explicitly when the field is left empty.

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
| `DUPLICATES_EXISTING` | The rewrite claims an achievement belonging to a different bullet | Retry (then flag if exhausted) |
| `WOULD_REQUIRE_FABRICATION` | Improving would mean inventing a claim | **Never retry → flag for human review** |

**On `DUPLICATES_EXISTING` (added in v1.1, after it happened).** Given the whole resume as context, the rewriter treats it as one undifferentiated pool of facts and attaches the nearest strong metric to whichever bullet it is working on. This is *not* caught by the fabrication check — the claim genuinely is in the source — and it scores *well*, because it borrowed a quantified result. It is therefore checked **before** the threshold, not after: correctness gates quality. Both the rewriter and the scorer now receive the other bullets explicitly.

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

**Provider: OpenAI. Default `gpt-4o-mini` for all tools.**

Per-tool model assignment is an env var (`LLM_MODEL_DECOMPOSE`, `LLM_MODEL_REWRITE`, …), so cost and quality can be tuned per step without code changes. That abstraction was exercised twice during the build — Claude → Gemini → OpenAI — and each switch touched one file, `api/_llm.js`.

**Reasoning models were tested and rejected.** Measured on the same 15-bullet resume:

| | gpt-5-nano (reasoning) | gpt-4o-mini |
|---|---|---|
| Wall time, 2 calls | 67.8s | **15.0s** |
| Output tokens | 11,213 | **1,266** |
| Reasoning overhead | 88% | 0% |
| Coverage result | 4/7 | 4/7 |

Identical output quality, 4.5× slower, ~9× the output tokens — and reasoning bills at the output rate. Decompose is the clearest case: it burned 3,584 reasoning tokens transcribing text it was explicitly told not to alter. Extraction needs no deliberation.

**Structured outputs are load-bearing, not a convenience.** Every tool uses strict `json_schema`. Three constraints were ignored when expressed as prompt instructions and held immediately when moved into a schema enum or into code:

| Constraint | As a prompt instruction | As a schema/code constraint |
|---|---|---|
| Rewrite target must not be `NONE` | Ignored on 9 of 10 bullets | Enum excludes `NONE` — impossible |
| One clarifying question per bullet | Fired 3 at one bullet | Deduped in `api/questions.js` |
| Don't ask leading questions | *"By what percentage did satisfaction improve?"* | `questionType` enum steers the form |

**Prompts express preferences; schemas express guarantees.** Anything the product depends on belongs in the second category.

**Measured cost basis:** a 10-bullet resume with no experience doc costs **23 model calls / ~25K tokens**. Retries and the per-bullet source context dominate. Input tokens are the larger share, since resume + all sibling bullets are re-sent on every rewrite and score call.

## 11. Build phases

| # | Deliverable | Status |
|---|---|---|
| 1 | LLM service layer (`api/_llm.js`) | **Done** |
| 2 | Competency model + deterministic scoring, unit-tested | **Done** — 36 tests |
| 3 | Decompose + competency mapper | **Done** |
| 4 | STAR rewriter | **Done** |
| 5 | Self-scorer + reason codes + retry/routing | **Done** |
| 6 | Duplication guard (`DUPLICATES_EXISTING`) | **Done** — added after live testing |
| 7 | Clarification pass (questions + answer folding) | **Done** |
| 8 | Golden set + eval harness | **Built — awaiting 30 hand labels** |
| 9 | UI: setup, section workspace, per-point boxes | **Done** — v1.4 shape |
| 10 | Client-side file parsing (PDF / DOCX / TXT) | **Done** — resume, notes, and JD all accept files |
| 11 | Threshold calibration against golden set | Blocked on #8 |
| 12 | Gap-aware rewrite targeting | **Done** — the rewriter is told when its target closes a gap |
| 13 | Rephrase, with or without an instruction (per-point) | **Done** — `api/refine.js`, refusal included |
| 14 | Fabrication audit (50 bullets) | Not started |
| 15 | Vercel deploy | Not started |
| 16 | JD match per point (`shared/jdMatch.js`) | **Done** — 10 tests |

**Phase 8 is the critical path.** The golden set's 30 bullets are written and the harness runs, but `eval/labels.csv` has no human labels in it, so nothing currently validates the self-scorer — the claim §8 exists to support is unsupported until Raju fills that in. Labelling it with a model would measure the scorer against itself and prove nothing.

**~15 days** (10–12 compressed with Claude Code). Phase 8 is deliberately placed before the output UI — calibrating the threshold before building the UI that displays scores avoids rebuilding the display around a number that turns out to be wrong.

## 12. UI

Two screens. The autonomous run's three-screen flow (input → progress log → output) was retired in v1.2 and the log with it; self-correction now happens inside each point and surfaces as a verdict on that point's box.

**Screen 1 — Setup.** All four inputs, together, before any work starts:

| Input | Required | Accepts |
|---|---|---|
| Resume | yes | paste, or PDF / DOCX / TXT |
| Experience notes | no, but strongly recommended | paste, or PDF / DOCX / TXT |
| Target level | yes (defaults to PM) | dropdown — sets which competencies count as gaps |
| Job description | no | paste, upload, or company + role via search |

The JD is collected here rather than later because it changes what every rewrite optimises for. Provenance is shown the moment one resolves (§1.3): pasted / fetched / assembled from snippets.

One analysis pass (~20s) then finds the sections in both documents.

**Screen 2 — Workspace.** A **Resume / Experience notes** switcher at the top picks which document's sections are listed. Choosing a section rewrites every point under it, one at a time, each landing as it finishes.

**One point, one box:**

```
Point 1     JD MATCH 58% → 79%                       improved
──────────────────────────────────────────────────────────────
YOUR ORIGINAL
KYC rework took two quarters, ran 18 merchant interviews
first, drop-off went 41% to 23%.

FINAL LINE — TAILORED TO THE JD              quality 76%
Conducted 18 merchant interviews during a two-quarter KYC
rework, improving onboarding drop-off from 41% to 23%.

[↻ Rephrase]  [Rephrase with a note]  [Edit]        [working]
```

Two percentages, deliberately named apart: **JD match** is fit to the posting (§1.4), **quality** is the §7.3 composite — STAR, competency, specificity, format. An unlabelled number beside another unlabelled number is a guessing game.

*Rephrase* runs the loop again with every version already shown ruled out, so it changes angle rather than resampling. *Rephrase with a note* takes an instruction and may refuse it — asked to claim a number the documents don't support, it declines and names what's missing.

*working* expands the derivation: the criterion scores, the JD requirement matched and the words that hit it, the facts drawn from the candidate's documents, and any earlier versions rephrased past. Every number on the screen can be traced from there.

**Not built:** export beyond copy-to-clipboard, and the clarification pass. Questions still generate (`api/questions.js`) and are covered by tests, but no screen asks them — the workspace tells the user what's missing on the point itself and lets them add it to their notes. Wiring the question flow back in is a v1.5 item.


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
