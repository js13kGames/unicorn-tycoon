#!/usr/bin/env python3
"""Prepare the source for roadroller.

Inject CSS and body markup from JavaScript rather than leaving them alongside
the script. They enter roadroller's stream, where context mixing compresses
them more tightly than ZIP deflate. Previously measured saving: 821 bytes.

Usage: inline.py <src/index.html> <work_directory>
Writes <work_directory>/app.js and <work_directory>/title.txt.
"""
import re, sys, json

src, work = sys.argv[1], sys.argv[2]
html = open(src, encoding='utf-8').read()

css = re.search(r'<style>(.*?)</style>', html, re.S).group(1)
body = re.search(r'<body>(.*?)<script>', html, re.S).group(1)
js = re.search(r'<script>(.*)</script>', html, re.S).group(1).replace('"use strict";', '')
title = re.search(r'<title>(.*?)</title>', html).group(1)

# Keep readable building IDs in the source. Only exact private ID literals and
# TY's definition keys are shortened; display names and API identifiers stay.
ids = re.findall(r'^\s*(\w+)\s*:\{n:', js, re.M)
for i, name in enumerate(ids):
    short = chr(65 + i)
    js = js.replace("'" + name + "'", "'" + short + "'")
    js = re.sub(r'^(\s*)' + name + r'(\s*:\{n:)', r'\g<1>' + short + r'\2', js, flags=re.M)

# Minify CSS comments, whitespace around separators, and line breaks.
# Preserve values such as calc() and env().
css = re.sub(r'/\*.*?\*/', '', css, flags=re.S)
css = re.sub(r'\s*([{}:;,>])\s*', r'\1', css)
css = re.sub(r'\s+', ' ', css).replace(';}', '}').strip()
body = re.sub(r'\s*\n\s*', '', body)

open(work + '/title.txt', 'w', encoding='utf-8').write(title)
open(work + '/app.js', 'w', encoding='utf-8').write(
    'document.body.innerHTML=' + json.dumps('<style>' + css + '</style>' + body) + ';\n' + js)

print('CSS %d B, DOM %d B, JS %d B' % (len(css), len(body), len(js)))
