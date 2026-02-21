#!/usr/bin/env python3
"""
clean-content-2.py — targeted cleanup for remaining cross-language reference lines.
"""
import os, re

BLOG = '/home/clawd/.openclaw/workspace/baejoseph-website/src/content/blog'

def path(f): return os.path.join(BLOG, f)
def read(f): return open(path(f), encoding='utf-8').read()
def write(f, s): open(path(f), 'w', encoding='utf-8').write(s); print(f'  ✓ {f}')

def delete_lines_matching(fname, pattern):
    t = read(fname)
    lines = t.splitlines(keepends=True)
    new = [l for l in lines if not re.search(pattern, l)]
    if new != lines:
        write(fname, ''.join(new))

# ── 1. Pure cross-ref lines → delete entirely ────────────────────────────────

# "This is a (Korean) translation of [the original in English](...)"
for f in ['충성.md', '성묘교회.md', '이란.md', '갈릴리.md']:
    delete_lines_matching(f, r'This is a (?:Korean )?translation of.*baejoseph\.com')

# ([English version is here](...))
delete_lines_matching('예수서원.md', r'\[English version is here\].*baejoseph\.com')

# \[you can find the English version [here](...)\]
delete_lines_matching('leftism.md', r'you can find the English version.*baejoseph\.com')

# ([한글은 여기 있습니다](...))
delete_lines_matching('jesus-academia.md', r'한글은 여기 있습니다.*baejoseph\.com')

# \[이 글의 한글 버전은 [다음](...)\]
delete_lines_matching('2017-prayer-mission-eng1.md', r'이 글의 한글 버전.*baejoseph\.com')

# \[[이 글을 한글로 읽으실 수 있습니다.](...)\]
delete_lines_matching('leftism-eng.md', r'이 글을 한글로 읽으실 수 있습니다.*baejoseph\.com')

# ── 2. Mixed lines → strip just the cross-ref portion ────────────────────────

# 휴거.md: exact string replace
t = read('휴거.md')
t = t.replace(
    '\\[_이 글은 아놀드 프루크텐바움(Arnold Fruchtenbaum)의 [가르침](https://youtu.be/3DMhMl3Kabc)을 정리한 내용입니다._ English version is [here](https://baejoseph.com/rapture).\\]',
    '\\[_이 글은 아놀드 프루크텐바움(Arnold Fruchtenbaum)의 [가르침](https://youtu.be/3DMhMl3Kabc)을 정리한 내용입니다._\\]'
)
write('휴거.md', t)

# rapture.md: exact string replace
t = read('rapture.md')
t = t.replace(
    '\\[This article is based on the [teaching](https://youtu.be/3DMhMl3Kabc) of [Arnold Fruchtenbaum](https://www.ariel.org). 한글은 [여기](https://baejoseph.com/휴거/) 있습니다. \\]',
    '\\[This article is based on the [teaching](https://youtu.be/3DMhMl3Kabc) of [Arnold Fruchtenbaum](https://www.ariel.org)\\]'
)
write('rapture.md', t)

# 금식.md: long para ending in "(English version [here](https://baejoseph.com/fasting))."
t = read('금식.md')
t = re.sub(r'\s*\(English version \[here\]\(https://baejoseph\.com/fasting\)\)\.?', '', t)
write('금식.md', t)

# jesus-academia-2.md: "([Part one](...) is here. 한글은 [여기 있습니다](...))"
# → "(Part one is [here](/jesus-academia/))"
t = read('jesus-academia-2.md')
t = re.sub(
    r'\(\[Part one\]\(https://baejoseph\.com/jesus-academia/\) is here\. 한글은 \[여기 있습니다\]\([^\)]+\)\)',
    '(Part one is [here](/jesus-academia/))',
    t
)
write('jesus-academia-2.md', t)

# jesus-academia-3.md: "(Part one is [here](...); Part two is [here](...). 한글은 [여기 있습니다](...))"
# → "(Part one is [here](/jesus-academia/); Part two is [here](/jesus-academia-2/))"
t = read('jesus-academia-3.md')
t = re.sub(
    r'\(Part one is \[here\]\(https://baejoseph\.com/jesus-academia/\); Part two is \[here\]\(https://baejoseph\.com/jesus-academia-2/\)\. 한글은 \[여기 있습니다\]\([^\)]+\)\)',
    '(Part one is [here](/jesus-academia/); Part two is [here](/jesus-academia-2/))',
    t
)
write('jesus-academia-3.md', t)

print('\nDone.')
