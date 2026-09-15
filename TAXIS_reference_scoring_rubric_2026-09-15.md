# TAXIS Reference Scoring Rubric

*Rules for scoring TAXIS edges against a clinically tuned reference LLM such as OpenEvidence: what the reference must prove before its verdicts count, how each edge is scored, how the estimates are made and corrected, and how the design carries from the stratified random sample to the full edge set.*

Version 0.1, 15 September 2026. Marc Overhage with Claude. Status: draft for pre-registration; frozen when the first Phase 2 query is sent.

| Rubric card | |
|---|---|
| Thing validated | TAXIS v6.0 edges from the INPC association-rule run: concept pair, pair type, code(s), direction and gate-first evidence grade |
| Reference | A clinically tuned, literature-grounded LLM reached through an API (OpenEvidence or equivalent), queried blind with the TAXIS question |
| Arbiter | Human review of sampled disagreements and agreements; the reference's own error rate is measured against it before any accuracy is quoted |
| Phase 2 frame | The stratified random sample: 37,023 pairs, 14 pair types × 4 lift bands, of which 26,901 were coded by the four-coder ensemble |
| Phase 3 frame | Every pair the pipeline publishes or holds (grades G1 to G4) in the full edge set, plus a monitored slice of the rest |
| Primary estimand | Corrected precision of the production rule and of each evidence grade, with 95% intervals that account for reference error and concept clustering |

## 0. Why a promptable reference changes the design

Every validator used so far answered a question next to the TAXIS question. ClinVec's clinicians scored relatedness. PACES linked episodes for attribution. The Phenotype Library's rules define cohorts. SemMedDB records what a paper stated. SNOMED models what a terminology needs. Each disagreement with the ensemble was partly a disagreement about the question, and each adjudication sample spent human time measuring that gap.

A reference LLM changes three things.

**It can be asked the TAXIS question.** The prompt carries the v6.0 definitions, the direct-relationship tests for mediation and confounding, the pair type's code menu and the two escapes. The reference judges the same construct the coders judged, so a disagreement is about the pair.

**It can be asked about any pair.** The ensemble's rejections, the escapes and the broadness-screened pairs can all be queried. That yields negatives, so specificity, negative predictive value and recall become estimable outside ClinVec's disorder pairs, which were the only negatives the program has had.

**It runs at API cost.** The full edge set can be scored as a census rather than sampled. The sample's job changes: it calibrates the reference and fixes the correction factors. The census then attaches a reference verdict to every edge's evidence vector, so the validation doubles as enrichment.

What it does not give is a gold standard by declaration. A clinically tuned LLM is a rater with an error rate, trained on the same literature the coders were trained on, and it can be wrong in the same places. The rubric therefore treats it as a reference only after it has been measured, and it audits the cells where reference and ensemble agree as carefully as the cells where they differ.

> **R0. No verdict from the reference is quoted as accuracy until the reference's sensitivity and specificity against human judgement have been measured on the same kind of pairs (Phase 1). Every accuracy figure is reported corrected for that error, beside the raw agreement, with the unit, the denominator, the prevalence and the reference version.**

## 1. The reference: role, blinding, versioning

### R1 Blinding

The reference never sees the ensemble's votes, codes, grade or lift, and never sees another validator's verdict. The extraction layer that maps a reference answer to the scoring schema never sees them either. A human judging a sampled disagreement sees the pair and the TAXIS definitions only; the source of the disagreement is hidden and the items are interleaved, as in the three adjudication samples already completed.

### R2 Same construct, two prompt forms

The primary prompt is the closed form in Appendix A: the TAXIS definitions verbatim from the coder catalog, the pair type's menu of codes with their one-line definitions, and the escapes. A prompt that reproduces the coder catalog can also reproduce the catalog's ambiguities, so a random 10% of Phase 2 pairs are also queried in an open form that asks the reference to describe the relationship in one sentence with no menu. The open answers are mapped to codes by the extraction layer, and the two forms are compared on existence and family. A disagreement rate between forms above 10% on existence is reported as a construct-validity finding and the closed form remains primary.

### R3 Role decision

The reference is compared with the ensemble on the same human-judged items (Phase 1, paired). It is a **reference** in the reporting sense, and accuracy language is used, only if its balanced accuracy on existence exceeds the ensemble's by at least 0.05 with a bootstrap 95% interval that excludes zero, and its admissible-code accuracy among human-confirmed pairs is at least the ensemble's. Otherwise it is a **peer rater**: the same rubric runs, the report uses agreement language, human anchoring carries every accuracy claim, and a latent-class model is added as a secondary analysis. The decision is made once, recorded, and not revisited within a rubric version.

### R4 Version lock

