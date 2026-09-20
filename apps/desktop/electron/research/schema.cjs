'use strict';
const { isDeepStrictEqual } = require('node:util');

const PHASES = ['planning', 'researching', 'checking', 'writing'];
const STATUSES = ['awaiting_plan', 'queued', 'running', 'completed', 'stopped', 'interrupted', 'failed'];
const DEFAULT_LIMITS = Object.freeze({ maxSteps: 40, maxActiveMs: 30 * 60 * 1000, stepTimeoutMs: 90000 });
const MAX_JOB_BYTES = 8 * 1024 * 1024;
function fault(code, message) { return Object.assign(new Error(message), { code, researchSafe: true }); }
function assert(value, message = 'Invalid research data.') { if (!value) throw fault('INVALID_RESEARCH', message); }
function object(value, keys) {
 assert(value && typeof value === 'object' && !Array.isArray(value));
 assert(Object.keys(value).every(key => keys.includes(key)), 'Unexpected research field.');
}
function text(value, max = 4096, nonempty = false) {
 assert(typeof value === 'string' && Buffer.byteLength(value) <= max && !value.includes('\0') && Buffer.from(value).toString('utf8') === value && (!nonempty || value.trim().length));
}
function id(value) { text(value, 256, true); }
function uuid(value) { assert(typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)); }
function number(value, max = Number.MAX_SAFE_INTEGER) { assert(Number.isSafeInteger(value) && value >= 0 && value <= max); }
function list(value, max, validate) { assert(Array.isArray(value) && value.length <= max); value.forEach(validate); }
function unique(value, key = v => v) { assert(new Set(value.map(key)).size === value.length, 'Duplicate research item.'); }
function choice(value) { object(value, ['connectionId', 'model']); id(value.connectionId); text(value.model, 512, true); }
function source(value, resolved = false) {
 object(value, ['kind', 'id', 'scope', ...(resolved ? ['label', 'revision', 'capability', 'scopeDescription'] : [])]);
 assert(['web', 'attachment', 'note', 'project_file', 'connector'].includes(value.kind)); id(value.id);
 list(value.scope, 40, v => text(v, 2048, true)); unique(value.scope);
 if (resolved) { text(value.label, 512, true); id(value.revision); assert(['read', 'search_read'].includes(value.capability)); text(value.scopeDescription, 2048, true); }
}
function input(value) {
 object(value, ['id', 'conversationId', 'projectId', 'choice', 'brief', 'sources', 'previousReport']); if(value.previousReport!==undefined)report(value.previousReport); uuid(value.id); id(value.conversationId);
 if (value.projectId !== null) id(value.projectId); choice(value.choice); text(value.brief, 32000, true);
 list(value.sources, 30, v => source(v)); assert(value.sources.length > 0, 'Select at least one research source.'); unique(value.sources, v => v.id);
 return structuredClone(value);
}
function binding(value, requested) {
 object(value, ['adapterId', 'connectionRevision', 'sources']); id(value.adapterId); id(value.connectionRevision);
 list(value.sources, 30, v => source(v, true)); unique(value.sources, v => v.id);
 const selections = value.sources.map(({ kind, id, scope }) => ({ kind, id, scope }));
 assert(isDeepStrictEqual(selections, requested), 'The resolved research sources do not match the selected scope.');
 return structuredClone(value);
}
function plan(value) {
 object(value, ['title', 'steps', 'questions']); text(value.title, 512, true);
 list(value.steps, 16, v => text(v, 2048, true)); assert(value.steps.length > 0, 'A research plan needs at least one step.');
 list(value.questions, 8, v => text(v, 2048, true));
 return structuredClone(value);
}
function evidence(value) {
 object(value, ['id', 'sourceId', 'title', 'locator', 'url', 'retrievedAt', 'excerpt', 'contentHash', 'level', 'provenance']);
 id(value.id); id(value.sourceId); text(value.title, 1024, true); text(value.locator, 4096, true); number(value.retrievedAt);
 text(value.excerpt, 32000, true); assert(['snippet', 'excerpt', 'document'].includes(value.level));
 if (value.url !== undefined) { text(value.url, 4096, true); let url; try { url = new URL(value.url); } catch { assert(false); } assert(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password); }
 if (value.contentHash !== undefined) text(value.contentHash, 256, true);
 object(value.provenance, ['tool', 'requestId']); id(value.provenance.tool); id(value.provenance.requestId);
}
function finding(value) {
 object(value, ['id', 'text', 'evidenceIds', 'kind']); id(value.id); text(value.text, 16000, true);
 list(value.evidenceIds, 100, id); unique(value.evidenceIds);
 assert(['sourced', 'quotation', 'calculation', 'interpretation'].includes(value.kind));
 assert(value.kind === 'interpretation' || value.evidenceIds.length > 0, 'Sourced findings require evidence.');
}
function reportDraft(value) {
 object(value, ['title', 'markdown', 'citationIds', 'datasets', 'charts']); require('./report-schema.cjs').visuals(value); text(value.title, 512, true); text(value.markdown, 500000, true);
 list(value.citationIds, 500, id); unique(value.citationIds);
}
function report(value) { object(value, ['artifactId', 'versionId']); uuid(value.artifactId); uuid(value.versionId); }
function limits(value) {
 object(value, ['maxSteps', 'maxActiveMs', 'stepTimeoutMs']);
 number(value.maxSteps, DEFAULT_LIMITS.maxSteps); assert(value.maxSteps >= 5);
 number(value.stepTimeoutMs, DEFAULT_LIMITS.stepTimeoutMs); assert(value.stepTimeoutMs >= 1);
 number(value.maxActiveMs, DEFAULT_LIMITS.maxActiveMs); assert(value.maxActiveMs >= 5 * value.stepTimeoutMs);
 return structuredClone(value);
}
function usage(value) {
 object(value, ['steps', 'activeMs', 'inputTokens', 'outputTokens', 'unmeasuredSteps']);
 for (const key of ['steps', 'activeMs', 'inputTokens', 'outputTokens', 'unmeasuredSteps']) number(value[key]);
}
function step(value) {
 object(value, ['id', 'phase', 'status', 'startedAt', 'finishedAt', 'reservedMs', 'activity']); uuid(value.id);
 if (value.activity !== undefined) activity(value.activity);
 assert([...PHASES, 'publishing'].includes(value.phase)); assert(['started', 'complete', 'interrupted'].includes(value.status));
 number(value.startedAt); number(value.reservedMs); if (value.finishedAt !== null) number(value.finishedAt);
 assert(value.status === 'started' ? value.finishedAt === null : value.finishedAt !== null);
}
function activity(value) {
 object(value, ['kind', 'sourceId', 'description']);
 assert(['web_search', 'read', 'connector'].includes(value.kind)); id(value.sourceId); text(value.description, 2048, true);
}
function material(value) {
 list(value, 30, item => { object(item, ['sourceId', 'title', 'text', 'mime']); id(item.sourceId); text(item.title, 1024, true); text(item.text, 100000, true); text(item.mime, 128, true); });
 unique(value, item => item.sourceId); assert(Buffer.byteLength(JSON.stringify(value)) <= 600000, 'Select at most 600 KB of research reference text.');
 return structuredClone(value);
}
function result(value, phase) {
 const keys = phase === 'planning' ? ['plan'] : phase === 'researching' ? ['evidence', 'findings', 'gaps', 'done'] : phase === 'checking' ? ['findings', 'gaps'] : ['reportDraft'];
 object(value, [...keys, 'usage', 'activity']);
 if (value.activity !== undefined) activity(value.activity);
 if (value.usage !== undefined) { object(value.usage, ['inputTokens', 'outputTokens']); number(value.usage.inputTokens); number(value.usage.outputTokens); }
 if (phase === 'planning') plan(value.plan);
 if (phase === 'researching') { list(value.evidence, 100, evidence); unique(value.evidence, v => v.id); assert(typeof value.done === 'boolean'); }
 if (['researching', 'checking'].includes(phase)) { list(value.findings, 100, finding); unique(value.findings, v => v.id); list(value.gaps, 100, v => text(v, 4096, true)); }
 if (phase === 'writing') reportDraft(value.reportDraft);
 return structuredClone(value);
}
function job(value) {
 object(value, ['id', 'revision', 'input', 'binding', 'material', 'phase', 'status', 'generation', 'plan', 'planVersion', 'acceptedPlanVersion', 'steps', 'evidence', 'findings', 'gaps', 'reportDraft', 'report', 'publicationKey', 'finishRequested', 'createdAt', 'updatedAt', 'usage', 'limits', 'error']);
 uuid(value.id); number(value.revision); assert(value.revision > 0); input(value.input); assert(value.id === value.input.id);
 binding(value.binding, value.input.sources); assert(PHASES.includes(value.phase) && STATUSES.includes(value.status)); number(value.generation);
 if (value.material !== undefined) { material(value.material); assert(value.material.every(m => value.input.sources.some(s => s.id === m.sourceId && ['attachment', 'note', 'project_file'].includes(s.kind)))); }
 number(value.planVersion); if (value.plan !== null) plan(value.plan);
 if (value.acceptedPlanVersion !== null) { number(value.acceptedPlanVersion); assert(value.acceptedPlanVersion === value.planVersion && value.plan !== null && !value.plan.questions.length); }
 assert(value.phase === 'planning' || value.acceptedPlanVersion !== null);
 assert(value.status !== 'awaiting_plan' || value.phase === 'planning' && value.plan !== null);
 list(value.steps, DEFAULT_LIMITS.maxSteps, step); unique(value.steps, v => v.id);
 const active = value.steps.filter(s => s.status === 'started'); assert(active.length <= 1 && (!active.length || value.status === 'running'));
 assert(value.status !== 'running' || active.length === 1);
 list(value.evidence, 500, evidence); unique(value.evidence, v => v.id);
 assert(value.evidence.every(e => value.binding.sources.some(s => s.id === e.sourceId)), 'Evidence came from an unselected source.');
 const evidenceIds = new Set(value.evidence.map(e => e.id));
 list(value.findings, 500, finding); unique(value.findings, v => v.id);
 assert(value.findings.every(f => f.evidenceIds.every(id => evidenceIds.has(id))), 'A finding references missing evidence.');
 list(value.gaps, 200, v => text(v, 4096, true));
 if (value.reportDraft !== null) { reportDraft(value.reportDraft); assert(value.reportDraft.citationIds.every(id => evidenceIds.has(id)), 'The report references missing evidence.'); assert(value.phase === 'writing'); }
 if (value.report !== null) { report(value.report); assert(value.reportDraft !== null && value.status === 'completed'); }
 assert(value.status !== 'completed' || value.report !== null);
 assert(value.publicationKey === `research:${value.id}:report:1`);
 assert(typeof value.finishRequested === 'boolean'); number(value.createdAt); number(value.updatedAt);
 usage(value.usage); limits(value.limits); assert(value.usage.steps === value.steps.length && value.usage.steps <= value.limits.maxSteps && value.usage.activeMs <= value.limits.maxActiveMs);
 assert(value.usage.unmeasuredSteps <= value.usage.steps);
 if (value.error !== null) { object(value.error, ['code', 'message']); text(value.error.code, 128, true); text(value.error.message, 2048, true); }
 assert(Buffer.byteLength(JSON.stringify(value)) <= MAX_JOB_BYTES, 'This research job has reached its storage limit.');
 return value;
}
module.exports = { evidence, source, choice, DEFAULT_LIMITS, MAX_JOB_BYTES, fault, assert, input, binding, plan, result, report, limits, job, uuid, number, material, finding };

function validDraft(value) { if (value === undefined) return true; try { object(value, ['mode', 'sources', 'previousReport']); if(value.previousReport!==undefined)report(value.previousReport); assert(typeof value.mode === 'boolean'); list(value.sources, 30, v => source(v)); unique(value.sources, v => v.id); return true; } catch { return false; } }
module.exports.validDraft = validDraft;
