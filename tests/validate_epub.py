"""Small dependency-free structural check for the generated EPUB samples."""

import sys
from pathlib import Path, PurePosixPath
from zipfile import ZIP_STORED, ZipFile
from xml.etree import ElementTree


ROOT = Path(__file__).resolve().parents[1]
SAMPLES = sorted((ROOT / "sample").glob("*.epub"))
NS = {
    "c": "urn:oasis:names:tc:opendocument:xmlns:container",
    "opf": "http://www.idpf.org/2007/opf",
    "x": "http://www.w3.org/1999/xhtml",
}


def check(path):
    with ZipFile(path) as archive:
        names = archive.namelist()
        assert names[0] == "mimetype"
        assert archive.getinfo("mimetype").compress_type == ZIP_STORED
        assert archive.read("mimetype") == b"application/epub+zip"
        assert len(names) == len(set(names)), "duplicate ZIP entries"
        assert "META-INF/container.xml" in names

        xml_files = [name for name in names if name.endswith((".xml", ".opf", ".xhtml"))]
        trees = {name: ElementTree.fromstring(archive.read(name)) for name in xml_files}

        rootfile = trees["META-INF/container.xml"].find(".//c:rootfile", NS).get("full-path")
        package = trees[rootfile]
        base = PurePosixPath(rootfile).parent
        items = package.findall("opf:manifest/opf:item", NS)
        ids = [item.get("id") for item in items]
        assert len(ids) == len(set(ids)), f"duplicate manifest ids: {ids}"
        declared = {str(base / item.get("href")) for item in items}
        for href in declared:
            assert href in names, f"manifest points to missing file {href}"
        for name in names:
            if name != "mimetype" and not name.startswith("META-INF/") and name != rootfile:
                assert name in declared, f"{name} is not in the manifest"
        for ref in package.findall("opf:spine/opf:itemref", NS):
            assert ref.get("idref") in ids, f"spine refers to unknown id {ref.get('idref')}"

        nav_item = next(item for item in items if "nav" in (item.get("properties") or "").split())
        nav = trees[str(base / nav_item.get("href"))]
        links = nav.findall(".//x:nav/x:ol/x:li/x:a", NS)
        assert links, "nav.xhtml has no entries"
        assert all("".join(link.itertext()).strip() for link in links), "empty nav link text"
    return len(names), len(xml_files), len(links)


# Sample names are Chinese; don't depend on the console code page.
sys.stdout.reconfigure(encoding="utf-8")
assert SAMPLES, "no sample EPUB; run node tests/test_core.js first"
for sample in SAMPLES:
    entries, xml_count, nav_count = check(sample)
    print(f"PASS: {sample.name}: {entries} entries; {xml_count} XML/XHTML files parsed; {nav_count} nav entries")