Every query record stores the reference model version string, the prompt version hash, the TAXIS catalog version, the OMOP vocabulary release, the extraction model version and the rubric version. A change in any of them starts a new run identifier. The control set (R14) is the detector for changes the vendor does not announce.

## 2. Unit, questions and query protocol

### R5 Unit of scoring

The unit is the concept pair with its pair type: unordered for existence, ordered for direction. An edge is a pair plus the ensemble's code or codes, direction and gate-first grade. The identity key is the two concept identifiers, the pair type and the catalog version. Result composites and drug groups keep the identifiers the pipeline gave them.

The grades are the ones the synthesis defined on 10 September, with the counts in the coded sample and the single-reviewer precision measured on the 291-pair calibration sample:

| Grade | Definition | Pairs in sample | Reviewer precision, F7 |
|---|---|---:|---:|
| G1 | Gate majority, two or more coders | 3,020 | 65% (50 to 78) |
| G2 | Gate majority, one coder | 999 | 36% (24 to 50) |
| G3 | Gate majority, no coder | 1,285 | 56% (33 to 77) |
| G4 | Gate minority, three or more coders | 355 | 21% (10 to 38) |
| G5 | Gate minority, two or fewer coders | 6,714 | 6.5% (3 to 14) |
| G6 | No gate vote | 14,528 | 3.6% (1 to 12) |

The production rule, two or more coders regardless of gate, holds at 31% on the same sample. The rubric scores every grade, so the choice of publication threshold remains a view over the evidence vector rather than an input to the validation.

### R6 The questions, in fixed order

| | Question | Answer set | Asked when |
|---|---|---|---|
| Q1 | Is there a direct clinical relationship between A and B, under the v6.0 tests for mediation and confounding? | DIRECT · NO DIRECT RELATIONSHIP · TOO ABSTRACT TO JUDGE · CANNOT DETERMINE | Always |
| Q2 | Which relationship in the pair type's menu fits best? Up to two, best first | The pair type's assignable codes, shuffled | Q1 = DIRECT |
| Q3 | Which way does it run? | A→B · B→A · SYMMETRIC | Q1 = DIRECT |
| Q4 | For a causal-family code, how strong is the evidence? | ESTABLISHED · PLAUSIBLE · SPECULATIVE | Q2 in the causal family |
| Q5 | Which sources support the answer, and why, in one sentence? | Citations and rationale | Always; stored, not scored |

Q1 is the existence verdict and the only one used for the 2×2. The escapes are asked once, in Q1, so that Q2's menu contains only assignable codes and the reference cannot answer "no relationship" twice in two places. The order of the four Q1 options is fixed; the order of Q2's menu is randomised (R8).

### R7 Concept context

Each concept is presented with its name, vocabulary, concept class and domain, and, where the vocabulary supplies one, a definition or up to three synonyms. A result composite is presented as its test, operator, value and unit. A drug group is presented with its member count and three example ingredients. Nothing that came from the pipeline is shown: no lift, no votes, no code, no grade. The context block is generated by one function, versioned with the prompt, so that every pair in a run is described the same way.

### R8 Randomisation and replication

The order in which A and B are presented is randomised per query with a logged seed. The order of Q2's menu is randomised per query with a logged seed. A random 10% of Phase 2 pairs are re-queried with A and B swapped, to estimate order effects (R16). A random 5% are re-queried after at least seven days with a fresh session, to estimate test-retest reliability (R15). Replicates are stored as separate records linked to the original, never averaged before scoring.

### R9 Extraction

If the API returns structured output, the schema in Appendix B is filled directly. If it returns prose, a fixed extraction model maps the prose to the schema and records a confidence. Before Phase 2, 300 extractions are checked by a human against the prose; extraction agreement must reach 0.97 on Q1 and 0.95 on Q2 or the prompt is revised. Refusals, empty answers and answers outside the schema are recorded as CANNOT DETERMINE with the raw text retained; they are never coerced to a code.

## 3. The scoring rubric

### R10 Existence outcome

Each pair is placed in one cell of Table A by the ensemble's state and the reference's Q1 answer. Cells are computed within each grade, so that precision is a function of grade and the same table serves every publication threshold.

| Ensemble state → Reference says | DIRECT | NO DIRECT RELATIONSHIP | TOO ABSTRACT | CANNOT DETERMINE |
|---|---|---|---|---|
| Asserted by at least one coder, any grade | **Confirmed** (C), scored further in Table B | **Contradicted** (X) | **Abstract-disputed** (A) | **Unresolved** (U) |
| No coder asserted (k = 0) | **Missed** (M), candidate false negative | **Negative agreement** (N) | **Negative agreement** (N) | Unresolved (U) |
| Ensemble majority said too abstract | **Screen-disputed** (S) | Negative agreement (N) | **Screen agreement** (N⁰) | Unresolved (U) |
| Screened out by the broadness filter, not coded | Screen-disputed (S) | Screen agreement (N⁰) | Screen agreement (N⁰) | Unresolved (U) |

