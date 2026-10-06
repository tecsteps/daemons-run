"""A fake control plane for installer/test/run.sh.

Serves /install.sh and /release/* from WORK, accepts /agent/progress and /agent/enroll for
the tokens in WORK/tokens, and appends every call to WORK/events.jsonl.

usage: python3 -I fake_cp.py PORT WORK
"""
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT, WORK = int(sys.argv[1]), sys.argv[2]
consumed = set()


def tokens():
    with open(os.path.join(WORK, "tokens")) as f:
        return {line.strip() for line in f if line.strip()}


def record(event):
    with open(os.path.join(WORK, "events.jsonl"), "a") as f:
        f.write(json.dumps(event) + "\n")


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def send(self, status, body=b"", ctype="application/json"):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        name = self.path.lstrip("/")
        parts = name.split("/")
        if name != "install.sh" and (len(parts) != 2 or parts[0] != "release" or parts[1] in ("", ".", "..")):
            return self.send(404, b"not found", "text/plain")
        path = os.path.join(WORK, *parts)
        if not os.path.isfile(path):
            return self.send(404, b"not found", "text/plain")
        with open(path, "rb") as f:
            self.send(200, f.read(), "application/octet-stream")

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        auth = self.headers.get("Authorization", "")
        token = auth.removeprefix("Bearer ")
        if token not in tokens():
            record({"path": self.path, "unauthorized": True})
            return self.send(401, b'{"error":"unauthorized"}')
        try:
            data = json.loads(body)
        except ValueError:
            record({"path": self.path, "bad_json": body.decode(errors="replace")})
            return self.send(400, b'{"error":"bad json"}')
        record({"path": self.path, "token": token, "body": data})
        if self.path == "/agent/progress":
            return self.send(204)
        if self.path == "/agent/enroll":
            if token in consumed:
                return self.send(401, b'{"error":"token used"}')
            consumed.add(token)
            return self.send(200, json.dumps({"server_id": "srv_test", "name": "test-1", "credential": "cred-test"}).encode())
        self.send(404, b'{"error":"not found"}')


ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
