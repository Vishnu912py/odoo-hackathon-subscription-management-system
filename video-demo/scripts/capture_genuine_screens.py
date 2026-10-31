#!/usr/bin/env python3
"""
capture_genuine_screens.py
Starts an ephemeral HTTP server on frontend/dist and uses headless Chrome
to capture genuine high-resolution (1920x1080) screenshots of the available frontend screens.
"""

import http.server
import os
import socketserver
import subprocess
import threading
import time
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BASE_DIR.parent
DIST_DIR = REPO_ROOT / "frontend" / "dist"
CAPTURES_DIR = BASE_DIR / "assets" / "captures"
CHROME_PATH = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
PORT = 4185


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DIST_DIR), **kwargs)

    def log_message(self, format, *args):
        pass  # quiet output


def capture_url(url: str, output_path: Path, delay_ms: int = 1500):
    cmd = [
        CHROME_PATH,
        "--headless=new",
        "--disable-gpu",
        "--window-size=1920,1080",
        "--force-device-scale-factor=1",
        f"--virtual-time-budget={delay_ms}",
        f"--screenshot={os.path.abspath(output_path)}",
        url
    ]
    subprocess.run(cmd, check=True)


def main():
    print("=" * 80)
    print(" BRIGHTLOOP VIDEO PRODUCTION: GENUINE SCREEN CAPTURER")
    print("=" * 80)

    if not DIST_DIR.exists() or not (DIST_DIR / "index.html").exists():
        print("Frontend dist not found. Building frontend first...")
        subprocess.run(["npm", "run", "build"], cwd=str(REPO_ROOT / "frontend"), check=True)

    CAPTURES_DIR.mkdir(parents=True, exist_ok=True)

    httpd = socketserver.TCPServer(("127.0.0.1", PORT), QuietHandler)
    t = threading.Thread(target=httpd.serve_forever)
    t.daemon = True
    t.start()
    print(f"Ephemeral frontend static server started on http://127.0.0.1:{PORT}")

    try:
        time.sleep(1)

        # 1. Capture Live Workspace Auth Screen (Default Landing)
        auth_capture = CAPTURES_DIR / "genuine_auth_screen.png"
        print(f"Capturing Genuine Live Workspace Auth Screen -> {auth_capture.name}...")
        capture_url(f"http://127.0.0.1:{PORT}", auth_capture, delay_ms=1000)
        print(f"Captured: {auth_capture.stat().st_size} bytes")

        # 2. Capture Design Preview Dashboard (Albin's Prototype)
        index_html = (DIST_DIR / "index.html").read_text(encoding="utf-8")
        injected_script = """
        <script>
        window.addEventListener('load', () => {
            let clicked = false;
            const interval = setInterval(() => {
                if (clicked) return;
                const btns = Array.from(document.querySelectorAll('button'));
                const previewBtn = btns.find(b => b.textContent && b.textContent.includes('preview'));
                if (previewBtn) {
                    previewBtn.click();
                    clicked = true;
                    clearInterval(interval);
                }
            }, 50);
        });
        </script>
        """
        preview_html_path = DIST_DIR / "preview_mode.html"
        preview_html_path.write_text(index_html.replace("</body>", f"{injected_script}</body>"), encoding="utf-8")

        dash_capture = CAPTURES_DIR / "genuine_dashboard_preview.png"
        print(f"Capturing Genuine Design Preview Dashboard -> {dash_capture.name}...")
        capture_url(f"http://127.0.0.1:{PORT}/preview_mode.html", dash_capture, delay_ms=2000)
        print(f"Captured: {dash_capture.stat().st_size} bytes")

        # Clean up temporary preview_mode.html
        if preview_html_path.exists():
            preview_html_path.unlink()

        # Clean up test_dash.png if left
        if os.path.exists("test_dash.png"):
            os.remove("test_dash.png")

        print("\nGenuine screen captures completed successfully!")
        print("=" * 80)
    finally:
        httpd.shutdown()


if __name__ == "__main__":
    main()
