#!/usr/bin/env python3
"""
clean-content.py

Fixes two Turndown conversion artifacts across all markdown blog posts:
1. Lone backslash lines (\ on its own) → delete
2. Cross-language "English/Korean version is here" lines → delete or strip
"""

import os
import re

BLOG_DIR = os.path.join(os.path.dirname(__file__), '../src/content/blog')

# ── Pattern helpers ────────────────────────────────────────────────────────────

# Matches a markdown link that goes to baejoseph.com (the old domain)
WP_LINK = r'\[[^\]]*\]\(https?://baejoseph\.com[^\)]*\)'

# Words/phrases that flag a cross-language reference
CROSS_LANG_SIGNALS = re.compile(
    r'(english version|english is|영어 버전|korean version|korean translation|'
    r'한글은|한글 버전|한글 번역|한글로 읽|여기 있습니다|여기\]|'
    r'you can find the english|an english version|translation of.*original|'
    r'this is a.*translation)',
    re.IGNORECASE
)

def is_pure_cross_ref(line: str) -> bool:
    """Return True if the entire line is a cross-language reference (nothing else)."""
    # Strip markdown wrapper chars and whitespace
    stripped = line.strip()
    # Remove outer parens / escaped brackets
    stripped = re.sub(r'^[\(\[\\\s]+', '', stripped)
    stripped = re.sub(r'[\)\]\\\s\.]+$', '', stripped)
    stripped = stripped.strip()

    if not stripped:
        return False

    # If it has cross-lang signals AND all non-empty text resolves to just
    # link text + boilerplate, consider it pure
    if not CROSS_LANG_SIGNALS.search(stripped):
        return False

    # Remove all markdown links; what's left should be only boilerplate
    remainder = re.sub(r'\[[^\]]*\]\([^\)]*\)', '', stripped)
    # Strip common boilerplate words
    remainder = re.sub(
        r'\b(english|korean|한글|영어|version|버전|번역|is|are|found|here|여기|있습니다|있다|'
        r'you|can|find|the|an|a|of|in|at|this|translation|original|이|글|을|는|로|에)\b',
        '', remainder, flags=re.IGNORECASE
    )
    remainder = re.sub(r'[\s\.\,\(\)\[\]\\\!\?\_\*\-]', '', remainder)
    return len(remainder) == 0


def strip_trailing_cross_ref(line: str) -> str:
    """
    Remove a trailing cross-language reference from a line that has real content.
    e.g. "큰 은혜 (English version [here](...))" → "큰 은혜"
    """
    # Patterns at end of line: " English is [here](...)", " 한글은 [여기](...) 있습니다", etc.
    patterns = [
        # English trailing refs
        r'\s*\(?\\?\[?[Ee]nglish(?:\s+version)?(?:\s+is)?(?:\s+found)?\s+\[(?:here|이곳)\]\([^)]+\)\.?\]?\)?\s*$',
        r'\s*\(?[Ee]nglish\s+(?:version\s+)?is\s+\[here\]\([^)]+\)\.?\)?\s*$',
        # Korean trailing refs
        r'\s*[\(\[]?한글(?:\s*버전|\s*번역)?\s*(?:은|는)?\s*\[?여기\]?\(?[^)]*\)?\s*(?:있습니다|있다)\.?[\)\]]?\s*$',
        r'\s*[\(\[\\]*이\s*글을\s*한글로\s*읽으실[^)]*\)?\s*$',
        # Generic trailing ref in parens: (... [here](url))
        r'\s*\((?:[^()]*)\[(?:here|여기[^\]]*)\]\([^)]+\)[^)]*\)\s*$',
    ]
    result = line
    for p in patterns:
        new = re.sub(p, '', result, flags=re.IGNORECASE)
        if new != result:
            result = new.rstrip()
            # Clean up orphaned opening parens/brackets at end
            result = re.sub(r'[\(\[\\]+\s*$', '', result).rstrip()
            break
    return result


def clean_file(path: str) -> tuple[int, int]:
    """Clean a single markdown file. Returns (lone_backslash_removed, crossref_removed)."""
    with open(path, 'r', encoding='utf-8') as f:
        original = f.read()

    lines = original.splitlines(keepends=True)
    out = []
    lone_bs = 0
    crossref = 0

    # Find frontmatter end (skip frontmatter lines)
    in_frontmatter = False
    fm_done = False
    fm_count = 0

    for i, line in enumerate(lines):
        stripped = line.rstrip('\n').rstrip('\r')

        # Track frontmatter
        if i == 0 and stripped == '---':
            in_frontmatter = True
            out.append(line)
            continue
        if in_frontmatter:
            out.append(line)
            if stripped == '---':
                fm_count += 1
                if fm_count >= 1:
                    in_frontmatter = False
                    fm_done = True
            continue

        # ── 1. Lone backslash line ────────────────────────────────────────────
        if stripped in ('\\', '\\ '):
            lone_bs += 1
            continue  # drop the line entirely

        # ── 2. Cross-language reference lines ────────────────────────────────
        if CROSS_LANG_SIGNALS.search(stripped) and WP_LINK in stripped or (
            CROSS_LANG_SIGNALS.search(stripped) and re.search(WP_LINK, stripped)
        ):
            if is_pure_cross_ref(stripped):
                crossref += 1
                continue  # drop entire line
            else:
                # Line has real content — strip just the trailing cross-ref part
                new_stripped = strip_trailing_cross_ref(stripped)
                if new_stripped != stripped:
                    crossref += 1
                    # Preserve original line ending
                    ending = line[len(stripped):]
                    out.append(new_stripped + ending)
                    continue

        out.append(line)

    result = ''.join(out)
    # Also collapse 3+ consecutive blank lines down to 2
    result = re.sub(r'\n{3,}', '\n\n', result)

    if result != original:
        with open(path, 'w', encoding='utf-8') as f:
            f.write(result)

    return lone_bs, crossref


def main():
    files = sorted(f for f in os.listdir(BLOG_DIR) if f.endswith('.md'))
    total_bs = 0
    total_cr = 0
    changed = 0

    for fname in files:
        path = os.path.join(BLOG_DIR, fname)
        bs, cr = clean_file(path)
        total_bs += bs
        total_cr += cr
        if bs or cr:
            changed += 1
            print(f"  {fname}: -{bs} backslash, -{cr} cross-ref")

    print(f"\nDone: {changed} files modified")
    print(f"  Lone backslashes removed:  {total_bs}")
    print(f"  Cross-lang refs removed:   {total_cr}")


if __name__ == '__main__':
    main()
