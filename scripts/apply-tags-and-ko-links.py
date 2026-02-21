#!/usr/bin/env python3
"""
apply-tags-and-ko-links.py
1. Adds tags to every markdown post's frontmatter
2. Adds Korean cross-links mirroring the English linking work
"""
import os, re

BLOG = '/home/clawd/.openclaw/workspace/baejoseph-website/src/content/blog'

# ── Tag taxonomy ───────────────────────────────────────────────────────────────
# 15 tags: eschatology · leftism · fasting · evangelism · family
#          theology · health · tech · korea · testimony
#          prayer · israel · courage · review · travel

TAGS = {
    # ── EN posts ──
    '2017-prayer-mission-eng1.md': ['prayer', 'korea', 'testimony'],
    '2023-review.md':              ['testimony'],
    '2026-fast.md':                ['fasting', 'testimony'],
    'aaron.md':                    ['leftism', 'courage'],
    'allegiance.md':               ['theology', 'courage'],
    'bayes.md':                    ['theology'],
    'best-gift.md':                ['evangelism', 'family', 'testimony'],
    'bible-app.md':                ['tech'],
    'bradford-2023.md':            ['evangelism', 'testimony'],
    'butter.md':                   ['health'],
    'cbmc-2023.md':                ['testimony', 'korea'],
    'century.md':                  ['family', 'testimony'],
    'cholesterol.md':              ['health'],
    'climate.md':                  ['leftism', 'eschatology'],
    'closure.md':                  ['testimony', 'courage'],
    'courage.md':                  ['courage', 'leftism', 'eschatology'],
    'cry-out.md':                  ['prayer', 'korea'],
    'daily-bread.md':              ['tech'],
    'empathy.md':                  ['theology', 'leftism'],
    'end3.md':                     ['eschatology', 'israel'],
    'eschatology.md':              ['eschatology', 'theology'],
    'evangelism.md':               ['evangelism'],
    'evidence.md':                 ['leftism'],
    'family-korea-2023.md':        ['travel', 'korea', 'family'],
    'fasting.md':                  ['fasting', 'prayer'],
    'favourites.md':               ['theology'],
    'financial-crash-and-wokism.md': ['leftism'],
    'galilee.md':                  ['travel', 'testimony'],
    'heroics.md':                  ['theology', 'courage'],
    'iran.md':                     ['eschatology', 'israel'],
    'jane-eyre.md':                ['review'],
    'jesus-academia.md':           ['testimony', 'theology'],
    'jesus-academia-2.md':         ['testimony', 'theology'],
    'jesus-academia-3.md':         ['testimony', 'theology'],
    'joshua-camp.md':              ['family', 'testimony'],
    'journey.md':                  ['theology', 'testimony', 'eschatology'],
    'jun-juna-wedding.md':         ['family', 'testimony'],
    'keller-eng.md':               ['theology', 'leftism'],
    'kirk.md':                     ['eschatology', 'courage'],
    'labels.md':                   ['eschatology', 'theology'],
    'leftism-eng.md':              ['leftism', 'theology'],
    'leftism-essay-gpt.md':        ['leftism', 'tech'],
    'love.md':                     ['eschatology', 'theology'],
    'maga-hat.md':                 ['courage', 'leftism'],
    'maths.md':                    ['theology'],
    'mccheyne.md':                 ['prayer'],
    'memes.md':                    ['leftism'],
    'morning-sermon.md':           ['theology', 'testimony'],
    'multiculturalism.md':         ['leftism'],
    'name-of-jesus.md':            ['courage', 'theology'],
    'nkjv.md':                     ['theology'],
    'oils.md':                     ['health'],
    'paul-debbie-wedding.md':      ['family', 'testimony'],
    'poke.md':                     ['tech', 'family'],
    'pride-and-prejudice.md':      ['review'],
    'privacy.md':                  ['tech'],
    'propitiation.md':             ['theology'],
    'rapture.md':                  ['eschatology'],
    'recon.md':                    ['evangelism', 'travel'],
    'rothschilds.md':              ['leftism'],
    'self.md':                     ['theology', 'family'],
    'sepulchre.md':                ['travel', 'testimony'],
    'seven-taboos.md':             ['theology', 'courage'],
    'sober.md':                    ['leftism', 'courage'],
    'solzhenitsyn.md':             ['leftism', 'courage'],
    'starve.md':                   ['leftism', 'courage'],
    'sted-cathedral.md':           ['travel', 'testimony'],
    'stolen.md':                   ['leftism'],
    'submit.md':                   ['theology', 'family'],
    'sunday.md':                   ['tech'],
    'theology.md':                 ['theology', 'testimony'],
    'three.md':                    ['theology', 'eschatology', 'leftism'],
    'throne-of-david.md':          ['eschatology', 'israel'],
    'tithes.md':                   ['theology'],
    'tor.md':                      ['evangelism', 'travel'],
    'trade.md':                    ['theology'],
    'trappist.md':                 ['prayer', 'theology'],
    'two.md':                      ['eschatology', 'theology'],
    'values.md':                   ['theology', 'eschatology', 'family'],
    'week.md':                     ['testimony'],
    'will.md':                     ['eschatology'],
    'wooden-cross.md':             ['evangelism'],
    'xcc.md':                      ['testimony', 'travel'],
    # ── KO posts ──
    '2017-prayer-mission.md':      ['prayer', 'korea', 'testimony'],
    '2023-card.md':                ['testimony', 'family'],
    '2023-korea-visit.md':         ['korea', 'family', 'testimony'],
    '2023-prayer-mission.md':      ['prayer', 'korea', 'testimony'],
    '2026-금식.md':                ['fasting', 'testimony'],
    '3-men-room.md':               ['leftism', 'theology'],
    '40th-birthday-party.md':      ['family', 'testimony'],
    '7금기들.md':                  ['theology', 'courage'],
    'baegpt.md':                   ['tech', 'korea'],
    'dsec-2023.md':                ['tech', 'testimony'],
    'ealing-yale.md':              ['korea', 'testimony'],
    'einstein.md':                 ['testimony'],
    'keller.md':                   ['theology', 'leftism'],
    'leftism.md':                  ['leftism', 'theology'],
    'locusts.md':                  ['theology'],
    'murph.md':                    ['health', 'testimony'],
    'murph-update.md':             ['health', 'testimony'],
    'mymortgageinsight.md':        ['tech', 'testimony'],
    'okas.md':                     ['testimony'],
    'pastor-han.md':               ['testimony', 'prayer'],
    'pride-month.md':              ['leftism', 'theology'],
    'rod.md':                      ['family', 'theology'],
    'sarah-club.md':               ['family', 'testimony'],
    'sweet.md':                    ['family', 'korea'],
    'vivek.md':                    ['leftism'],
    # ── KO with Korean-char filenames ──
    '가치.md':                     ['theology', 'eschatology', 'family'],
    '갈릴리.md':                   ['travel', 'testimony'],
    '공감.md':                     ['theology', 'leftism'],
    '극한도전.md':                  ['testimony', 'travel'],
    '금식.md':                     ['fasting', 'prayer'],
    '두가지.md':                   ['eschatology', 'theology'],
    '마지막.md':                   ['eschatology', 'israel'],
    '먹지마.md':                   ['leftism', 'courage'],
    '믿음.md':                     ['theology'],
    '베이즈.md':                   ['theology'],
    '부르짖으라.md':               ['prayer', 'korea'],
    '사랑.md':                     ['eschatology', 'theology'],
    '성경적-정치관.md':            ['leftism', 'theology'],
    '성묘교회.md':                 ['travel', 'testimony'],
    '세가지.md':                   ['theology', 'eschatology', 'leftism'],
    '센츄리.md':                   ['family', 'testimony'],
    '솔로몬의-부의-비밀.md':       ['theology'],
    '아침설교.md':                 ['theology', 'testimony'],
    '연결.md':                     ['prayer', 'testimony'],
    '예수서원.md':                 ['testimony', 'theology'],
    '예수서원2.md':                ['testimony', 'theology'],
    '예수서원3.md':                ['testimony', 'theology'],
    '오만.md':                     ['review'],
    '용기.md':                     ['courage', 'leftism', 'eschatology'],
    '이란.md':                     ['eschatology', 'israel'],
    '정신.md':                     ['leftism', 'courage'],
    '제인-에어.md':                ['review'],
    '천년설.md':                   ['eschatology', 'theology'],
    '출산.md':                     ['korea', 'family'],
    '충성.md':                     ['theology', 'courage'],
    '프린스.md':                   ['fasting', 'prayer', 'testimony'],
    '환경.md':                     ['leftism', 'eschatology'],
    '휴거.md':                     ['eschatology'],
}

