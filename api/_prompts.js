/**
 * Prompts and response schemas, one per tool.
 *
 * Kept separate from the tools themselves so they can be diffed, reviewed, and
 * A/B'd against the golden set without touching orchestration logic. Prompt
 * changes invalidate eval calibration — re-run the harness after editing.
 *
 * STRICT SCHEMA RULES (OpenAI structured outputs):
 *   - every object needs `additionalProperties: false`
 *   - every property must appear in `required`
 *   - optional fields are expressed as a nullable type, e.g. ["string","null"]
 */

import { COMPETENCIES } from '../shared/competencyModel.js';

/* ------------------------------------------------------------------ *
 * decompose — resume text -> individual bullets with metadata
 * ------------------------------------------------------------------ */

export const DECOMPOSE_SCHEMA = {
  type: 'object',
  properties: {
    bullets: {
      type: 'array',
      description: 'Every bullet point found, in document order.',
      items: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: 'The bullet copied VERBATIM from the resume. Never reworded.',
          },
          section: {
            type: 'string',
            enum: ['EXPERIENCE', 'PROJECTS', 'SKILLS', 'EDUCATION', 'OTHER'],
          },
          company: { type: ['string', 'null'] },
          role: { type: ['string', 'null'] },
          period: {
            type: ['string', 'null'],
            description: 'Dates as written, e.g. "Jan 2023 - Present". Null if absent.',
          },
        },
        required: ['text', 'section', 'company', 'role', 'period'],
        additionalProperties: false,
      },
    },
  },
  required: ['bullets'],
  additionalProperties: false,
};

export const DECOMPOSE_SYSTEM = `You extract structured data from resumes. You are a parser, not an editor.

Rules:
- Copy each bullet's text VERBATIM. Do not reword, shorten, fix grammar, or improve anything. Downstream steps depend on seeing the original exactly as the candidate wrote it.
- Extract only bullets that describe work: accomplishments, responsibilities, projects. Skip headers, contact details, dates on their own line, and section titles.
- Attribute each bullet to the company, role, and period under which it appears. Use null when the resume does not state one - never guess.
- A multi-line bullet that wraps in the source is ONE bullet; join it into a single line.
- If the text contains no resume bullets at all, return an empty array.`;

export function decomposePrompt({ resumeText, experienceText }) {
  const parts = [`<resume>\n${resumeText.trim()}\n</resume>`];

  if (experienceText?.trim()) {
    // The experience doc is context for later steps, not a source of bullets.
    // Extracting from it here would put content on the resume that the
    // candidate never actually wrote there.
    parts.push(
      `<experience_doc>\n${experienceText.trim()}\n</experience_doc>`,
      'The experience doc is supplementary context only. Extract bullets from the RESUME only.'
    );
  }

  return parts.join('\n\n');
}

/* ------------------------------------------------------------------ *
 * competency — bullets -> competency tag + strength
 * ------------------------------------------------------------------ */

const COMPETENCY_ENUM = [...COMPETENCIES.map((c) => c.id), 'NONE'];

/**
 * potentialCompetency deliberately omits NONE.
 *
 * Asking for this in the prompt did not work — the model anchored on
 * competency=NONE and copied it across, leaving the rewriter with no target on
 * 9 of 10 queued bullets. Strict structured outputs constrain the decoder, so
 * removing NONE from the enum makes the failure impossible rather than
 * discouraged. Prefer schema enforcement over prompt instruction whenever the
 * constraint is expressible as a type.
 */
const POTENTIAL_COMPETENCY_ENUM = COMPETENCIES.map((c) => c.id);

export const COMPETENCY_SCHEMA = {
  type: 'object',
  properties: {
    assessments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: {
            type: 'integer',
            description: 'Zero-based index of the bullet being assessed.',
          },
          competency: { type: 'string', enum: COMPETENCY_ENUM },
          potentialCompetency: {
            type: 'string',
            enum: POTENTIAL_COMPETENCY_ENUM,
            description:
              'The competency this bullet could credibly demonstrate if rewritten well, based on the ' +
              'work it describes. This is the rewriter\'s target and must always be a real competency. ' +
              'When the bullet is already strong, repeat its competency.',
          },
          strength: { type: 'string', enum: ['strong', 'weak', 'none'] },
          rationale: {
            type: 'string',
            description: 'One sentence. Shown to the user, so make it specific and actionable.',
          },
          hasQuantifiedResult: {
            type: 'boolean',
            description: 'True only if the bullet states a measurable outcome.',
          },
        },
        required: [
          'index',
          'competency',
          'potentialCompetency',
          'strength',
          'rationale',
          'hasQuantifiedResult',
        ],
        additionalProperties: false,
      },
    },
  },
  required: ['assessments'],
  additionalProperties: false,
};

