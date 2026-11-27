#!/usr/bin/env python3
"""Make the English manuscript table English.

Two defects, one pass:
  1. The English notes were carried over from the Korean draft, so 435 of 543
     explainers mixed Korean glosses (개역개정, (없음), (삼 일 만에), …) into
     English sentences. Every note is rewritten here: 개역개정 -> "the CT",
     Korean glosses -> the English they gloss.
  2. The CT/TR sigla are set here too — Critical Text and Textus Receptus, the
     Received Text. Some scholars write RT for the Received Text; the page says
     so once, in the intro, and keeps TR throughout. Re-running this script on
     the current files is therefore a no-op for the sigla.

Each note exists twice in the file (the data-note attribute the tooltip reads,
and its <span class="srnote"> twin), so both are rewritten from the same source.
"""
import re

SIGLA = [
    ('&#x27;s', '’s'), ("'s", '’s'),          # protect apostrophes first
]
HANGUL = re.compile(r'[\uac00-\ud7a3][\uac00-\ud7a3\s]*')

GLOSS = {
    '개역개정': 'the CT',
    '없음': 'not present',
    '예수': 'Jesus', '그리스도': 'Christ', '그리스도 예수': '“Christ Jesus”',
    '그리스도를': '“Christ”', '그리스도의': '“of Christ”',
    '그리스도 안에서': '“in Christ”', '그리스도 예수 안에서는': '“in Christ Jesus”',
    '아멘': 'Amen', '주': '“the Lord”', '주여': '“Lord”', '주께': '“to the Lord”',
    '주께서': '“the Lord”', '주 예수': '“the Lord Jesus”',
    '주 예수 그리스도': '“our Lord Jesus Christ”',
    '주 예수 그리스도의 은혜': '“the grace of our Lord Jesus Christ”',
    '주의 은혜': '“the grace of the Lord”', '주의 날': '“the day of the Lord”',
    '주의 이름': '“the name of the Lord”',
    '주의하라 깨어 있으라': '“watch and be alert”',
    '하나님': 'God', '하나님의': '“of God”', '하나님께 받아': '“from God”',
    '하나님이 부르신': '“God called”', '하나님의 뜻을 따라': '“according to the will of God”',
    '하나님을 찬양하고': '“singing to God”', '하나님으로 말미암아': '“through God”',
    '하나님의 거룩하신 자': '“the Holy One of God”',
    '요셉': 'Joseph', '요한': 'John', '게바': '“Cephas”',
    '요섹': 'Josech', '요다': 'Joda', '요아난': 'Joanan', '엘마담': 'Elmadam',
    '요남': 'Jonam', '브리스가': 'Prisca', '디도 유스도': 'Titus Justus',
    '마가단': 'Magadan', '베다니': 'Bethany', '거라사인': 'Gerasene',
    '아니요': '“Arni”', '도마야': '“Thomas”', '부로의': '“of Pyrrhus”',
    '형제들아': '“brethren”', '형제들': '“brethren”', '자매': '“sister”',
    '사랑하는 자들아': '“beloved”', '간음한 여인들아': '“adulteresses”',
    '너희': '“you”', '너를': '“you”', '자라는': '“growing”', '너희에게': '“to you”', '너희를': '“you”',
    '너희를 위하여': '“for you”', '너희를 위한': '“for you”', '너희와': '“with you”',
    '너희 심령에': '“with your spirit”', '너희 자신에게': '“to yourselves”',
    '너희여': '“you”', '너희가 알지니': '“you know”',
    '너희로 우리 사정을': '“that you may know our circumstances”',
    '우리': '“our”', '우리가': '“we”', '우리의': '“our”', '우리는': '“we”',
    '우리를': '“us”', '우리에게': '“to us”', '우리 가운데': '“among us”',
    '우리 가운데서': '“among us”', '우리 어머니': '“our mother”',
    '우리 조상': '“our fathers”', '우리의 동역자': '“our fellow labourer”',
    '우리도 그러한 줄': '“we also are such”', '우리 여신': '“our goddess”',
    '우리를 위하여': '“for us”',
    '내가': '“I”', '나와 함께': '“with me”', '그는': '“he”', '그들이': '“they”',
    '그들에게': '“to them”', '그 사람들': '“those men”', '사람들이': '“the people”',
    '사람들을': '“people”', '모든 사람이': '“all”', '두 사람': '“two men”',
    '한 사람': '“one man”', '열둘': '“twelve”', '여러분': '“you”',
    '그의 부모': '“his parents”', '그 부모': '“the parents”',
    '그의 동생의 아내': '“his brother’s wife”', '그의 나라': '“his kingdom”',
    '그의 말을 들으라': '“you shall hear him”',
    '그 모든 영광': '“all its glory”', '그 이름으로': '“in this name”',
    '그 아들이나 소': '“his son or an ox”',
    '죄': '“sin”', '의': '“righteousness”', '구제': '“almsgiving”',
    '은혜': '“grace”', '복음': '“gospel”', '복음의': '“of the gospel”',
    '기도': '“prayer”', '금식': '“fasting”', '눈물': '“tears”', '많은': '“many”',
    '이방인': '“Gentile”', '이방인들': '“the Gentiles”', '이방인의': '“of the Gentiles”',
    '선지자': '“prophet”', '대제사장들': '“chief priests”', '재판관': '“judge”',
    '천사': '“an angel”', '여신': '“goddess”', '음부': '“Hades”',
    '사망아': '“O death”', '간음': '“adultery”', '살인': '“murder”',
    '음행': '“sexual immorality”', '긍휼': '“mercy”', '권능': '“dominion”',
    '존귀': '“honour”', '경륜': '“dispensation”', '의무': '“duty”',
    '순전함': '“sincerity”', '거룩함': '“holiness”', '깨끗함': '“purity”',
    '거룩한': '“holy”', '영의': '“of the spirits”', '생명나무': '“the tree of life”',
    '마음의': '“of the heart”', '평안을': '“peace”', '만유 가운데': '“in all”',
    '먼저': '“first”', '빛의': '“of light”', '아버지': '“the Father”',
    '주 아버지': '“the Lord and Father”', '홀로 하나이신': '“who alone is”',
    '가이사': '“Caesar”', '백성을': '“the people”', '곳': '“a place”',
    '안에서': '“in”', '새': '“new”', '아내': '“wife”', '시돈': '“Sidon”',
    '지옥에': '“into hell”', '새들': '“the birds”', '공중의 새들': '“the birds of the air”',
    '들에서': '“from the fields”', '목숨': '“soul”', '이 일': '“this”',
    '이 밤에': '“this night”', '이 세대': '“this generation”',
    '이것들을': '“these things”', '받으라': '“receive”', '찬송': '“praise”',
    '거슬러 말하기를': '“speaking against”', '약속하신': '“promised”',
    '예정하신': '“appointed”', '그 종': '“your servant”',
    '그 종 예수': '“your servant Jesus”', '이스라엘의': '“of Israel”',
    '대주재여': '“O Lord”', '성령으로': '“by the Holy Spirit”',
    '성령의 능력으로': '“by the power of the Spirit”',
    '주 너희 하나님': '“the Lord your God”',
    '예수 그리스도의 이름으로': '“in the name of Jesus Christ”',
    '예수 그리스도로 말미암아': '“through Jesus Christ”',
    '예수의': '“of Jesus”', '예수를': '“Jesus”',
    '자기를 보내던 사람들': '“those who sent them”',
    '문 밖': '“outside the gate”',
    '기도할 곳이 있을까 하여': '“supposing a place of prayer”',
    '말씀에 붙잡혀': '“constrained by the word”',
    '말씀하셨으니': '“has spoken”', '옷과 같이': '“as a garment”',
    '제사장이라': '“a priest”', '자기 나라 사람': '“his countryman”',
    '첫 언약': '“the first covenant”', '갇힌 자': '“prisoners”',
    '하늘에': '“in the heavens”',
    '잉태할 수 있는 힘을 얻었으니': '“received strength to conceive”',
    '보고': '“seeing”', '환영하며': '“embracing”',
    '행함이 없는': '“without works”', '헛것': '“idle”',
    '보지 못하였으나': '“though you have not seen”',
    '구원에 이르도록': '“unto salvation”', '믿지 아니하는': '“unbelieving”',
    '겸손하며': '“humble-minded”', '열심으로': '“zealous”',
    '서로 겸손으로 허리를 동이라': '“clothe yourselves with humility”',
    '굳게 서라': '“stand firm”', '하려 하노라': '“I intend”',
    '호색하는': '“lascivious”', '불의를 당하며': '“suffering wrong”',
    '안개': '“mist”', '겨우': '“scarcely”',
    '드러나리로다': '“shall be found”', '만국': '“all nations”',
    '지금은 없으나': '“though now absent”', '무너졌으며': '“has fallen”',
    '보좌 앞': '“before the throne”', '보좌에서': '“from the throne”',
    '구원받은 자들의': '“of those who are saved”',
    '아시아': '“Asia”', '시기와 분쟁': '“envy and strife”',
    '주께서 나눠 주신': '“the Lord apportioned”',
    '불법의 사람': '“the man of lawlessness”',
    '돈을 사랑하지 아니하며': '“not greedy of money”',
    '믿는 여자': '“a believing woman”', '참된 생명': '“the true life”',
    '그리스도의 평강': '“the peace of Christ”',
    '주를 두려워하여': '“fearing the Lord”',
    '많이 수고하는': '“much labour”', '받으실 만한': '“acceptable”',
    '받았노라': '“I received”', '사랑': '“love”', '믿음': '“faith”',
    '알고도': '“knowing”', '율법': '“the law”', '행위': '“works”',
    '간직하게 하라': '“let her keep it”', '지키지': '“does not keep”',
    '지키리라': '“will keep”', '구하라': '“ask”',
    '내 떡을 먹는 자': '“he who eats my bread”',
    '조상들이 먹고도 죽은 그것': '“what your fathers ate and died”',
    '독생하신 하나님': '“the only begotten God”',
    '내 뒤에 오시는 그이라': '“he who comes after me”',
    '영생을 얻게 하려': '“that they may have eternal life”',
    '세상의 구주': '“the Saviour of the world”', '박해': '“persecution”',
    '믿는 자': '“the one who believes”', '걸인': '“beggar”',
    '인자': '“the Son of Man”', '들': '“heard”', '들은': '“heard”',
    '전에': '“before”', '진실로': '“verily”', '오시도다': '“he comes”',
    '아들도 모르고': '“neither knows the Son”',
    '택함을 받은 자': '“the chosen one”',
    '몇 가지만 하든지 혹은': '“only a few things, or”',
    '거기서 나오실 때에': '“when he departed from there”',
    '이르시되': '“he said”', '대답하지 아니할 것이니라': '“you will not answer”',
    '잘 지었기 때문에': '“because it was well built”',
    '삼 일 만에': '“after three days”', '두려워하며': '“fearing”',
    '두려워하였으나': '“they were afraid”', '행한 일': '“works done”',
    '모일': '“gathering”', '일어나 걷는지라': '“he rose and walked”',
    '옛 사람들에게': '“to those of old”', '다윗 왕은': '“David the king”',
    '왕': '“king”', '아내을': '“wife”', '이르시되': '“he said”',
    '어찌 하겠느냐': '“what shall we do”',
    '내주는 것': '“what I endure”', '친위대장': '“the captain of the guard”',
    '새번역': 'the New Korean Translation', '세례': '“Baptist”',
    '많은': '“many”', '기쁨으로': '“with joy”', '눈물': '“tears”',
    '듣고': '“hearing”',
}