Precision of a grade is C ÷ (C + X + A) in the primary analysis, with A counted as a contradiction because the reference judged the pair judgeable and found no relationship at that level of abstraction. Unresolved pairs are excluded from the denominator and reported as an abstention rate with bounds (R22). Missed and screen-disputed pairs feed the recall estimate (R25) and the screen check.

### R11 Type concordance depth

Confirmed pairs are scored for the relationship type at five depths. The ensemble's primary code is the code with the most coder votes among the asserting coders; ties are scored on the best-matching code and flagged. The reference's primary code is the first of its up to two Q2 answers.

| Depth | Condition | Reported as |
|---:|---|---|
| 4 | Reference primary code equals the ensemble primary code | Exact |
| 3 | Reference primary code is in the ensemble primary code's admissible set | Admissible |
| 2 | Same catalog family, not admissible | Family |
| 1 | Same pair type, different family | Existence only |
| 0 | Reference names no code, or CANNOT DETERMINE at Q2 | Existence only, type unresolved |

The admissible sets are a versioned map from each of the 112 assignable codes to the codes accepted as equivalent for scoring, built from the catalog's family metadata and the substitutions the adjudications have already documented (TD-01 for TD-03, ID-02 for ID-01, ID-03 and ID-04, ID-05 for ID-06). The map is frozen with the rubric before Phase 2 and its hash is stored with every run. Secondary codes are scored separately: the share of confirmed pairs where any reference code matches any ensemble code with two or more votes is reported beside the primary-on-primary depth. Evidence strength on causal codes is compared by linearly weighted kappa as a secondary measure.

### R12 Direction and the composite score

| Case | Score |
|---|---|
| Both directed, same direction | Match |
| Both directed, opposite direction | Reversed. In the causal, therapeutic, prognostic and outcome families, where direction is part of the code's meaning, the depth is capped at 1; elsewhere reported separately |
| One side SYMMETRIC, the other directed | Partial, reported |
| Direction not applicable to the code | Not scored |

The composite per-edge score is ordinal, from 5 to 0, and is the field carried into the evidence vector:

| Score | Meaning |
|---:|---|
| 5 | Confirmed, exact code, direction match |
| 4 | Confirmed, admissible code, direction match |
| 3 | Confirmed, same family |
| 2 | Confirmed, existence only |
| 1 | Unresolved: the reference could not determine |
| 0 | Contradicted, or abstract-disputed |

The score is never averaged. Precision, depth distributions and direction agreement are reported as proportions with intervals; the score exists so that a downstream user can filter edges by the depth of external confirmation.

### R13 Aggregation

Every rate is computed first within stratum: pair type × lift band for the frame, grade for the levels, code for the catalog. Phase 2 marginals are Horvitz–Thompson estimates using the design weights, the ratio of frame count to sampled count per pair type × lift band cell from the ARM output, and the design effect is reported. Where an adjudication subsample adds a second stage of sampling, the two sets of weights multiply. Phase 3 is a census, so its agreement rates carry no sampling error; their intervals reflect reference error and clustering only. The synthesis's reporting rule applies to every number: unit, denominator, prevalence beside any predictive value, reviewer and question beside any human-anchored figure, and the reference version.

## 4. Qualification and calibration: Phases 0 and 1

### Phase 0: qualify the API on 100 pairs

Fifty pairs the gold-300 reviewer accepted and fifty rejected, across pair types, are queried. Each item on the checklist is a gate; a failed gate stops the program until it is resolved or the rubric is amended.

| Check | Pass condition |
|---|---|
| Output form | Structured output, or prose the extraction layer maps at R9's accuracy |
| Determinism | Temperature and seed controllable, or test-retest agreement measured at R15's threshold |
| Citations | Sources returned per answer and stored |
| Throughput | Requests per minute and concurrency known; a Phase 2 run of about 40,000 queries completes within the planned window |
| Cost | Cost per query known; the Phase 2 and first Phase 3 budgets approved |
| Terms | The terms of use permit automated evaluation, storage of outputs and publication of aggregate results; the inputs are concept names and definitions only, never patient data |
| Refusals | Refusal rate on the 100 pairs below 5%, with the refusals characterised |
| Context | The concept-context block (R7) is accepted at its full length for the longest result composites and drug groups |

### Phase 1: measure the reference against the human judgements that already exist

