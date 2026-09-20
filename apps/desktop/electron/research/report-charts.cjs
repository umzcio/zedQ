'use strict';
const escape = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const short = (text, n = 34) => Array.from(String(text)).slice(0, n).join('');
function scene(chart, dataset) {
 const width = 800, height = 380, left = 90, top = 42, right = 765, bottom = 308;
 const xi = dataset.columns.findIndex(c => c.key === chart.x), yi = dataset.columns.findIndex(c => c.key === chart.y), numericX = chart.type !== 'bar' && dataset.columns[xi].type === 'number';
 const points = dataset.rows.map((r, index) => ({ x: numericX ? r.values[xi] : index, y: r.values[yi], label: r.values[xi] }));
 const valid = points.filter(p => p.x !== null && p.y !== null && p.label !== null), ys = valid.map(p => p.y), xs = valid.map(p => p.x);
 let min = Math.min(...ys), max = Math.max(...ys); if (chart.type === 'bar') { min = Math.min(0, min); max = Math.max(0, max); } if (max === min) { const pad = Math.abs(min) * .1 || 1; min -= pad; max += pad; }
 let xmin = numericX ? Math.min(...xs) : -.5, xmax = numericX ? Math.max(...xs) : points.length - .5; if (xmin === xmax) { xmin -= .5; xmax += .5; }
 const x = value => left + (value - xmin) / (xmax - xmin) * (right - left), y = value => bottom - (value - min) / (max - min) * (bottom - top);
 const marks = [], line = (x1, y1, x2, y2, color = '#dce1e7') => marks.push({ kind: 'line', x1, y1, x2, y2, color }), label = (text, px, py, size = 13) => marks.push({ kind: 'text', text: short(text), x: px, y: py, size });
 label(chart.title, left, 15, 17);
 for (let i = 0; i <= 4; i++) { const value = min + (max - min) * i / 4, py = y(value); line(left, py, right, py); label(Number(value.toPrecision(4)), 8, py - 7, 12); }
 line(left, top, left, bottom, '#748091'); line(left, bottom, right, bottom, '#748091');
 const step = Math.max(1, Math.ceil(points.length / 6));
 points.forEach((p, i) => { if (i % step === 0 && p.x !== null && p.label !== null) label(short(p.label, 13), Math.max(left, x(p.x) - 20), bottom + 12, 12); });
 const unit = c => c.label + (c.unit ? ` (${c.unit})` : ''); label(unit(dataset.columns[xi]), left, height - 22, 13); label(unit(dataset.columns[yi]), right - 250, height - 22, 13);
 let previous = null;
 for (const p of points) {
  if (p.x === null || p.y === null || p.label === null) { previous = null; continue; }
  const px = x(p.x), py = y(p.y);
  if (chart.type === 'bar') { const w = Math.min(65, (right - left) / points.length * .65), zero = y(0); marks.push({ kind: 'rect', x: px - w / 2, y: Math.min(py, zero), width: w, height: Math.abs(zero - py), color: '#5079aa' }); }
  else { if (chart.type === 'line' && previous) line(previous.x, previous.y, px, py, '#5079aa'); marks.push({ kind: 'circle', x: px, y: py, radius: 3, color: '#5079aa' }); }
  previous = { x: px, y: py };
 }
 return { width, height, marks };
}
function svg(chart, dataset) {
 const plot = scene(chart, dataset), elements = plot.marks.map(m => m.kind === 'text' ? `<text x="${m.x}" y="${m.y + m.size}" font-family="Arial,sans-serif" font-size="${m.size}" fill="#263240">${escape(m.text)}</text>` : m.kind === 'line' ? `<line x1="${m.x1}" y1="${m.y1}" x2="${m.x2}" y2="${m.y2}" stroke="${m.color}" stroke-width="1.5"/>` : m.kind === 'rect' ? `<rect x="${m.x}" y="${m.y}" width="${m.width}" height="${m.height}" fill="${m.color}"/>` : `<circle cx="${m.x}" cy="${m.y}" r="${m.radius}" fill="${m.color}"/>`);
 return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${plot.width} ${plot.height}" role="img"><title>${escape(chart.title)}</title><rect width="100%" height="100%" fill="white"/>${elements.join('')}</svg>`;
}
function pdf(doc, plot, x, y, width, drawText) {
 const scale = width / plot.width;
 for (const m of plot.marks) {
  if (m.kind === 'text') drawText(m.text, x + m.x * scale, y + m.y * scale, m.size * scale);
  else if (m.kind === 'line') doc.moveTo(x + m.x1 * scale, y + m.y1 * scale).lineTo(x + m.x2 * scale, y + m.y2 * scale).lineWidth(1).stroke(m.color);
  else if (m.kind === 'rect') doc.rect(x + m.x * scale, y + m.y * scale, m.width * scale, m.height * scale).fill(m.color);
  else doc.circle(x + m.x * scale, y + m.y * scale, m.radius * scale).fill(m.color);
 }
}
module.exports = { scene, svg, pdf };