TR_RE = re.compile(r'\bTR\b')
SNOTE = re.compile(r'(<span class="srnote">)(.*?)(</span>)', re.S)
DNOTE = re.compile(r'(data-note=")([^"]*)(")')


def polish(text):
    """Now that the sigla are English, drop the Korean draft's redundancy:
    the CT *is* the critical text, so "the CT follows the critical text's X"
    has to become "the CT reads X", carrying the gloss along."""
    text = re.sub(r'the CT’s (“[^”]+”) follows the critical text’s (bare )?([^;.,]+)',
                  r'the CT has \3 (\1)', text)
    text = re.sub(r'the CT’s (“[^”]+”) follows the critical text', r'the CT prints \1', text)
    text = re.sub(r'the CT follows the critical text’s (bare )?([^ ]+) with \(?(“[^”]+”)\)?',
                  r'the CT reads \1\2 (\3)', text)
    text = re.sub(r'the CT follows the critical text’s (bare )?([^;.,]+)', r'the CT reads \2', text)
    text = re.sub(r'the CT follows the critical text ', 'the CT reads ', text)
    text = re.sub(r'the CT follows the critical text\.', 'the CT follows that reading.', text)
    text = text.replace('which the CT follows from the critical text', 'which the CT renders')
    text = re.sub(r', following the critical text’s ', ', reading ', text)
    text = text.replace('critical text’s', 'CT’s').replace('from the critical text', 'from the CT')
    text = text.replace('a critical-text addition', 'an addition')
    text = text.replace('the CT&#x27;s', 'the CT’s')
    return text


