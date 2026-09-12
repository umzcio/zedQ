# Native skill helper compatibility prototype

This document describes synthetic fixture coverage, not a claim of shipping support. All four fixtures passed through the explicitly selected App Sandbox diagnostic helper on 2026-09-11. The strict build fails closed before execution. See [measured results and isolation limits](native-skill-helper.md). No imported skill source is bundled in these fixtures.

## Fixture contract

Run each `apps/desktop/native/skill-helper-prototype/fixtures/*.py` as the helper's generated Python code, with its working directory set to a fresh private job directory. The helper may stage `inputs/` and `skill/` there. These fixtures use only synthetic content; they do not request host paths, network access, or user files. Each fixture creates temporary intermediates beneath its working directory, removes those intermediates, writes one final file to `output/`, and prints a JSON summary only after assertions pass. An exception is a failed fixture.

Running all four yields four final documents. The scripts use no subprocesses and require `python-docx`, `openpyxl`, `python-pptx`, `pypdf`, `reportlab`, and Pillow from the helper's pinned environment.

| Fixture | Final file | What its assertions check |
|---|---|---|
| `docx_workflow.py` | `document-edited.docx` | Creation and reopening; edit one run; preserve other text, run formatting, header, footer, and table cells. |
| `xlsx_workflow.py` | `workbook-formulas.xlsx` | Creation and reopening; edit one input; preserve three formulas, formatting, and another sheet; demonstrate that calculated caches are absent. |
| `pptx_workflow.py` | `presentation-edited.pptx` | Creation and reopening; edit one text shape and append a slide; preserve other shapes, color/position, embedded Pillow image bytes, and an existing slide. |
| `pdf_workflow.py` | `document-merged-filled.pdf` | Generate an AcroForm and another page; merge; split an intermediate copy; fill the form; reopen to check field value, appearance stream, page count, and unrelated page text. |

The preservation checks cover deliberately simple synthetic structures. They do not establish lossless round-trips for arbitrary Word, Excel, PowerPoint, or PDF files. None of the fixtures renders a document; every JSON result explicitly reports `rendered: false`. An appearance stream's existence is a structural check, not visual QA.

For XLSX, `openpyxl` writes formulas without evaluating them. The fixture checks `data_only=False` for preserved formula strings and `data_only=True` for absent cached results. Do not present these blank caches as recalculated values or replace formulas with fabricated results. A separate calculation engine and its compatibility checks are still required.

## Upstream skill compatibility is a separate claim

The public Anthropic packages were inspected at commit `34040c9c568585f6929bedeaad110ad08f079624`. Their normal workflows do not match this Python-only prototype:

| Upstream workflow | Additional dependencies or execution behavior | Prototype scope |
|---|---|---|
| DOCX creation | Generated JavaScript using npm `docx`; `pandoc` for reading; LibreOffice and Poppler for rendering. Existing-document editing uses ZIP/XML and packaged Python helpers. | `python-docx` proves a bounded format workflow; it does not execute unchanged JavaScript creation instructions. |
| XLSX editing and verification | Generated Python using `openpyxl`/`pandas`; packaged `recalc.py` invokes LibreOffice and a temporary Basic recalculation macro; reading guidance also uses `markitdown`. | Formula preservation is exercised; recalculation and the upstream complete verification sequence are not. |
| PPTX creation and verification | Generated JavaScript using `pptxgenjs`; optional React icons and `sharp`; `markitdown`, packaged XML validation, LibreOffice, and Poppler. | `python-pptx` exercises shape/slide edits; the JavaScript generator and full rendering/validation toolchain are unavailable. |
| PDF operations | Many paths use `pypdf` and `reportlab`; other paths need `pdfplumber`, `pdf2image`/Poppler, `qpdf`, OCR, or JavaScript libraries. | This fixture covers merge/split and one AcroForm text field, not all PDF workflows. |

Sources: [DOCX skill](https://github.com/anthropics/skills/blob/34040c9c568585f6929bedeaad110ad08f079624/skills/docx/SKILL.md), [XLSX skill](https://github.com/anthropics/skills/blob/34040c9c568585f6929bedeaad110ad08f079624/skills/xlsx/SKILL.md), [recalculation helper](https://github.com/anthropics/skills/blob/34040c9c568585f6929bedeaad110ad08f079624/skills/xlsx/scripts/recalc.py), [PPTX skill](https://github.com/anthropics/skills/blob/34040c9c568585f6929bedeaad110ad08f079624/skills/pptx/SKILL.md), [PDF skill](https://github.com/anthropics/skills/blob/34040c9c568585f6929bedeaad110ad08f079624/skills/pdf/SKILL.md).

These four upstream package directories contain no Python requirements/lock file or npm manifest/lock file. The runtime's dependency versions therefore belong to its own tested compatibility profile; importing a package does not install or satisfy dependencies. The imported `SKILL.md`, metadata, resource paths, and original bytes must remain intact. Report unavailable tools before activation rather than silently rewriting a skill to use the prototype's Python libraries.

## Verification scope and remaining work

- Completed: all four fixtures executed through the diagnostic XPC service; versions, sizes, timings and worker peak RSS are recorded in the result report.
- Completed: host document validation and existing isolated artifact viewer checks passed. Screenshots were inspected separately; worker fixture JSON correctly retains `rendered: false`.
- Completed: separate native probes found file/network denials but also execution, sibling-directory and detached-child gaps. These are blockers for untrusted integration; see the native findings report.
- Completed: prototype bundle size, fixture timings and fresh-client startup samples are measured. Cold-boot and cross-device benchmarking remain untested.
- Keep Node, LibreOffice recalculation/rendering, Poppler, and OCR marked unproven or unavailable until their own implementations and isolated tests exist.
