#!/usr/bin/env python3
"""Generates the codeDeft logo files in docs/brand/ (text converted to outlines, so no font is needed to view them).

Mark: code brackets around a check mark — "code, verified".
Run: python3 scripts/logo.py   (PNG exports need rsvg-convert)
"""
import shutil
import subprocess
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'docs' / 'brand'
FONT = Path('/usr/share/fonts/opentype/inter/Inter-Bold.otf')
FOREST, FOREST_DARK, MINT, INK, PAPER = '#2f5d50', '#1f4238', '#9fd6bf', '#1f2a26', '#faf9f7'


def mark(x=0, y=0, size=512, tile=True, fg='#ffffff', check=MINT, bg=FOREST, bg2=FOREST_DARK, uid='m'):
    """The icon: rounded tile, < > brackets and a check mark, on a 512 grid scaled to `size`."""
    k = size / 512
    tile_svg = (f'<defs><linearGradient id="{uid}g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{bg}"/><stop offset="1" stop-color="{bg2}"/></linearGradient></defs>'
                f'<rect width="512" height="512" rx="116" fill="url(#{uid}g)"/>') if tile else ''
    sw = 46
    return (f'<g transform="translate({x} {y}) scale({k})">{tile_svg}'
            f'<path d="M168 152 L72 256 L168 360" fill="none" stroke="{fg}" stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round"/>'
            f'<path d="M344 152 L440 256 L344 360" fill="none" stroke="{fg}" stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round"/>'
            f'<path d="M190 262 L238 310 L326 206" fill="none" stroke="{check}" stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round"/></g>')


def mark_small(uid='s'):
    """Bolder mark for 16–32 px (favicons): thicker strokes, fewer, larger shapes."""
    return (f'<defs><linearGradient id="{uid}g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{FOREST}"/><stop offset="1" stop-color="{FOREST_DARK}"/></linearGradient></defs>'
            f'<rect width="512" height="512" rx="104" fill="url(#{uid}g)"/>'
            '<path d="M160 136 L56 256 L160 376 M352 136 L456 256 L352 376" fill="none" stroke="#fff" stroke-width="68" stroke-linecap="round" stroke-linejoin="round"/>'
            f'<path d="M178 266 L236 322 L334 196" fill="none" stroke="{MINT}" stroke-width="68" stroke-linecap="round" stroke-linejoin="round"/>')


def text_path(text, x, y, size, color, font=TTFont(FONT)):
    """Text as outlined paths (baseline at y)."""
    gs, cmap, hmtx = font.getGlyphSet(), font.getBestCmap(), font['hmtx']
    scale = size / font['head'].unitsPerEm
    parts, cx = [], 0.0
    for ch in text:
        name = cmap[ord(ch)]
        pen = SVGPathPen(gs)
        gs[name].draw(TransformPen(pen, (scale, 0, 0, -scale, x + cx, y)))
        parts.append(pen.getCommands())
        cx += hmtx[name][0] * scale - size * 0.012  # slight tightening for a logo
    return f'<path d="{" ".join(parts)}" fill="{color}"/>', cx


def svg(w, h, body, title):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" role="img" aria-label="{title}">'
            f'<title>{title}</title>{body}</svg>\n')


def wordmark(dark=False, tagline=False):
    ink, accent = ('#ffffff', MINT) if dark else (INK, FOREST)
    h = 200 if tagline else 160
    p1, w1 = text_path('code', 176, 108, 96, ink)
    p2, w2 = text_path('Deft', 176 + w1, 108, 96, accent)
    width = int(176 + w1 + w2 + 24)
    body = mark(16, 16, 128, uid='w' + ('d' if dark else 'l')) + p1 + p2
    if tagline:
        t, _ = text_path('Understand First. Code Better.', 180, 172, 30, '#a9b8b1' if dark else '#5c6863')
        body += t
    bg = f'<rect width="{width}" height="{h}" rx="24" fill="#0f1412"/>' if dark else ''
    return svg(width, h, bg + body, 'codeDeft')


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    files = {
        'codedeft-icon.svg': svg(512, 512, mark(), 'codeDeft'),
        'codedeft-icon-small.svg': svg(512, 512, mark_small(), 'codeDeft'),
        'codedeft-icon-mono.svg': svg(512, 512, mark(tile=False, fg=FOREST, check=FOREST), 'codeDeft'),
        'codedeft-icon-white.svg': svg(512, 512, mark(tile=False, fg='#ffffff', check='#ffffff'), 'codeDeft'),
        'codedeft-logo.svg': wordmark(),
        'codedeft-logo-dark.svg': wordmark(dark=True),
        'codedeft-logo-tagline.svg': wordmark(tagline=True),
    }
    for name, content in files.items():
        (OUT / name).write_text(content, encoding='utf-8')
    if shutil.which('rsvg-convert'):
        for px in (16, 32, 48, 128, 256, 512, 1024):
            src = 'codedeft-icon-small.svg' if px <= 32 else 'codedeft-icon.svg'
            subprocess.run(['rsvg-convert', '-w', str(px), '-h', str(px), OUT / src, '-o', OUT / f'codedeft-icon-{px}.png'], check=True)
        for name in ('codedeft-logo', 'codedeft-logo-dark', 'codedeft-logo-tagline'):
            subprocess.run(['rsvg-convert', '-z', '3', OUT / f'{name}.svg', '-o', OUT / f'{name}.png'], check=True)
    print('wrote', ', '.join(sorted(p.name for p in OUT.iterdir())))




def install():
    """Copies the logo into the apps that show it."""
    ext = ROOT / 'apps' / 'vscode-extension' / 'media'; ext.mkdir(exist_ok=True)
    shutil.copy(OUT / 'codedeft-icon-256.png', ext / 'icon.png')
    pub = ROOT / 'apps' / 'web-dashboard' / 'public'; pub.mkdir(exist_ok=True)
    shutil.copy(OUT / 'codedeft-icon-small.svg', pub / 'favicon.svg')
    shutil.copy(OUT / 'codedeft-icon-32.png', pub / 'favicon-32.png')
    shutil.copy(OUT / 'codedeft-icon-256.png', pub / 'apple-touch-icon.png')


if __name__ == '__main__':
    main()
    install()