export const COMPETENCY_SYSTEM = `You assess product-manager resume bullets against a fixed competency model.

${COMPETENCIES.map((c) => `- ${c.id}: ${c.label}. Strong when it shows: ${c.shows}.`).join('\n')}
- NONE: does not demonstrate any of the above (e.g. a skills list or a pure duty statement).

Assign exactly one competency per bullet - the one it MOST demonstrates. Do not spread credit.

Strength - apply this test strictly:

- "strong": demonstrates the competency AND states a concrete OUTCOME - something that changed as a result of the work. A number is the usual evidence; a specific verifiable non-numeric change also counts.
- "weak": describes real work but states no outcome. This includes activities and duties: presenting, attending, managing, owning, participating, being responsible for, or building something with no stated effect.
- "none": reserved for content that is not an accomplishment bullet at all - a skills list, an education line, a header.

The single most common error is marking an ACTIVITY as strong. Presenting a review is an activity; "presented the review, which secured $2M in funding" is an outcome. Shipping a tool is an activity; "shipped a tool that cut handling time 60%" is an outcome. If you cannot name what changed, it is "weak" - never "strong".

Do not use "none" merely because a bullet is vague or has no outcome. A vague accomplishment bullet is "weak", and weak bullets are the ones this product exists to fix. Reserve "none" for text that is not describing work at all.

Set competency to what the bullet demonstrates now (NONE if genuinely nothing). Set potentialCompetency to what it could demonstrate if rewritten with a real outcome, inferred from the work described - this is the rewriter's target, so it should almost never be NONE for a bullet that describes work.

Judge only what the bullet actually says. Never infer scale, seniority, or impact that is not written.`;

export function competencyPrompt({ bullets }) {
  const listed = bullets
    .map((b, i) => `${i}. ${b.text}`)
    .join('\n');
  return `Assess each bullet. Return one assessment per bullet, using its index.\n\n${listed}`;
}

/* ------------------------------------------------------------------ *
 * rewrite — one weak bullet -> a STAR-format rewrite
 * ------------------------------------------------------------------ */

export const REWRITE_SCHEMA = {
  type: 'object',
  properties: {
    rewrite: {
      type: 'string',
      description: 'The rewritten bullet. Single line, max 150 characters, opens with an action verb.',
    },
    claimsUsed: {
      type: 'array',
      description:
        'Every factual claim in the rewrite that is not in the original bullet, quoted from the source ' +
        'documents. Empty if the rewrite adds no new facts. This is auditable evidence against fabrication.',
      items: { type: 'string' },
    },
    rationale: {
      type: 'string',
      description: 'One sentence explaining what changed and why. Shown to the user.',
    },
  },
  required: ['rewrite', 'claimsUsed', 'rationale'],
  additionalProperties: false,
};

export const REWRITE_SYSTEM = `You rewrite product-manager resume bullets into STAR format.

Hard constraints - a rewrite violating any of these is useless:
1. NEVER invent facts. Every number, name, scale, timeframe, and outcome must appear in the source documents provided. If the source does not state a result, do not state one. Writing a plausible-sounding metric is the worst thing you can do here.
2. NEVER borrow another bullet's achievement. You are rewriting ONE bullet, about one piece of work. Other bullets on this resume describe different work and their results belong to them. Reusing a metric or outcome from another bullet makes the candidate claim the same win twice, which a recruiter notices immediately. A bullet you cannot strengthen from its OWN material stays unstrengthened - that is the correct outcome, not a failure.
3. Single line. Maximum 150 characters. Count them.
4. Open with a strong past-tense action verb. Never "Responsible for", "Helped", "Worked on", "Assisted", "Managed", or "Participated in".
5. Structure: action + context + result. The result is what changed.

If the source contains no outcome for this bullet, write the strongest possible version WITHOUT inventing one, and leave it outcome-free. A later step asks the candidate for the missing data. Do not paper over the gap.

List in claimsUsed every fact you brought in from the source documents that was not in the original bullet, quoted. If you added nothing, return an empty array. This is checked.`;

