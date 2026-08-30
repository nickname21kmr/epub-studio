"""Small dependency-free structural check for the generated EPUB sample."""

from pathlib import Path
from zipfile import ZIP_STORED, ZipFile
from xml.etree import ElementTree


ROOT = Path(__file__).resolve().parents[1]
EPUB = ROOT / "sample" / "验证样书.epub"

with ZipFile(EPUB) as archive:
    names = archive.namelist()
    assert names[0] == "mimetype"
    assert archive.getinfo("mimetype").compress_type == ZIP_STORED
    assert archive.read("mimetype") == b"application/epub+zip"
    assert "META-INF/container.xml" in names
    assert "EPUB/package.opf" in names
    assert "EPUB/nav.xhtml" in names

    xml_files = [name for name in names if name.endswith((".xml", ".opf", ".xhtml"))]
    for name in xml_files:
        ElementTree.fromstring(archive.read(name))

print(f"PASS: {len(names)} entries; {len(xml_files)} XML/XHTML files parsed")
