#!/usr/bin/env python3
"""Static dev server for the eReferral console.

`python -m http.server` sends no cache headers, so browsers cache the ES modules in
src/js/ and keep running stale code after an edit — reloading the page does not help,
because each module has its own cache entry. This server sends no-store on everything.

    python serve.py [port]        # defaults to 8000

Then open http://localhost:8000/views/index.html
"""

import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        # One line per request, without the noisy timestamp prefix.
        sys.stderr.write(f"{self.command} {self.path} -> {args[1]}\n")


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    handler = partial(NoCacheHandler, directory="src")
    with ThreadingHTTPServer(("127.0.0.1", port), handler) as httpd:
        print(f"Serving src/ on http://localhost:{port}/views/index.html (no-store)")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")


if __name__ == "__main__":
    main()