export function rewritePrompt({
  bullet,
  targetCompetency,
  competencyDescription,
  resumeText,
  experienceText,
  attempt = 0,
  previousAttempts = [],
  isGapCompetency = false,
  otherBullets = [],
}) {
  const parts = [
    `<original_bullet>\n${bullet.text}\n</original_bullet>`,
    `<target_competency>\n${targetCompetency}: ${competencyDescription}\n</target_competency>`,
  ];

  if (otherBullets.length) {
    // Showing these explicitly is what stops the model treating the resume as
    // one pool of facts. Without it, it reliably lifts the nearest strong
    // metric from a neighbouring bullet.
    parts.push(
      `<other_bullets_on_this_resume>\n` +
        otherBullets.map((t) => `- ${t}`).join('\n') +
        `\n</other_bullets_on_this_resume>`,
      `The achievements above belong to OTHER bullets. Do not reuse their results, ` +
        `metrics, or outcomes. Your rewrite must stand on the work described in ` +
        `<original_bullet> alone.`
    );
  }

  if (isGapCompetency) {
    // Gap-aware targeting: this resume demonstrates nothing in this area, so a
    // credible rewrite here is worth more than one reinforcing an already
    // covered competency.
    parts.push(
      `This competency is currently MISSING from the resume entirely. If the work described ` +
        `can credibly demonstrate it, aim there - it closes a real gap.`
    );
  }

  parts.push(
    `<source_documents>\n${resumeText.trim()}` +
      (experienceText?.trim() ? `\n\n---\n\n${experienceText.trim()}` : '') +
      `\n</source_documents>`
  );

  if (attempt > 0 && previousAttempts.length) {
    // Retries change the angle rather than the sampling temperature, so every
    // attempt is explainable after the fact.
    const strategy = [
      'Take a different angle: lead with a different aspect of the work.',
      'Restructure completely: different action verb, different sentence shape.',
    ][Math.min(attempt - 1, 1)];

    parts.push(
      `<previous_attempts_that_scored_too_low>\n` +
        previousAttempts.map((a, i) => `${i + 1}. ${a}`).join('\n') +
        `\n</previous_attempts_that_scored_too_low>`,
      `Attempt ${attempt + 1}. ${strategy} Do not repeat a previous attempt.`
    );
  }

  return parts.join('\n\n');
}

/* ------------------------------------------------------------------ *
 * score — judge a rewrite against the rubric
 * ------------------------------------------------------------------ */

export const SCORE_SCHEMA = {
  type: 'object',
  properties: {
    competencySignal: {
      type: 'integer',
      description: '0-100. Does the bullet clearly demonstrate the target competency?',
    },
    starCompliance: {
      type: 'integer',
      description: '0-100. Action verb + context + result. Missing result caps this below 70.',
    },
    specificity: {
      type: 'integer',
      description: '0-100. Concrete and quantified vs vague. An unquantified claim caps this below 70.',
    },
    fabricationRisk: {
      type: 'boolean',
      description: 'True if the rewrite states any fact not supported by the source documents.',
    },
    fabricatedClaims: {
      type: 'array',
      description: 'Each unsupported claim, quoted from the rewrite. Empty when fabricationRisk is false.',
      items: { type: 'string' },
    },
    sourceHasMetric: {
      type: 'boolean',
      description:
        'True if the SOURCE DOCUMENTS contain a quantifiable result for this work, whether or not the ' +
        'rewrite used it. False means no rewrite could ever quantify this - the data does not exist.',
    },
    duplicatesAnotherBullet: {
      type: 'boolean',
      description:
        'True if the rewrite claims an achievement that already belongs to a different bullet on the resume.',
    },
    duplicatedFrom: {
      type: ['string', 'null'],
      description: 'The other bullet whose achievement was appropriated, quoted. Null if none.',
    },
    rationale: { type: 'string', description: 'One sentence. Shown to the user.' },
  },
  required: [
    'competencySignal',
    'starCompliance',
    'specificity',
    'fabricationRisk',
    'fabricatedClaims',
    'sourceHasMetric',
    'duplicatesAnotherBullet',
    'duplicatedFrom',
    'rationale',
  ],
  additionalProperties: false,
};

export const SCORE_SYSTEM = `You score a rewritten resume bullet against a fixed rubric. You are an auditor, not a coach - be strict and consistent.

Score each 0-100:
- competencySignal: does it clearly demonstrate the stated target competency?
- starCompliance: action verb + context + result. No stated result means this cannot exceed 69.
- specificity: concrete and measurable vs vague. No quantification and no specific verifiable outcome means this cannot exceed 69.

Then two factual checks, which matter more than the scores:

fabricationRisk - set true if the rewrite asserts ANYTHING not present in the source documents: a number, a scale, a timeframe, a named system, an outcome. Paraphrasing is fine; adding facts is not. Quote each unsupported claim in fabricatedClaims. When unsure whether the source supports a claim, treat it as unsupported.

sourceHasMetric - does the SOURCE contain a quantifiable result for this work, regardless of whether the rewrite used it? This distinguishes "written badly" from "the data does not exist". Answer about the source, not the rewrite. Getting this wrong sends the candidate a pointless question or wastes retries on an unfixable bullet.

duplicatesAnotherBullet - the trap to watch for. Compare the rewrite against the OTHER bullets listed. If it claims a result that already belongs to a different bullet, set this true and quote that bullet in duplicatedFrom. This is NOT caught by the fabrication check: the claim genuinely appears in the source, so it looks supported - but attaching it to this bullet makes the candidate claim one accomplishment twice. A rewrite that borrowed a strong metric from elsewhere will score well on every other criterion, so this check is the only thing standing between it and acceptance.

Do not reward effort or good intentions. Score what is on the page.`;

