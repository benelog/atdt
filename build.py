"""posts/*.txt 갈무리 글을 읽어 js/posts.js 를 만든다.

    python3 build.py

글을 더하거나 고친 뒤 다시 실행하면 된다. 외부 패키지는 쓰지 않는다.

파일 이름 규칙
- 갈무리 원문 머리에 게시물 정보(제목·올린이·날짜)가 남아 있는 글은 그 제목이 곧 파일 이름이다.
  build.py 가 머리글을 읽어 파일 이름과 맞는지 검사하고, 다르면 고칠 이름을 알려 준다.
  파일 이름에 못 쓰는 글자(/ : ? " < > | * \\)는 전각 글자로 바꾸고, 잇단 공백은 하나로 줄인다.
- 머리글이 없는 글은 파일 이름이 그대로 제목이다.
- 화면에서는 머리글을 원문 그대로 보여 준다. 하이텔식 `[번호] 제목 :` 의 번호만 이 보관소의 글 번호로 바꾼다.
"""
import json
import re
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "posts"
OUT = ROOT / "js" / "posts.js"

EXCLUDE = {
    "연세대 수험번호 성명 명단",
}

BOARDS = [
    ('컴퓨터 프로그래밍 강좌', [
        '오토마타란 무엇인가 ？',
        '한글 입력 오토마타의 작성',
        '[강좌] 한글 입력 알고리즘 #1',
        '[강좌] 한글 입력 알고리즘 #2',
        '[강좌] 한글 입력 알고리즘 #3',
        '[강좌] 한글 입출력 안 깨지게!',
        '[강좌] 한글 입출력 안 깨지게!(2)',
        '[강좌] 한글 입출력 안 깨지게!(3)',
        '[강좌] 한글 풀그림 강좌 #1',
        '[강좌] 한글 풀그림 강좌 #2',
        '[강좌] 한글 풀그림 강좌 #3',
        '[강좌] 한글 풀그림 강좌 #4',
        '[강좌] 비디오메모리제어강좌 #1',
        '[강좌] 비디오메모리제어강좌 #2',
        '[강좌] 비디오메모리제어강좌 #3',
        '[소스] 스크롤 예제 #1 - 비디오메모리제어',
        '퀵베이직 인터럽트 딜레이 함수 팁',
        '[소스] 통신 소스,강좌 #1',
        '[소스] 통신 소스,강좌 #2',
        '[강좌] DEBUG에 대해서.. (1)',
        '[강좌] DEBUG에 대해서... (2)',
        '[강좌] DEBUG에 대해서... (3)',
        '[강좌] DEBUG에 대해서... (4)',
        '[9503](1)32비트 보호 모드 프로그래밍',
        '[9503](2) 32비트 보호 모드 프로그래밍',
        '[9503](3) 32비트 보호 모드 프로그래밍',
        '[9503](4) 32비트 보호 모드 프로그래밍',
        '[9503](5) 32비트 보호 모드 프로그래밍',
        '[9503](6) 32비트 보호 모드 프로그래밍',
        '[소스] PC-SPEAKER VOICE DRIVER',
        '[강좌] 소브강좌 1회',
    ]),
    ('윈도우95 · 인터넷', [
        '[강좌] WINDOWS 95의 부트체제......',
        '[특집 I-3] (1)윈도우 95의 메모리 관리',
        '[특집 I-3] (2)윈도우 95의 메모리 관리',
        '[참고] 윈95에서 도스창에서 오락하기',
        '[PPP 사용법 2] 윈95 전화접속네트워킹 설치 및 사용법',
    ]),
    ('음악 이야기', [
        '[정보]015B 21세기 모노리스 교신 부분',
        '[M.O.S 기획]6월8일 경향신문기사',
        '[정보] 이승환 scream !!',
        '[뮤직파일] 015B편',
        '표절 운운에 대한 답',
        '표절 운운에 대한 답 2',
        '사탄주의 음악에 대한 신해철씨의 글',
        '[뉴에이지]기독교인은 보지 마시오!!',
        '8215는 뉴에이지에 대해 제대로아세요..',
        '메탈이 악마음악이면 레개도 악마음악이객',
    ]),
    ('만화 · 애니메이션', [
        '아다찌 미쯔루..',
        'H2와 아다치...( 독후감 ？？？)',
        '[감상]아다치의 H2...영화와 만화.',
        '[감상] Touch를 다시 보고...',
        '아다찌와 전영소녀에 대한 비평',
        '나디아의 재방을 위한 우리의 외침이...',
        '[평론] 나디아-역사의 정리와 또다른 시작',
        '타이의 대모험 제 306화',
        '타이의 대모험 307화 줄거리',
        '타이의 대모험 제 308화',
    ]),
    ('유머 · 창작 소설', [
        '겜마록 게임유머 소설',
        'ZINUS 게임유머 단편모음',
        '[앙쥐판] 알퐁스도테의 =별= 안보면후회.',
        '[羅刹] H.O.T 죽이기 大작전 Ver 2.0 ＜Comic Version＞',
        '[특선 단편] 안개 끼이던 그 날...',
        '내 가장 무서웠던 기억....',
    ]),
    ('입시 · 학교', [
        '누가 분포도 400 ~ 312 점까지의 인간들 헤헤',
        '누가 분포도 311.7 ~ 1빵빵 점(？) 까지',
        '대입 특차 배치표',
        '대학입시／ ＂주관식 겁낼 것 없습니다＂',
        '연세대 97학년도 모집요강',
        '[기계공학부] Vs [전자공학부] 다른점..',
    ]),
    ('사는 이야기', [
        '[위스키]With Pakistani',
        '완전초보자를 위한 Korea Times 읽기 특강 ： 제목읽기 - 1',
        '완전초보자를 위한 Korea Times 읽기 특강 ： 제목읽기 - 2',
        '완전초보자를 위한 Korea Times 읽기 특강 ： 제목읽기 - 3',
        '백구 2차대회 대구 포항이어 부산상륙 4일간 열전에',
    ]),
    ('아스키 아트', [
        '포카혼타스 아스키아트',
        '[귀염이] ## 소녀의 얼굴 두번째입니다. ##',
        '남자얼굴....',
        '아스키아트 그림',
        '특수문자 아스키아트 도안',
    ]),
]

