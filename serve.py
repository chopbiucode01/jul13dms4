"""Run Iron Path locally without installing any packages."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import os
import webbrowser

os.chdir(Path(__file__).parent)
url = "http://127.0.0.1:4173"
print(f"Iron Path is ready at {url}")
print("Keep this window open while playing. Press Control-C to stop it.")
webbrowser.open(url)
ThreadingHTTPServer(("127.0.0.1", 4173), SimpleHTTPRequestHandler).serve_forever()
