#!/usr/bin/env python3
"""
add-crosslinks.py
Adds natural intra-blog cross-links across posts.
Each replacement is (file, old_text, new_text) — exact string replacements only.
"""
import os

BLOG = '/home/clawd/.openclaw/workspace/baejoseph-website/src/content/blog'

def r(fname):
    return open(os.path.join(BLOG, fname), encoding='utf-8').read()

def w(fname, text):
    open(os.path.join(BLOG, fname), 'w', encoding='utf-8').write(text)

def apply(fname, old, new):
    text = r(fname)
    if old not in text:
        print(f"  ⚠ NOT FOUND in {fname}: {old[:60]!r}")
        return False
    if new in text:
        print(f"  ↩ ALREADY DONE in {fname}: {new[:60]!r}")
        return False
    text = text.replace(old, new, 1)
    w(fname, text)
    return True

changes = 0

def link(fname, old, new):
    global changes
    if apply(fname, old, new):
        print(f"  ✓ {fname}")
        changes += 1

# ─── 2026-fast.md ─────────────────────────────────────────────────────────────
link('2026-fast.md',
     'during our school runs',
     'during our [school runs](/century)')

link('2026-fast.md',
     'the McCheyne plan',
     'the [McCheyne plan](/mccheyne)')

link('2026-fast.md',
     'Just as street evangelism',
     'Just as [street evangelism](/evangelism)')

link('2026-fast.md',
     'In these end times',
     'In these [end times](/end3)')

# ─── allegiance.md ────────────────────────────────────────────────────────────
link('allegiance.md',
     'with love, and courage, and loyalty',
     'with love, and [courage](/courage), and loyalty')

link('allegiance.md',
     'to swear fealty to the rightful King',
     'to swear fealty to the [rightful King](/throne-of-david)')

link('allegiance.md',
     'we follow the Lamb',
     'we follow the [Lamb](/propitiation)')

link('allegiance.md',
     'eagerly wait for the Saviour, Our Lord Jesus Christ',
     'eagerly [wait for the Saviour](/rapture), Our Lord Jesus Christ')

# ─── empathy.md ───────────────────────────────────────────────────────────────
link('empathy.md',
     'the postmodern rejection of objective moral truth',
     'the [postmodern rejection of objective moral truth](/leftism-eng)')

link('empathy.md',
     "'guard your heart, for out of it spring the issues of life'",
     "'[guard your heart](/allegiance), for out of it spring the issues of life'")

link('empathy.md',
     'even at the cost of personal sacrifice',
     'even at the cost of [personal sacrifice](/propitiation)')

link('empathy.md',
     'but an unchanging foundation',
     'but an [unchanging foundation](/seven-taboos)')

# ─── propitiation.md ──────────────────────────────────────────────────────────
link('propitiation.md',
     'the gospel has been reshaped into a sentimental romance',
     'the gospel has been reshaped into a [sentimental romance](/keller-eng)')

link('propitiation.md',
     'The fruit is all around us: moral chaos',
     'The fruit is all around us: [moral chaos](/leftism-eng)')

link('propitiation.md',
     'but boldly proclaim its unsearchable depths',
     'but [boldly proclaim](/courage) its unsearchable depths')

link('propitiation.md',
     'until every knee has bowed and every tongue confess',
     'until [every knee has bowed](/throne-of-david) and every tongue confess')

link('propitiation.md',
     'has the power to transform lives, renew families',
     'has the power to transform lives, [renew families](/values)')

# ─── seven-taboos.md ──────────────────────────────────────────────────────────
link('seven-taboos.md',
     'pluck up the courage to confront',
     'pluck up the [courage](/courage) to confront')

link('seven-taboos.md',
     'along with corporate fasting within the local church community',
     'along with [corporate fasting](/2026-fast) within the local church community')

link('seven-taboos.md',
     'practice generosity through tithing to their local churches',
     'practice generosity through [tithing](/tithes) to their local churches')

link('seven-taboos.md',
     'Specifically within the Korean church, there is a need',
     'Specifically within the [Korean church](/ealing-yale), there is a need')

