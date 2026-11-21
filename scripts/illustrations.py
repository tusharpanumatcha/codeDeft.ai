#!/usr/bin/env python3
"""Generates the README illustrations in docs/images/ (forest palette, light background so they read on GitHub light and dark).

Run: python3 scripts/illustrations.py
"""
from pathlib import Path
from xml.sax.saxutils import escape

OUT = Path(__file__).resolve().parent.parent / 'docs' / 'images'
C = dict(bg='#faf9f7', surface='#ffffff', s2='#f1efea', border='#d9d5cc', strong='#b9b3a6', text='#1f2a26', muted='#5c6863',
         accent='#2f5d50', soft='#e3efe9', warn='#8a5a00', warnsoft='#fbf1dc', danger='#a3322a', dangersoft='#f8e3e0', ok='#2e7d4f')
FONT = "Inter, 'Segoe UI', system-ui, -apple-system, sans-serif"
MONO = "'JetBrains Mono', SFMono-Regular, Menlo, Consolas, monospace"


class Svg:
    def __init__(self, w, h, title, desc):
        self.w, self.h, self.parts = w, h, []
        self.head = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" role="img" aria-labelledby="t d">'
                     f'<title id="t">{escape(title)}</title><desc id="d">{escape(desc)}</desc>'
                     f'<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
                     f'<path d="M0 0 L10 5 L0 10 z" fill="{C["accent"]}"/></marker>'
                     f'<marker id="arrowm" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
                     f'<path d="M0 0 L10 5 L0 10 z" fill="{C["muted"]}"/></marker></defs>'
                     f'<rect width="{w}" height="{h}" rx="16" fill="{C["bg"]}" stroke="{C["border"]}"/>')

    def text(self, x, y, s, size=14, weight=400, color='text', anchor='start', mono=False, italic=False):
        fam = MONO if mono else FONT
        st = ' font-style="italic"' if italic else ''
        self.parts.append(f'<text x="{x}" y="{y}" font-family="{fam}" font-size="{size}" font-weight="{weight}" fill="{C.get(color, color)}" text-anchor="{anchor}"{st}>{escape(s)}</text>')

    def lines(self, x, y, items, size=13, gap=19, **kw):
        for i, s in enumerate(items):
            self.text(x, y + i * gap, s, size=size, **kw)

    def box(self, x, y, w, h, fill='surface', stroke='border', r=12, dash=False, sw=1.5):
        d = ' stroke-dasharray="6 5"' if dash else ''
        self.parts.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{C.get(fill, fill)}" stroke="{C.get(stroke, stroke)}" stroke-width="{sw}"{d}/>')

    def card(self, x, y, w, h, title, body=(), fill='surface', stroke='border', tag=None, title_color='text', body_mono=False, size=13):
        self.box(x, y, w, h, fill, stroke)
        self.text(x + 16, y + 28, title, size=15, weight=700, color=title_color)
        if tag:
            tw = len(tag) * 7 + 16
            self.box(x + w - tw - 12, y + 12, tw, 22, 'soft', 'soft', r=11)
            self.text(x + w - 12 - tw / 2, y + 27, tag, size=11, weight=700, color='accent', anchor='middle')
        self.lines(x + 16, y + 52, body, size=size if not body_mono else size - 1, color='muted', mono=body_mono)

    def arrow(self, x1, y1, x2, y2, label=None, color='accent', dash=False, lx=None, ly=None, curve=None):
        mk = 'arrow' if color == 'accent' else 'arrowm'
        d = ' stroke-dasharray="5 5"' if dash else ''
        path = f'M{x1} {y1} Q{curve[0]} {curve[1]} {x2} {y2}' if curve else f'M{x1} {y1} L{x2} {y2}'
        self.parts.append(f'<path d="{path}" fill="none" stroke="{C[color]}" stroke-width="2"{d} marker-end="url(#{mk})"/>')
        if label:
            self.text(lx if lx is not None else (x1 + x2) / 2, ly if ly is not None else (y1 + y2) / 2 - 8, label, size=12, color='muted', anchor='middle')

    def step(self, x, y, n):
        self.parts.append(f'<circle cx="{x}" cy="{y}" r="13" fill="{C["accent"]}"/>')
        self.text(x, y + 5, str(n), size=13, weight=700, color='#ffffff', anchor='middle')

    def pill(self, x, y, s, tone='soft', color='accent', mono=False):
        w = len(s) * (7.8 if mono else 7.2) + 22
        self.box(x, y, w, 26, tone, tone, r=13)
        self.text(x + w / 2, y + 18, s, size=12, weight=600, color=color, anchor='middle', mono=mono)
        return w

    def heading(self, title, sub):
        self.text(32, 44, title, size=22, weight=700)
        self.text(32, 70, sub, size=14, color='muted')

    def save(self, name):
        OUT.mkdir(parents=True, exist_ok=True)
        (OUT / name).write_text(self.head + ''.join(self.parts) + '</svg>\n', encoding='utf-8')