def add_tags(fname, tags):
    path = os.path.join(BLOG, fname)
    if not os.path.exists(path):
        print(f'  ⚠ not found: {fname}')
        return
    text = open(path, encoding='utf-8').read()
    if 'tags:' in text.split('---')[1] if text.startswith('---') else '':
        return  # already has tags
    # Find second --- (end of frontmatter)
    parts = text.split('---', 2)
    if len(parts) < 3:
        return
    fm = parts[1]
    body = parts[2]
    tag_line = '\ntags: [' + ', '.join(f'"{t}"' for t in tags) + ']'
    new_text = '---' + fm + tag_line + '\n---' + body
    open(path, 'w', encoding='utf-8').write(new_text)

print('Adding tags...')
for fname, tags in TAGS.items():
    add_tags(fname, tags)
    print(f'  ✓ {fname}')

# ── Korean cross-links ─────────────────────────────────────────────────────────

def link(fname, old, new, desc=''):
    path = os.path.join(BLOG, fname)
    if not os.path.exists(path):
        print(f'  ⚠ not found: {fname}')
        return
    text = open(path, encoding='utf-8').read()
    if old not in text:
        print(f'  ⚠ NOT FOUND in {fname}: {old[:50]!r}')
        return
    if new in text:
        return  # already done
    open(path, 'w', encoding='utf-8').write(text.replace(old, new, 1))
    print(f'  ✓ {fname}: {desc or old[:40]}')