def fix_note(text):
    """One explainer -> English only, with the CT/RT sigla."""
    text = text.replace('&#x27;', '’')
    text = TR_RE.sub('TR', text)
    text = text.replace('개역개정’s', 'the CT’s').replace("개역개정's", 'the CT’s')
    text = text.replace('개역개정', 'the CT')

    missing = []

    def run(m):
        raw = m.group(0)
        core = raw.strip()
        if core not in GLOSS:
            if re.search(r'[\uac00-\ud7a3]', core):
                missing.append(core)
            return raw
        lead = raw[:len(raw) - len(raw.lstrip())]
        trail = raw[len(raw.rstrip()):]
        return lead + GLOSS[core] + trail

    text = HANGUL.sub(run, text)
    return polish(text), missing


def main():
    total_missing = []

    for path, rename in [('src/content/blog/manuscript.md', True),
                         ('src/content/blog/사본.md', False)]:
        s = open(path, encoding='utf-8').read()

        if rename:
            # English post: every explainer becomes English.
            def dnote(m):
                new, miss = fix_note(m.group(2))
                total_missing.extend(miss)
                return m.group(1) + new + m.group(3)

            def snote(m):
                new, _ = fix_note(m.group(2))
                return m.group(1) + new + m.group(3)

            s = DNOTE.sub(dnote, s)
            s = SNOTE.sub(snote, s)
            s = s.replace('CR vs TR', 'CT vs RT')
            # Reading-order switch: RT first, as the table is set.
            s = s.replace('data-a="CT" data-b="TR"', 'data-a="CT" data-b="TR"')
            s = s.replace('<span class="sw-a">TR</span>', '<span class="sw-a">TR</span>')
            s = s.replace('<span class="lg cr">Critical Text</span>',
                          '<span class="lg cr">Critical Text (CT)</span>')
            s = s.replace('<span class="lg tr">Received Text (NKJV)</span>',
                          '<span class="lg tr">Textus Receptus (TR) · NKJV</span>')
        else:
            # Korean post keeps its Korean, keeps the CT/RT sigla.
            s = s.replace('CR vs TR', 'CT vs RT')
            s = s.replace('TR', 'RT')
            s = s.replace('<span class="lg cr">개역개정</span>',
                          '<span class="lg cr">개역개정 (CT)</span>')
            s = s.replace('<span class="lg tr">공인본문 (RT)</span>',
                          '<span class="lg tr">공인본문 (RT)</span>')
            s = s.replace('<span class="lg tr">공인본문</span>',
                          '<span class="lg tr">공인본문 (RT)</span>')

        open(path, 'w', encoding='utf-8').write(s)
        print('rewrote', path)

    if total_missing:
        from collections import Counter
        print('\nUNTRANSLATED RUNS:')
        for k, v in Counter(total_missing).most_common():
            print('  %s (%d)' % (k, v))
    else:
        print('\nall Korean glosses translated')


main()