def architecture():
    s = Svg(1000, 600, 'codeDeft architecture',
            'AI assistants, the web dashboard and the VS Code extension talk to the codeDeft MCP server and the local API server, '
            'which use the engine and a SQLite database. The repository is only read; new files are created only after approval in VS Code.')
    s.heading('How codeDeft fits together', 'Everything runs on your machine. Your code never leaves it unless you configure a model endpoint.')
    s.text(32, 112, 'WHERE YOU WORK', size=12, weight=700, color='muted')
    s.card(32, 124, 300, 118, 'AI assistants', ['GitHub Copilot (agent mode), Claude,', 'Cursor… ask codeDeft for context', 'and check their code with it'], tag='MCP')
    s.card(350, 124, 300, 118, 'Web dashboard', ['Feature chats: Figma frame, reuse', 'decisions, dependencies and', 'proposals per feature'], tag='127.0.0.1')
    s.card(668, 124, 300, 118, 'VS Code extension', ['Registers codeDeft with Copilot;', 'previews proposals and creates', 'files only after you approve'])
    s.text(32, 290, 'CODEDEFT', size=12, weight=700, color='muted')
    s.card(32, 302, 300, 112, 'MCP server', ['get_task_context · verify_code', 'search · lookup_symbol', 'find_reusable_code · dependencies'], fill='soft', stroke='accent', body_mono=True)
    s.card(350, 302, 618, 112, 'Local API server', ['Feature chats · reuse intelligence · Figma reading · grounded generation', '(generate → verify → repair) · proposals. Listens on 127.0.0.1 only,', 'checks Host/Origin and an optional token.'], fill='soft', stroke='accent')
    s.arrow(182, 242, 182, 300); s.arrow(500, 242, 500, 300); s.arrow(818, 242, 818, 300)
    s.card(32, 462, 452, 108, 'Engine', ['Index files · symbols · exports · import aliases', 'Dependency graph · conventions · search', 'Verify imports, exports and packages'])
    s.card(500, 462, 220, 108, 'SQLite', ['Repository index', 'Feature chats', 'Designs · proposals'])
    s.card(736, 462, 232, 108, 'Outside (optional)', ['Figma API: frame reads', 'Model endpoint: generation', 'Token used per request'], fill='s2', stroke='strong')
    s.arrow(182, 414, 182, 460); s.arrow(560, 414, 560, 460); s.arrow(852, 414, 852, 460, color='muted', dash=True)
    s.text(196, 445, 'reads your repository, never edits it', size=12, color='muted')
    s.save('architecture.svg')


