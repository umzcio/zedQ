"""Synthetic PDF merge/split/AcroForm fixture, with one final merged PDF."""

import json
import tempfile
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas


output = Path("output")
output.mkdir(exist_ok=True)
destination = output / "document-merged-filled.pdf"

with tempfile.TemporaryDirectory(prefix="pdf-fixture-", dir=".") as scratch:
    scratch = Path(scratch)
    form_path = scratch / "form.pdf"
    second_path = scratch / "second.pdf"
    merged_path = scratch / "merged.pdf"
    split_path = scratch / "split.pdf"

    form = canvas.Canvas(str(form_path), pagesize=letter)
    form.drawString(72, 730, "Synthetic form page")
    form.drawString(72, 695, "Project:")
    form.acroForm.textfield(name="project", tooltip="Project name", x=135, y=680,
                            width=250, height=24, value="Draft", borderWidth=1)
    form.showPage()
    form.save()

    page = canvas.Canvas(str(second_path), pagesize=letter)
    page.drawString(72, 730, "Preserve this second page exactly.")
    page.showPage()
    page.save()

    merged = PdfWriter()
    merged.append(str(form_path))
    merged.append(str(second_path))
    merged.write(str(merged_path))
    merged.close()
    merged_reader = PdfReader(str(merged_path))
    assert len(merged_reader.pages) == 2
    assert "Synthetic form page" in merged_reader.pages[0].extract_text()
    assert "Preserve this second page exactly." in merged_reader.pages[1].extract_text()
    assert merged_reader.get_fields()["project"]["/V"] == "Draft"

    split = PdfWriter()
    split.append(str(merged_path), pages=(1, 2))
    split.write(str(split_path))
    split.close()
    split_reader = PdfReader(str(split_path))
    assert len(split_reader.pages) == 1
    assert "Preserve this second page exactly." in split_reader.pages[0].extract_text()

    filled = PdfWriter()
    filled.append(str(merged_path))
    filled.update_page_form_field_values(filled.pages[0], {"project": "zQ synthetic fixture"},
                                          auto_regenerate=False)
    filled.write(str(destination))
    filled.close()
    reopened = PdfReader(str(destination))
    assert len(reopened.pages) == 2
    assert reopened.get_fields()["project"]["/V"] == "zQ synthetic fixture"
    assert "Preserve this second page exactly." in reopened.pages[1].extract_text()
    widgets = [annotation.get_object() for annotation in reopened.pages[0]["/Annots"]]
    field = next(annotation for annotation in widgets if annotation.get("/T") == "project")
    assert "/AP" in field and "/N" in field["/AP"], "Filled field lacks an appearance stream"

print(json.dumps({
    "fixture": "pdf", "status": "passed", "output": str(destination),
    "checks": ["create form", "merge pages", "split page", "fill AcroForm",
               "reopen field value", "preserve unrelated page", "field appearance stream exists"],
    "pageCount": 2, "rendered": False,
}))