CAPS = {
    '8215는 뉴에이지에 대해 제대로아세요..': ('NEW.CAP', '1995-10-04'),
    'H2와 아다치...( 독후감 ？？？)': ('AD.CAP', '1996-02-19'),
    'ZINUS 게임유머 단편모음': ('SHORTSTO.CAP', '1994-02-18'),
    '[9503](1)32비트 보호 모드 프로그래밍': ('POT.CAP', '1995-06-10'),
    '[9503](2) 32비트 보호 모드 프로그래밍': ('POT-2.CAP', '1995-06-10'),
    '[9503](3) 32비트 보호 모드 프로그래밍': ('POT-3.CAP', '1995-06-10'),
    '[9503](4) 32비트 보호 모드 프로그래밍': ('POT-4.CAP', '1995-06-10'),
    '[9503](5) 32비트 보호 모드 프로그래밍': ('POT-5.CAP', '1995-06-10'),
    '[9503](6) 32비트 보호 모드 프로그래밍': ('POT-6.CAP', '1995-06-10'),
    '[M.O.S 기획]6월8일 경향신문기사': ('I0728.CAP', '1996-07-29'),
    '[PPP 사용법 2] 윈95 전화접속네트워킹 설치 및 사용법': ('WIF.CAP', '1997-01-22'),
    '[羅刹] H.O.T 죽이기 大작전 Ver 2.0 ＜Comic Version＞': ('HOT.CAP', '1997-01-31'),
    '[감상] Touch를 다시 보고...': ('TOUCH11.CAP', '1996-12-11'),
    '[감상]아다치의 H2...영화와 만화.': ('HH2.CAP', '1996-12-11'),
    '[강좌] DEBUG에 대해서.. (1)': ('DEBUG.CAP', '1995-03-08'),
    '[강좌] DEBUG에 대해서... (2)': ('DEBUG-2.CAP', '1995-03-08'),
    '[강좌] DEBUG에 대해서... (3)': ('DEBUG-3.CAP', '1995-03-08'),
    '[강좌] DEBUG에 대해서... (4)': ('DEBUG-4.CAP', '1995-03-08'),
    '[강좌] WINDOWS 95의 부트체제......': ('BOOT.CAP', '1997-01-16'),
    '[강좌] 비디오메모리제어강좌 #1': ('MEMO.CAP', '1995-07-30'),
    '[강좌] 비디오메모리제어강좌 #2': ('MEMO-2.CAP', '1995-07-30'),
    '[강좌] 비디오메모리제어강좌 #3': ('MEMO-3.CAP', '1995-07-30'),
    '[강좌] 소브강좌 1회': ('SOB.CAP', '1995-01-22'),
    '[강좌] 한글 입력 알고리즘 #1': ('HANA.CAP', '1995-03-01'),
    '[강좌] 한글 입력 알고리즘 #2': ('HANA-2.CAP', '1995-03-01'),
    '[강좌] 한글 입력 알고리즘 #3': ('HANA-3.CAP', '1995-03-01'),
    '[강좌] 한글 입출력 안 깨지게!': ('HANNO.CAP', '1995-03-05'),
    '[강좌] 한글 입출력 안 깨지게!(2)': ('HANNO-2.CAP', '1995-03-05'),
    '[강좌] 한글 입출력 안 깨지게!(3)': ('HANNO-3.CAP', '1995-03-05'),
    '[강좌] 한글 풀그림 강좌 #1': ('HAN2.CAP', '1995-03-01'),
    '[강좌] 한글 풀그림 강좌 #2': ('HAN2-2.CAP', '1995-03-01'),
    '[강좌] 한글 풀그림 강좌 #3': ('HAN2-3.CAP', '1995-03-01'),
    '[강좌] 한글 풀그림 강좌 #4': ('HAN2-4.CAP', '1995-03-01'),
    '[귀염이] ## 소녀의 얼굴 두번째입니다. ##': ('P3.CAP', '1995-08-27'),
    '[기계공학부] Vs [전자공학부] 다른점..': ('MECA2.CAP', '1997-01-15'),
    '[뉴에이지]기독교인은 보지 마시오!!': ('NEWAGE.CAP', '1994-11-06'),
    '[뮤직파일] 015B편': ('I0831.CAP', '1996-08-31'),
    '[소스] PC-SPEAKER VOICE DRIVER': ('PSP.CAP', '1995-05-28'),
    '[소스] 스크롤 예제 #1 - 비디오메모리제어': ('MEMO-4.CAP', '1995-07-30'),
    '[소스] 통신 소스,강좌 #1': ('COMM.CAP', '1995-03-01'),
    '[소스] 통신 소스,강좌 #2': ('COMM-2.CAP', '1995-03-01'),
    '[앙쥐판] 알퐁스도테의 =별= 안보면후회.': ('I0806.CAP', '1996-08-07'),
    '[위스키]With Pakistani': ('WHI.CAP', '1997-02-06'),
    '[정보] 이승환 scream !!': ('I0728-2.CAP', '1996-07-29'),
    '[정보]015B 21세기 모노리스 교신 부분': ('015B.CAP', '1996-06-13'),
    '[참고] 윈95에서 도스창에서 오락하기': ('WINDOS.CAP', '1997-01-16'),
    '[특선 단편] 안개 끼이던 그 날...': ('DAN.CAP', '1994-08-21'),
    '[특집 I-3] (1)윈도우 95의 메모리 관리': ('WIM.CAP', '1997-02-28'),
    '[특집 I-3] (2)윈도우 95의 메모리 관리': ('WIM-2.CAP', '1997-02-28'),
    '[평론] 나디아-역사의 정리와 또다른 시작': ('NADIA.CAP', '1995-08-23'),
    '겜마록 게임유머 소설': ('GAMMAROK.CAP', '1994-02-18'),
    '나디아의 재방을 위한 우리의 외침이...': ('NAIDA.CAP', '1995-08-16'),
    '남자얼굴....': ('P2.CAP', '1995-08-27'),
    '내 가장 무서웠던 기억....': ('HORRI.CAP', '1994-08-21'),
    '누가 분포도 311.7 ~ 1빵빵 점(？) 까지': ('LIST.CAP', '1996-12-07'),
    '누가 분포도 400 ~ 312 점까지의 인간들 헤헤': ('LIST2.CAP', '1996-12-07'),
    '대입 특차 배치표': ('TT.CAP', '1996-12-07'),
    '대학입시／ ＂주관식 겁낼 것 없습니다＂': ('I0816.CAP', '1996-08-17'),
    '메탈이 악마음악이면 레개도 악마음악이객': ('RAE.CAP', '1995-10-04'),
    '백구 2차대회 대구 포항이어 부산상륙 4일간 열전에': ('IL.CAP', '1997-01-23'),
    '사탄주의 음악에 대한 신해철씨의 글': ('I0730.CAP', '1995-07-31'),
    '아다찌 미쯔루..': ('RO.CAP', '1996-02-19'),
    '아다찌와 전영소녀에 대한 비평': ('RO2.CAP', '1996-02-19'),
    '아스키아트 그림': ('I0827.CAP', '1995-09-17'),
    '연세대 97학년도 모집요강': ('YUNSEI.CAP', '1996-12-07'),
    '오토마타란 무엇인가 ？': ('AUTO.CAP', '1995-03-08'),
    '완전초보자를 위한 Korea Times 읽기 특강 ： 제목읽기 - 1': ('TIME1.CAP', '1996-03-18'),
    '완전초보자를 위한 Korea Times 읽기 특강 ： 제목읽기 - 2': ('TIME1-2.CAP', '1996-03-18'),
    '완전초보자를 위한 Korea Times 읽기 특강 ： 제목읽기 - 3': ('TIME1-3.CAP', '1996-03-18'),
    '퀵베이직 인터럽트 딜레이 함수 팁': ('TI.CAP', '1995-05-21'),
    '타이의 대모험 307화 줄거리': ('I0506.CAP', '1996-05-07'),
    '타이의 대모험 제 306화': ('TIE-1.CAP', '1996-05-07'),
    '타이의 대모험 제 308화': ('TIE.CAP', '1996-05-07'),
    '특수문자 아스키아트 도안': ('P4.CAP', '1995-09-17'),
    '포카혼타스 아스키아트': ('P.CAP', '1996-06-16'),
    '표절 운운에 대한 답': ('I1009.CAP', '1994-10-10'),
    '표절 운운에 대한 답 2': ('I1009-2.CAP', '1994-10-10'),
    '한글 입력 오토마타의 작성': ('AUTO2.CAP', '1995-03-08'),
}