| Set | Items | Question the human answered | Human labels | Use in calibration |
|---|---:|---|---|---|
| INPC evidence-level sample | 291 pairs | Direct relationship, blind to votes, codes and lift | 69 related, 216 not, 6 unsure | Existence sensitivity and specificity by grade cell; code agreement on the 60 confirmed pairs with a code |
| PACES adjudication | 299 items, 1,182 code rows | Does the admissible code hold for this pair | Held or not; 35 unsure | Type and direction accuracy on ID and DD codes |
| Gold-300 | 300 pairs, 623 verdicts | Is this asserted code defensible | Per code | Type accuracy by family |
| Literature miss queue | 63 pairs | Does a direct TAXIS relation hold | 8 yes, 55 no | Existence on pairs the ensemble rejected |
| ClinVec | 1,976 coded pairs | Relatedness 1 to 5, with degree-matched unrelated controls | Clinician scores; 193 disagreements adjudicated | Specificity on hard negatives, disorder pairs only; a neighbouring question, used for negatives |
| Phenotype adjudication | 331 items | Cohort-rule relation holds | Not yet judged | Added when judged |

About 950 pairs carry a human verdict on the TAXIS question and a further 1,976 carry clinician relatedness scores with true negatives. The ensemble's answers on every one of these items are already stored, so the reference and the ensemble are compared on the same items, paired (R26). Phase 1 yields the first estimates of the reference's sensitivity and specificity on existence, its admissible-code accuracy among human-confirmed pairs, its direction accuracy and its abstention rate, each by pair-type family where the count allows and pooled otherwise. These first estimates are coarse: the INPC sample has 69 positives, so its sensitivity carries an interval about 20 points wide. The disagreement adjudication (R18) tightens them in every later phase.

### R14 Control set

Two hundred pairs with human labels, 100 confirmed and 100 rejected, spanning the pair types, are re-submitted with every batch of 2,000 queries in every phase. Agreement with the human label is charted per batch on a p-chart with three-sigma limits fixed from the first ten batches. A batch outside the limits, or a change in the version string, quarantines that batch; it is re-run once the cause is found, and the finding is logged against the run.

### R15 Test-retest reliability

Five percent of Phase 2 pairs, at least 1,000, are re-queried after seven or more days. Percent agreement and kappa are reported for Q1, Q2 (exact and admissible) and Q3. Single-query verdicts are acceptable if Q1 agreement is at least 0.90 and admissible-code agreement at least 0.80. Below either threshold every pair in the run is queried three times and the majority verdict is scored, with the disagreement recorded; the cost model (R30) is re-approved before continuing.

### R16 Order effect

Ten percent of Phase 2 pairs are re-queried with A and B swapped. The Q1 flip rate and the Q3 consistency are reported. A flip rate above 5% requires both orders for every pair in every later phase, with the verdict scored only where the two orders agree and otherwise recorded as unresolved.

### R17 Menu position effect

Because Q2's menu order is randomised, the position of the chosen code is a covariate. A logistic model of choice on position, with code fixed effects, estimates the position effect. A significant effect (p < 0.01) with an odds ratio above 1.5 between first and last position means every pair receives two menu orders and the code is scored only where both agree.

### R18 Human adjudication budget

Human review is the arbiter and the scarcest resource, so it is spent on sampled cells with known probabilities. Per phase, a blinded, interleaved worksheet is drawn:

| Cell | Items | Purpose |
|---|---:|---|
| Ensemble asserted, reference contradicted (X) | 200 | Which side is right when they disagree; the reference's false-negative and the ensemble's false-positive rates |
| Ensemble did not assert, reference DIRECT (M) | 200 | Candidate misses; the reference's false-positive rate on ensemble negatives |
| Both assert (C) | 100 | The correlated-error check: how often both are wrong together |
| Both negative (N) | 100 | The correlated-error check on the negative side; anchors specificity |

Six hundred items per phase, drawn with known probabilities so that every cell rate extrapolates to the frame. A second reader judges a random 20%, and their agreement is reported as kappa with the items where they differ resolved by discussion. Sampling from all four cells is what separates this design from checking disagreements only: two LLM raters can agree and both be wrong, and the agree cells are the only place that is measured.

## 5. Statistical analysis plan

### R19 Estimands

| | Estimand | Primary reporting |
|---|---|---|
| E1 | Corrected precision of the production rule and of each grade G1 to G6 | Point, 95% interval, by grade; G1 and the production rule are primary |
| E2 | Ordering of corrected precision across grades | Test of the pre-specified order G1 ≥ G3 ≥ G2 ≥ G4 ≥ G5 ≥ G6 |
| E3 | Corrected precision by pair type at the production rule | Fifteen rows with intervals |
| E4 | Corrected precision by code at the production rule | Shrunk estimates, 90% posterior intervals, floor flags |
| E5 | Specificity and negative predictive value of the ensemble's negatives (k = 0 without gate support) and of G6 | With prevalence beside each predictive value |
| E6 | Recall of human-confirmed reference positives at k ≥ 1, k ≥ 2 and gate majority | Design-based estimate with interval |
| E7 | Distribution of type depth among confirmed edges | Shares at depths 4, 3, 2, 1, 0 |
| E8 | Direction agreement among confirmed directed edges | Match, reversed, partial |
| E9 | Reference reach: abstention and TOO ABSTRACT rates by concept class | Results, tests, drug groups, disorders, findings, interventions |

