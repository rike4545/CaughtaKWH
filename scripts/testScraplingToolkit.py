"""Static and import smoke checks for the optional Scrapling crawler."""
import ast
import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
source = (ROOT / "scripts/scraplingSpider.py").read_text(encoding="utf-8")
tree = ast.parse(source)
assert any(isinstance(node, ast.ClassDef) and node.name == "TeslaStationSpider" for node in ast.walk(tree))
for token in ("autothrottle_enabled", "robots_txt_obey", "concurrent_requests_per_domain", "ProxyRotator", "crawldir", "to_jsonl", "to_csv", "to_xml"):
    assert token in source, f"Missing crawler capability: {token}"
assert "response.status in {500, 502, 503, 504}" in source
assert "Do not rotate/retry around 401/403/407/429" in source

sys.path.insert(0, str(ROOT / "scripts"))
import scraplingSpider

with tempfile.TemporaryDirectory() as tmp:
    path = Path(tmp) / "stations.json"
    path.write_text(json.dumps([
        {"id": "ok", "name": "Allowed", "url": "https://www.tesla.com/findus/location/supercharger/allowed"},
        {"id": "bad-host", "url": "https://example.com/findus/location/supercharger/no"},
        {"id": "bad-scheme", "url": "http://www.tesla.com/findus/location/supercharger/no"},
        {"id": "bad-path", "url": "https://www.tesla.com/other/path"},
    ]), encoding="utf-8")
    rows = scraplingSpider.load_stations(path, 10)
    assert len(rows) == 1 and rows[0]["station_id"] == "ok"

print("Scrapling toolkit static, import, and URL-allowlist tests passed.")
