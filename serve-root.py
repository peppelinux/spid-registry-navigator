#!/usr/bin/env python3
"""
Serve la SPA compilata da dist/ alla root del sito.

Uso (dalla root del repo, dopo npm run build):
  python3 serve-root.py [porta]

Evita il redirect index.html → dist/ che con http.server dalla root
può portare a /dist/dist/ se dist/index.html contiene ancora un redirect.
"""
from __future__ import annotations

import sys
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist"
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080


def main() -> None:
    if not (DIST / "index.html").is_file():
        print("Manca dist/index.html — esegui prima: npm run build", file=sys.stderr)
        sys.exit(1)

    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(DIST), **kwargs)

        def end_headers(self) -> None:
            path = self.path.split("?", 1)[0]
            if path == "/" or path.endswith(".html"):
                self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
                self.send_header("Pragma", "no-cache")
            super().end_headers()

    print(f"SPID Registry Navigator — http://127.0.0.1:{PORT}/")
    print("(Ctrl+C per uscire)")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