### R20 Intervals and clustering

Single proportions use Wilson intervals. Edges are not independent: each belongs to two concepts, and one bad concept, such as a result-status metadata concept, makes every edge that touches it bad. Any interval for a rate pooled over many edges is therefore computed by the pigeonhole bootstrap for crossed factors: concepts are resampled, not edges, and an edge enters a replicate with weight equal to the product of its two endpoints' resampling counts. Where the two agree, the Wilson interval is reported; where the bootstrap interval is wider, it replaces the Wilson interval and the design effect is stated.

### R21 Correction for reference error

The share of edges in a cell that the reference confirms is a mixture of true edges the reference recognises and false edges it fails to reject. With the reference's sensitivity and specificity against human judgement from Phase 1 and R18, the corrected precision is the Rogan–Gladen estimator:

```
p_true = (p_obs + Sp_r − 1) / (Se_r + Sp_r − 1)

p_obs   share of edges in the cell the reference confirms (Q1 = DIRECT)
Se_r    reference sensitivity against human judgement, same pair-type family
Sp_r    reference specificity against human judgement, same pair-type family
```

Sensitivity and specificity are taken from the same pair-type family when the calibration count in that family is at least 100, and pooled otherwise. Uncertainty is propagated by bootstrapping the calibration items and the evaluation items jointly, so the interval on the corrected figure reflects both. The raw agreement is always printed beside the corrected figure. When the denominator, the Youden index Se_r + Sp_r − 1, is below 0.5, the reference is too weak in that family for the correction to be stable; the corrected figure is printed with its interval but is not quoted, and that family's precision rests on human adjudication alone.

### R22 Abstention bounds

Unresolved pairs are excluded from the primary denominator and their share is reported by grade and concept class. Two bounds are reported with every primary figure: precision if every unresolved pair were confirmed, and if every one were contradicted. When the bounds straddle a decision threshold in Section 7, the decision waits until a random 100 unresolved pairs from that cell have been judged by a human and the bound is narrowed with their rate.

### R23 Grade calibration

Corrected precision is fitted by isotonic regression on the grade order pre-specified in E2. The bootstrap share of replicates in which the observed order holds is reported, and each adjacent pair of grades is reported with the interval on its difference. Where a grade carries a numeric probability in the published level, the expected calibration error against the corrected precision is reported by grade and pair type.

### R24 Per-code estimates and multiplicity

The 112 codes are estimated with a beta-binomial model whose prior is fitted per catalog family, so each code's estimate is shrunk toward its family mean in proportion to how few edges it has. Posterior means with 90% intervals are reported. A code is flagged below floor when the posterior probability that its corrected precision is under 0.20 exceeds 0.9. The frequentist counterpart, a one-sided test per code against 0.20 with Benjamini–Hochberg control at q = 0.05, is reported beside it; the two flag lists are expected to agree and any code on one list only is discussed.

### R25 Recall

Recall is estimated relative to the union of what the reference and the ensemble surfaced; pairs both miss stay invisible and the report says so. True positives are estimated from the adjudicated agree-yes cell and false negatives from the adjudicated cell where the reference said DIRECT and no coder asserted, each extrapolated with its sampling weight. Recall at k ≥ 1, at k ≥ 2 and under gate majority is reported with a bootstrap interval, by pair type where the adjudicated counts allow. The literature miss queue found that one in six literature-only flags was real; the same measurement is made for reference-only flags, and the resulting rate is the number that says what a reference-only assertion is worth.

### R26 Reference versus ensemble, paired

On the Phase 1 items, the reference and the ensemble are compared on the same pairs. Existence is compared by McNemar's test and by the bootstrap interval on the difference in balanced accuracy; type is compared on admissible-code accuracy among human-confirmed pairs. This comparison is the R3 decision, and it is also the first published fact about the reference: how much better than a four-coder ensemble a clinically tuned model is at the TAXIS question.

### R27 Sample size and stopping

Phase 2 queries every coded pair, so the question is not how many to draw but what the design already supports. For a Wilson half-width of five points at the precision F7 measured, the required cell sizes are 350 for G1, 355 for G2, 380 for G3, 255 for G4, 95 for G5 and 55 for G6; for three points they are 971, 983, 1,052, 708, 259 and 148. Every grade cell in the coded sample exceeds the three-point requirement except G4, which has 355 pairs and supports five points. Separating adjacent grades at the bottom, G5 at 6.5% against G6 at 3.6%, needs about 830 pairs per grade for 80% power at a two-sided 0.05, which both cells exceed. Cells of pair type × grade, 90 of them, are not all powered in the sample; the census is what powers them. There is no early stopping in Phase 2. The human worksheets use the fixed budgets in R18. Appendix C tabulates the requirements.

