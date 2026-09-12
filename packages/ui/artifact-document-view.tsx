import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist'
import { frameHtml, validateZipDirectory } from './artifact-document-security.mjs'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import './artifact-document-view.css'

export type ArtifactDocumentFile = { name: string; mime: string; data: string; format?: string }
export type ArtifactDocumentViewProps = { file: ArtifactDocumentFile; zoom: number | 'fit'; onEscape?: () => void }
type Format = 'pdf' | 'docx' | 'xlsx' | 'pptx'

function fileFormat(file: ArtifactDocumentFile): Format | null {
  if (['pdf', 'docx', 'xlsx', 'pptx'].includes(file.format || '')) return file.format as Format
  const mime: Record<string, Format> = {
    'application/pdf': 'pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  }
  const extension = file.name.split('.').pop()?.toLowerCase()
  return mime[file.mime] || (['pdf', 'docx', 'xlsx', 'pptx'].includes(extension || '') ? extension as Format : null)
}
function fileBytes(data: string) {
  if (data.length > 13981016 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw new Error('This file is invalid or exceeds the 10 MB preview limit.')
  const decoded = atob(data)
  if (decoded.length > 10 * 1024 * 1024) throw new Error('This file exceeds the 10 MB preview limit.')
  return Uint8Array.from(decoded, character => character.charCodeAt(0))
}

/** Office parsing and DOM rendering stay inside an opaque-origin iframe. */
function OfficeDocument({ file, zoom, onEscape, format }: ArtifactDocumentViewProps & { format: Exclude<Format, 'pdf'> }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [source, setSource] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const session = useRef('')
  const currentZoom = useRef(zoom); currentZoom.current = zoom
  const escapeHandler = useRef(onEscape); escapeHandler.current = onEscape
  useEffect(() => {
    let cancelled = false
    const scripts: string[] = []
    const token = crypto.randomUUID(); session.current = token
    let bytes: Uint8Array<ArrayBuffer>
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.data?.zqDocument !== token) return
      if (event.data.type === 'loaderReady') frame.current?.contentWindow?.postMessage({ zqDocument: token, type: 'loadScripts', scripts }, '*')
      if (event.data.type === 'boot') frame.current?.contentWindow?.postMessage({ zqDocument: token, type: 'render', format, bytes: bytes.buffer, zoom: currentZoom.current }, '*')
      if (event.data.type === 'ready') setLoading(false)
      if (event.data.type === 'error') { setLoading(false); setError(String(event.data.message || 'This document could not be rendered.').slice(0, 400)) }
      if (event.data.type === 'escape') escapeHandler.current?.()
    }
    window.addEventListener('message', receive)
    setLoading(true); setError(''); setSource('')
    void (async () => {
      bytes = fileBytes(file.data)
      validateZipDirectory(bytes)
      const [{ default: zip }, { default: runtime }] = await Promise.all([
        import('../../node_modules/jszip/dist/jszip.min.js?raw'),
        import('./artifact-document-runtime.js?raw'),
      ])
      if (cancelled) return
      scripts.push(zip)
      if (format === 'docx') {
        const { default: source } = await import('../../node_modules/docx-preview/dist/docx-preview.min.js?raw')
        if (cancelled) return
        scripts.push(source)
      } else if (format === 'xlsx') {
        const { default: source } = await import('../../node_modules/exceljs/dist/exceljs.min.js?raw')
        if (cancelled) return
        scripts.push(source)
      } else {
        const { default: source } = await import('@aiden0z/pptx-renderer/browser?raw')
        if (cancelled) return
        // The standalone distribution has no static imports. Adapt its final ESM
        // export to a classic script so it can run in a no-same-origin sandbox.
        // PDF fallback is disabled, including its optional import.meta resolver.
        const exportBlock = source.match(/export\s*\{([\s\S]*?)\};?\s*$/)
        const viewer = exportBlock?.[1].match(/([\w$]+)\s+as\s+PptxViewer\b/)?.[1]
        if (!viewer || !exportBlock) throw new Error('PowerPoint viewer bundle is incompatible.')
        scripts.push(source.slice(0, exportBlock.index).replaceAll('import.meta.resolve', 'undefined') + `\nglobalThis.zqPptx = { PptxViewer: ${viewer} };`)
      }
      scripts.push(`const validateZipDirectory = ${validateZipDirectory.toString()};\n${runtime}`)
      if (!cancelled) setSource(frameHtml(token))
    })().catch(error => { if (!cancelled) { setLoading(false); setError(error instanceof Error ? error.message : 'This document could not be rendered.') } })
    return () => { cancelled = true; window.removeEventListener('message', receive) }
  }, [file.data, format])
  useEffect(() => { frame.current?.contentWindow?.postMessage({ zqDocument: session.current, type: 'zoom', zoom }, '*') }, [zoom])
  return <div className="artifact-document-office">
    {loading && <div className="artifact-document-state" role="status">Rendering document…</div>}
    {error && <div className="artifact-document-state" role="alert">{error} Download the original file to open it in its application.</div>}
    {source && <iframe ref={frame} title={`${file.name} document`} sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={source} className="artifact-document-frame" style={{ visibility: error ? 'hidden' : 'visible' }} />}
  </div>
}

