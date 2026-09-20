'use strict';
const { randomUUID } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { performance } = require('node:perf_hooks');
const { ResearchStore } = require('./store.cjs');
const schema = require('./schema.cjs');
const ACTIVE = new Set(['queued', 'running', 'awaiting_plan']);
const RECOVERABLE = new Set(['stopped', 'interrupted', 'failed']);
const UNAVAILABLE = 'Deep Research source adapters are not available in this build yet.';
const clone = value => structuredClone(value);
const errorData = error => error?.researchSafe ? { code: error.code, message: error.message } : { code: 'RESEARCH_STEP_FAILED', message: 'The research step failed. Saved evidence is preserved; you can resume from the last checkpoint.' };

function summary(job) {
 return {
  id: job.id, conversationId: job.input.conversationId, projectId: job.input.projectId,
  title: job.plan?.title ?? Array.from(job.input.brief).slice(0, 120).join(''), revision: job.revision,
  phase: job.phase, status: job.status, choice: clone(job.input.choice), createdAt: job.createdAt, updatedAt: job.updatedAt,
  evidenceCount: job.evidence.length, findingCount: job.findings.length, usedSourceIds: [...new Set(job.evidence.map(e => e.sourceId))],
  usage: clone(job.usage), limits: clone(job.limits), error: clone(job.error), report: clone(job.report), finishRequested: job.finishRequested,
 };
}
function detail(job) {
 return { ...summary(job), brief: job.input.brief, sources: clone(job.binding.sources), plan: clone(job.plan), planVersion: job.planVersion,
  acceptedPlanVersion: job.acceptedPlanVersion, steps: clone(job.steps), evidence: clone(job.evidence), findings: clone(job.findings), gaps: clone(job.gaps) };
}
// Cancellation races even an adapter that does not settle promptly. Late results
// never reach persistence; adapters must also pass this signal to their I/O.
function abortable(signal, fn) {
 if (signal.aborted) return Promise.reject(signal.reason);
 return new Promise((resolve, reject) => {
  const abort = () => reject(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  Promise.resolve().then(() => { if (signal.aborted) throw signal.reason; return fn(); }).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
 });
}

class ResearchService {
 constructor({ directory, store = new ResearchStore(directory), adapter = null, disabledReason = '', validateContext = () => {}, onChange = () => {}, concurrency = 2, limits = schema.DEFAULT_LIMITS }) {
  schema.assert(Number.isInteger(concurrency) && concurrency >= 1 && concurrency <= 3);
  this.store = store; this.adapter = adapter; this.disabledReason = disabledReason; this.validateContext = validateContext; this.onChange = onChange;
  this.concurrency = concurrency; this.limits = schema.limits(limits); this.jobs = new Map(); this.runs = new Map(); this.preparing = new Map();
  this.closed = false; this.storageError = null; this.scheduled = false; this.epoch = 0;
  // Loading never contacts a provider. Abandoned requests retain the full time
  // reservation because their actual remote consumption after a crash is unknown.
  for (const saved of store.loadAll()) {
   this.jobs.set(saved.id, saved);
   if (saved.status === 'running' || saved.status === 'queued') this.change(saved.id, job => {
    job.status = 'interrupted'; job.generation++;
    job.error = { code: 'RESEARCH_INTERRUPTED', message: 'Research was interrupted. Resume to continue from saved evidence.' };
    for (const step of job.steps) if (step.status === 'started') { step.status = 'interrupted'; step.finishedAt = Date.now(); }
   });
  }
 }
 assertOpen() {
  if (this.storageError) throw schema.fault(this.storageError.code, this.storageError.message);
  if (this.closed) throw schema.fault('RESEARCH_CLOSED', 'Research is paused while zQ closes.');
 }
 job(id) { schema.uuid(id); const job = this.jobs.get(id); if (!job) throw schema.fault('RESEARCH_NOT_FOUND', 'Research job not found.'); return job; }
 assertReadable() { if (this.storageError) throw schema.fault(this.storageError.code, this.storageError.message); }
 list() { this.assertReadable(); return [...this.jobs.values()].sort((a, b) => b.updatedAt - a.updatedAt).map(summary); }
 get(id) { this.assertReadable(); return detail(this.job(id)); }
 notify(job = null) { try { this.onChange({ job: job ? summary(job) : null, error: clone(this.storageError) }); } catch { /* View errors cannot stop native work. */ } }
 blockStorage(error) {
  this.storageError = errorData(error); this.epoch++;
  for (const run of this.runs.values()) run.controller.abort(schema.fault('RESEARCH_STORAGE', 'Research stopped because its checkpoint could not be saved.'));
  this.notify();
 }
 commit(job, revision) {
  try { this.store.save(job, revision); }
  catch (error) { if (error.committed) this.jobs.set(job.id, job); this.blockStorage(error); throw error; }
  this.jobs.set(job.id, job); this.notify(job); return job;
 }
 change(id, fn) {
  const previous = this.job(id), next = clone(previous); fn(next); next.revision++; next.updatedAt = Date.now();
  // Validate before attempting disk I/O. Invalid provider output must not poison
  // the store or prevent other valid jobs from continuing.
  schema.job(next); return this.commit(next, previous.revision);
 }
 assertUnique(conversationId, except) {
  if ([...this.jobs.values()].some(j => j.id !== except && j.input.conversationId === conversationId && ACTIVE.has(j.status)) || [...this.preparing.entries()].some(([id, c]) => id !== except && c === conversationId))
   throw schema.fault('RESEARCH_BUSY', 'This conversation already has active research. Open it or stop it before starting another.');
 }
 busy(conversationId) { return [...this.preparing.values()].includes(conversationId) || [...this.jobs.values()].some(j => j.input.conversationId === conversationId && ACTIVE.has(j.status)); }
 async resolve(input, signal, material = []) {
  if (this.disabledReason) throw schema.fault('RESEARCH_UNAVAILABLE', this.disabledReason);
  if (!this.adapter) throw schema.fault('RESEARCH_UNAVAILABLE', UNAVAILABLE);
  this.validateContext(clone(input));
  const binding = schema.binding(await abortable(signal, () => this.adapter.resolve(clone(input), { signal, material: clone(material) })), input.sources);
  this.validateContext(clone(input));
  return binding;
 }
 async availability(raw) {
  const input = schema.input(raw); this.assertOpen();
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(schema.fault('RESEARCH_TIMEOUT', 'Checking research availability timed out.')), 10000);
  try { const resolved = await this.resolve(input, controller.signal); return { available: true, reason: '', sources: resolved.sources }; }
  catch (error) { return { available: false, reason: error?.researchSafe ? error.message : 'The selected model or sources are unavailable for research.', sources: [] }; }
  finally { clearTimeout(timer); }
 }
 catalog(input) { this.assertOpen(); if (!this.adapter?.catalog) throw schema.fault('RESEARCH_UNAVAILABLE', UNAVAILABLE); return this.adapter.catalog(clone(input), this.disabledReason); }
 async create(raw) {
  this.assertOpen(); const input = schema.input(raw), existing = this.jobs.get(input.id);
  if (existing) { if (!isDeepStrictEqual(existing.input, input)) throw schema.fault('RESEARCH_CONFLICT', 'This research request ID was already used for a different brief.'); return detail(existing); }
  if (this.preparing.has(input.id)) throw schema.fault('RESEARCH_BUSY', 'This research request is being prepared.');
  this.assertUnique(input.conversationId); this.preparing.set(input.id, input.conversationId); const epoch = this.epoch;
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(schema.fault('RESEARCH_TIMEOUT', 'Preparing research timed out.')), 10000);
  try {
   const binding = await this.resolve(input, controller.signal); this.assertOpen();
   const material = schema.material(this.adapter.capture ? await abortable(controller.signal, () => this.adapter.capture(clone(input))) : []);
   if (!isDeepStrictEqual(binding, await this.resolve(input, controller.signal, material))) throw schema.fault('RESEARCH_ACCESS_CHANGED', 'Research sources changed while preparing the job. Try again.');
   if (epoch !== this.epoch) throw schema.fault('RESEARCH_INTERRUPTED', 'Research preparation was interrupted. Try again.');
   this.assertUnique(input.conversationId, input.id); const now = Date.now();
   const job = { id: input.id, revision: 1, input, binding, material, phase: 'planning', status: 'queued', generation: 0,
    plan: null, planVersion: 0, acceptedPlanVersion: null, steps: [], evidence: [], findings: [], gaps: [], reportDraft: null, report: null,
    publicationKey: `research:${input.id}:report:1`, finishRequested: false, createdAt: now, updatedAt: now,
    usage: { steps: 0, activeMs: 0, inputTokens: 0, outputTokens: 0, unmeasuredSteps: 0 }, limits: clone(this.limits), error: null };
   this.commit(job, 0); this.schedule(); return detail(job);
  } finally { clearTimeout(timer); this.preparing.delete(input.id); }
 }
 acceptPlan({ id, expectedRevision, plan: rawPlan }) {
  this.assertOpen(); const job = this.job(id); schema.number(expectedRevision);
  if (job.revision !== expectedRevision) throw schema.fault('RESEARCH_CONFLICT', 'The plan changed. Reload it before accepting.');
  if (job.status !== 'awaiting_plan') throw schema.fault('RESEARCH_STATE', 'This research is not waiting for plan review.');
  const plan = schema.plan(rawPlan);
  schema.assert(!plan.questions.length, 'Answer the clarification questions in the plan before starting research.');
  const next = this.change(id, j => { j.plan = plan; j.planVersion++; j.acceptedPlanVersion = j.planVersion; j.phase = 'researching'; j.status = 'queued'; j.error = null; });
  this.schedule(); return detail(next);
 }
 settleStep(job, run) {
  const step = run && job.steps.find(s => s.id === run.stepId && s.status === 'started');
  if (step) {
   step.status = 'interrupted'; step.finishedAt = Date.now();
   job.usage.activeMs -= Math.max(0, step.reservedMs - Math.min(step.reservedMs, Math.ceil(performance.now() - run.started)));
  }
 }
 cancel(id, status, message) {
  const job = this.job(id), run = this.runs.get(id);
  if (job.status === 'completed') return detail(job);
  // Abort first even when disk is full; a failed checkpoint cannot leave requests running.
  run?.controller.abort(schema.fault('RESEARCH_CANCELLED', message));
  return detail(this.change(id, j => { this.settleStep(j, run); j.generation++; j.status = status; j.error = status === 'interrupted' ? { code: 'RESEARCH_INTERRUPTED', message } : null; }));
 }
 stop(id) {
  this.assertOpen(); const job = this.job(id); if (job.status === 'stopped' || job.status === 'completed') return detail(job);
  return this.cancel(id, 'stopped', 'Research stopped. Saved evidence is preserved.');
 }
 finish(id) {
  this.assertOpen(); const job = this.job(id);
  if (job.status === 'completed' || job.finishRequested && ACTIVE.has(job.status)) return detail(job);
  if (job.acceptedPlanVersion === null) throw schema.fault('RESEARCH_STATE', 'Accept a research plan before finishing a report.');
  this.assertUnique(job.input.conversationId, id);
  const run = this.runs.get(id); run?.controller.abort(schema.fault('RESEARCH_CANCELLED', 'Finish using saved evidence.'));
  const next = this.change(id, j => {
   this.settleStep(j, run); j.generation++; j.finishRequested = true; j.status = 'queued'; j.error = null;
   if (j.phase === 'researching') j.phase = 'checking';
  });
  this.schedule(); return detail(next);
 }
 resume(id) {
  this.assertOpen(); const job = this.job(id);
  if (ACTIVE.has(job.status) || job.status === 'completed') return detail(job);
  if (!RECOVERABLE.has(job.status)) throw schema.fault('RESEARCH_STATE', 'This research cannot be resumed.');
  this.assertUnique(job.input.conversationId, id);
  const next = this.change(id, j => { j.generation++; j.error = null; j.status = j.phase === 'planning' && j.plan ? 'awaiting_plan' : 'queued'; });
  this.schedule(); return detail(next);
 }
 retryStorage() {
  if (!this.storageError) return this.list();
  this.epoch++;
  for (const run of this.runs.values()) run.controller.abort(schema.fault('RESEARCH_CANCELLED', 'Recovering saved checkpoints.'));
  this.runs.clear();
  // The last rename may have succeeded even if its directory flush failed.
  // Reload disk, never overwrite that revision using stale in-memory state.
  let saved;
  try { saved = this.store.loadAll(); } catch (error) { this.blockStorage(error); throw error; }
  this.jobs = new Map(saved.map(job => [job.id, job])); this.storageError = null;
  for (const job of saved) this.change(job.id, next => {
   if (next.status === 'running' || next.status === 'queued') {
    next.status = 'interrupted'; next.generation++;
    next.error = { code: 'RESEARCH_INTERRUPTED', message: 'The checkpoint was recovered. Resume to continue research.' };
    for (const step of next.steps) if (step.status === 'started') { step.status = 'interrupted'; step.finishedAt = Date.now(); }
   }
  });
  this.notify(); return this.list();
 }
 schedule() {
  if (this.scheduled || this.closed || this.storageError) return;
  this.scheduled = true; queueMicrotask(() => { this.scheduled = false; this.drain(); });
 }
 drain() {
  if (this.closed || this.storageError) return;
  for (const job of this.jobs.values()) {
   if (this.runs.size >= this.concurrency) break;
   if (job.status !== 'queued' || this.runs.has(job.id)) continue;
   const run = { controller: new AbortController(), generation: job.generation, stepId: null, started: 0 };
   this.runs.set(job.id, run);
   void this.execute(job.id, run).finally(() => { if (this.runs.get(job.id) === run) this.runs.delete(job.id); this.schedule(); });
  }
 }
 owns(id, run) { return !this.closed && !this.storageError && !run.controller.signal.aborted && this.runs.get(id) === run && this.job(id).generation === run.generation; }
 async execute(id, run) {
  let timer;
  try {
   if (!this.owns(id, run)) return;
   let job = this.job(id);
   // Reserve three final stages before collection can use up the run's budget.
   // Retries count as new attempts; neither Stop nor Resume resets any limit.
   const reserve = ['planning', 'researching'].includes(job.phase) ? 3 : 0;
   if (job.usage.steps >= job.limits.maxSteps - reserve || job.usage.activeMs + (reserve + 1) * job.limits.stepTimeoutMs > job.limits.maxActiveMs)
    throw schema.fault('RESEARCH_LIMIT', reserve ? 'Research reached its collection limit. Finish with the saved evidence to produce a partial report.' : 'Research reached its run limit. Saved evidence and report draft are preserved.');
   run.stepId = randomUUID(); run.started = performance.now();
   job = this.change(id, j => {
    j.status = 'running'; j.error = null; j.usage.steps++; j.usage.activeMs += j.limits.stepTimeoutMs;
    if (!j.reportDraft) j.usage.unmeasuredSteps++;
    j.steps.push({ id: run.stepId, phase: j.reportDraft ? 'publishing' : j.phase, status: 'started', startedAt: Date.now(), finishedAt: null, reservedMs: j.limits.stepTimeoutMs });
   });
   timer = setTimeout(() => run.controller.abort(schema.fault('RESEARCH_TIMEOUT', 'This research step timed out. Resume to retry from the saved checkpoint.')), job.limits.stepTimeoutMs);
   const signal = run.controller.signal;
   const currentBinding = await this.resolve(job.input, signal, job.material);
   if (!this.owns(id, run)) return;
   if (!isDeepStrictEqual(job.binding, currentBinding)) throw schema.fault('RESEARCH_ACCESS_CHANGED', 'The selected account, model adapter, or source access changed. Restore the original selection or start a new research job.');
   const publishing = job.reportDraft !== null;
   const raw = await abortable(signal, () => publishing
    ? this.adapter.publish({ job: clone(job), signal, idempotencyKey: job.publicationKey, expectedLatestVersionId: job.input.previousReport?.versionId ?? null })
    : this.adapter.runPhase({ job: clone(job), signal, stepId: run.stepId }));
   if (!this.owns(id, run)) return;
   // Access can change while an adapter is awaiting I/O. Reject those results too.
   const afterBinding = await this.resolve(job.input, signal, job.material);
   if (!this.owns(id, run)) return;
   if (!isDeepStrictEqual(job.binding, afterBinding)) throw schema.fault('RESEARCH_ACCESS_CHANGED', 'Research access changed during this step. Its result was not added.');
   const result = publishing ? (schema.report(raw), clone(raw)) : schema.result(raw, job.phase);
   this.change(id, j => {
    const step = j.steps.find(s => s.id === run.stepId); this.settleStep(j, run); step.status = 'complete';
    if (!publishing && result.activity) step.activity = result.activity;
    if (!publishing && result.usage) { j.usage.inputTokens += result.usage.inputTokens; j.usage.outputTokens += result.usage.outputTokens; j.usage.unmeasuredSteps--; }
    if (publishing) { j.report = result; j.status = 'completed'; return; }
    if (j.phase === 'planning') { j.plan = result.plan; j.planVersion++; j.status = 'awaiting_plan'; return; }
    if (j.phase === 'researching') {
     for (const evidence of result.evidence) {
      const previous = j.evidence.find(e => e.id === evidence.id);
      schema.assert(!previous || isDeepStrictEqual(previous, evidence), 'A source attempted to replace saved evidence.');
      if (!previous) j.evidence.push(evidence);
     }
     for (const finding of result.findings) {
      const previous = j.findings.find(f => f.id === finding.id);
      schema.assert(!previous || isDeepStrictEqual(previous, finding), 'A research step attempted to replace a saved finding.');
      if (!previous) j.findings.push(finding);
     }
     j.gaps = [...new Set([...j.gaps, ...result.gaps])]; if (result.done) j.phase = 'checking';
    } else if (j.phase === 'checking') { j.findings = result.findings; j.gaps = result.gaps; j.phase = 'writing'; }
    else j.reportDraft = result.reportDraft;
    j.status = 'queued';
   });
  } catch (error) {
   // Timeouts are ours to persist; user cancellation already committed a newer generation.
   if (this.closed || this.storageError || this.runs.get(id) !== run || this.job(id).generation !== run.generation) return;
   const failure = run.controller.signal.aborted ? run.controller.signal.reason : error;
   try { this.change(id, j => { this.settleStep(j, run); j.status = ['RESEARCH_TIMEOUT', 'RESEARCH_LIMIT'].includes(failure?.code) ? 'interrupted' : 'failed'; j.error = errorData(failure); }); }
   catch { /* commit already halted scheduling and disclosed its storage error */ }
  } finally { clearTimeout(timer); }
 }
 shutdown() {
  this.closed = true; this.epoch++;
  let failure;
  for (const run of this.runs.values()) run.controller.abort(schema.fault('RESEARCH_CANCELLED', 'zQ closed.'));
  for (const job of this.jobs.values()) if (job.status === 'queued' || job.status === 'running') {
   try { this.cancel(job.id, 'interrupted', 'Research paused when zQ closed. Resume to continue from saved evidence.'); } catch (error) { failure ??= error; }
  }
  if (this.storageError) failure ??= schema.fault(this.storageError.code, this.storageError.message);
  if (failure) throw failure;
 }
 reopen() { this.closed = false; /* Explicit Resume is required; never restart paid work automatically. */ }
}
module.exports = { ResearchService, summary, detail, abortable };