print('\nAdding Korean cross-links...')

# 용기.md — mirrors courage.md (already has leftism, eschatology links from localisation)
link('용기.md',
     '세 가지 구별된 영역',
     '[세 가지 구별된 영역](/세가지)',
     'three realms → 세가지')
link('용기.md',
     '복음을 전파',
     '[복음을 전파](/evangelism)',
     'evangelism EN')
# safer: link to eschatology concept
link('용기.md',
     '천년왕국',
     '[천년왕국](/천년설)',
     'millennial → labels KO')
link('용기.md',
     '진실을 말하라',
     '[진실을 말하라](/7금기들)',
     'speak truth → 7 taboos KO')

# 마지막.md — mirrors end3.md
link('마지막.md',
     '휴거',
     '[휴거](/휴거)',
     'rapture → 휴거')
link('마지막.md',
     '예언',
     '[예언](/이란)',
     'prophecy → iran KO')
link('마지막.md',
     '금식과 기도',
     '[금식](/금식)과 기도',
     'fasting → 금식')

# 휴거.md — mirrors rapture.md
link('휴거.md',
     '다윗의 보좌',
     '[다윗의 보좌](/솔로몬의-부의-비밀)',
     'throne of David → solomon KO')
# Already has: 가르침 (teaching YT link), Arnold Fruchtenbaum attribution

# 세가지.md — mirrors three.md
link('세가지.md',
     '복음 전파',
     '[복음 전파](/부르짖으라)',
     'gospel → cry-out KO')
link('세가지.md',
     '좌파주의',
     '[좌파주의](/leftism)',
     'leftism → leftism KO')
link('세가지.md',
     '천년왕국',
     '[천년왕국](/천년설)',
     'millennium → labels KO')