# ---------------------------------------------------------------- 머리글 읽기
RE_DASH = re.compile(r"^\s*-{10,}\s*$")
RE_HITEL = re.compile(r"^\s*\[\s*\d+\]\s*제\s*목\s*:\s*(.+?)\s*$")
RE_TITLE = re.compile(r"^\s*제\s*목\s*:\s*(.+?)\s*$")
RE_WRITER = re.compile(r"(올린이|보낸이)\s*:\s*([^\s(]+)\s*\(\s*([^)]*?)\s*\)\s*(\d\d/\d\d(?:/\d\d)?)?")
RE_POSTED = re.compile(r"올린시각\s*:\s*(\d\d/\d\d/\d\d)")
RE_NEWS = re.compile(r"뉴스제공시각\s*:\s*(\d\d/\d\d)\s+\d\d:\d\d(?:\s+출처\s*:\s*(.+?))?\s*$")
RE_SENDER = re.compile(r"송신일:\s*(\d+):(\d+):(\d+)\s+송신인:\s*([^\s\[]+)")
RE_HANA_TITLE = re.compile(r"제\s*목\s*:\s*(.+?)\s*$")
RE_NAME_ID = re.compile(r"^\s*(\S+)\s+\(\s*([^)\s]+)\s*\)\s*$")
RE_LINE_HEAD = re.compile(r"^\s*(.*?)\s+(\d\d/\d\d) \d\d:\d\d\s+\d+ line\s*$")

