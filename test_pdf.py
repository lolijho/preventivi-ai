#!/usr/bin/env python3
"""Test end-to-end: genera PDF dal preventivo e lo rende in PNG per verifica visiva."""
import json
import subprocess
import sys

import pdfplumber

BASE = "http://localhost:3000"


def post_pdf(quote_file, out_pdf):
    with open(quote_file, "rb") as f:
        r = subprocess.run(
            ["curl", "-s", "-X", "POST", f"{BASE}/api/pdf",
             "-H", "Content-Type: application/json",
             "--max-time", "120", "-o", out_pdf, "-w", "%{http_code} %{size_download}",
             "-d", "@-"],
            stdin=f, capture_output=True, text=True)
    print("pdf:", r.stdout)
    return r.stdout


def render_pages(pdf_path, prefix):
    with pdfplumber.open(pdf_path) as pdf:
        print("pagine:", len(pdf.pages))
        for i, page in enumerate(pdf.pages):
            out = f"{prefix}_p{i+1}.png"
            page.to_image(resolution=100).save(out)
            print("  ->", out)


if __name__ == "__main__":
    quote_file = sys.argv[1] if len(sys.argv) > 1 else "/tmp/test-q.json"
    out_pdf = sys.argv[2] if len(sys.argv) > 2 else "/tmp/test-preventivo.pdf"
    prefix = sys.argv[3] if len(sys.argv) > 3 else "/tmp/test_pdf"
    post_pdf(quote_file, out_pdf)
    head = open(out_pdf, "rb").read(8)
    print("header:", head[:5])
    if not head.startswith(b"%PDF"):
        print("ERRORE: non e' un PDF:", open(out_pdf).read()[:300])
        sys.exit(1)
    render_pages(out_pdf, prefix)