# 충성.md — mirrors allegiance.md
link('충성.md',
     '용기',
     '[용기](/용기)',
     'courage → 용기')
link('충성.md',
     '재림',
     '[재림](/마지막)',
     'second coming → 마지막')
link('충성.md',
     '우리의 왕',
     '[우리의 왕](/천년설)',
     'our king → labels KO')

# 공감.md — mirrors empathy.md
link('공감.md',
     '포스트모더니즘',
     '[포스트모더니즘](/leftism)',
     'postmodernism → leftism KO')
link('공감.md',
     '성경적 진리',
     '[성경적 진리](/충성)',
     'biblical truth → allegiance KO')
link('공감.md',
     '희생',
     '[희생](/베이즈)',
     'sacrifice → bayes KO')

# 두가지.md — mirrors two.md
link('두가지.md',
     '휴거',
     '[휴거](/휴거)',
     'rapture → 휴거')
link('두가지.md',
     '다윗의 보좌',
     '[다윗의 보좌](/솔로몬의-부의-비밀)',
     'throne of David → solomon KO')
link('두가지.md',
     '이스라엘',
     '[이스라엘](/이란)',
     'Israel → iran KO')

# 사랑.md — mirrors love.md
link('사랑.md',
     '깊이 묵상',
     '[깊이 묵상](/마지막)',
     'meditation → 마지막')
link('사랑.md',
     '부활의 몸',
     '[부활의 몸](/휴거)',
     'resurrection bodies → 휴거')
link('사랑.md',
     '천년왕국',
     '[천년왕국](/천년설)',
     'millennium → labels KO')

# 금식.md — mirrors fasting.md
link('금식.md',
     '21일 금식',
     '[21일 금식](/2026-금식)',
     '21-day fast → 2026-금식')
link('금식.md',
     '교회 전체',
     '[교회 전체](/부르짖으라)',
     'whole church → cry-out KO')
link('금식.md',
     '말세',
     '[말세](/마지막)',
     'end times → 마지막')

# 천년설.md — mirrors labels.md
link('천년설.md',
     '전천년주의',
     '[전천년주의](/휴거)',
     'premillennialism → 휴거')
link('천년설.md',
     '재림',
     '[재림](/마지막)',
     'second coming → 마지막')
link('천년설.md',
     '기도',
     '[기도](/부르짖으라)',
     'prayer → cry-out KO')

# 예수서원.md — mirrors jesus-academia.md
link('예수서원.md',
     '금식',
     '[금식](/금식)',
     'fasting → 금식')
link('예수서원.md',
     '천년왕국',
     '[천년왕국](/마지막)',
     'millennium → end3 KO')

# 아침설교.md — mirrors morning-sermon.md
link('아침설교.md',
     '금식',
     '[금식](/금식)',
     'fasting → 금식')
link('아침설교.md',
     '복음 전파',
     '[복음 전파](/부르짖으라)',
     'evangelism → cry-out KO')
link('아침설교.md',
     '말씀 암송',
     '[말씀 암송](/mccheyne)',
     'scripture memory → mccheyne')

# 베이즈.md — mirrors bayes.md
link('베이즈.md',
     '부활',
     '[부활](/휴거)',
     'resurrection → 휴거')
link('베이즈.md',
     '증거',
     '[증거](/eschatology)',
     'evidence → eschatology')

# 프린스.md — about Derek Prince
link('프린스.md',
     '금식',
     '[금식](/금식)',
     'fasting → 금식')
link('프린스.md',
     '이스라엘',
     '[이스라엘](/이란)',
     'Israel → iran KO')
link('프린스.md',
     '성령',
     '[성령](/충성)',
     'Holy Spirit → allegiance KO')

# 부르짖으라.md — mirrors cry-out.md
link('부르짖으라.md',
     '용기',
     '[용기](/용기)',
     'courage → 용기')
link('부르짖으라.md',
     '금식',
     '[금식](/금식)',
     'fasting → 금식')
link('부르짖으라.md',
     '말세',
     '[말세](/마지막)',
     'end times → 마지막')

print('\nDone.')
