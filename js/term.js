/*
 * 도스 한글 터미널 흉내.
 *  - 한 칸은 8x16 점. 영문(ASCII)은 1칸, 한글·특수문자·한자는 2칸 (완성형 바이트 수와 같다).
 *  - 색은 EGA 16색. 16 = 기본 글자색, 17 = 기본 바탕색 (색깔 바꿈으로 CSS 변수만 바꾼다).
 *  - ESC[..m / ESC[2J / ESC[H / ESC[K 와 몇 가지 사설 신호를 알아듣는다.
 *      ESC ] L ; 명령 BEL   여기부터 다람쥐로 누를 수 있는 곳 (명령을 보냄)
 *      ESC ] L BEL          누를 수 있는 곳 끝
 *      ESC ] I BEL          여기서부터 입력을 받는다
 *      ESC ] K BEL          글쇠 하나를 기다린다 (계속/그만 따위)
 */
(function () {
  "use strict";

  const DEF_FG = 16, DEF_BG = 17;
  const ATTR_DEFAULT = DEF_FG | (DEF_BG << 5);
  const HISTORY_MAX = 600; // 챙긴글: 대략 20 화면

  function cw(ch) {
    return ch.charCodeAt(0) < 0x80 ? 1 : 2;
  }

  function strWidth(s) {
    let w = 0;
    for (const ch of s) w += cw(ch);
    return w;
  }

  // 표시 폭 w 에 맞춰 자르고 모자라면 공백으로 채운다
  function fit(s, w, right) {
    let out = "", n = 0;
    for (const ch of s) {
      const c = cw(ch);
      if (n + c > w) break;
      out += ch;
      n += c;
    }
    const pad = " ".repeat(w - n);
    return right ? pad + out : out + pad;
  }

  // 글꼴(Neo둥근모)에서 폭이 도스와 다른 글자는 16점 상자에 따로 넣어 그린다
  function isBoxed(code) {
    if (code < 0x80) return false;
    if (code >= 0xac00 && code <= 0xd7a3) return false; // 한글 음절
    if (code >= 0x3131 && code <= 0x318e) return false; // 한글 자모
    return true;
  }
  function isLine(code) {
    return code >= 0x2500 && code <= 0x257f;
  }

  const ESC_HTML = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
  function esc(s) {
    return s.replace(/[&<>"]/g, (c) => ESC_HTML[c]);
  }

  // ---- 한글 종류가 맞지 않을 때: 완성형 바이트를 조합형으로 읽어 깨뜨린다 ----
  let eucMap = null;
  function buildEucMap() {
    eucMap = new Map();
    let dec;
    try {
      dec = new TextDecoder("euc-kr");
    } catch (e) {
      return;
    }
    const buf = new Uint8Array(2);
    for (let a = 0xa1; a <= 0xfe; a++) {
      for (let b = 0xa1; b <= 0xfe; b++) {
        buf[0] = a;
        buf[1] = b;
        const s = dec.decode(buf);
        if (s.length === 1 && s !== "�") eucMap.set(s, (a << 8) | b);
      }
    }
  }
  const J_CHO = [-1, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1];
  const J_JUNG = [-1, -1, -1, 0, 1, 2, 3, 4, -1, -1, 5, 6, 7, 8, 9, 10, -1, -1, 11, 12, 13, 14, 15, 16, -1, -1, 17, 18, 19, 20, -1, -1];
  const J_JONG = [-1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, -1, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, -1, -1];
  const garbleCache = new Map();
  function garble(ch) {
    let g = garbleCache.get(ch);
    if (g) return g;
    if (!eucMap) buildEucMap();
    const code = eucMap.get(ch);
    g = "▒";
    if (code) {
      const b1 = code >> 8, b2 = code & 0xff;
      if (b1 >= 0x84 && b1 <= 0xd3) {
        const cho = J_CHO[(b1 >> 2) & 31], jung = J_JUNG[((b1 & 3) << 3) | (b2 >> 5)], jong = J_JONG[b2 & 31];
        if (cho >= 0 && jung >= 0 && jong >= 0) g = String.fromCharCode(0xac00 + (cho * 21 + jung) * 28 + jong);
      }
    }
    garbleCache.set(ch, g);
    return g;
  }

  function blankRow(cols, attr) {
    return { ch: new Array(cols).fill(" "), at: new Uint16Array(cols).fill(attr), links: null };
  }

  class Terminal {
    constructor(el, opts) {
      opts = opts || {};
      this.el = el;
      this.cols = opts.cols || 80;
      this.rows = opts.rows || 29;
      this.history = opts.history === false ? null : [];
      this.lines = [];
      for (let i = 0; i < this.rows; i++) this.lines.push(blankRow(this.cols, ATTR_DEFAULT));
      this.cx = 0;
      this.cy = 0;
      this.fg = DEF_FG;
      this.bg = DEF_BG;
      this.bright = false;
      this.reverse = false;
      this.link = null; // 지금 쓰고 있는 누를 곳 {c0, cmd}
      this.queue = "";
      this.bps = 19200;
      this.viewOffset = 0; // 챙긴글 보기: 위로 올린 줄 수
      this.garble = false;
      this.inputPos = null; // 입력 받을 곳 {row, col}
      this.inputText = "";
      this.keyMode = false;
      this.capture = null; // 갈무리 중이면 함수
      this.onMarker = null;
      this.cursorVisible = true;

      this.rowEls = [];
      el.textContent = "";
      for (let i = 0; i < this.rows; i++) {
        const r = document.createElement("div");
        r.className = "row";
        el.appendChild(r);
        this.rowEls.push(r);
      }
      this.cursorEl = document.createElement("div");
      this.cursorEl.className = "cursor";
      el.appendChild(this.cursorEl);
      this.dirty = new Set();
      this.allDirty = true;
      this.rafId = 0;
      this.lastPump = 0;
      this.scheduleRender();
    }

    // ---------------- 출력 ----------------

    // 모뎀으로 들어오는 글: 선로 속도에 맞춰 조금씩 찍는다
    send(str) {
      this.queue += str;
      this.schedulePump();
    }

    get busy() {
      return this.queue.length > 0;
    }

    // 남은 글을 한꺼번에 찍는다
    flush() {
      if (!this.queue) return;
      const q = this.queue;
      this.queue = "";
      this.write(q);
    }

    schedulePump() {
      if (this.pumping) return;
      this.pumping = true;
      this.lastPump = performance.now();
      const step = (now) => {
        if (!this.queue) {
          this.pumping = false;
          this.budget = 0;
          return;
        }
        // 8-N-1 이면 한 바이트에 10 비트
        const dt = Math.min(1000, now - this.lastPump);
        this.lastPump = now;
        this.budget = (this.budget || 0) + (this.bps / 10) * (dt / 1000);
        let take = 0, bytes = 0;
        const q = this.queue;
        while (take < q.length && bytes < this.budget) {
          if (q.charCodeAt(take) === 0x1b) {
            take = this.escEnd(q, take);
            continue;
          }
          bytes += cw(q[take]);
          take++;
        }
        this.budget -= bytes;
        if (take > 0) {
          this.queue = q.slice(take);
          this.write(q.slice(0, take));
        }
        // rAF 는 탭이 가려지면 멈추므로 타이머로 돌린다. 그리기는 render() 가 rAF 로 한다.
        setTimeout(() => step(performance.now()), 30);
      };
      setTimeout(() => step(performance.now()), 0);
    }

    // ESC 로 시작하는 신호가 끝나는 곳
    escEnd(s, i) {
      if (s[i + 1] === "[") {
        let j = i + 2;
        while (j < s.length && !/[A-Za-z]/.test(s[j])) j++;
        return j + 1;
      }
      if (s[i + 1] === "]") {
        const j = s.indexOf("\x07", i);
        return j < 0 ? s.length : j + 1;
      }
      return i + 2;
    }

    write(s) {
      for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        const code = ch.charCodeAt(0);
        if (code === 0x1b) {
          const end = this.escEnd(s, i);
          this.doEscape(s.slice(i, end));
          i = end - 1;
        } else if (ch === "\n") {
          this.newline();
        } else if (ch === "\r") {
          this.endLink();
          this.cx = 0;
        } else if (ch === "\b") {
          if (this.cx > 0) this.cx--;
        } else if (ch === "\x07") {
          // 삑
        } else if (code >= 0x20) {
          this.putChar(ch);
        }
      }
      this.scheduleRender();
    }

    get attr() {
      let fg = this.fg, bg = this.bg;
      if (this.bright && fg < 8) fg += 8;
      // 16, 17 도 색 번호처럼 맞바꾸면 된다 (CSS 에서 f17 은 바탕색 글씨, b16 은 글자색 바탕)
      return this.reverse ? bg | (fg << 5) : fg | (bg << 5);
    }

    putChar(ch) {
      const w = cw(ch);
      if (this.cx + w > this.cols) this.newline();
      const row = this.lines[this.cy];
      const a = this.attr;
      // 2칸 글자의 반쪽을 덮어쓰면 나머지 반쪽은 지운다
      if (row.ch[this.cx] === null && this.cx > 0) row.ch[this.cx - 1] = " ";
      row.ch[this.cx] = ch;
      row.at[this.cx] = a;
      if (w === 2) {
        row.ch[this.cx + 1] = null;
        row.at[this.cx + 1] = a;
      } else if (this.cx + 1 < this.cols && row.ch[this.cx + 1] === null) {
        row.ch[this.cx + 1] = " ";
      }
      this.cx += w;
      this.dirty.add(this.cy);
      if (this.capture) this.capture(ch);
    }

    newline() {
      this.endLink();
      if (this.capture) this.capture("\n");
      this.cx = 0;
      this.cy++;
      if (this.cy >= this.rows) {
        this.scrollUp();
        this.cy = this.rows - 1;
      }
    }

    scrollUp() {
      const top = this.lines.shift();
      if (this.history) {
        this.history.push(top);
        if (this.history.length > HISTORY_MAX) this.history.shift();
      }
      this.lines.push(blankRow(this.cols, ATTR_DEFAULT));
      if (this.inputPos) this.inputPos.row--;
      this.allDirty = true;
    }

    clear() {
      // 지워지는 화면도 챙긴글에 남긴다
      if (this.history) {
        let last = this.rows - 1;
        while (last >= 0 && this.rowText(this.lines[last]).trim() === "") last--;
        for (let i = 0; i <= last; i++) this.history.push(this.lines[i]);
        while (this.history.length > HISTORY_MAX) this.history.shift();
      }
      for (let i = 0; i < this.rows; i++) this.lines[i] = blankRow(this.cols, this.attr);
      this.cx = 0;
      this.cy = 0;
      this.allDirty = true;
    }

    clearHistory() {
      if (this.history) this.history.length = 0;
      this.viewOffset = 0;
      this.allDirty = true;
      this.scheduleRender();
    }

    eraseToEol() {
      const row = this.lines[this.cy];
      if (row.ch[this.cx] === null && this.cx > 0) row.ch[this.cx - 1] = " ";
      for (let c = this.cx; c < this.cols; c++) {
        row.ch[c] = " ";
        row.at[c] = this.attr;
      }
      if (row.links) {
        row.links = row.links.filter((l) => l.c1 <= this.cx);
        if (!row.links.length) row.links = null;
      }
      this.dirty.add(this.cy);
    }

    doEscape(seq) {
      if (seq[1] === "]") {
        const body = seq.slice(2, -1);
        const kind = body[0];
        if (kind === "L") {
          this.endLink();
          if (body.length > 1) this.link = { row: this.cy, c0: this.cx, cmd: body.slice(2) };
        } else if (kind === "I") {
          this.inputPos = { row: this.cy, col: this.cx };
          this.keyMode = false;
          this.drawInput();
        } else if (kind === "K") {
          this.inputPos = null;
          this.keyMode = true;
        }
        if (this.onMarker) this.onMarker(kind, body);
        return;
      }
      if (seq[1] !== "[") return;
      const cmd = seq[seq.length - 1];
      const args = seq.slice(2, -1).split(";").map((n) => (n === "" ? 0 : parseInt(n, 10)));
      if (cmd === "m") {
        for (const n of args) {
          if (n === 0) {
            this.fg = DEF_FG;
            this.bg = DEF_BG;
            this.bright = false;
            this.reverse = false;
          } else if (n === 1) this.bright = true;
          else if (n === 7) this.reverse = true;
          else if (n === 22) this.bright = false;
          else if (n === 27) this.reverse = false;
          else if (n >= 30 && n <= 37) this.fg = n - 30;
          else if (n === 39) this.fg = DEF_FG;
          else if (n >= 40 && n <= 47) this.bg = n - 40;
          else if (n === 49) this.bg = DEF_BG;
          else if (n >= 90 && n <= 97) this.fg = n - 90 + 8;
        }
      } else if (cmd === "J") {
        this.clear();
      } else if (cmd === "H") {
        this.endLink();
        this.cy = Math.min(this.rows - 1, Math.max(0, (args[0] || 1) - 1));
        this.cx = Math.min(this.cols - 1, Math.max(0, (args[1] || 1) - 1));
      } else if (cmd === "K") {
        this.eraseToEol();
      }
    }

    endLink() {
      const l = this.link;
      if (!l) return;
      this.link = null;
      if (l.row !== this.cy || this.cx <= l.c0) return;
      const row = this.lines[this.cy];
      (row.links || (row.links = [])).push({ c0: l.c0, c1: this.cx, cmd: l.cmd });
      this.dirty.add(this.cy);
    }

    // ---------------- 입력 되울림 ----------------

    // 입력 칸에 지금 치고 있는 글을 보여준다 (갈무리에는 넣지 않는다)
    setInput(text) {
      this.inputText = text;
      if (this.inputPos) this.drawInput();
    }

    drawInput() {
      const p = this.inputPos;
      const cap = this.capture;
      this.capture = null;
      this.cy = p.row;
      this.cx = p.col;
      this.eraseToEol();
      let shown = this.inputText;
      const room = this.cols - p.col - 1;
      if (strWidth(shown) > room) {
        // 넘치면 뒤쪽만 보인다
        const chars = [...shown];
        while (strWidth(chars.join("")) > room) chars.shift();
        shown = chars.join("");
      }
      for (const ch of shown) this.putChar(ch);
      this.capture = cap;
      this.scheduleRender();
    }

    // 엔터: 친 글을 화면에 남기고 다음 줄로
    commitInput(text) {
      if (this.inputPos) {
        this.inputText = text;
        this.drawInput();
        if (this.capture) this.capture(text);
      } else {
        for (const ch of text) this.putChar(ch);
      }
      this.inputPos = null;
      this.inputText = "";
      this.write("\r\n");
    }

    // ---------------- 그리기 ----------------

    rowText(row) {
      let s = "";
      for (let c = 0; c < this.cols; c++) if (row.ch[c] !== null) s += row.ch[c];
      return s.replace(/\s+$/, "");
    }

    screenText() {
      return this.lines.map((r) => this.rowText(r)).join("\n").replace(/\n+$/, "") + "\n";
    }

    get totalLines() {
      return (this.history ? this.history.length : 0) + this.rows;
    }

    viewRow(i) {
      if (!this.viewOffset) return this.lines[i];
      const hist = this.history || [];
      const idx = hist.length - this.viewOffset + i;
      return idx < hist.length ? hist[idx] : this.lines[idx - hist.length];
    }

    scrollView(delta) {
      const max = this.history ? this.history.length : 0;
      const v = Math.max(0, Math.min(max, this.viewOffset + delta));
      if (v !== this.viewOffset) {
        this.viewOffset = v;
        this.allDirty = true;
        this.scheduleRender();
      }
      return v;
    }

    scheduleRender() {
      if (this.rafId) return;
      this.rafId = requestAnimationFrame(() => {
        this.rafId = 0;
        this.render();
      });
    }

    invalidate() {
      this.allDirty = true;
      this.scheduleRender();
    }

    render() {
      for (let i = 0; i < this.rows; i++) {
        if (!this.allDirty && !this.dirty.has(i)) continue;
        this.rowEls[i].innerHTML = rowHTML(this.viewRow(i), this.cols, this.garble);
      }
      this.allDirty = false;
      this.dirty.clear();
      const show = this.cursorVisible && !this.viewOffset;
      this.cursorEl.style.display = show ? "" : "none";
      if (show) {
        this.cursorEl.style.left = Math.min(this.cx, this.cols - 1) * 8 + "px";
        this.cursorEl.style.top = this.cy * 16 + "px";
      }
      if (this.onRender) this.onRender();
    }
  }

  // 한 줄을 HTML 로. 같은 색이 이어지는 글자는 한 덩어리로 묶는다.
  function rowHTML(row, cols, garbled) {
    let html = "", run = "", runAttr = -1;
    const links = row.links;
    let li = 0, inLink = null;
    const flush = () => {
      if (run) {
        html += `<i class="f${runAttr & 31} b${runAttr >> 5}">${esc(run)}</i>`;
        run = "";
      }
    };
    for (let c = 0; c < cols; c++) {
      let ch = row.ch[c];
      if (ch === null) continue;
      if (links) {
        if (inLink && c >= inLink.c1) {
          flush();
          html += "</a>";
          inLink = null;
        }
        if (!inLink && li < links.length && c >= links[li].c0) {
          flush();
          inLink = links[li++];
          html += `<a class="lk" data-cmd="${esc(inLink.cmd)}">`;
        }
      }
      const a = row.at[c];
      const code = ch.charCodeAt(0);
      if (garbled && code >= 0xac00 && code <= 0xd7a3) ch = garble(ch);
      if (isBoxed(ch.charCodeAt(0))) {
        flush();
        const inner = isLine(code) ? `<b>${esc(ch)}</b>` : esc(ch);
        html += `<i class="w${isLine(code) ? " ln" : ""} f${a & 31} b${a >> 5}">${inner}</i>`;
        continue;
      }
      if (a !== runAttr) {
        flush();
        runAttr = a;
      }
      run += ch;
    }
    flush();
    if (inLink) html += "</a>";
    return html;
  }

  // 색이 한 가지인 글 한 줄 (문서 편집기, 대화상자 따위). 색은 둘러싼 요소의 --tfg/--tbg 를 따른다.
  function textRowHTML(text, cols) {
    const row = blankRow(cols, ATTR_DEFAULT);
    let c = 0;
    for (const ch of text) {
      const w = cw(ch);
      if (c + w > cols) break;
      row.ch[c] = ch;
      if (w === 2) row.ch[c + 1] = null;
      c += w;
    }
    return rowHTML(row, cols, false);
  }

  window.Term = { Terminal, cw, strWidth, fit, rowHTML, textRowHTML, esc, ATTR_DEFAULT };
})();