def assistants():
    s = Svg(1000, 430, 'How an AI assistant uses codeDeft',
            'The assistant asks for task context, writes code using only what exists, calls verify_code, fixes any reported errors '
            'using the suggested real names, and finishes when every import, export and package checks out.')
    s.heading('Context first, then a check', 'The assistant works from what really exists in your repository, and verifies before it finishes.')
    xs = [32, 228, 424, 620, 816]
    cards = [('Your task', ['"Add a checkout page', 'that uses PayButton"'], False),
             ('get_task_context', ['Real files and excerpts,', 'exports, aliases,', 'packages, reuse'], True),
             ('Assistant writes', ['Imports only what', 'the context showed', 'exists'], False),
             ('verify_code', ['Every file, export', 'and package is', 'checked'], True),
             ('Done', ['No invented imports,', 'no missing packages,', 'no copied helpers'], False)]
    for i, (x, (t, body, tool)) in enumerate(zip(xs, cards)):
        last = i == 4
        s.card(x, 110, 152, 140, t, body, fill='soft' if tool else ('surface'), stroke='ok' if last else ('accent' if tool else 'border'),
               title_color='ok' if last else 'text', size=12)
        s.step(x + 152 - 22, 110, i + 1)
        if i < 4:
            s.arrow(x + 154, 180, xs[i + 1] - 4, 180)
    s.arrow(700, 254, 500, 254, color='muted', curve=(600, 330))
    s.text(600, 306, 'fix and check again', size=12, color='muted', anchor='middle')
    s.box(395, 318, 410, 78, 'dangersoft', 'danger', r=10)
    s.text(411, 342, 'verify_code found a problem', size=13, weight=700, color='danger')
    s.text(411, 362, 'Checkout.vue:3  "formatCurrency" is not exported', size=12, color='text', mono=True)
    s.text(411, 381, 'by src/utils/money.ts. Did you mean formatPrice?', size=12, color='text', mono=True)
    s.text(32, 330, 'If something is wrong, the', size=13, color='muted')
    s.text(32, 349, 'assistant gets the line and the', size=13, color='muted')
    s.text(32, 368, 'closest real name, fixes it and', size=13, color='muted')
    s.text(32, 387, 'checks again.', size=13, color='muted')
    s.save('ai-assistants.svg')


def figma():
    s = Svg(1000, 440, 'Figma frame to code proposal',
            'A Figma frame is read once with your token, summarised into layers, components and texts, matched to existing files, '
            'combined with your reuse choices into a verified proposal of new files that you review and approve in VS Code.')
    s.heading('From a Figma frame to reviewed code', 'Paste a frame link in a feature chat. Nothing is written until you approve it in VS Code.')
    # frame sketch
    s.box(32, 110, 170, 200, 'surface', 'border')
    s.text(48, 136, 'Checkout', size=13, weight=700)
    s.box(48, 150, 138, 18, 's2', 's2', r=4); s.box(48, 176, 100, 12, 's2', 's2', r=4); s.box(48, 196, 120, 12, 's2', 's2', r=4)
    s.box(48, 222, 138, 40, 's2', 'strong', r=6, dash=True); s.text(117, 247, 'OrderSummary', size=11, color='muted', anchor='middle')
    s.box(48, 272, 138, 26, 'accent', 'accent', r=8); s.text(117, 290, 'Pay now', size=12, weight=700, color='#ffffff', anchor='middle')
    s.text(117, 332, 'Figma frame', size=13, weight=600, anchor='middle')
    s.text(117, 350, 'figma.com/design/…?node-id=', size=11, color='muted', anchor='middle', mono=True)
    cols = [(240, 'Read once', ['Token used for this', 'request only; never', 'stored or logged']),
            (436, 'Design summary', ['48 layers', '6 components', 'Texts: "Pay now", …']),
            (632, 'Match + choices', ['PayButton.vue', '  → Reuse', 'CartView.vue', '  → Reference only']),
            (828, 'Proposal', ['New files only', 'Imports checked', 'Open in VS Code'])]
    for i, (x, t, b) in enumerate(cols):
        s.card(x, 140, 148, 150, t, b, fill='soft' if i in (1, 2) else 'surface', stroke='ok' if i == 3 else ('accent' if i in (1, 2) else 'border'),
               title_color='ok' if i == 3 else 'text', size=12)
        s.step(x + 148 - 22, 140, i + 1)
    s.arrow(204, 210, 238, 210)
    for a, b in ((390, 434), (586, 630), (782, 826)):
        s.arrow(a, 210, b, 210)
    s.box(240, 322, 736, 84, 'surface', 'border', r=10)
    s.text(258, 348, 'Stored with the feature', size=13, weight=700)
    s.text(258, 370, 'The design summary, closest files and your reuse choices stay in the feature chat (SQLite), so the next', size=12, color='muted')
    s.text(258, 389, 'generation uses them again. Large files: use “Copy link to selection” so the link points at one frame.', size=12, color='muted')
    s.save('figma-workflow.svg')


