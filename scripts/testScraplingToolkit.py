"""Static/smoke checks for the optional Scrapling crawler entrypoint."""
import ast
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
source = (ROOT / "scripts/scraplingSpider.py").read_text(encoding="utf-8")
tree = ast.parse(source)
assert any(isinstance(node, ast.ClassDef) and node.name == "TeslaStationSpider" for node in tree)
for token in ("autothrottle_enabled", "robots_txt_obey", "concurrent_requests_per_domain", "ProxyRotator", "crawldir", "to_jsonl", "to_csv", "to_xml"):
    assert token in source, f"Missing crawler capability: {token}"
assert "response.status in {500, 502, 503, 504}" in source
print("Scrapling toolkit static checks passed.")