# ─── labels.md ────────────────────────────────────────────────────────────────
link('labels.md',
     'to all who have _longed_ for His appearing',
     'to all who have _[longed for His appearing](/rapture)_')

link('labels.md',
     'Amillennialism, while intellectually sophisticated',
     '[Amillennialism](/theology), while intellectually sophisticated')

link('labels.md',
     "Let's stay awake in prayer.",
     "Let's [stay awake in prayer](/cry-out).")

link('labels.md',
     "Let's stay ready in holiness.",
     "Let's [stay ready in holiness](/allegiance).")

# ─── two.md ───────────────────────────────────────────────────────────────────
link('two.md',
     'the second coming will be as a King to sit on the throne of David',
     'the second coming will be as a King to sit on the [throne of David](/throne-of-david)')

link('two.md',
     'starting with the early 20th-century Azusa Street Revival',
     'starting with the early 20th-century [Azusa Street Revival](/journey)')

link('two.md',
     'The re-gathering of Israel, often mentioned in the Old Testament',
     'The [re-gathering of Israel](/end3), often mentioned in the Old Testament')

link('two.md',
     'yet Israel remains distinct from the Church and still has a significant role',
     'yet Israel remains distinct from the Church and still has a [significant role](/seven-taboos)')

# ─── cry-out.md ───────────────────────────────────────────────────────────────
link('cry-out.md',
     "there is a time to roar together",
     "there is a time to [roar together](/courage)")

link('cry-out.md',
     "entering the throne of grace together with boldness",
     "entering the [throne of grace](/propitiation) together with boldness")

# ─── evangelism.md ────────────────────────────────────────────────────────────
link('evangelism.md',
     'In my journey with various methods of street evangelism',
     'In my journey with various methods of [street evangelism](/wooden-cross)')

link('evangelism.md',
     'He rose again on the third day, according to the Scriptures.',
     '[He rose again on the third day](/bayes), according to the Scriptures.')

link('evangelism.md',
     'Our role is to faithfully proclaim the truths',
     'Our role is to [faithfully proclaim](/courage) the truths')

# ─── love.md ──────────────────────────────────────────────────────────────────
link('love.md',
     'The thought of reigning with Christ for a thousand years',
     'The thought of [reigning with Christ for a thousand years](/throne-of-david)')

link('love.md',
     'our resurrection bodies will enable us to teleport',
     'our [resurrection bodies](/rapture) will enable us to teleport')

link('love.md',
     'How will we as Church Saints and Old Testament Saints communicate',
     'How will we as [Church Saints and Old Testament Saints](/two) communicate')

link('love.md',
     'the Kingdom of Jesus will be a Kingdom defined by love',
     'the Kingdom of Jesus will be a [Kingdom defined by love](/propitiation)')

# ─── theology.md ──────────────────────────────────────────────────────────────
link('theology.md',
     'My journey led me deeper into Pentecostal and charismatic theology',
     '[My journey](/journey) led me deeper into Pentecostal and charismatic theology')

link('theology.md',
     'He taught me about the baptism of the Holy Spirit',
     'He taught me about the [baptism of the Holy Spirit](/allegiance)')

link('theology.md',
     'came to see the Biblical significance of the May 1948 Establishment of the State of Israel',
     'came to see the Biblical significance of the [May 1948 Establishment of the State of Israel](/end3)')

link('theology.md',
     'eagerly anticipating the imminent return of Christ and His Millennial Kingdom',
     'eagerly anticipating the imminent return of Christ and His [Millennial Kingdom](/throne-of-david)')

# ─── journey.md ───────────────────────────────────────────────────────────────
# "Derek Prince" → /fasting/ (his key teaching that journey.md references)
link('journey.md',
     '**Derek Prince** offers what strikes me as the most luminous insight',
     '**[Derek Prince](/fasting)** offers what strikes me as the most luminous insight')

# journey.md already has ~9 links from localisation; Derek Prince → /fasting/ brings it to 10

print(f"\nTotal changes: {changes}")