def independent():
    s = Svg(1000, 460, 'Independent proposals: new files only, after approval',
            'A generated proposal passes a safety gate that rejects existing files, paths outside the repository, node_modules and hidden '
            'or config folders. VS Code previews each file and creates them only after Approve and Create; cancelling changes nothing.')
    s.heading('New files only, and only after you approve', 'The server returns proposals. Only the VS Code extension can create files, and only when you say so.')
    s.card(32, 110, 200, 128, 'Proposal', ['2 new files', 'Checkout.vue', 'OrderSummary.vue'], size=12)
    s.card(276, 110, 250, 128, 'Safety gate', ['Server and extension reject:', 'existing files, paths', 'outside the repository,', 'node_modules, .git, .env*…'], fill='soft', stroke='accent', size=12)
    s.card(570, 110, 180, 128, 'Preview in VS Code', ['Each file opens as', 'an unsaved preview;', 'paths in Output panel'], size=12)
    s.card(794, 110, 174, 128, 'Approve and Create', ['Rechecks nothing exists;', 'creates complete files,', 'overwrite off, Undo works'], stroke='ok', title_color='ok', size=12)
    for a, b in ((234, 274), (528, 568), (752, 792)):
        s.arrow(a, 174, b, 174)
    s.text(881, 262, 'Cancel → nothing changes', size=12, color='muted', anchor='middle')
    # file tree
    s.box(32, 290, 440, 140, 'surface', 'border')
    s.text(50, 316, 'Your repository after approval', size=13, weight=700)
    tree = [('src/components/PayButton.vue', 'unchanged', 'muted'), ('src/components/OrderSummary.vue', '+ new', 'ok'),
            ('src/views/CartView.vue', 'unchanged', 'muted'), ('src/views/Checkout.vue', '+ new', 'ok')]
    for i, (p, tag, col) in enumerate(tree):
        y = 342 + i * 22
        s.text(50, y, p, size=12, mono=True, color='text' if col == 'ok' else 'muted')
        s.text(456, y, tag, size=12, weight=700 if col == 'ok' else 400, color=col, anchor='end')
    s.box(496, 290, 472, 140, 'warnsoft', 'warn', r=12)
    s.text(514, 316, 'You still wire it in', size=13, weight=700, color='warn')
    s.lines(514, 340, ['Adding the new page to a router or parent component is', 'deliberately not automatic: no existing file is edited.',
                       'Review the imports in the preview; in feature chats,', 'reused modules are imported, never copied.'], size=12, gap=20, color='text')
    s.save('independent-proposals.svg')