FNAME_MAP = str.maketrans({"/": "／", "\\": "＼", ":": "：", "*": "＊", "?": "？", '"': "＂", "<": "＜", ">": "＞", "|": "｜"})

def to_stem(title):
    """제목을 파일 이름(확장자 없이)으로."""
    return re.sub(r"\s+", " ", title).strip().translate(FNAME_MAP)

def width(s):
    """도스 한글 화면에서의 칸 수 (완성형 바이트 수와 같다)."""
    return sum(1 if ord(c) < 0x80 else 2 for c in s)

def parse_head(lines):
    """원문 머리의 게시물 정보. 없으면 None.

    돌려주는 것: kind, title, author(아이디), posted(yy/mm/dd 또는 mm/dd), hs, he(머리글 줄 범위, he 는 끝 다음)
    """
    n = min(len(lines), 8)

    def nxt(i):
        i += 1
        while i < len(lines) and not lines[i].strip():
            i += 1
        return i if i < len(lines) else None

    def span(hs, he):
        if hs > 0 and RE_DASH.match(lines[hs - 1]):
            hs -= 1
        if he < len(lines) and RE_DASH.match(lines[he]):
            he += 1
        return hs, he

    for i in range(n):
        line = lines[i]
        j = nxt(i)
        if j is None:
            break
        # 하이텔: [330] 제목 : ... / 올린이 : whisky00(이소영  )  96/08/06 02:08  읽음 : 21
        m = RE_HITEL.match(line)
        if m:
            w = RE_WRITER.search(lines[j])
            p = RE_POSTED.search(lines[j])
            if w:
                author, posted = (w.group(2) if w.group(1) == "올린이" else w.group(3)), w.group(4) or ""
            elif p:
                author, posted = "", p.group(1)
            else:
                continue
            hs, he = span(i, j + 1)
            return dict(kind="hitel", title=m.group(1), author=author, posted=posted, hs=hs, he=he, numline=i)
        # 뉴스: 뉴스제공시각 : 01/22 14:09  출처 : 스포츠서울 / 제목 : ...
        m = RE_NEWS.search(line)
        if m and RE_TITLE.match(lines[j]):
            hs, he = span(i, j + 1)
            return dict(kind="news", title=RE_TITLE.match(lines[j]).group(1), author=(m.group(2) or "").strip(),
                        posted=m.group(1), hs=hs, he=he)
        # 천리안: 제목 : ... / #23931/26143  보낸이:정철주  (jcj713  )    03/03 14:5
        m = RE_TITLE.match(line)
        if m and RE_WRITER.search(lines[j]):
            w = RE_WRITER.search(lines[j])
            author = w.group(2) if w.group(1) == "올린이" else w.group(3)
            hs, he = span(i, j + 1)
            return dict(kind="chollian", title=m.group(1), author=author, posted=w.group(4) or "", hs=hs, he=he)
        # 하나로: 번 호: 1381/1390 송신일: 96:7:13  송신인: hana72[김일광] / 읽 기: [14 ]  제 목: ...
        m = RE_SENDER.search(line)
        if m and RE_HANA_TITLE.search(lines[j]):
            y, mo, d = (int(x) for x in m.group(1, 2, 3))
            hs, he = span(i, j + 1)
            return dict(kind="hana", title=RE_HANA_TITLE.search(lines[j]).group(1), author=m.group(4),
                        posted=f"{y:02d}/{mo:02d}/{d:02d}", hs=hs, he=he)
        # 나우누리·천리안 목록식: 이소영   (whisky00) / 제목   08/06 02:08   21 line
        m = RE_NAME_ID.match(line)
        if m and RE_LINE_HEAD.match(lines[j]):
            m2 = RE_LINE_HEAD.match(lines[j])
            hs, he = span(i, j + 1)
            return dict(kind="nownuri", title=m2.group(1), author=m.group(2), posted=m2.group(2), hs=hs, he=he)
    return None

