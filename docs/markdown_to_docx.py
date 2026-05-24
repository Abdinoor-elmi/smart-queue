import re
import sys
import zipfile
from html import escape
from pathlib import Path


def clean_inline(text):
    text = re.sub(r"!\[([^\]]*)\]\(([^)]+)\)", r"\1 (\2)", text)
    text = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r"\1 (\2)", text)
    text = text.replace("`", "")
    text = text.replace("**", "")
    text = text.replace("*", "")
    return text


def paragraph(text="", style=None, bold=False, monospace=False):
    text = escape(clean_inline(text))
    props = ""
    if style:
        props += f'<w:pStyle w:val="{style}"/>'
    run_props = ""
    if bold:
        run_props += "<w:b/>"
    if monospace:
        run_props += '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="19"/>'
    return (
        f"<w:p><w:pPr>{props}</w:pPr><w:r><w:rPr>{run_props}</w:rPr>"
        f"<w:t xml:space=\"preserve\">{text}</w:t></w:r></w:p>"
    )


def table(rows):
    cells = []
    for row in rows:
        tds = []
        for cell in row:
            value = escape(clean_inline(cell.strip()))
            tds.append(
                "<w:tc><w:tcPr><w:tcW w:w=\"2400\" w:type=\"dxa\"/></w:tcPr>"
                f"<w:p><w:r><w:t xml:space=\"preserve\">{value}</w:t></w:r></w:p></w:tc>"
            )
        cells.append("<w:tr>" + "".join(tds) + "</w:tr>")
    return (
        "<w:tbl><w:tblPr><w:tblW w:w=\"0\" w:type=\"auto\"/>"
        "<w:tblBorders><w:top w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"B7C9D9\"/>"
        "<w:left w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"B7C9D9\"/>"
        "<w:bottom w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"B7C9D9\"/>"
        "<w:right w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"B7C9D9\"/>"
        "<w:insideH w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"B7C9D9\"/>"
        "<w:insideV w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"B7C9D9\"/></w:tblBorders>"
        "</w:tblPr>" + "".join(cells) + "</w:tbl>"
    )


def is_separator(row):
    return bool(re.fullmatch(r"\s*\|?[\s:\-|]+\|?\s*", row))


def split_table_row(row):
    row = row.strip()
    if row.startswith("|"):
        row = row[1:]
    if row.endswith("|"):
        row = row[:-1]
    return [cell.strip() for cell in row.split("|")]


def convert_markdown(md):
    lines = md.splitlines()
    body = []
    i = 0
    in_code = False
    code_label = ""

    while i < len(lines):
        line = lines[i]

        if line.startswith("```"):
            in_code = not in_code
            code_label = line[3:].strip()
            if in_code and code_label:
                body.append(paragraph(f"Code block: {code_label}", bold=True))
            i += 1
            continue

        if in_code:
            body.append(paragraph(line, monospace=True))
            i += 1
            continue

        if "|" in line and i + 1 < len(lines) and is_separator(lines[i + 1]):
            rows = [split_table_row(line)]
            i += 2
            while i < len(lines) and "|" in lines[i] and lines[i].strip():
                rows.append(split_table_row(lines[i]))
                i += 1
            body.append(table(rows))
            body.append(paragraph())
            continue

        stripped = line.strip()
        if not stripped:
            body.append(paragraph())
        elif stripped.startswith("# "):
            body.append(paragraph(stripped[2:], "Title"))
        elif stripped.startswith("## "):
            body.append(paragraph(stripped[3:], "Heading1"))
        elif stripped.startswith("### "):
            body.append(paragraph(stripped[4:], "Heading2"))
        elif stripped.startswith("- "):
            body.append(paragraph("• " + stripped[2:]))
        else:
            body.append(paragraph(stripped))
        i += 1

    return "\n".join(body)


def write_docx(markdown_path, docx_path):
    md = Path(markdown_path).read_text(encoding="utf-8")
    document_body = convert_markdown(md)
    document = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    {document_body}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1008" w:right="1008" w:bottom="1008" w:left="1008"/>
    </w:sectPr>
  </w:body>
</w:document>"""

    styles = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:sz w:val="22"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:rPr><w:b/><w:sz w:val="30"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style>
</w:styles>"""

    content_types = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>"""

    rels = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"""

    doc_rels = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>"""

    with zipfile.ZipFile(docx_path, "w", zipfile.ZIP_DEFLATED) as docx:
        docx.writestr("[Content_Types].xml", content_types)
        docx.writestr("_rels/.rels", rels)
        docx.writestr("word/document.xml", document)
        docx.writestr("word/styles.xml", styles)
        docx.writestr("word/_rels/document.xml.rels", doc_rels)


if __name__ == "__main__":
    write_docx(sys.argv[1], sys.argv[2])