def reuse():
    s = Svg(1000, 450, 'Reuse intelligence',
            'A requirement is matched against code units from the repository using name, path, structure and usage evidence. '
            'Ranked candidates show their source and evidence, and you choose Reuse, Extract, Extend or Keep independent. The result is a review plan.')
    s.heading('Find what already exists before writing it again', 'Evidence first: every suggestion shows the real source, where it is used and why it matched.')
    s.card(32, 110, 196, 150, 'Requirement', ['"validate access', 'token"'], size=13)
    s.card(262, 110, 196, 150, 'Scan', ['Code units in Vue, TS,', 'JS, Java, Python, Go,', 'C#, Kotlin, Rust', 'Cached until files change'], size=12)
    s.arrow(230, 185, 260, 185); s.arrow(460, 185, 490, 185)
    # ranked list
    s.box(492, 110, 476, 150, 'surface', 'accent')
    s.text(510, 136, 'Ranked candidates', size=15, weight=700)
    rows = [('verifyToken()  src/auth/jwt.ts', 0.92, 'used by 7'), ('useSession()  src/auth/session.ts', 0.64, 'used by 4'), ('decodeBase64()  src/utils/b64.ts', 0.38, 'used by 2')]
    for i, (name, score, used) in enumerate(rows):
        y = 152 + i * 34
        s.box(508, y, 444, 28, 's2', 's2', r=6)
        s.text(518, y + 19, name, size=12, mono=True)
        s.box(812, y + 10, 70, 8, 'border', 'border', r=4); s.box(812, y + 10, 70 * score, 8, 'accent', 'accent', r=4)
        s.text(942, y + 19, used, size=11, color='muted', anchor='end')
    s.text(32, 300, 'EVIDENCE SHOWN FOR EACH', size=12, weight=700, color='muted')
    x = 32
    for p in ['Name / path match', 'Excerpt with line numbers', 'Imports', 'Where it is used', 'Estimated effort']:
        x += s.pill(x, 312, p, tone='s2', color='text') + 8
    s.text(32, 372, 'YOUR DECISION', size=12, weight=700, color='muted')
    x = 32
    for p, tone, col in [('Reuse', 'soft', 'accent'), ('Extract', 'soft', 'accent'), ('Extend', 'soft', 'accent'), ('Keep independent', 's2', 'text')]:
        x += s.pill(x, 384, p, tone=tone, color=col) + 8
    s.arrow(x + 6, 397, x + 50, 397)
    s.text(x + 60, 402, 'A review plan. No files are modified.', size=13, weight=600, color='ok')
    s.save('reuse-intelligence.svg')


def engine():
    s = Svg(1000, 420, 'codeDeft engine pipeline',
            'Repository files are indexed into files, symbols, exports, imports and resolved aliases, built into a dependency graph and '
            'conventions, persisted in SQLite, and used for search with citations, agent context plans and verification of proposed code.')
    s.heading('Engine: index once, answer from facts', 'A standalone Node.js + TypeScript library and CLI. No network calls except opt-in model generation.')
    s.card(32, 110, 180, 150, 'Repository', ['src/**/*.ts, *.vue…', 'package.json', 'tsconfig / vite', 'aliases'], body_mono=True, size=12)
    s.card(246, 110, 220, 150, 'Index', ['Files and symbols', 'Exports and imports', 'Aliases resolved (@/…)', 'Safe paths only'], fill='soft', stroke='accent', size=12)
    s.card(500, 110, 200, 150, 'Graph + profile', ['Who imports what', 'Frameworks, package', 'manager, conventions'], size=12)
    s.card(734, 110, 234, 150, 'SQLite', ['Persisted index', 'Query without', 'rescanning sources'], size=12)
    for a, b in ((214, 244), (468, 498), (702, 732)):
        s.arrow(a, 185, b, 185)
    s.text(32, 300, 'WHAT YOU CAN ASK IT', size=12, weight=700, color='muted')
    uses = [('Search', 'Ranked files with cited', 'reasons for a question'), ('Agent plan', 'Focused context for one task,', 'within a size budget'),
            ('Validate / verify', 'Missing files, exports and', 'packages, with real names'), ('Evaluate', 'Retrieval quality on your', 'own benchmark questions')]
    for i, (t, a, b) in enumerate(uses):
        x = 32 + i * 238
        s.box(x, 312, 222, 82, 'surface', 'border', r=10)
        s.text(x + 14, 336, t, size=14, weight=700)
        s.text(x + 14, 358, a, size=12, color='muted'); s.text(x + 14, 376, b, size=12, color='muted')
    s.save('engine-pipeline.svg')


if __name__ == '__main__':
    for f in (architecture, assistants, figma, independent, reuse, engine):
        f()
    print('wrote', ', '.join(sorted(p.name for p in OUT.glob('*.svg'))))