### R28 Pre-registration

Before the first Phase 2 query the rubric version, the estimands, the thresholds in Section 7, the admissible map, the prompt and the analysis code are frozen and their hashes recorded. The analysis code is run first on a synthetic dataset with known truth, including a planted reference error rate, and must recover the planted values; that run is stored as the code's test. Deviations after freezing are amendments, dated and listed in the report, and an amended rubric carries a new version number.

## 6. Scale: the Phase 2 sample and the Phase 3 census

### Phase 2: the stratified random sample

| Query set | Pairs | Purpose |
|---|---:|---|
| Every coded pair, all grades | 26,901 | E1 to E9 on the frame; the calibration of the grades |
| Random draw from the 8,343 broadness-screened pairs | 2,000 | Does the reference agree the pairs were too broad to code |
| Order-swap replicates, 10% | 2,900 | R16 |
| Test-retest replicates, 5% | 1,450 | R15 |
| Open-form prompts, 10% | 2,900 | R2 |
| Control set, 200 per batch of 2,000 | 3,600 | R14 |
| Total | about 39,800 | |

The 1,779 pairs excluded as unusable results are not queried. Phase 2 ends with the role decision confirmed on the larger calibration, the correction factors per family, the grade calibration table, the per-code floor list and the reach table by concept class. Its human worksheet (R18) is drawn from the Phase 2 cells.

### Phase 3: the full edge set

Every pair in grades G1 to G4, the published edges and the holds, receives a reference verdict. A random 2% of the G5, G6 and screened-out pairs, at least 5,000 per increment, is queried for continuing specificity and screen monitoring. Replication fractions fall to 2% order-swap and 1% retest once Phase 2 has established reliability. The frame is defined per increment: the August 2026 INPC run once IU delivers its statistical profile, and the ego ring-1 set of 158,840 codable rows as the first increment after it. Each increment is a run with its own control charts and its own human worksheet.

### R29 Evidence-vector integration

The reference verdict is stored per edge as a field of the evidence vector: the composite score (R12), the depth, the direction case, the Q1 answer, the reference version, the query identifier and the run identifier. It is one element beside gate votes, coder votes, literature, lift and the external anchors; the grade remains a versioned view over the vector. The reference never moves a grade silently: a change in how the verdict enters the level rules is a rubric amendment (R28), and the previous level stays reproducible from the stored vector.

### R30 Throughput and cost

The query count for an increment is the sum of its G1 to G4 pairs, 2% of its remaining pairs, its replication fractions, and 200 control queries per batch of 2,000. Wall time is the query count divided by the permitted request rate times the number of parallel keys; cost is the query count times the per-query price fixed in Phase 0. For the ego ring-1 increment the run plan projects about 55,400 gate-passing rows, so the census would need roughly 65,000 queries including monitoring, replication and controls. The budget line in the pre-registration states the price, the count and the approved total, and a test-retest failure that triples the count (R15) requires re-approval before the run continues.

### R31 Batch quality control

Batches are 2,000 queries. Each carries the control set, and the response version string is checked on every record. The p-chart from R14 is the run's health record; the report includes it. A quarantined batch is never scored until re-run. Raw responses are archived immutable, with a hash stored in the verdict record, so any score can be recomputed from the original text.

### R32 Sample-to-census shift

Before a census figure is quoted, the Phase 2 estimates are post-stratified to the census's mix of pair types, concept classes and lift bands, and the post-stratified sample prediction is compared with the census's observed agreement rate by grade. A discrepancy above five points in any grade is investigated, starting with the concept-class reach table and the control charts, before any census figure is quoted. This check is what detects an increment whose concepts the reference cannot read, such as a new set of local result composites.

### R33 Ongoing human review

Each increment draws the R18 worksheet from its own census cells, so the correction factors are re-estimated on the pairs actually being published rather than carried forward from the sample. The second reader continues at 20%. The cumulative human-judged set, now about 950 pairs, grows by 600 per increment and becomes the program's standing calibration corpus.

## 7. Pre-specified decisions

Each trigger is evaluated once per phase against the corrected estimates with their intervals. The consequence is applied as written; a different consequence is an amendment.

