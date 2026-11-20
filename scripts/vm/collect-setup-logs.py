#!/usr/bin/env python3
"""Receive temporary WinPE diagnostics on host loopback only; no file serving."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import os
from pathlib import Path

STATE = Path(os.environ.get('AO_VM_STATE', '~/Projects/ao-reference/runtime/ao-vm')).expanduser()
DEST = STATE / 'setup-logs'
os.umask(0o077)
DEST.mkdir(exist_ok=True)


class Receiver(BaseHTTPRequestHandler):
    def do_PUT(self):
        length = int(self.headers.get('Content-Length', '0'))
        if self.path not in ('/pe-start.log', '/setupact.log', '/setuperr.log') or not 0 <= length <= 8 * 1024**2:
            self.send_error(400)
            return
        temporary = DEST / (self.path[1:] + '.tmp')
        temporary.write_bytes(self.rfile.read(length))
        temporary.replace(DEST / self.path[1:])
        self.send_response(204)
        self.end_headers()

    def log_message(self, *_):
        pass


ThreadingHTTPServer(('127.0.0.1', 18081), Receiver).serve_forever()
