'use strict';
const validate = require('./report-schema.cjs');
const charts = require('./report-charts.cjs');
const s = require('./schema.cjs');
const filename = title => Array.from(title.replace(/[\\/\x00-\x1f\x7f:*?"<>|]/g, '_')).slice(0, 70).join('').trim() || 'Research report';
function csv(dataset) {
 const cell = v => { const raw = v === null ? '' : String(v), safe = typeof v === 'string' && /^[=+\-@\t\r]/.test(raw) ? "'" + raw : raw; return '"' + safe.replace(/"/g, '""') + '"'; };
 return [dataset.columns.map(c => c.label + (c.unit ? ` (${c.unit})` : '')), ...dataset.rows.map(r => r.values)].map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
function table(dataset, report) {
 const cell = v => String(v ?? '—').replace(/\|/g, '\\|').replace(/[\r\n]/g, ' ');
 const headings = [...dataset.columns.map(c => c.label + (c.unit ? ` (${c.unit})` : '')), 'Sources'];
 return `## ${dataset.title}\n\n| ${headings.map(cell).join(' | ')} |\n| ${headings.map(() => '---').join(' | ')} |\n` + dataset.rows.map(r => '| ' + [...r.values, r.evidenceIds.map(id => `[${report.citationIds.indexOf(id) + 1}]`).join(', ')].map(cell).join(' | ') + ' |').join('\n') + `\n\n${dataset.method}\n`;
}
const methods = {
 researchReport(target) { const a = this.artifact(target.artifactId); s.assert(a.format === 'research', 'This artifact is not a research report.'); const bytes = Buffer.from(this.file(target).data, 'base64'); return structuredClone(validate.document(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))); },
 researchView(target) { const document = this.researchReport(target); return { document, datasets:document.datasets.map(d=>({id:d.id,csv:csv(d)})), charts: document.charts.map(c => ({ id: c.id, image: 'data:image/svg+xml;base64,' + Buffer.from(charts.svg(c, document.datasets.find(d => d.id === c.datasetId))).toString('base64') })) }; },
 publishResearch({ job, signal, idempotencyKey, expectedLatestVersionId }) {
  signal?.throwIfAborted(); s.assert(idempotencyKey === `research:${job.id}:report:1`);
  const existing = this.items.flatMap(a => a.versions.map(v => ({ a, v }))).find(({ v }) => v.publicationKey === idempotencyKey);
  if (existing) { const target = { artifactId: existing.a.id, versionId: existing.v.id }; s.assert(this.researchReport(target).jobId === job.id); return target; }
  const draft = job.reportDraft; s.assert(draft, 'The research report has not been written.');
  const document = validate.document({ schemaVersion: 1, jobId: job.id, title: draft.title, markdown: draft.markdown, citationIds: draft.citationIds, evidence: job.evidence, findings: job.findings, gaps: job.gaps, sources: job.binding.sources, plan: job.plan, choice: job.input.choice, createdAt: job.createdAt, datasets: draft.datasets ?? [], charts: draft.charts ?? [], ...(job.input.previousReport ? { previousReport: job.input.previousReport } : {}) });
  const previous = job.input.previousReport;
  if (previous) { s.assert(expectedLatestVersionId === previous.versionId); try { this.checkRevision(previous.artifactId, previous.versionId, 'research'); } catch { throw s.fault('RESEARCH_REPORT_CONFLICT', 'The report changed or was deleted during this follow-up. Saved research is preserved. Open the latest report to start a new follow-up.'); } }
  else s.assert(expectedLatestVersionId === null);
  signal?.throwIfAborted();
  const artifact = this.commitResearch(document, { artifactId: previous?.artifactId, publicationKey: idempotencyKey, source: { conversationId: job.input.conversationId, ...(job.input.projectId ? { projectId: job.input.projectId } : {}) } });
  return { artifactId: artifact.id, versionId: artifact.versions.at(-1).id };
 },
 commitResearch(document, options = {}) {
  validate.document(document); const title = filename(document.title), data = Buffer.from(JSON.stringify(document)).toString('base64');
  return this.commit({ name: title + '.research.json', mime: 'application/json', data }, { ...options, format: 'research', title });
 },
 reviseResearch({ artifactId, versionId, expectedLatestVersionId, title, markdown }) {
  this.checkRevision(artifactId, expectedLatestVersionId, 'research');
  const document = this.researchReport({ artifactId, versionId });
  const next = { ...document, title, markdown, createdAt: Date.now(), previousReport: { artifactId, versionId } };
  validate.document(next); return this.commitResearch(next, { artifactId, source: this.version({ artifactId, versionId }).source });
 },
 async researchExport({ artifactId, versionId, format, itemId }) {
  const doc = this.researchReport({ artifactId, versionId }), base = filename(doc.title);
  if (format === 'csv') { const d = doc.datasets.find(d => d.id === itemId); s.assert(d, 'Dataset not found.'); return { name: base + '-' + d.id + '.csv', mime: 'text/csv', bytes: Buffer.from(csv(d)) }; }
  if (format === 'svg') { const c = doc.charts.find(c => c.id === itemId); s.assert(c, 'Chart not found.'); return { name: base + '-' + c.id + '.svg', mime: 'image/svg+xml', bytes: Buffer.from(charts.svg(c, doc.datasets.find(d => d.id === c.datasetId))) }; }
  s.assert(['markdown', 'pdf'].includes(format), 'Choose Markdown, PDF, chart SVG or dataset CSV.');
  const content = doc.markdown + '\n\n' + doc.datasets.map(d => table(d, doc)).join('\n\n');
  if (format === 'pdf') {
   const { renderPdf, parseContent } = require('../artifact-renderer.cjs');
   const blocks = parseContent(content), plots = doc.charts.map(c => ({ type: 'chart', plot: charts.scene(c, doc.datasets.find(d => d.id === c.datasetId)), text: c.title }));
   return { name: base + '.pdf', mime: 'application/pdf', bytes: await renderPdf(doc.title, [...blocks, ...plots]) };
  }
  const zip = new (require('jszip'))();
  const figures = doc.charts.map(c => { const relative = `assets/${c.id}.svg`; zip.file(relative, charts.svg(c, doc.datasets.find(d => d.id === c.datasetId))); return `## ${c.title}\n\n![${c.title.replace(/[\[\]<>]/g, '')}](${relative})\n\n[View data](data/${c.datasetId}.csv)`; });
  for (const d of doc.datasets) zip.file(`data/${d.id}.csv`, csv(d));
  // Exports contain citations/data, not copied private source documents/excerpts.
  zip.file('report.md', `# ${doc.title}\n\n${content}\n\n${figures.join('\n\n')}\n`);
  zip.file('sources.json', JSON.stringify({ schemaVersion: 1, citations: doc.citationIds.map((id, i) => { const e = doc.evidence.find(e => e.id === id); return { number: i + 1, id, title: e.title, url: e.url, locator: e.locator, retrievedAt: e.retrievedAt, level: e.level }; }), datasets: doc.datasets }, null, 2));
  return { name: base + '.zip', mime: 'application/zip', bytes: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }) };
 },
};
module.exports = { methods, csv, table };