export function scorePrompt({
  original,
  rewrite,
  targetCompetency,
  competencyDescription,
  resumeText,
  experienceText,
  otherBullets = [],
}) {
  const parts = [
    `<target_competency>\n${targetCompetency}: ${competencyDescription}\n</target_competency>`,
    `<original_bullet>\n${original}\n</original_bullet>`,
    `<rewrite_to_score>\n${rewrite}\n</rewrite_to_score>`,
  ];

  if (otherBullets.length) {
    parts.push(
      `<other_bullets_on_this_resume>\n` +
        otherBullets.map((t) => `- ${t}`).join('\n') +
        `\n</other_bullets_on_this_resume>`
    );
  }

  parts.push(
    `<source_documents>\n${resumeText.trim()}` +
      (experienceText?.trim() ? `\n\n---\n\n${experienceText.trim()}` : '') +
      `\n</source_documents>`
  );

  return parts.join('\n\n');
}

/* ------------------------------------------------------------------ *
 * questions — bullets with no source data -> targeted questions
 * ------------------------------------------------------------------ */

export const QUESTIONS_SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      description: 'At most 5, ordered by how much the answer would improve the resume.',
      items: {
        type: 'object',
        properties: {
          bulletId: { type: 'string' },
          questionType: {
            type: 'string',
            enum: ['WHAT_CHANGED', 'HOW_MUCH', 'HOW_MANY', 'HOW_LONG', 'WHO_WAS_AFFECTED'],
            description:
              'The shape of the question. WHAT_CHANGED is neutral and safest - use it unless the ' +
              'bullet already names an outcome whose size is the only missing piece.',
          },
          question: {
            type: 'string',
            description:
              'One specific question the candidate can answer from memory in a sentence. ' +
              'Must not presuppose the answer.',
          },
          whatItUnlocks: {
            type: 'string',
            description: 'Short note on how the answer would strengthen the bullet. Shown to the user.',
          },
        },
        required: ['bulletId', 'questionType', 'question', 'whatItUnlocks'],
        additionalProperties: false,
      },
    },
  },
  required: ['questions'],
  additionalProperties: false,
};

export const QUESTIONS_SYSTEM = `You write short questions that recover missing evidence from a job candidate.

These bullets could not be strengthened because the candidate's documents contain no measurable outcome for them. Rather than inventing one, we ask.

Rules for each question:
- Ask about ONE specific missing fact: a number, a timeframe, a scale, or a concrete result.
- Quote the bullet it refers to so the candidate knows what you mean.
- Make it answerable from memory in one sentence. "By roughly how much did support ticket volume drop?" is answerable. "Describe the impact of your work" is not.
- Prefer a range or an estimate over precision. Candidates often remember "about a third" but not "31.4%".
- Never imply what the answer should be. "By what percentage did user satisfaction improve?" is wrong twice over: it presumes satisfaction improved, and presumes it was measured. Ask "What changed after this shipped?" - a leading question produces a number the candidate half-invents to satisfy you, which is the exact failure we are avoiding.

Choose questionType first, then write the question to match it. Default to WHAT_CHANGED. Only use HOW_MUCH or HOW_MANY when the bullet ALREADY names an outcome and the size is the sole missing piece - if the bullet does not say something improved, you may not ask by how much it improved.

ONE question per bullet. Pick the single question whose answer would strengthen that bullet most. Asking someone three questions about one line of their resume is worse than asking nothing - they abandon the form. Return at most 5 questions total, covering 5 different bullets, best first.`;

export function questionsPrompt({ bullets }) {
  return (
    `These bullets need data the candidate has not written down anywhere:\n\n` +
    bullets
      .map((b) => `[${b.id}] "${b.text}"\n   best attempt so far: "${b.bestRewrite ?? '(none)'}"`)
      .join('\n\n')
  );
}