function PdfPage({ document, number, zoom, width }: { document: PDFDocumentProxy; number: number; zoom: number | 'fit'; width: number }) {
  const host = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [visible, setVisible] = useState(false)
  const [page, setPage] = useState<PDFPageProxy | null>(null)
  const [error, setError] = useState('')
  const [ratio, setRatio] = useState(792 / 612)
  useEffect(() => {
    const observer = new IntersectionObserver(entries => setVisible(entries[0].isIntersecting), { rootMargin: '700px' })
    if (host.current) observer.observe(host.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    let cancelled = false
    if (visible && !page) void document.getPage(number).then(page => {
      if (cancelled) return
      const viewport = page.getViewport({ scale: 1 })
      if (!Number.isFinite(viewport.width) || !Number.isFinite(viewport.height) || viewport.width <= 0 || viewport.height <= 0 || viewport.width > 20000 || viewport.height > 20000) throw new Error('This PDF page is too large to preview.')
      setPage(page); setRatio(viewport.height / viewport.width)
    }).catch(error => { if (!cancelled) setError(error.message) })
    return () => { cancelled = true }
  }, [document, number, visible, page])
  const naturalWidth = page?.getViewport({ scale: 1 }).width || 612
  const displayWidth = zoom === 'fit' ? Math.max(100, width - 40) : naturalWidth * Math.max(0.25, Math.min(3, zoom / 100))
  useEffect(() => {
    if (!page || !canvas.current) return
    const element = canvas.current
    if (!visible) { element.width = 0; element.height = 0; return }
    const scale = displayWidth / naturalWidth
    const density = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(8_000_000 / (displayWidth * displayWidth * ratio)))
    const viewport = page.getViewport({ scale: scale * density })
    element.width = Math.ceil(viewport.width); element.height = Math.ceil(viewport.height)
    const task: RenderTask = page.render({ canvas: element, viewport })
    void task.promise.catch(error => { if (error.name !== 'RenderingCancelledException') setError(error.message) })
    return () => task.cancel()
  }, [page, visible, displayWidth, naturalWidth, ratio])
  return <div ref={host} className="artifact-pdf-page" style={{ width: displayWidth, minHeight: displayWidth * ratio }} aria-label={`Page ${number}`}>
    {error ? <div role="alert" className="artifact-document-state">{error}</div> : <canvas ref={canvas} style={{ width: '100%', height: '100%' }} aria-label={`PDF page ${number}`} />}
    <span className="artifact-pdf-page-number">{number}</span>
  </div>
}

function PdfDocument({ file, zoom }: ArtifactDocumentViewProps) {
  const scroll = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(600)
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const observer = new ResizeObserver(entries => setWidth(entries[0].contentRect.width))
    if (scroll.current) observer.observe(scroll.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    let cancelled = false
    let task: ReturnType<typeof import('pdfjs-dist')['getDocument']> | undefined
    setDocument(null); setError('')
    void (async () => {
      const pdfjs = await import('pdfjs-dist')
      if (cancelled) return
      pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
      task = pdfjs.getDocument({ data: fileBytes(file.data), useSystemFonts: true, useWasm: false, disableAutoFetch: true, maxImageSize: 16_777_216 })
      task.onPassword = () => { setError('Password-protected PDFs cannot be previewed.'); void task?.destroy() }
      const document = await task.promise
      if (document.numPages > 200) throw new Error('PDF preview is limited to 200 pages. Download the original to view every page.')
      if (!cancelled) setDocument(document)
    })().catch(error => { if (!cancelled) setError(error.message || 'This PDF could not be rendered.') })
    return () => { cancelled = true; void task?.destroy() }
  }, [file.data])
  return <div ref={scroll} className="artifact-document-pdf">
    {error ? <div className="artifact-document-state" role="alert">{error}</div> : document ? Array.from({ length: document.numPages }, (_, index) => <PdfPage key={index} document={document} number={index + 1} zoom={zoom} width={width} />) : <div className="artifact-document-state" role="status">Rendering PDF…</div>}
  </div>
}

function OtherDocument({ file, zoom }: ArtifactDocumentViewProps) {
  try {
    if (['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.mime)) {
      fileBytes(file.data)
      return <div className="artifact-document-other"><img src={`data:${file.mime};base64,${file.data}`} alt={file.name} style={zoom === 'fit' ? { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' } : { zoom: Math.max(0.25, Math.min(3, zoom / 100)), maxWidth: 'none' }} /></div>
    }
    if (file.mime.startsWith('text/') || ['application/json', 'application/javascript'].includes(file.mime) || ['txt', 'md', 'csv', 'json', 'html', 'js', 'ts', 'py'].includes(file.format || file.name.split('.').pop() || '')) {
      if (file.data.length > 273068) throw new Error('Text preview is limited to 200 KB. Download the original to read the whole file.')
      const bytes = fileBytes(file.data)
      if (bytes.length > 200 * 1024) throw new Error('Text preview is limited to 200 KB. Download the original to read the whole file.')
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      return <div className="artifact-document-other"><pre className="artifact-document-text" style={{ fontSize: `${13 * (zoom === 'fit' ? 1 : Math.max(0.25, Math.min(3, zoom / 100)))}px` }}>{text}</pre></div>
    }
    return <div className="artifact-document-state" role="status">A formatted preview is not available for this file type. Download the original to open it in its application.</div>
  } catch (error) { return <div className="artifact-document-state" role="alert">{error instanceof Error ? error.message : 'This file could not be displayed.'}</div> }
}

export function ArtifactDocumentView(props: ArtifactDocumentViewProps) {
  const format = fileFormat(props.file)
  return <div className="artifact-document-view" data-format={format || 'unsupported'}>
    {format === 'pdf' ? <PdfDocument {...props} /> : format ? <OfficeDocument {...props} format={format} /> : <OtherDocument {...props} />}
  </div>
}
