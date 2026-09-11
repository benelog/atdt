// 모뎀(명령 상태) · BBS "갈무리 보관소" · 도스 흉내. term.js 위에서 돈다.
(function () {
  "use strict";

  const ESC = "\x1b", BEL = "\x07", CRLF = "\r\n";
  const T = window.Term;
  const { fit, strWidth, cw } = T;
  const D = window.ATDT_DATA;
  const POSTS = D.posts, BOARDS = D.boards;
  const byId = new Map(POSTS.map((p) => [p.id, p]));

  const INPUT = ESC + "]I" + BEL; // 여기서부터 한 줄 입력
  const KEY = ESC + "]K" + BEL; // 글쇠 하나 기다림
  const CLS = ESC + "[2J";
  const EOL = "\r" + ESC + "[K";
  const sgr = (...n) => ESC + "[" + n.join(";") + "m";
  const lk = (cmd, text) => ESC + "]L;" + cmd + BEL + text + ESC + "]L" + BEL;
  const HR = " " + "─".repeat(39);

  function postLines(p) {
    return p._lines || (p._lines = p.text.split("\n"));
  }
  function lineCount(p) {
    return postLines(p).length;
  }
  function rowsOf(line) {
    let cx = 0, rows = 1;
    for (const ch of line) {
      const w = cw(ch);
      if (cx + w > 80) {
        rows++;
        cx = 0;
      }
      cx += w;
    }
    return rows;
  }
  function eucBytes(text) {
    // 완성형으로 저장했을 때의 크기. 줄마다 CRLF 2 바이트.
    let n = 0;
    for (const line of text.split("\n")) n += strWidth(line) + 2;
    return n;
  }
  function capDate(p) {
    return p.date ? p.date.slice(2).replace(/-/g, "/") : "-";
  }
  function hms(ms) {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }
  function digitsOf(s) {
    return String(s).replace(/[^0-9*#]/g, "");
  }

  // ---------------------------------------------------------------- 전화번호부
  const PHONEBOOK = [
    { name: "갈무리 보관소", number: "555-1996", speed: "19200-N-8-1", memo: "7", star: true, result: "CONNECT" },
    { name: "HiTEL 전국 어디서나", number: "01410", speed: "19200-N-8-1", memo: "7", result: "NO CARRIER" },
    { name: "천리안", number: "01421", speed: "14400-N-8-1", memo: "7", result: "BUSY" },
    { name: "나우누리", number: "01433", speed: "14400-N-8-1", memo: "7", result: "NO CARRIER" },
  ];

  // ---------------------------------------------------------------- 소리
  const DTMF = {
    1: [697, 1209], 2: [697, 1336], 3: [697, 1477],
    4: [770, 1209], 5: [770, 1336], 6: [770, 1477],
    7: [852, 1209], 8: [852, 1336], 9: [852, 1477],
    "*": [941, 1209], 0: [941, 1336], "#": [941, 1477],
  };
  const HANDSHAKE_SECONDS = 7.5;

  class Sound {
    constructor() {
      this.ctx = null;
      this.nodes = [];
    }
    ensure() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) {
          try {
            this.ctx = new AC();
          } catch (e) {
            this.ctx = null;
          }
        }
      }
      if (this.ctx && this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
      return this.ctx;
    }
    tone(freqs, t0, dur, vol) {
      const ctx = this.ctx;
      const g = ctx.createGain();
      const start = ctx.currentTime + t0;
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(vol, start + 0.01);
      g.gain.setValueAtTime(vol, start + dur - 0.01);
      g.gain.linearRampToValueAtTime(0, start + dur);
      g.connect(ctx.destination);
      for (const f of freqs) {
        const o = ctx.createOscillator();
        o.type = "sine";
        o.frequency.value = f;
        o.connect(g);
        o.start(start);
        o.stop(start + dur);
        this.nodes.push(o);
      }
    }
    noise(t0, dur, vol, swell = false) {
      const ctx = this.ctx;
      const start = ctx.currentTime + t0;
      const n = Math.floor(ctx.sampleRate * dur);
      const buf = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = buf.getChannelData(0);
      // 녹음에서 들리는 거친 데이터음과 가는 금속성 울림을 신호 합성으로 흉내 낸다.
      // 4단계 I/Q 심벌을 반송파에 얹고, 심벌 사이를 부드럽게 이어 거친 클릭을 줄인다.
      const levels = [-1, -1 / 3, 1 / 3, 1];
      const symbol = () => levels[Math.floor(Math.random() * levels.length)];
      let prevI = 0, prevQ = 0, nextI = symbol(), nextQ = symbol(), phase = 0;
      for (let i = 0; i < n; i++) {
        const t = i / ctx.sampleRate, progress = i / n;
        phase += 2400 / ctx.sampleRate;
        if (phase >= 1) {
          phase -= 1;
          prevI = nextI; prevQ = nextQ;
          nextI = symbol(); nextQ = symbol();
        }
        const blend = (1 - Math.cos(Math.PI * phase)) / 2;
        const inPhase = prevI + (nextI - prevI) * blend;
        const quadrature = prevQ + (nextQ - prevQ) * blend;
        const carrier = 2 * Math.PI * 1800 * t;
        const data = (inPhase * Math.cos(carrier) - quadrature * Math.sin(carrier)) / 2;
        const hiss = Math.random() * 2 - 1;
        // 초반의 떨리는 훈련음 → 넓은 잡음 → 잠깐의 재조정 → 안정된 데이터음.
        const training = Math.max(0, 1 - progress / 0.22);
        const retrain = Math.max(0, 1 - Math.abs(progress - 0.68) / 0.04);
        const probe = (Math.sin(2 * Math.PI * 1200 * t) + Math.sin(2 * Math.PI * 2400 * t)) / 2;
        const flutter = 0.96 + 0.04 * Math.sin(2 * Math.PI * 45 * t);
        const envelope = Math.min(1, t / 0.008, (dur - t) / 0.025);
        const air = swell ? 0.22 + 0.24 * progress : 0.43;
        d[i] = (0.5 * data + air * hiss + (0.12 * training + 0.05 * retrain) * probe) * flutter * envelope;
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      // 전화선처럼 저음/초고음을 덜어내고, 녹음의 밝고 거친 중고역을 살린다.
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 400;
      hp.Q.value = 0.7;
      const presence = ctx.createBiquadFilter();
      presence.type = "peaking";
      presence.frequency.value = 2600;
      presence.Q.value = 0.8;
      presence.gain.value = 4;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 3600;
      lp.Q.value = 0.7;
      const g = ctx.createGain();
      g.gain.value = vol;
      if (swell) {
        // 2초 동안 고역과 음량이 함께 열리며 '쏴' 하고 커진다.
        lp.frequency.setValueAtTime(1800, start);
        lp.frequency.linearRampToValueAtTime(3600, start + dur);
        g.gain.setValueAtTime(vol * 0.45, start);
        g.gain.linearRampToValueAtTime(vol, start + dur - 0.025);
      }
      src.connect(hp);
      hp.connect(presence);
      presence.connect(lp);
      lp.connect(g);
      g.connect(ctx.destination);
      src.start(start);
      src.stop(start + dur);
      this.nodes.push(src);
    }
    beep() {
      if (!this.ensure()) return;
      this.tone([880], 0, 0.08, 0.05);
    }
    stop() {
      for (const n of this.nodes) {
        try {
          n.stop();
        } catch (e) {}
      }
      this.nodes = [];
    }
  }

  // ---------------------------------------------------------------- 모뎀
  class Modem {
    constructor(term, opts) {
      this.term = term;
      this.opts = opts || {};
      this.state = "cmd"; // cmd | dialing | online
      this.sound = new Sound();
      this.bbs = new BBS(term, this);
      this.dialTimer = 0;
      this.hangTimer = 0;
    }
    get bps() {
      return this.opts.bps ? this.opts.bps() : 19200;
    }
    soundOn() {
      return this.opts.soundOn ? this.opts.soundOn() : true;
    }
    send(s) {
      this.term.send(s);
    }
    ready() {
      this.send(INPUT);
    }
    init(done) {
      this.send("ATZ" + CRLF);
      setTimeout(() => {
        this.send("OK" + CRLF);
        this.ready();
        if (done) setTimeout(done, 500);
      }, 400);
    }

    line(text) {
      if (this.state === "online") return this.bbs.line(text);
      if (this.state === "dialing") return;
      const t = text.trim().toUpperCase();
      if (!t) return this.ready();
      if (!t.startsWith("AT")) {
        this.send("ERROR" + CRLF);
        return this.ready();
      }
      const cmd = t.slice(2).replace(/\s+/g, "");
      const m = /^D[TP]?([0-9*#,;-]+)/.exec(cmd);
      if (m) return this.dial(m[1], true);
      if (cmd === "" || cmd === "Z" || cmd === "Z0" || /^&[FW]/.test(cmd) || /^[EMLVQXSHB][0-9]*$/.test(cmd)) {
        this.send("OK" + CRLF);
      } else if (/^I[0-9]?$/.test(cmd)) {
        this.send("이야기 5.3 웹 모뎀 (재현물)  V.34 28800bps" + CRLF + "OK" + CRLF);
      } else {
        this.send("ERROR" + CRLF);
      }
      this.ready();
    }

    key(k) {
      if (this.state === "online") return this.bbs.key(k);
      if (this.state === "dialing") return this.cancelDial();
    }

    dial(number, typed) {
      if (this.state !== "cmd") return;
      this.sound.stop();
      const digits = digitsOf(number);
      const entry = PHONEBOOK.find((e) => digitsOf(e.number) === digits) || null;
      if (!typed) this.send("ATDT " + digits + CRLF);
      this.state = "dialing";
      this.term.inputPos = null;
      if (this.opts.onDial) this.opts.onDial(entry);

      // 발신·협상·통화중/응답없음의 합성음 시간표.
      const plan = [];
      let t = 0.3;
      plan.push(["tone", [350, 440], t, 0.7]);
      t += 0.8;
      for (const d of digits) {
        if (DTMF[d]) plan.push(["tone", DTMF[d], t, 0.12]);
        t += 0.18;
      }
      t += 0.4;
      const result = entry ? entry.result : "NO CARRIER";
      if (result === "CONNECT") {
        // 짧은 '띠' → 장2도 높은 '디~' → 잠깐의 간격 → '쏴~'.
        const answerHz = 2100;
        plan.push(["tone", [answerHz], t, 0.65]);
        t += 0.75;
        plan.push(["tone", [answerHz * 2 ** (2 / 12)], t, 1.15]);
        t += 1.58; // 긴 음 뒤 0.43초 쉬고 잡음을 시작한다.
        plan.push(["noise", t, 2, true]);
        t = HANDSHAKE_SECONDS;
      } else if (result === "BUSY") {
        for (let i = 0; i < 3; i++) {
          plan.push(["tone", [480, 620], t, 0.5]);
          t += 1.0;
        }
      } else {
        for (let i = 0; i < 2; i++) {
          plan.push(["tone", [440, 480], t, 1.0]);
          t += 2.5;
        }
        t -= 1.0;
      }
      if (this.soundOn() && this.sound.ensure()) {
        for (const p of plan) {
          if (p[0] === "tone") this.sound.tone(p[1], p[2], p[3], 0.05);
          else this.sound.noise(p[1], p[2], p[3] ? 0.1 : 0.08, !!p[3]);
        }
      }
      this.dialTimer = setTimeout(() => this.finishDial(result, entry), t * 1000);
    }

    finishDial(result, entry) {
      if (this.state !== "dialing") return;
      clearTimeout(this.dialTimer);
      this.dialTimer = 0;
      this.sound.stop();
      if (result === "CONNECT") {
        this.state = "online";
        this.send("CONNECT " + this.bps + "/ARQ/V42BIS" + CRLF);
        if (this.opts.onConnect) this.opts.onConnect(entry);
        this.bbs.enter();
      } else {
        this.state = "cmd";
        this.send(result + CRLF);
        this.ready();
        if (this.opts.onDialFail) this.opts.onDialFail(result);
      }
    }

    // 주소(#49 등)로 바로 들어올 때: 전화 거는 과정 없이 곧장 접속한 것으로 한다.
    connectDirect(entry, route) {
      if (this.state !== "cmd") return false;
      this.state = "online";
      this.term.inputPos = null;
      this.send("ATDT " + digitsOf(entry.number) + CRLF + "CONNECT " + this.bps + "/ARQ/V42BIS" + CRLF);
      if (this.opts.onConnect) this.opts.onConnect(entry);
      this.bbs.reset();
      this.bbs.startedAt = Date.now();
      if (!this.bbs.goto(route)) this.bbs.mainMenu();
      return true;
    }

    cancelDial() {
      if (this.state !== "dialing") return;
      clearTimeout(this.dialTimer);
      this.dialTimer = 0;
      this.sound.stop();
      this.state = "cmd";
      this.send("NO CARRIER" + CRLF);
      this.ready();
      if (this.opts.onDialFail) this.opts.onDialFail("NO CARRIER");
    }

    // 사용자가 끊는다 (^F9, ATH). 남은 출력은 버린다.
    hangup() {
      if (this.state === "dialing") return this.cancelDial();
      if (this.state !== "online") return false;
      clearTimeout(this.hangTimer);
      this.term.queue = "";
      this.dropLine();
      return true;
    }
    // BBS 쪽에서 끊는다 (X). 남은 출력이 다 찍힌 뒤에 NO CARRIER.
    disconnectLater(ms) {
      clearTimeout(this.hangTimer);
      this.hangTimer = setTimeout(() => this.dropLine(), ms);
    }
    dropLine() {
      this.hangTimer = 0;
      if (this.state !== "online") return;
      this.bbs.leave();
      this.state = "cmd";
      this.send(CRLF + "NO CARRIER" + CRLF);
      this.ready();
      if (this.opts.onDisconnect) this.opts.onDisconnect();
    }
  }

  // ---------------------------------------------------------------- BBS
  const BIG = {
    A: [".###.", "#...#", "#####", "#...#", "#...#"],
    T: ["#####", "..#..", "..#..", "..#..", "..#.."],
    D: ["####.", "#...#", "#...#", "#...#", "####."],
  };
  function bigText(word) {
    const rows = [];
    for (let r = 0; r < 5; r++) {
      let line = "";
      for (const ch of word) line += BIG[ch][r].replace(/#/g, "■").replace(/\./g, "  ") + "  ";
      rows.push(line.replace(/\s+$/, ""));
    }
    return rows;
  }
  function center(s) {
    const pad = Math.max(0, Math.floor((80 - strWidth(s)) / 2));
    return " ".repeat(pad) + s;
  }
  const PER_PAGE = 20;

  class BBS {
    constructor(term, modem) {
      this.term = term;
      this.modem = modem;
      this.reset();
    }
    reset() {
      this.ctx = "menu"; // menu | list | read | bye
      this.wait = null; // banner | page | search
      this.list = null; // { ids, title, page }
      this.current = null; // { p, lines, idx, pages }
      this.reads = 0;
      this.startedAt = 0;
    }
    send(s) {
      this.term.send(s);
    }
    prompt() {
      return " 번호/명령(P,N,L,T,S,H,X) >> " + INPUT;
    }
    // 주소창의 # 뒤: 글은 갈무리 파일 이름("WHI" = WHI.CAP, 번호 "47" 도 됨), 게시판은 "b7",
    // 전체 목록은 "all", 주 메뉴는 "". 글 번호는 글을 지우면 밀리므로 나눠 줄 주소는 파일 이름을 쓴다.
    static routeOf(p) {
      return p.cap.replace(/\.CAP$/i, "");
    }
    route(h) {
      if (this.modem.opts.onRoute) this.modem.opts.onRoute(h);
    }
    static parseRoute(h) {
      h = String(h || "").replace(/^#/, "").trim();
      if (!h) return { kind: "menu" };
      if (h === "all") return { kind: "all" };
      let m = /^b(\d+)$/i.exec(h);
      if (m && BOARDS[m[1] - 1]) return { kind: "board", i: m[1] - 1 };
      m = /^(\d+)$/.exec(h);
      if (m && byId.has(+m[1])) return { kind: "post", id: +m[1] };
      const key = h.replace(/\.CAP$/i, "").toUpperCase();
      const p = POSTS.find((x) => BBS.routeOf(x) === key);
      if (p) return { kind: "post", id: p.id };
      return null;
    }
    // 주소가 가리키는 곳으로 간다. 모르는 주소면 false.
    goto(h) {
      const r = BBS.parseRoute(h);
      if (!r) return false;
      this.wait = null;
      this.term.keyMode = false;
      if (r.kind === "post") {
        const p = byId.get(r.id);
        if (!this.list || !this.list.ids.includes(r.id)) {
          const b = BOARDS[p.board];
          this.list = { ids: b.posts.slice(), title: b.name, page: Math.floor(b.posts.indexOf(r.id) / PER_PAGE) };
        }
        this.read(r.id);
      } else if (r.kind === "board") this.board(r.i);
      else if (r.kind === "all") this.allList();
      else this.mainMenu();
      return true;
    }

    enter() {
      this.reset();
      this.startedAt = Date.now();
      let s = CLS + CRLF;
      for (const r of bigText("ATDT")) s += " ".repeat(17) + sgr(1, 33) + r + sgr(0) + CRLF;
      s += CRLF + center("갈 무 리   보 관 소") + CRLF;
      s += center("─".repeat(20)) + CRLF + CRLF;
      s += center(`1994 ~ 1997 년 PC통신에서 갈무리해 둔 글 ${POSTS.length} 편을 모아 두었습니다.`) + CRLF;
      s += center("하이텔 · 천리안 · 나우누리 게시판에 올라왔던 글들입니다.") + CRLF + CRLF;
      s += center(sgr(1, 32) + "손님(GUEST)으로 들어오셨습니다. 로그인은 필요 없습니다." + sgr(0)) + CRLF + CRLF;
      s += center("이 화면은 옛 통신 프로그램 '이야기 5.3'을 본떠 새로 만든 재현물입니다.") + CRLF;
      s += center("화면의 밝은 글자는 다람쥐(마우스)로 눌러도 됩니다.") + CRLF + CRLF + CRLF;
      s += center(sgr(7) + lk("ENTER", " 아무 글쇠나 누르십시오 ") + sgr(0)) + KEY;
      this.wait = "banner";
      this.send(s);
    }

    leave() {
      this.wait = null;
      this.ctx = "bye";
      this.term.keyMode = false;
      this.route("");
    }

    mainMenu() {
      this.ctx = "menu";
      this.list = null;
      this.current = null;
      let s = CLS;
      s += " ┌" + "─".repeat(37) + "┐" + CRLF;
      const title = "갈 무 리   보 관 소   주 메 뉴";
      const padL = Math.floor((74 - strWidth(title)) / 2);
      s += " │" + sgr(1, 33) + fit(" ".repeat(padL) + title, 74) + sgr(0) + "│" + CRLF;
      s += " └" + "─".repeat(37) + "┘" + CRLF + CRLF;
      const item = (i) => {
        const b = BOARDS[i];
        return lk(String(i + 1), fit(` ${i + 1}. ${b.name} (${b.posts.length})`, 34));
      };
      for (let i = 0; i < 4; i++) s += "   " + item(i) + "   " + item(i + 4) + CRLF;
      s += CRLF + "   " + lk("9", ` 9. 전체 글 목록 (${POSTS.length} 편)`) + CRLF + CRLF;
      s += "   " + lk("H", " H 도움말 ") + "    " + lk("S", " S 낱말 : 찾기 ") + "    " + lk("X", " X 접속 끝 ") + CRLF + CRLF;
      s += " 게시판 번호를 치거나, 글 번호(1 ~ " + POSTS.length + ")를 바로 쳐도 됩니다." + CRLF + CRLF;
      s += this.prompt();
      this.send(s);
      this.route("");
    }

    showList(ids, title, page) {
      const pages = Math.max(1, Math.ceil(ids.length / PER_PAGE));
      page = Math.max(0, Math.min(pages - 1, page || 0));
      this.ctx = "list";
      this.current = null;
      this.list = { ids, title, page };
      let s = CLS;
      s += " " + sgr(1, 36) + title + sgr(0) + `   (${page + 1}/${pages} 쪽, 모두 ${ids.length} 편)` + CRLF;
      s += " 번호  " + fit("제  목", 44) + " " + fit("올린이", 10) + " " + fit("올린날", 8) + "  줄수" + CRLF;
      s += HR + CRLF;
      const slice = ids.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);
      for (const id of slice) {
        const p = byId.get(id);
        const row = ` ${fit(String(p.id), 3, true)}  ${fit(p.title, 44)} ${fit(p.author || "-", 10)} ${fit(p.posted || "-", 8)} ${fit(String(lineCount(p)), 5, true)}`;
        s += lk(String(p.id), row) + CRLF;
      }
      for (let i = slice.length; i < PER_PAGE; i++) s += CRLF;
      s += CRLF + " ";
      s += (page + 1 < pages ? lk("N", "다음쪽 [N]") : "다음쪽 [N]") + "  ";
      s += (page > 0 ? lk("P", "이전쪽 [P]") : "이전쪽 [P]") + "  ";
      s += lk("T", "처음 [T]") + "  " + lk("S", "찾기 [S]") + "  " + lk("H", "도움말 [H]") + "  " + lk("X", "접속 끝 [X]") + CRLF;
      s += this.prompt();
      this.send(s);
    }

    backToList() {
      if (this.list) this.showList(this.list.ids, this.list.title, this.list.page);
      else this.mainMenu();
    }

    board(i) {
      const b = BOARDS[i];
      this.showList(b.posts.slice(), b.name, 0);
      this.route("b" + (i + 1));
    }
    allList() {
      this.showList(POSTS.map((p) => p.id), "전체 글 목록", 0);
      this.route("all");
    }

    search(word) {
      const w = word.toLowerCase();
      const ids = POSTS.filter((p) => p.title.toLowerCase().includes(w) || p.text.toLowerCase().includes(w)).map((p) => p.id);
      if (!ids.length) {
        this.send(CRLF + ` '${word}' 이(가) 들어 있는 글이 없습니다.` + CRLF + CRLF + this.prompt());
        return;
      }
      this.showList(ids, `'${word}' 찾기 결과`, 0);
    }

    // 원문 머리에 게시물 정보(제목·올린이·날짜)가 남아 있는 글(p.hs 있음)은 그 머리글을 그대로 보여 주고,
    // 없는 글만 여기서 머리글을 만든다.
    header(p) {
      if (p.hs != null) return "";
      return (
        sgr(1, 36) + ` [${p.id}] 제목 : ${p.title}` + sgr(0) + CRLF +
        ` 올린이 : ${fit(p.author || "-", 8)}  ${fit(p.posted || "-", 8)}  갈무리 : ${capDate(p)}  파일 : ${p.cap}  ${lineCount(p)} 줄` + CRLF +
        HR + CRLF
      );
    }

    read(id) {
      const p = byId.get(id);
      if (!p) {
        this.send(CRLF + ` ${id} 번 글은 없습니다. (1 ~ ${POSTS.length})` + CRLF + CRLF + this.prompt());
        return;
      }
      this.ctx = "read";
      this.current = { p, lines: postLines(p), idx: 0, pages: [0] };
      this.reads++;
      this.printPage(true);
      this.route(BBS.routeOf(p));
    }

    // fresh: 화면을 지우고 새로 찍는다 (첫 쪽이면 머리글도). 아니면 프롬프트 줄에 이어서 찍는다.
    printPage(fresh) {
      const c = this.current;
      let s = "";
      let room;
      if (fresh) {
        s += CLS;
        if (c.idx === 0) {
          s += this.header(c.p);
          room = c.p.hs != null ? 28 : 25;
        } else room = 28;
      } else room = 28;
      while (c.idx < c.lines.length) {
        const line = c.lines[c.idx];
        const r = rowsOf(line);
        if (r > room) break;
        const inHead = c.p.hs != null && c.idx >= c.p.hs && c.idx < c.p.he;
        s += (inHead ? sgr(1, 36) + line + sgr(0) : line) + CRLF;
        room -= r;
        c.idx++;
      }
      if (c.idx >= c.lines.length) {
        s += this.endPrompt();
        this.wait = null;
      } else {
        const pct = Math.floor((c.idx * 100) / c.lines.length);
        s += sgr(7) + " ## " + lk("ENTER", "계속 [Enter]") + "  " + lk("B", "이전 [B]") + "  " + lk("L", "목록 [L]") + "  " + lk("Q", "그만 [Q]") + ` ## (${pct}%) ` + sgr(0) + KEY;
        this.wait = "page";
      }
      this.send(s);
    }

    nextId() {
      const c = this.current;
      if (!c) return null;
      if (this.list) {
        const i = this.list.ids.indexOf(c.p.id);
        return i >= 0 && i + 1 < this.list.ids.length ? this.list.ids[i + 1] : null;
      }
      return byId.has(c.p.id + 1) ? c.p.id + 1 : null;
    }

    endPrompt() {
      const nid = this.nextId();
      let s = CRLF + sgr(1) + " ## 글 끝 ## " + sgr(0) + "  ";
      if (nid) s += lk("N", "다음글 [N]") + "  ";
      s += lk("B", "이전쪽 [B]") + "  " + lk("L", "목록 [L]") + "  " + lk("T", "처음 [T]") + CRLF;
      const p = this.current.p;
      s += " 이 글을 파일로 받으려면 PgDn 을 누르십시오." + (p.hs != null ? `  (${p.cap}, ${capDate(p)} 갈무리, ${lineCount(p)} 줄)` : "") + CRLF;
      const url = this.modem.opts.postUrl ? this.modem.opts.postUrl(BBS.routeOf(p)) : "";
      if (url) s += " 이 글의 주소 : " + sgr(1, 32) + url + sgr(0) + CRLF;
      return s + this.prompt();
    }

    key(k) {
      const term = this.term;
      term.keyMode = false;
      if (this.wait === "banner") {
        this.wait = null;
        this.mainMenu();
        return;
      }
      if (this.wait === "page") {
        const c = this.current;
        const u = k.length === 1 ? k.toUpperCase() : k;
        if (u === "ENTER" || u === "Enter" || u === " " || u === "N" || u === "ArrowDown" || u === "PageDown") {
          this.wait = null;
          c.pages.push(c.idx);
          this.send(EOL);
          this.printPage(false);
        } else if (u === "B" || u === "P" || u === "ArrowUp" || u === "PageUp") {
          this.wait = null;
          if (c.pages.length > 1) c.pages.pop();
          c.idx = c.pages[c.pages.length - 1];
          this.printPage(true);
        } else if (u === "L") {
          this.wait = null;
          this.send(EOL);
          this.backToList();
        } else if (u === "T") {
          this.wait = null;
          this.mainMenu();
        } else if (u === "Q" || u === "Escape" || u === "X") {
          this.wait = null;
          this.send(EOL + CRLF + " 읽기를 그만둡니다." + CRLF + CRLF + this.prompt());
        } else {
          term.keyMode = true;
        }
        return;
      }
    }

    line(text) {
      const raw = text.trim();
      if (this.wait === "search") {
        this.wait = null;
        if (raw) this.search(raw);
        else this.send(this.prompt());
        return;
      }
      const sp = raw.indexOf(" ");
      const cmd = (sp < 0 ? raw : raw.slice(0, sp)).toUpperCase();
      const arg = sp < 0 ? "" : raw.slice(sp + 1).trim();

      if (!raw) {
        if (this.ctx === "list" && this.list.page + 1 < Math.ceil(this.list.ids.length / PER_PAGE)) return this.showList(this.list.ids, this.list.title, this.list.page + 1);
        return this.send(this.prompt());
      }
      if (/^\d+$/.test(cmd)) {
        const n = parseInt(cmd, 10);
        if (this.ctx === "menu" && n >= 1 && n <= 8) return this.board(n - 1);
        if (this.ctx === "menu" && n === 9) return this.allList();
        return this.read(n);
      }
      switch (cmd) {
        case "N":
          if (this.current) {
            const nid = this.nextId();
            if (nid) return this.read(nid);
            return this.send(" 다음 글이 없습니다." + CRLF + this.prompt());
          }
          if (this.list) return this.showList(this.list.ids, this.list.title, this.list.page + 1);
          return this.allList();
        case "P":
          if (this.list) return this.showList(this.list.ids, this.list.title, this.list.page - 1);
          return this.send(this.prompt());
        case "B":
          if (this.current) {
            const c = this.current;
            if (c.pages.length > 1) c.pages.pop();
            c.idx = c.pages[c.pages.length - 1];
            return this.printPage(true);
          }
          return this.backToList();
        case "L":
        case "LIST":
          return this.backToList();
        case "T":
        case "TOP":
        case "M":
        case "MENU":
          return this.mainMenu();
        case "A":
        case "ALL":
          return this.allList();
        case "S":
        case "F":
        case "찾기":
        case "SEARCH":
          if (arg) return this.search(arg);
          this.wait = "search";
          return this.send(" 찾을 낱말은 ? " + INPUT);
        case "H":
        case "?":
        case "HELP":
        case "도움말":
          return this.help();
        case "X":
        case "BYE":
        case "EXIT":
        case "G":
        case "Q":
        case "QUIT":
        case "OFF":
          return this.bye();
        case "AT":
        case "ATZ":
        case "ATH":
          return this.send(" 지금은 접속 중입니다. 끊으려면 X 를 치십시오." + CRLF + this.prompt());
      }
      this.send(` '${raw}' 은(는) 모르는 명령입니다. H 를 치면 도움말이 나옵니다.` + CRLF + this.prompt());
    }

    help() {
      const L = [
        "",
        sgr(1, 36) + " ┌ 갈무리 보관소 명령 ┐" + sgr(0),
        "   번호      : 그 번호의 글을 읽습니다. (글 번호는 1 ~ " + POSTS.length + ")",
        "   1 ~ 8     : 주 메뉴에서 게시판을 고릅니다.      9 : 전체 목록",
        "   N, P      : 다음 쪽 / 이전 쪽.  글을 읽은 뒤에는 N 이 다음 글입니다.",
        "   L         : 목록으로            T : 처음 메뉴로",
        "   S 낱말    : 제목과 본문에서 낱말을 찾습니다.  (보기: S 오토마타)",
        "   H, ?      : 이 도움말           X : 접속 끝",
        "",
        "   글을 읽는 중에 쪽이 끝나면 [Enter] 계속, [B] 이전 쪽, [L] 목록, [Q] 그만.",
        "   글을 읽는 중에 PgDn 을 누르면 그 글을 파일로 내려받습니다.",
        "   글마다 주소가 있습니다. 글을 읽을 때 주소창에 붙는 #이름(보기: #WHI)을 나눠 주십시오.",
        "   출력이 느리면 Enter 나 Space 를 눌러 나머지를 한꺼번에 찍을 수 있습니다.",
        "",
      ];
      this.send(L.join(CRLF) + CRLF + this.prompt());
    }

    bye() {
      this.ctx = "bye";
      this.wait = null;
      const t = hms(Date.now() - this.startedAt);
      let s = CRLF + " 갈무리 보관소를 찾아 주셔서 고맙습니다." + CRLF;
      s += ` 접속 시간 : ${t}    읽은 글 : ${this.reads} 편` + CRLF;
      s += " 안녕히 가십시오." + CRLF;
      this.send(s);
      this.modem.disconnectLater(1200);
    }
  }

  // ---------------------------------------------------------------- 도스
  const NOTICE = [
    "갈무리 보관소 - 이야기 5.3 화면 재현물",
    "",
    "이 화면은 큰사람의 PC통신 프로그램 '이야기 5.3'(1992)의 모습을",
    "본떠 HTML/CSS/SVG 로 새로 만든 재현물입니다. 큰사람과는 관계가 없으며,",
    "원본 프로그램의 실행 파일, 글꼴, 그림은 쓰지 않았습니다.",
    "",
    "글꼴 : Neo둥근모 (SIL Open Font License 1.1)",
    "글   : 1994 ~ 1997 년 PC통신에서 갈무리한 글 " + POSTS.length + " 편",
    "",
    "이야기를 시작하려면 I 를 치십시오.",
  ];

  function dosDate(iso) {
    // 1995-03-08 → 03-08-95
    if (!iso) return "09-11-96";
    return iso.slice(5, 7) + "-" + iso.slice(8, 10) + "-" + iso.slice(2, 4);
  }
  function dosTime(seed) {
    const h = 8 + (seed % 12), m = (seed * 7) % 60;
    return `${String(h > 12 ? h - 12 : h).padStart(2)}:${String(m).padStart(2, "0")}${h >= 12 ? "p" : "a"}`;
  }
  function globToRe(pat) {
    return new RegExp("^" + pat.toUpperCase().replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
  }

  class Dos {
    constructor(term, opts) {
      this.term = term;
      this.opts = opts || {};
      this.cwd = "C:\\I";
      this.waitKey = null;
    }
    files() {
      if (this._files) return this._files;
      const list = [
        { name: "I.EXE", size: 214528, date: "1992-08-15", seed: 3, bin: true },
        { name: "I.HLP", size: 28469, date: "1992-08-15", seed: 4, bin: true },
        { name: "I.BAT", lines: ["@I"], date: "1996-09-11", seed: 5 },
        { name: "I.CNF", size: 2048, date: "1996-09-11", seed: 6, bin: true },
        { name: "README.1ST", lines: NOTICE, date: "1996-09-11", seed: 7 },
      ];
      for (const p of POSTS) list.push({ name: p.cap, post: p, date: p.date, seed: p.id });
      for (const f of list) {
        if (f.lines) f.size = eucBytes(f.lines.join("\n"));
        else if (f.post) f.size = eucBytes(f.post.text);
      }
      this._files = list;
      return list;
    }
    find(name) {
      const u = name.toUpperCase().replace(/^C:\\I\\|^\\I\\|^C:/, "");
      return this.files().find((f) => f.name === u) || null;
    }
    write(s) {
      this.term.write(s);
    }
    prompt() {
      this.write(CRLF + this.cwd + ">" + INPUT);
    }
    start(msg) {
      this.term.clear();
      if (msg) this.write(msg + CRLF);
      this.prompt();
    }
    key(k) {
      const f = this.waitKey;
      if (!f) return;
      this.waitKey = null;
      this.term.keyMode = false;
      f(k);
    }
    // 여러 줄을 찍는다. page 면 화면이 찰 때마다 -- More -- 로 멈춘다.
    out(lines, page, done) {
      const term = this.term;
      const per = term.rows - 1;
      let i = 0;
      const step = () => {
        const chunk = lines.slice(i, i + per);
        i += chunk.length;
        if (chunk.length) term.write(chunk.join(CRLF) + CRLF);
        if (page && i < lines.length) {
          term.write("-- More --" + KEY);
          this.waitKey = (k) => {
            term.write(EOL);
            if (k === "Escape" || k === "q" || k === "Q" || k === "\x03") done();
            else step();
          };
        } else done();
      };
      step();
    }
    line(text) {
      this.run(text, () => this.prompt());
    }
    run(text, done) {
      const t = text.trim();
      if (!t) return done();
      let page = false, cmdline = t;
      const m = /^(.*?)\s*\|\s*MORE\s*$/i.exec(t);
      if (m) {
        page = true;
        cmdline = m[1];
      }
      let parts = cmdline.split(/\s+/);
      const cmd = parts[0].toUpperCase();
      let args = parts.slice(1).filter((a) => {
        if (/^\/P$/i.test(a)) {
          page = true;
          return false;
        }
        return true;
      });
      const out = (lines) => this.out(lines, page, done);
      switch (cmd) {
        case "DIR":
          return out(this.dir(args[0]));
        case "TYPE": {
          if (!args[0]) return out(["Required parameter missing"]);
          const f = this.find(args[0]);
          if (!f) return out(["File not found - " + args[0].toUpperCase()]);
          if (f.bin) return out(["MZ▒▒  ▒▒ ▒▒▒▒  ▒ ▒▒   ▒▒▒▒ ▒▒  This program requires DOS.  ▒▒ ▒▒▒▒"]);
          return out((f.lines || postLines(f.post)).slice());
        }
        case "CLS":
          this.term.clear();
          return done();
        case "VER":
          return out(["", "갈무리 DOS Version 5.3 (이야기 5.3 웹 재현물)"]);
        case "CD":
        case "CHDIR":
          if (!args[0] || args[0] === ".") return out([this.cwd]);
          if (/^(\\I|C:\\I|\\I\\|I)$/i.test(args[0]) || (args[0] === ".." && this.cwd === "C:\\")) {
            this.cwd = "C:\\I";
            return done();
          }
          if (/^(\\|C:\\|\.\.)$/i.test(args[0])) {
            this.cwd = "C:\\";
            return done();
          }
          return out(["Invalid directory"]);
        case "CD\\":
        case "CD..":
          this.cwd = "C:\\";
          return done();
        case "C:":
          return done();
        case "ECHO":
          return out([args.join(" ") || "ECHO is on"]);
        case "DATE": {
          const d = new Date();
          const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
          return out([`Current date is ${days[d.getDay()]} ${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}-${d.getFullYear()}`]);
        }
        case "TIME": {
          const d = new Date();
          return out([`Current time is ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}.00`]);
        }
        case "MEM":
          return out(["", "Memory Type        Total       Used       Free", "----------------  --------   --------   --------", "Conventional          640K       381K       259K", "", "Total under 1 MB      640K       381K       259K"]);
        case "EXIT":
          return this.opts.onExit ? this.opts.onExit("exit") : done();
        case "I":
        case "II":
        case "I.EXE":
        case "I.BAT":
          if (this.cwd !== "C:\\I") return out(["Bad command or file name"]);
          return this.opts.onExit ? this.opts.onExit("i") : done();
        case "HELP":
        case "?":
          return out([
            "",
            "DIR [파일] [/P]   파일 목록        TYPE 파일 [| MORE]   파일 내용 보기",
            "CLS               화면 지움        VER                   판 번호",
            "CD, DATE, TIME, ECHO, MEM         도스 명령 흉내",
            "I                 이야기 시작      EXIT                  이야기로 돌아감 (나들이였을 때)",
            "",
            "여기는 웹으로 다시 만든 도스 화면입니다. 파일을 만들거나 지울 수는 없습니다.",
          ]);
        case "COPY":
        case "DEL":
        case "ERASE":
        case "REN":
        case "MD":
        case "MKDIR":
        case "RD":
        case "DELTREE":
        case "FORMAT":
        case "EDIT":
        case "MOVE":
          return out(["Access denied"]);
      }
      return out(["Bad command or file name"]);
    }
    dir(pattern) {
      const re = pattern ? globToRe(pattern.toUpperCase().replace(/^C:\\I\\|^\\I\\/, "")) : null;
      const files = this.files().filter((f) => !re || re.test(f.name));
      const L = [" Volume in drive C is ATDT", " Volume Serial Number is 1996-0911", " Directory of " + this.cwd, ""];
      if (this.cwd !== "C:\\I") {
        L.push("I            <DIR>     08-15-92   5:30p");
        L.push("        0 file(s)          0 bytes", "               12582912 bytes free");
        return L;
      }
      let total = 0;
      for (const f of files) {
        const [n, e] = f.name.split(".");
        L.push(`${fit(n, 8)} ${fit(e || "", 3)} ${String(f.size).padStart(10)} ${dosDate(f.date)}  ${dosTime(f.seed)}`);
        total += f.size;
      }
      if (!files.length) L.push("File not found");
      else L.push(`${String(files.length).padStart(9)} file(s) ${String(total).padStart(10)} bytes`, `${" ".repeat(19)}12582912 bytes free`);
      return L;
    }
  }

  window.Host = { Modem, BBS, Dos, Sound, PHONEBOOK, NOTICE, eucBytes, postLines, lineCount, rowsOf, INPUT, KEY };
})();
