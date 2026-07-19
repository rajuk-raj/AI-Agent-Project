/**
 * PM competency model — the scoring backbone for v1.
 *
 * This is a config file on purpose. It is the most contested part of the
 * product (PRD §13, open question 1) and is expected to be revised after
 * validating against real PM job descriptions. Changing it invalidates the
 * golden-set calibration — re-run the eval harness after any edit.
 */

export const COMPETENCIES = [
  {
    id: 'DISCOVERY',
    label: 'Discovery & user research',
    shows: 'Talked to users, synthesized findings, changed direction based on evidence',
    signals: ['user interviews', 'research', 'validated', 'discovery', 'usability', 'survey'],
  },
  {
    id: 'PRIORITIZATION',
    label: 'Prioritization & roadmap',
    shows: 'Made a tradeoff, cut something, sequenced against a constraint',
    signals: ['prioritized', 'roadmap', 'tradeoff', 'scoped', 'deprioritized', 'sequenced'],
  },
  {
    id: 'METRICS',
    label: 'Metrics & data-informed decisions',
    shows: 'Defined a metric, moved it, or killed something because of it',
    signals: ['metric', 'A/B test', 'conversion', 'retention', 'instrumented', 'baseline'],
  },
  {
    id: 'INFLUENCE',
    label: 'Cross-functional influence',
    shows: 'Aligned eng/design/sales/legal without authority',
    signals: ['partnered', 'aligned', 'cross-functional', 'negotiated', 'influenced'],
  },
  {
    id: 'EXECUTION',
    label: 'Execution & delivery',
    shows: 'Shipped, on a timeline, through obstacles',
    signals: ['shipped', 'launched', 'delivered', 'released', 'migrated'],
  },
  {
    id: 'COMMUNICATION',
    label: 'Stakeholder & exec communication',
    shows: 'Presented up, secured buy-in or budget',
    signals: ['presented', 'exec', 'buy-in', 'secured funding', 'briefed', 'board'],
  },
  {
    id: 'DOMAIN',
    label: 'Domain / technical depth',
    shows: 'Demonstrated credibility in the problem space',
    signals: ['API', 'architecture', 'ML', 'infrastructure', 'compliance', 'protocol'],
  },
];

export const COMPETENCY_IDS = COMPETENCIES.map((c) => c.id);

export const SENIORITY = {
  APM: {
    label: 'Associate PM',
    // Competencies a resume at this level is expected to demonstrate.
    // Absence of an expected competency is reported as a gap; absence of an
    // unexpected one is not held against the candidate.
    expected: ['EXECUTION', 'METRICS', 'INFLUENCE'],
  },
  PM: {
    label: 'Product Manager',
    expected: ['EXECUTION', 'METRICS', 'INFLUENCE', 'DISCOVERY', 'PRIORITIZATION'],
  },
  SENIOR_PM: {
    label: 'Senior PM',
    expected: ['EXECUTION', 'METRICS', 'INFLUENCE', 'DISCOVERY', 'PRIORITIZATION', 'COMMUNICATION'],
  },
  GROUP_PM: {
    label: 'Group PM',
    expected: COMPETENCY_IDS,
  },
  DIRECTOR: {
    label: 'Director of Product',
    expected: COMPETENCY_IDS,
  },
};

export const DEFAULT_SENIORITY = 'PM';

/** Bullet strength as judged by the competency mapper. */
export const STRENGTH = {
  STRONG: 'strong',
  WEAK: 'weak',
  NONE: 'none',
};

/**
 * Competency Coverage — computed in code, identically before and after, so the
 * delta shown to the user is real (PRD §7.6).
 *
 * Deliberately NOT called an "ATS score": no applicant tracking system works
 * this way, and the honest label is what it actually measures.
 */
export function computeCoverage(bullets, seniority = DEFAULT_SENIORITY) {
  const expected = SENIORITY[seniority]?.expected ?? SENIORITY[DEFAULT_SENIORITY].expected;

  const byCompetency = Object.fromEntries(
    COMPETENCY_IDS.map((id) => [id, { strong: 0, weak: 0 }])
  );

  for (const b of bullets) {
    const slot = byCompetency[b.competency];
    if (!slot) continue; // competency NONE or unrecognized
    if (b.strength === STRENGTH.STRONG) slot.strong += 1;
    else if (b.strength === STRENGTH.WEAK) slot.weak += 1;
  }

  const covered = COMPETENCY_IDS.filter((id) => byCompetency[id].strong > 0);
  const gaps = expected.filter((id) => byCompetency[id].strong === 0);

  return {
    seniority,
    byCompetency,
    coveredIds: covered,
    gapIds: gaps,
    // Headline number: covered out of all seven.
    score: covered.length / COMPETENCY_IDS.length,
    display: `${covered.length}/${COMPETENCY_IDS.length}`,
    // Secondary: covered out of what this seniority actually requires.
    expectedScore: expected.length ? (expected.length - gaps.length) / expected.length : 1,
  };
}

export function competencyLabel(id) {
  return COMPETENCIES.find((c) => c.id === id)?.label ?? 'Uncategorized';
}
