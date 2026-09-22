#!/usr/bin/env python3
"""Lokal inkişaf serveri — Vercel-in cleanUrls davranışını təqlid edir.

İstifadə:  python3 dev-server.py        (sonra http://localhost:8000 aç)

Vercel-də olduğu kimi: /about -> about.html, /about.html -> 308 -> /about,
tapılmayan ünvanlar üçün 404.html göstərilir.
"""
import http.server
import os
import socketserver
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        path = self.path.split("?")[0]
        if path.endswith(".html"):
            target = path[: -len("/index.html")] if path.endswith("/index.html") else path[:-5]
            self.send_response(308)
            self.send_header("Location", target or "/")
            self.end_headers()
            return
        name = path.strip("/")
        if name and "." not in os.path.basename(name):
            if os.path.exists(name + ".html"):
                self.path = "/" + name + ".html"
            elif os.path.isdir(name) and os.path.exists(os.path.join(name, "index.html")):
                self.path = "/" + name + "/index.html"
        return super().do_GET()

    def send_error(self, code, *args, **kwargs):
        if code == 404 and os.path.exists("404.html"):
            body = open("404.html", "rb").read()
            self.send_response(404)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        return super().send_error(code, *args, **kwargs)


socketserver.TCPServer.allow_reuse_address = True
print(f"http://localhost:{PORT}  (dayandırmaq üçün Ctrl+C)")
socketserver.TCPServer(("", PORT), Handler).serve_forever()
