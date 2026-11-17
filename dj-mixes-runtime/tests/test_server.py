import http.client
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import unittest


RUNTIME = Path(__file__).resolve().parents[1]


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class RunningServer:
    def __init__(self, token="", extra_env=None):
        self.port = free_port()
        self.temp = tempfile.TemporaryDirectory()
        env = os.environ.copy()
        env.update({
            "CRATE_OS_DJ_MIXES_HOST": "127.0.0.1",
            "CRATE_OS_DJ_MIXES_PORT": str(self.port),
            "CRATE_OS_DJ_MIXES_ASSET_DIR": str(RUNTIME),
            "CRATE_OS_DJ_MIXES_DATA_DIR": self.temp.name,
            "CRATE_OS_DJ_MIXES_DISABLE_SCREEN": "1",
        })
        if token:
            env["CRATE_OS_DJ_MIXES_TOKEN"] = token
        env.update(extra_env or {})
        self.process = subprocess.Popen(
            [sys.executable, str(RUNTIME / "mixes_server.py")],
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        for _ in range(50):
            try:
                status, _, body = self.request("GET", "/health")
                if status == 200 and b"crate-os-good-mixx" in body:
                    return
            except OSError:
                pass
            time.sleep(0.05)
        stdout, stderr = self.process.communicate(timeout=2)
        raise AssertionError(f"server did not start\nstdout={stdout}\nstderr={stderr}")

    def request(self, method, path, body=None, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=2)
        connection.request(method, path, body=body, headers=headers or {})
        response = connection.getresponse()
        result = response.status, dict(response.getheaders()), response.read()
        connection.close()
        return result

    def close(self):
        self.process.terminate()
        self.process.wait(timeout=3)
        if self.process.stdout:
            self.process.stdout.close()
        if self.process.stderr:
            self.process.stderr.close()
        self.temp.cleanup()


class DjMixesServerTests(unittest.TestCase):
    def test_original_interface_and_transition_memory_use_app_data(self):
        server = RunningServer()
        try:
            status, _, body = server.request("GET", "/mixes")
            self.assertEqual(status, 200)
            self.assertIn(b"GOOD MIXX", body)
            self.assertIn(b"WHAT'S NEXT", body)

            payload = json.dumps({"from": "track-a", "to": "track-b", "source": "test"})
            status, _, _ = server.request(
                "POST",
                "/api/links",
                payload,
                {"Content-Type": "application/json", "Content-Length": str(len(payload))},
            )
            self.assertEqual(status, 200)
            saved = json.loads((Path(server.temp.name) / "mixes.json").read_text())
            self.assertEqual(saved["links"][0]["from"], "track-a")
            self.assertEqual(saved["links"][0]["to"], "track-b")
        finally:
            server.close()

    def test_traktor_link_updates_mix_memory(self):
        server = RunningServer()
        try:
            loaded = json.dumps({"title": "Track One", "artist": "Artist", "bpm": 124, "keyText": "8A"})
            status, _, _ = server.request(
                "POST",
                "/traktor/deckLoaded/A",
                loaded,
                {"Content-Type": "application/json", "Content-Length": str(len(loaded))},
            )
            self.assertEqual(status, 200)
            playing = json.dumps({"isPlaying": True})
            status, _, _ = server.request(
                "POST",
                "/traktor/updateDeck/A",
                playing,
                {"Content-Type": "application/json", "Content-Length": str(len(playing))},
            )
            self.assertEqual(status, 200)
            history = json.loads((Path(server.temp.name) / "traktor_history.json").read_text())
            self.assertEqual(history[-1]["title"], "Track One")
            self.assertEqual(history[-1]["djkey"], "8A")
        finally:
            server.close()

    def test_lan_token_is_required_then_moved_to_a_cookie(self):
        server = RunningServer(token="test-token")
        try:
            status, _, _ = server.request("GET", "/mixes")
            self.assertEqual(status, 401)

            status, headers, _ = server.request("GET", "/mixes?token=test-token")
            self.assertEqual(status, 302)
            self.assertEqual(headers["Location"], "/mixes")
            self.assertIn("HttpOnly", headers["Set-Cookie"])

            status, _, body = server.request(
                "GET",
                "/mixes",
                headers={"Cookie": "crate_os_dj_mixes=test-token"},
            )
            self.assertEqual(status, 200)
            self.assertIn(b"REVIEW A SET", body)
        finally:
            server.close()

    def test_other_websites_cannot_reach_or_post(self):
        server = RunningServer()
        try:
            # DNS rebinding: a page on another domain pointed at this Mac is refused.
            status, _, _ = server.request("GET", "/api/library", headers={"Host": "evil.example:%d" % server.port})
            self.assertEqual(status, 403)
            payload = json.dumps({"from": "a", "to": "b"})
            hdr = {"Content-Type": "application/json", "Content-Length": str(len(payload))}
            # A different web page posting here is refused...
            status, _, _ = server.request("POST", "/api/links", payload, dict(hdr, Origin="https://evil.example"))
            self.assertEqual(status, 403)
            status, _, _ = server.request("POST", "/api/quit", "", {"Origin": "null", "Content-Length": "0"})
            self.assertEqual(status, 403)
            # ...while the page itself (same origin) and Traktor (no Origin) still work.
            status, _, _ = server.request("POST", "/api/links", payload,
                                          dict(hdr, Origin="http://127.0.0.1:%d" % server.port))
            self.assertEqual(status, 200)
            status, _, _ = server.request("POST", "/traktor/updateMasterClock", "{}", {"Content-Length": "2"})
            self.assertEqual(status, 200)
        finally:
            server.close()

    def test_health_reports_instance_and_helper_exits_with_its_parent(self):
        parent = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
        server = RunningServer(extra_env={"CRATE_OS_DJ_MIXES_PARENT_PID": str(parent.pid),
                                          "CRATE_OS_DJ_MIXES_INSTANCE": "abc123"})
        try:
            status, _, body = server.request("GET", "/health")
            self.assertIn(b"abc123", body)
            parent.kill()
            parent.wait()
            server.process.wait(timeout=8)   # gone within a few seconds
            self.assertIsNotNone(server.process.returncode)
        finally:
            if server.process.poll() is None:
                server.close()
            else:
                server.temp.cleanup()
                for f in (server.process.stdout, server.process.stderr):
                    f and f.close()


if __name__ == "__main__":
    unittest.main()
