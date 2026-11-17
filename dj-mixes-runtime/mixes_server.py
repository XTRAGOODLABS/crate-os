"""DJ Mixes on its own - no stems page, no MIDI, nothing to install.
Run this on the Mac that is running djay, then open the address it prints on the iPad."""
import socket
import hmac
import json
import os
import sys
import threading
import time
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlsplit
import mixes

HOST = os.environ.get("CRATE_OS_DJ_MIXES_HOST", "127.0.0.1")
PORT = int(os.environ.get("CRATE_OS_DJ_MIXES_PORT", "8770"))
LAN_TOKEN = os.environ.get("CRATE_OS_DJ_MIXES_TOKEN", "")
mixes.STEMS = False


LOCAL_NAMES = {"127.0.0.1", "localhost", "[::1]"}


def _host_name(value):
    value = (value or "").strip().lower()
    if value.startswith("["):
        return value.split("]")[0] + "]"
    return value.rsplit(":", 1)[0] if ":" in value else value


class Handler(BaseHTTPRequestHandler):
    def _allowed_host(self):
        """Blocks DNS-rebinding: only answer to our own names, never to a web page's domain."""
        name = _host_name(self.headers.get("Host", ""))
        if name in LOCAL_NAMES:
            return True
        return HOST not in ("127.0.0.1", "localhost", "::1") and name in ALLOWED_LAN_NAMES

    def _same_origin_post(self):
        """Blocks other web pages from posting here. No Origin header = not a web page (Traktor, scripts)."""
        origin = self.headers.get("Origin")
        if origin is None:
            return True
        return urlsplit(origin).netloc.lower() == self.headers.get("Host", "").strip().lower()

    def _forbidden(self):
        body = b'{"error":"not allowed"}'
        self.send_response(403)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _is_authorized(self):
        if not LAN_TOKEN:
            return True
        cookie = self.headers.get("Cookie", "")
        supplied = next((part.split("=", 1)[1] for part in cookie.split(";")
                         if part.strip().startswith("crate_os_dj_mixes=")), "")
        return hmac.compare_digest(supplied, LAN_TOKEN)

    def _accept_token(self):
        token = parse_qs(urlsplit(self.path).query).get("token", [""])[0]
        if not LAN_TOKEN or not hmac.compare_digest(token, LAN_TOKEN):
            return False
        self.send_response(302)
        self.send_header("Location", "/mixes")
        self.send_header("Set-Cookie", "crate_os_dj_mixes=%s; HttpOnly; SameSite=Strict; Path=/" % LAN_TOKEN)
        self.end_headers()
        return True

    def _reject(self):
        body = json.dumps({"error": "DJ Mixes LAN token required"}).encode()
        self.send_response(401)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/health":
            body = json.dumps({"service": "crate-os-good-mixx", "ok": True,
                               "instance": os.environ.get("CRATE_OS_DJ_MIXES_INSTANCE", "")}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if not self._allowed_host():
            self._forbidden()
            return
        if self._accept_token():
            return
        if not self._is_authorized():
            self._reject()
            return
        if mixes.handle_get(self):
            return
        if path in ("/", "/index.html"):
            self.send_response(302)
            self.send_header("Location", "/mixes")
            self.end_headers()
            return
        self.send_error(404)

    def do_POST(self):
        path = urlsplit(self.path).path
        if not self._allowed_host() or not self._same_origin_post():
            self._forbidden()
            return
        if path.startswith("/traktor/") and self.client_address[0] in ("127.0.0.1", "::1"):
            if not mixes.handle_post(self):
                self.send_error(404)
            return
        if not self._is_authorized():
            self._reject()
            return
        if not mixes.handle_post(self):
            self.send_error(404)

    def log_message(self, *args):
        pass


ALLOWED_LAN_NAMES = set()


def watch_parent():
    """Exit if Crate OS goes away (crash or force quit), so no helper is left holding the port."""
    parent = os.environ.get("CRATE_OS_DJ_MIXES_PARENT_PID")
    if not parent:
        return
    parent = int(parent)

    def loop():
        while True:
            time.sleep(2)
            try:
                os.kill(parent, 0)
            except ProcessLookupError:
                os._exit(0)
            except PermissionError:
                pass
            if os.getppid() == 1:
                os._exit(0)
    threading.Thread(target=loop, daemon=True).start()


def local_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("192.0.2.1", 80))
        return s.getsockname()[0]
    except OSError:
        return ""
    finally:
        s.close()


def main():
    try:
        server = ThreadingHTTPServer((HOST, PORT), Handler)
    except OSError:
        print("DJ Mixes could not bind to %s:%d." % (HOST, PORT), file=sys.stderr)
        return 1
    actual_port = server.server_address[1]
    name = socket.gethostname()
    if not name.endswith(".local"):
        name += ".local"
    ip = local_ip()
    ALLOWED_LAN_NAMES.update(n.lower() for n in (ip, name, socket.gethostname()) if n)
    watch_parent()
    ipad_url = ""
    if HOST not in ("127.0.0.1", "localhost", "::1") and LAN_TOKEN:
        ipad_url = "http://%s:%d/mixes?token=%s" % (ip or name, actual_port, LAN_TOKEN)
    mixes.INFO.update(port=actual_port, host=name, ip=ip, ipad=ipad_url)
    print("DJ Mixes listening on %s:%d" % (HOST, actual_port))
    if HOST not in ("127.0.0.1", "localhost", "::1") and LAN_TOKEN:
        if ip:
            print("LAN URL: http://%s:%d/mixes?token=%s" % (ip, actual_port, LAN_TOKEN))
        print("LAN URL: http://%s:%d/mixes?token=%s" % (name, actual_port, LAN_TOKEN))
    sys.stdout.flush()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