| Trigger | Consequence |
|---|---|
| Reference balanced accuracy against humans exceeds the ensemble's by at least 0.05, interval excluding zero (R3) | Accuracy language in the report; otherwise agreement language and the latent-class secondary analysis |
| Reference specificity against humans below 0.85 in a pair-type family | The reference does not refute in that family: contradicted pairs are scored unresolved and the family's precision rests on human review |
| Unresolved or TOO ABSTRACT above 30% in a concept class | Edges in that class are reported as not checkable by the reference; no accuracy is quoted for them |
| Test-retest Q1 agreement below 0.90 (R15) | Three queries per pair, majority verdict; budget re-approved |
| Order flip rate above 5% (R16) | Both orders for every pair; verdict only where they agree |
| Control-set agreement outside the three-sigma limits, or a changed version string (R14) | Batch quarantined and re-run after the cause is found |
| G1 corrected precision with a lower bound of at least 0.60 | G1 stays "edge · strong" |
| G1 lower bound below 0.60 | G1 is published as a weighted edge and the gate ensemble is re-examined |
| G3 corrected precision at least 0.50 | G3 is promoted from queue to edge, confirming the 56% measured on 16 pairs |
| G3 corrected precision below 0.40 | G3 returns to the queue |
| A code's posterior probability of precision below 0.20 exceeds 0.9 (R24) | The code is held from publication and a catalog issue is opened |
| A pair type's corrected precision below 0.25 at the production rule | The class-aware concept screen from the synthesis's step 2 is required before that pair type is published |
| Recall at k ≥ 1 below 0.80 against human-confirmed reference positives (R25) | A recall queue of reference-only pairs is coded by the ensemble with the reference's rationale hidden |
| Sample-to-census discrepancy above five points after post-stratification (R32) | Investigation before any census figure is quoted |

## 8. Reporting template

The report for each phase contains these tables, in this order, each with its unit and denominator in the caption.

| | Table | Content |
|---|---|---|
| T1 | Qualification | Phase 0 checklist with the measured values |
| T2 | Calibration | Reference and ensemble against the human sets, paired: sensitivity, specificity, balanced accuracy, admissible-code accuracy, direction, abstention; the R3 decision |
| T3 | Existence | Table A counts by grade, raw and weighted to the frame |
| T4 | Corrected precision by grade | Raw agreement, corrected figure, interval, abstention bounds; the isotonic fit and the ordering test |
| T5 | By pair type | Corrected precision at the production rule, fifteen rows |
| T6 | By code | Shrunk estimates, intervals, floor flags, both flag lists |
| T7 | Type depth | Shares at each depth among confirmed edges; secondary-code matches; evidence-strength kappa |
| T8 | Direction | Match, reversed, partial by family |
| T9 | Recall | Design-based recall at three thresholds; the reference-only flag's confirmed rate |
| T10 | Reach | Abstention and TOO ABSTRACT by concept class |
| T11 | Reliability | Test-retest, order effect, menu position, open-form agreement |
| T12 | Run health | The control chart, quarantined batches, version strings seen |
| T13 | Human review | Cell rates from the worksheet, second-reader kappa, resolved items |

Every rate states its unit, its denominator and, beside any predictive value, the prevalence it assumes. Every human-anchored figure names the reviewer and the question. Every reference figure names the model version and the rubric version.

## 9. Limitations the rubric cannot remove

**Correlated error.** The reference and the four coders were trained on overlapping literature and can share blind spots. R18's agree-cell audit measures the joint error rate; it cannot make the raters independent, and the corrected figures depend on the human anchor being right.

**Literature reach.** A literature-grounded reference is expected to reproduce SemMedDB's pattern: strong on intervention × disorder and disorder × disorder, weak on results, tests and local composites. E9 measures this, and the reach decision in Section 7 stops accuracy being quoted where the reference cannot see; it does not validate those families.

**Construct drift.** Giving the reference the catalog's definitions makes its question the coders' question, and also imports the catalog's ambiguities. The open-form subsample (R2) measures the size of that effect on existence and family; it cannot measure it at the code level.

**Vendor drift.** The model behind the API can change without notice. R4 and R14 detect a change; they cannot prevent one, and a run that spans a version change is reported as two runs.

**One arbiter.** Every human verdict in the program so far is one reviewer's, applying a strict direct-relationship reading that confirmed 41% of PACES's own assertions. The second reader at 20% measures the strictness; it does not remove it.

**Citations are not verified here.** The reference's citations are stored for audit and for the reach analysis, and a later study can check them; this rubric scores verdicts, not sources.

**Terms of use.** Automated evaluation, storage and publication may be restricted by the provider's terms. Phase 0 makes this a gate; the rubric has no remedy if the gate fails except a different reference.

## Appendix A. Closed-form prompt skeleton