def full_date(posted, cap_date):
    """월/일만 있으면 갈무리한 해를 붙인다. 갈무리한 날보다 뒤면 그 전 해의 글이다."""
    if len(posted) == 5 and cap_date:
        year = int(cap_date[:4])
        if posted > cap_date[5:].replace("-", "/"):
            year -= 1
        posted = f"{year % 100:02d}/{posted}"
    return posted

def load(stem):
    text = (SRC / f"{stem}.txt").read_text(encoding="utf-8")
    text = unicodedata.normalize("NFC", text).replace("\r\n", "\n").replace("\r", "\n")
    lines = [line.rstrip() for line in text.split("\n")]
    while lines and not lines[-1]:
        lines.pop()
    return lines

def main():
    listed = [n for _, names in BOARDS for n in names]
    files = {unicodedata.normalize("NFC", p.stem) for p in SRC.glob("*.txt")}
    missing = sorted(files - set(listed) - EXCLUDE)
    if missing:
        raise SystemExit(f"게시판이 정해지지 않은 글: {missing}")
    gone = sorted(set(listed) - files)
    if gone:
        raise SystemExit(f"파일이 없는 글: {gone}")

    boards, posts, renames = [], [], []
    for b, (board_name, names) in enumerate(BOARDS):
        ids = []
        for stem in names:
            cap, cap_date = CAPS.get(stem, (None, ""))
            lines = load(stem)
            head = parse_head(lines)
            pid = len(posts) + 1
            if not cap:
                cap = f"ATDT{pid:04d}.CAP"
            post = {"id": pid, "board": b, "title": stem, "cap": cap, "date": cap_date, "author": "", "posted": ""}
            if head:
                if to_stem(head["title"]) != stem:
                    renames.append((stem, to_stem(head["title"])))
                post.update(title=head["title"], author=head["author"], posted=full_date(head["posted"], cap_date),
                            hs=head["hs"], he=head["he"])
                if head["kind"] == "hitel":
                    k = head["numline"]
                    lines[k] = re.sub(r"\[\s*\d+\]", f"[{pid}]", lines[k], count=1)
            post["text"] = "\n".join(lines)
            posts.append(post)
            ids.append(pid)
        boards.append({"name": board_name, "posts": ids})
    caps = [p["cap"] for p in posts]
    dup = sorted({c for c in caps if caps.count(c) > 1})
    if dup:
        raise SystemExit(f"갈무리 파일 이름이 겹침(글 주소로 쓰므로 달라야 함): {dup}")
    if renames:
        for old, new in renames:
            print(f"파일 이름이 머리글 제목과 다름: {old!r} → {new!r}")
        raise SystemExit("posts/ 의 파일 이름과 build.py 의 BOARDS, CAPS 를 위 제목으로 맞춘 뒤 다시 실행")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    body = json.dumps({"boards": boards, "posts": posts}, ensure_ascii=False, separators=(",", ":"))
    OUT.write_text(
        "// build.py 가 만든 파일. 직접 고치지 말 것.\nwindow.ATDT_DATA = " + body + ";\n",
        encoding="utf-8",
    )
    wide = [(p["title"], max(map(width, p["text"].split("\n")))) for p in posts]
    wide = [w for w in wide if w[1] > 80]
    withhead = sum(1 for p in posts if "hs" in p)
    print(f"{len(posts)}편(머리글 있는 글 {withhead}편), 게시판 {len(boards)}개 → {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024}KB)")
    if wide:
        print("80칸을 넘는 줄이 있는 글:", wide)

if __name__ == "__main__":
    main()
