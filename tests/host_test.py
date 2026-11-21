"""Talk to the native host over its stdio framing, like the browser does."""

import json
import os
import struct
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

HOST = Path(__file__).resolve().parent.parent / "host" / "omarchy-web-theme-host"


def read_message(stream):
    (length,) = struct.unpack("<I", stream.read(4))
    return json.loads(stream.read(length))


def write_message(stream, message):
    data = json.dumps(message).encode()
    stream.write(struct.pack("<I", len(data)) + data)
    stream.flush()


class HostTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.state = Path(self.tmp.name)
        (self.state / "theme").mkdir()
        self.write_theme("jade", 1, "#142620")
        self.proc = subprocess.Popen(
            [str(HOST)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            env={**os.environ, "OMARCHY_WEB_THEME_STATE_DIR": str(self.state)},
        )

    def tearDown(self):
        self.proc.stdin.close()
        self.proc.wait(timeout=5)
        self.proc.stdout.close()
        self.tmp.cleanup()

    def write_theme(self, name, generation, background):
        (self.state / "theme" / "colors.toml").write_text(
            f'mode = "dark"\naccent = "#8bcbb1"\nbackground = "{background}"\nopacity = 0.9\n'
        )
        (self.state / "theme.name").write_text(name)
        (self.state / "theme.generation").write_text(str(generation))

    def test_sends_palette_on_connect(self):
        message = read_message(self.proc.stdout)
        self.assertEqual(message["type"], "palette")
        self.assertEqual(message["name"], "jade")
        self.assertEqual(message["mode"], "dark")
        self.assertEqual(message["colors"], {"accent": "#8bcbb1", "background": "#142620"})

    def test_pushes_theme_changes(self):
        read_message(self.proc.stdout)
        time.sleep(0.1)
        self.write_theme("ember", 2, "#201010")
        message = read_message(self.proc.stdout)
        self.assertEqual(message["name"], "ember")
        self.assertEqual(message["colors"]["background"], "#201010")

    def test_answers_get(self):
        read_message(self.proc.stdout)
        write_message(self.proc.stdin, {"type": "get"})
        self.assertEqual(read_message(self.proc.stdout)["name"], "jade")

    def test_exits_when_browser_disconnects(self):
        read_message(self.proc.stdout)
        self.proc.stdin.close()
        self.assertEqual(self.proc.wait(timeout=5), 0)


if __name__ == "__main__":
    unittest.main()