```
You are answering as a practising clinician. Consider two clinical concepts.

  A: {name_a}  [{vocabulary_a} · {concept_class_a} · {domain_a}]
     {context_a: definition or synonyms; for a result, test / operator / value / unit;
      for a drug group, member count and three example ingredients}
  B: {name_b}  [{vocabulary_b} · {concept_class_b} · {domain_b}]
     {context_b}

Q1. Is there a DIRECT clinical relationship between A and B?
    A relationship is direct when it is not explained by a third concept that
    mediates it, and not produced by a shared cause that confounds it.
    {the v6.0 mediation and confounding tests, verbatim from the coder catalog}
    Answer exactly one: DIRECT | NO DIRECT RELATIONSHIP | TOO ABSTRACT TO JUDGE | CANNOT DETERMINE

Q2. If DIRECT: which relationship fits best? Give up to two, best first.
    {menu for pair type {pair_type}: code, label, one-line definition,
     in randomised order with seed {menu_seed}}

Q3. If DIRECT: which way does it run?  A→B | B→A | SYMMETRIC

Q4. If the relationship is causal: ESTABLISHED | PLAUSIBLE | SPECULATIVE

Q5. Cite the sources you relied on, and give one sentence of rationale.

Return JSON only:
{"q1": "...", "q2": ["...", "..."], "q3": "...", "q4": "...",
 "citations": ["..."], "rationale": "..."}
```

The open form omits Q2's menu and asks instead for one sentence describing the relationship; the extraction layer maps the sentence to a code and records its confidence. Both forms share the same context block and the same Q1 wording.

## Appendix B. Verdict record schema

| Field | Content |
|---|---|
| query_id, run_id, batch_id | Identifiers; run_id changes with any version change (R4) |
| concept_id_a, concept_id_b, pair_type, catalog_version | The unit key (R5) |
| presented_first, menu_seed, prompt_form | Randomisation record (R8); closed or open |
| model_version, prompt_hash, extraction_model, admissible_map_hash, rubric_version | Version lock |
| queried_at, raw_response_hash | Provenance; the raw text is archived immutable |
| q1, q2_primary, q2_secondary, q3, q4 | The reference's answers |
| n_citations, citation_ids, rationale | Stored for audit and the reach analysis; not scored |
| extraction_confidence | From the extraction layer when prose was mapped |
| replicate_of, replicate_kind | Links a swap, retest or open-form replicate to its original |
| control_flag | Marks a control-set query |
| cell, depth, direction_case, composite_score | Scoring outputs (R10 to R12), computed, never edited |

## Appendix C. Sample-size reference

Pairs needed in a cell for a Wilson interval of the stated half-width, at the precision expected from the calibration sample. Adjacent-grade separation is the pairs per grade for 80% power at a two-sided 0.05.

| Cell | Expected precision | ± 5 points | ± 3 points |
|---|---:|---:|---:|
| G1 | 0.65 | 350 | 971 |
| G2 | 0.36 | 355 | 983 |
| G3 | 0.56 | 380 | 1,052 |
| G4 | 0.21 | 255 | 708 |
| G5 | 0.065 | 95 | 259 |
| G6 | 0.036 | 55 | 148 |
| Production rule, any pair type | 0.31 | 329 | 913 |
| A rare code | 0.10 | 138 | 384 |
| G5 against G6, 6.5% against 3.6% | | 830 per grade | |

## Appendix D. Existing assets the rubric builds on

| Item | Where |
|---|---|
| Stratified sample and its coding | `INPC ARM Aug 2026/concept_pair_sample_09012026.csv` (37,023 pairs); `cab_llm/reports/v60_inpc_all_pairs.csv`; runs `v60_inpc_full`, `_namefix`, `_wider` in `D:\cab_llm_eval\db\roc.sqlite` |
| Gate votes and grades | Runs `v60_gate_smoke`, `v60_gate_reallms`, `v60_gate_wider`; grade counts from `analysis/v60_evidence/a16_sankey_data.py` |
| Human-judged sets | `analysis/v60_evidence/v60_adjudication_worksheet_COMPLETED.xlsx` and key; `paces_adjudication_sheet_COMPLETED.xlsx` with the DD-05 redo; gold-300 verdicts; `analysis/v60_semmed/v60_panel_miss_queue_COMPLETED.xlsx`; ClinVec in Postgres `clinvec_taxis`; `cab_llm/artifacts/PHENOTYPE_adjudication.xlsx` (unjudged) |
| Admissible-set precedent | `admissible_codes` in `cab_llm/data/paces_v60_expected.csv` and `phenotype_v60_expected.csv`; family metadata in `cab_llm/src/cab_llm/prompts_v6_0.py` (`RELATION_METADATA_BY_PAIR`) |
| Scorers to extend | `cab_llm/tools/score_paces_v60.py`, `score_paces_adjudication.py`, `sample_paces_adjudication.py`, `analysis/v60_evidence/a15_score_adjudication.py` |
| Synthesis and grades | `analysis/TAXIS_validation_synthesis_2026-09-08.md`, revised 11 September; finding F7 for the grades and their precision |
| First Phase 3 increment | `cab_llm/docs/EGO_RING1_RUN_PLAN.md` (158,840 codable rows, about 55,400 gate-passing projected) |
