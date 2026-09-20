'use strict';
const s = require('./schema.cjs');
const own = (v, keys) => { s.assert(v && typeof v === 'object' && !Array.isArray(v)); s.assert(Object.keys(v).every(k => keys.includes(k))); };
const text = (v, max = 4096) => s.assert(typeof v === 'string' && Buffer.byteLength(v) <= max && !v.includes('\0') && Buffer.from(v).toString('utf8') === v);
const list = (v, max) => s.assert(Array.isArray(v) && v.length <= max);
const identifier = v => s.assert(typeof v === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(v), 'Use short lowercase dataset and chart IDs.');
const unique = v => s.assert(new Set(v).size === v.length, 'Duplicate report item.');
function visuals(value, evidence) {
 const datasets = value.datasets ?? [], charts = value.charts ?? [];
 list(datasets, 8); list(charts, 8); unique(datasets.map(d => d.id)); unique(charts.map(c => c.id));
 for (const d of datasets) {
  own(d, ['id', 'title', 'columns', 'rows', 'method']); identifier(d.id); text(d.title, 200); text(d.method, 2048); list(d.columns, 8); s.assert(d.columns.length >= 2); unique(d.columns.map(c => c.key));
  for (const c of d.columns) { own(c, ['key', 'label', 'type', 'unit']); identifier(c.key); text(c.label, 80); text(c.unit ?? '', 40); s.assert(['text', 'number'].includes(c.type)); }
  list(d.rows, 200); s.assert(d.rows.length > 0);
  for (const row of d.rows) {
   own(row, ['values', 'evidenceIds']); list(row.values, 8); s.assert(row.values.length === d.columns.length); list(row.evidenceIds, 20); unique(row.evidenceIds); s.assert(row.evidenceIds.length > 0);
   if (evidence) s.assert(row.evidenceIds.every(id => evidence.some(e => e.id === id)), 'Dataset rows must cite saved evidence.');
   row.values.forEach((v, i) => { if (v === null) return; if (d.columns[i].type === 'text') text(v, 512); else {
    s.assert(typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e15, 'Dataset values must be finite numbers or null.');
    // Initial charts transcribe source values. Derived numeric datasets are not
    // accepted until their transformations can be independently reproduced.
    if (evidence) { const numbers = row.evidenceIds.flatMap(id => (evidence.find(e => e.id === id).excerpt.replace(/(?<=\d),(?=\d{3}(?:[,\D]|$))/g, '').match(/[-+]?\d+(?:\.\d+)?(?:e[-+]?\d+)?/gi) ?? []).map(Number)); s.assert(numbers.includes(v), 'Chart values must occur in the cited evidence. Keep unsupported calculations in the report with an explicit method.'); }
   } });
  }
 }
 for (const c of charts) {
  own(c, ['id', 'title', 'type', 'datasetId', 'x', 'y']); identifier(c.id); text(c.title, 200); s.assert(['bar', 'line', 'scatter'].includes(c.type));
  const d = datasets.find(d => d.id === c.datasetId); s.assert(d, 'A chart references missing data.'); const x = d.columns.find(v => v.key === c.x), y = d.columns.find(v => v.key === c.y);
  s.assert(x && y && x !== y && y.type === 'number' && (c.type !== 'scatter' || x.type === 'number'), 'Choose valid chart columns.');
  s.assert(c.type !== 'bar' || d.rows.length <= 40, 'Bar charts support up to 40 categories.');
  s.assert(d.rows.some(r => r.values[d.columns.indexOf(x)] !== null && r.values[d.columns.indexOf(y)] !== null), 'A chart needs at least one complete data point.');
 }
 return { datasets, charts };
}
function document(value) {
 own(value, ['schemaVersion', 'jobId', 'title', 'markdown', 'citationIds', 'evidence', 'findings', 'gaps', 'sources', 'plan', 'choice', 'createdAt', 'datasets', 'charts', 'previousReport']);
 s.assert(value.schemaVersion === 1); s.uuid(value.jobId); text(value.title, 512); s.assert(value.title.trim()); text(value.markdown, 500000); s.assert(value.markdown.trim()); s.number(value.createdAt);
 list(value.evidence, 500); value.evidence.forEach(s.evidence); unique(value.evidence.map(e => e.id));
 list(value.sources, 30); value.sources.forEach(v => s.source(v, true)); unique(value.sources.map(v => v.id)); s.assert(value.evidence.every(e => value.sources.some(v => v.id === e.sourceId)));
 list(value.citationIds, 500); unique(value.citationIds); s.assert(value.citationIds.every(id => value.evidence.some(e => e.id === id)), 'Missing report citation.');
 list(value.findings, 500); value.findings.forEach(s.finding); s.assert(value.findings.every(f => f.evidenceIds.every(id => value.evidence.some(e => e.id === id))));
 list(value.gaps, 200); value.gaps.forEach(v => text(v, 4096)); s.plan(value.plan); s.assert(value.plan.questions.length === 0); s.choice(value.choice);
 if (value.previousReport) s.report(value.previousReport);
 for (const match of value.markdown.matchAll(/\[(\d+)\](?!\()/g)) s.assert(Number(match[1]) > 0 && Number(match[1]) <= value.citationIds.length, 'The report contains an unknown citation number.');
 s.assert(!/<\s*(?:script|iframe|img|object|style|svg)\b/i.test(value.markdown), 'Embedded active content is not supported in reports.');
 visuals(value, value.evidence); s.assert((value.datasets ?? []).every(d => d.rows.every(r => r.evidenceIds.every(id => value.citationIds.includes(id)))), 'Dataset sources must appear in the report citations.'); s.assert(Buffer.byteLength(JSON.stringify(value)) <= 8 * 1024 * 1024, 'Report exceeds 8 MB.'); return value;
}
module.exports = { document, visuals };
