"""Serves the repo and receives test results at POST /result (writes them to argv[2], then exits)."""
import http.server, sys, os, threading
PORT, OUT = int(sys.argv[1]), sys.argv[2]
class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_POST(self):
        body = self.rfile.read(int(self.headers["Content-Length"])).decode("utf-8")
        open(OUT, "w", encoding="utf-8").write(body)
        self.send_response(204); self.end_headers()
        threading.Thread(target=self.server.shutdown).start()
http.server.ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
