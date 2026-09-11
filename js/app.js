// 이야기 5.3 화면: 모드, 글쇠, 메뉴, 대화상자, 상태줄, 편집기, 챙긴글, 시작 화면.
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const ESC = "\x1b", BEL = "\x07", CRLF = "\r\n";
  const T = window.Term, H = window.Host, D = window.ATDT_DATA;
  const { fit, strWidth, esc } = T;
  const POSTS = D.posts;
  const INPUT = H.INPUT, KEY = H.KEY;

  // ------------------------------------------------------------ 설정 (I.CNF)
  const DEFAULT_CNF = { bps: 19200, color: 0, sound: true, hangul: "ks", cursor: 1, echo: false };
  const COLORS = [["#FFFFFF", "#0000AA"], ["#AAAAAA", "#000000"], ["#FFFFFF", "#000000"], ["#FFFF55", "#0000AA"], ["#000000", "#AAAAAA"]];
  const COLOR_NAMES = ["흰/파랑", "회색/검정", "흰/검정", "노랑/파랑", "검정/회색"];
  const SPEEDS = [2400, 9600, 19200, 38400, 115200];
  const CURSORS = ["없음", "깜빡 상자", "고정 상자", "깜빡 밑줄", "고정 밑줄"];
  const CNF_KEY = "iyagi.cnf";
  let cnf = Object.assign({}, DEFAULT_CNF);
  try {
    const s = localStorage.getItem(CNF_KEY);
    if (s) Object.assign(cnf, JSON.parse(s));
  } catch (e) {}
  if (!SPEEDS.includes(cnf.bps)) cnf.bps = 19200;
  if (!(cnf.color >= 0 && cnf.color < COLORS.length)) cnf.color = 0;
  if (!(cnf.cursor >= 0 && cnf.cursor < CURSORS.length)) cnf.cursor = 1;

  // ------------------------------------------------------------ 요소
  const stage = $("stage"), screenEl = $("screen"), statusEl = $("status"), menubar = $("menubar");
  const layer = $("layer"), editorEl = $("editor"), etext = $("etext"), estat = $("estat");
  const dosEl = $("dos"), splash = $("splash"), kbd = $("kbd"), softkeys = $("softkeys");

  const term = new T.Terminal(screenEl, { cols: 80, rows: 29 });
  const dosTerm = new T.Terminal(dosEl, { cols: 80, rows: 30, history: false });

  let mode = "init"; // init | boot | splash | term | editor | backscroll | dos
  let dosReturn = null; // shell | quit | cmd
  let connectedAt = 0;
  let capture = null; // { name, buf }
  let hangulMode = false;
  let dialOpenedOnce = false;
  const dialogs = [];
  const bootTimers = [];

  const modem = new H.Modem(term, {
    bps: () => cnf.bps,
    soundOn: () => cnf.sound,
    onConnect: () => {
      connectedAt = Date.now();
      updateOffice();
      updateStatus();
    },
    onDisconnect: () => {
      connectedAt = 0;
      updateOffice();
      updateStatus();
    },
    onRoute: (h) => setRoute(h),
    postUrl: (key) => (/^https?:$/.test(location.protocol) ? location.href.replace(/#.*$/, "") + "#" + key : ""),
  });

  // ------------------------------------------------------------ 주소(#)
  // 글은 #WHI(갈무리 파일 이름), 게시판은 #b7, 전체 목록은 #all. BBS 가 화면을 바꿀 때 주소창도 따라가고,
  // 뒤로/앞으로 가기나 주소 입력으로 # 이 바뀌면 접속 중일 때 그곳으로 간다.
  const BASE_TITLE = document.title;
  function currentRoute() {
    return location.hash.replace(/^#/, "");
  }
  function setRoute(h) {
    const r = H.BBS.parseRoute(h);
    const p = r && r.kind === "post" ? POSTS.find((x) => x.id === r.id) : null;
    document.title = p ? p.title + " — 갈무리 보관소" : BASE_TITLE;
    if (currentRoute() === h) return;
    const url = location.pathname + location.search + (h ? "#" + h : "");
    // 같은 곳을 가리키는 다른 표기(#47 → #WHI)면 기록을 늘리지 않는다.
    const same = JSON.stringify(H.BBS.parseRoute(currentRoute())) === JSON.stringify(r);
    if (h && !same) history.pushState(null, "", url);
    else history.replaceState(null, "", url);
  }
  window.addEventListener("popstate", () => {
    if (mode !== "term" || modem.state !== "online" || dialogs.length) return;
    if (term.busy) term.flush();
    modem.bbs.goto(currentRoute());
  });
  // 주소를 달고 들어왔으면 도스 부팅과 전화 걸기를 건너뛰고 바로 그 글로 간다.
  function startFromRoute() {
    const h = currentRoute();
    if (!h || !H.BBS.parseRoute(h)) return false;
    dos.cwd = "C:\\I";
    dosTerm.inputPos = null;
    dialOpenedOnce = true;
    setMode("term");
    applyAll();
    modem.connectDirect(H.PHONEBOOK[0], h);
    return true;
  }
  const dos = new H.Dos(dosTerm, { onExit: (kind) => dosExit(kind) });

  // ------------------------------------------------------------ 도움 함수
  function pad2(n) {
    return String(n).padStart(2, "0");
  }
  function clock() {
    const d = new Date();
    return `${d.getHours()}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  }
  function mmdd() {
    const d = new Date();
    return pad2(d.getMonth() + 1) + pad2(d.getDate());
  }
  function saveFile(name, text) {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  }
  function activeTerm() {
    return mode === "dos" || mode === "boot" || mode === "init" ? dosTerm : term;
  }
  function focusKbd() {
    if (dialogs.length) return;
    try {
      kbd.focus({ preventScroll: true });
    } catch (e) {}
  }
  function placeKbd() {
    const t = activeTerm();
    const host = t === term ? screenEl : dosEl;
    kbd.style.left = host.offsetLeft + Math.min(t.cx, 79) * 8 + "px";
    kbd.style.top = host.offsetTop + t.cy * 16 + "px";
  }
  term.onRender = placeKbd;
  dosTerm.onRender = placeKbd;
  function ensureAudio() {
    if (cnf.sound) modem.sound.ensure();
  }

  // ------------------------------------------------------------ 설정 적용
  function applyColor() {
    const [fg, bg] = COLORS[cnf.color];
    screenEl.style.setProperty("--tfg", fg);
    screenEl.style.setProperty("--tbg", bg);
  }
  function applyCursor() {
    const c = cnf.cursor;
    term.cursorVisible = c !== 0;
    term.cursorEl.className = "cursor" + (c === 1 || c === 3 ? " blink" : "") + (c >= 3 ? " ul" : "");
    term.scheduleRender();
  }
  function applyAll() {
    term.bps = cnf.bps;
    term.garble = cnf.hangul === "johab";
    applyColor();
    applyCursor();
    term.invalidate();
    updateStatus();
  }
  function saveCnf() {
    try {
      localStorage.setItem(CNF_KEY, JSON.stringify(cnf));
      return true;
    } catch (e) {
      return false;
    }
  }

  // ------------------------------------------------------------ 모드
  function updateOffice() {
    const visible = mode === "splash" || (mode === "term" && modem.state !== "online");
    $("office").hidden = !visible;
    stage.classList.toggle("offline", visible);
  }
  function setMode(m) {
    mode = m;
    const termish = m === "term" || m === "backscroll";
    screenEl.hidden = !termish;
    statusEl.hidden = !termish && m !== "splash";
    editorEl.hidden = m !== "editor";
    dosEl.hidden = !(m === "dos" || m === "boot");
    splash.hidden = m !== "splash";
    kbd.value = "";
    if (m === "backscroll") buildStatus("back");
    else if (m === "term" || m === "splash") buildStatus("term");
    updateOffice();
    updateStatus();
    placeKbd();
    focusKbd();
  }

  // ------------------------------------------------------------ 상태줄
  let statusKind = "";
  const STATUS_TERM = [
    { w: 84, id: "ime" }, { w: 48, id: "led" }, { w: 96, id: "conn", act: "conn" }, { w: 112, id: "han", act: "hangul" },
    { w: 136, id: "line", act: "speed" }, { w: 96, id: "cap", act: "capture" }, { w: 68, id: "clk" },
  ];
  const STATUS_BACK = [
    { w: 84, id: "ime" }, { w: 50, id: "pos" }, { w: 24, id: "up", act: "bsUp", text: "▲" }, { w: 24, id: "dn", act: "bsDn", text: "▼" },
    { w: 48, id: "pu", act: "bsPgUp", text: "PgUp" }, { w: 48, id: "pd", act: "bsPgDn", text: "PgDn" },
    { w: 120, id: "sv", act: "bsSave", text: "S : 화면 저장" }, { w: 176, id: "ex", act: "bsExit", text: "F5, ESC : 빠짐" }, { w: 66, id: "clk" },
  ];
  const cells = {};
  function buildStatus(kind) {
    if (statusKind === kind) return;
    statusKind = kind;
    statusEl.textContent = "";
    for (const k in cells) delete cells[k];
    for (const c of kind === "term" ? STATUS_TERM : STATUS_BACK) {
      const s = document.createElement("span");
      s.style.width = c.w + "px";
      if (c.act) {
        s.classList.add("act");
        s.dataset.act = c.act;
      }
      if (c.text) s.textContent = c.text;
      if (c.id === "led") s.innerHTML = '<b class="led rx"></b><b class="led tx"></b>';
      statusEl.appendChild(s);
      cells[c.id] = s;
    }
  }
  function updateStatus() {
    if (!statusKind) return;
    const ime = (hangulMode ? "한글" : "영문") + ">-2";
    cells.ime.innerHTML = '<b class="mouse"></b>' + ime;
    cells.clk.textContent = clock();
    if (statusKind === "term") {
      const secs = connectedAt ? Math.floor((Date.now() - connectedAt) / 1000) : 0;
      cells.conn.textContent = `연결 ${Math.floor(secs / 3600)}:${pad2(Math.floor((secs % 3600) / 60))}`;
      cells.han.textContent = cnf.hangul === "ks" ? "KS5601 완성" : "상용 조합형";
      cells.line.textContent = (cnf.echo ? "*" : "") + `4- ${cnf.bps}-N-8-1`;
      cells.cap.textContent = capture ? "갈무리 중" : "갈무리 끝";
    } else {
      cells.pos.textContent = term.viewOffset + "줄";
    }
    if (estat && mode === "editor") editor.renderStatus();
  }
  statusEl.addEventListener("click", (e) => {
    if (mode === "splash") return;
    const s = e.target.closest("span[data-act]");
    if (!s || dialogs.length) return;
    const a = s.dataset.act;
    if (a === "conn") return modem.state === "online" ? runAction("hangup") : runAction("dial");
    if (a === "hangul" || a === "speed" || a === "capture") return runAction(a);
    if (a === "bsUp") backscroll.scroll(1);
    else if (a === "bsDn") backscroll.scroll(-1);
    else if (a === "bsPgUp") backscroll.scroll(28);
    else if (a === "bsPgDn") backscroll.scroll(-28);
    else if (a === "bsSave") backscroll.save();
    else if (a === "bsExit") backscroll.exit();
  });
  setInterval(updateStatus, 1000);
  setInterval(() => {
    if (!cells.led) return;
    const rx = cells.led.firstChild;
    rx.classList.toggle("on", term.busy && !rx.classList.contains("on"));
  }, 200);

  // ------------------------------------------------------------ 대화상자
  function openDialog(d) {
    d.el.classList.add("dlg");
    layer.appendChild(d.el);
    layer.hidden = false;
    dialogs.push(d);
    const x = d.x != null ? d.x : Math.max(0, Math.floor((640 - d.el.offsetWidth) / 16) * 8);
    const y = d.y != null ? d.y : Math.max(0, Math.floor((480 - d.el.offsetHeight) / 32) * 16);
    d.el.style.left = x + "px";
    d.el.style.top = y + "px";
    if (d.input) {
      d.input.focus();
      d.input.select();
    } else kbd.blur();
    return d;
  }
  function closeDialog(d) {
    const i = dialogs.indexOf(d);
    if (i < 0) return;
    dialogs.splice(i, 1);
    d.el.remove();
    if (!dialogs.length) {
      layer.hidden = true;
      focusKbd();
    }
    if (d.onClose) d.onClose();
  }
  function box(cls, title, bodyHTML) {
    const el = document.createElement("div");
    el.className = cls || "";
    el.innerHTML = `<div class="ttl">${esc(title)}</div>${bodyHTML}`;
    return el;
  }
  function msgBox(title, lines, cb) {
    const el = box("msg", title, `<div class="bd">${lines.map((l) => `<div>${esc(l)}</div>`).join("")}</div><div class="btns"><span class="btn sel">확 인</span></div>`);
    const d = {
      el,
      onKey(e, k) {
        if (k === "Enter" || k === "Escape" || k === "Space") {
          closeDialog(d);
          if (cb) cb();
        }
        return true;
      },
    };
    el.querySelector(".btn").onclick = () => d.onKey(null, "Enter");
    return openDialog(d);
  }
  function confirmBox(title, lines, cb) {
    const el = box("msg", title, `<div class="bd">${lines.map((l) => `<div>${esc(l)}</div>`).join("")}</div><div class="btns"><span class="btn sel" data-v="1">예(Y)</span><span class="btn" data-v="0">아니오(N)</span></div>`);
    const btns = el.querySelectorAll(".btn");
    let sel = 0;
    const draw = () => btns.forEach((b, i) => b.classList.toggle("sel", i === sel));
    const finish = (v) => {
      closeDialog(d);
      cb(v);
    };
    const d = {
      el,
      onKey(e, k) {
        if (k === "ArrowLeft" || k === "ArrowRight" || k === "Tab") {
          sel = 1 - sel;
          draw();
        } else if (k === "Enter" || k === "Space") finish(sel === 0);
        else if (k === "Y") finish(true);
        else if (k === "N" || k === "Escape") finish(false);
        return true;
      },
    };
    btns.forEach((b) => (b.onclick = () => finish(b.dataset.v === "1")));
    return openDialog(d);
  }
  function promptBox(title, label, def, cb) {
    const el = box("ask", title, `<div class="bd"><div>${esc(label)}</div><div style="width:${Math.max(240, strWidth(label) * 8)}px;margin-top:8px"><input class="in"></div><div class="hint" style="margin-top:8px">Enter 확인   Esc 취소</div></div>`);
    const input = el.querySelector("input");
    input.value = def || "";
    const d = {
      el,
      input,
      onKey(e, k) {
        if (k === "Enter") {
          const v = input.value;
          closeDialog(d);
          cb(v);
          return true;
        }
        if (k === "Escape") {
          closeDialog(d);
          cb(null);
          return true;
        }
        return e && e.key && e.key.length > 1 && /^F\d/.test(e.key);
      },
    };
    return openDialog(d);
  }
  function listBox(title, items, sel, cb) {
    const el = box("pick", title, `<div class="bd" style="padding:4px 0">${items.map((it, i) => `<div class="li${i === sel ? " sel" : ""}" data-i="${i}">${esc(it)}</div>`).join("")}</div>`);
    const rows = el.querySelectorAll(".li");
    const draw = () => rows.forEach((r, i) => r.classList.toggle("sel", i === sel));
    const finish = (v) => {
      closeDialog(d);
      cb(v);
    };
    const d = {
      el,
      onKey(e, k) {
        if (k === "ArrowUp") sel = (sel + items.length - 1) % items.length;
        else if (k === "ArrowDown") sel = (sel + 1) % items.length;
        else if (k === "Home") sel = 0;
        else if (k === "End") sel = items.length - 1;
        else if (k === "Enter" || k === "Space") return finish(sel), true;
        else if (k === "Escape") return finish(-1), true;
        draw();
        return true;
      },
    };
    rows.forEach((r) => (r.onclick = () => finish(+r.dataset.i)));
    return openDialog(d);
  }
  function notImpl() {
    msgBox("알 림", ["웹 이야기에서는 쓸 수 없는 기능입니다."]);
  }

  // ------------------------------------------------------------ 메뉴
  const MENUS = [
    { title: "☎", icon: true, items: [
      { label: "이야기란..", id: "about" }, { label: "사용설명서", key: "F1", id: "help" }, "-",
      { label: "음악기능", key: "@P" }, { label: "연주상태", key: "@-" }, { label: "나들이", key: "@S", id: "shell" }, { label: "끝내기", key: "@X", id: "quit" } ] },
    { title: "서류철", items: [
      { label: "파일보냄", key: "PgUp", k: "PageUp", id: "upload" }, { label: "파일받음", key: "PgDn", k: "PageDown", id: "download" }, { label: "전송상태", key: "@+" },
      { label: "파일 편집", key: "@V", id: "edit" }, "-", { label: "환경저장", key: "@W", id: "savecnf" }, { label: "갈무리 시작", key: "@L", id: "capture" },
      { label: "프린터 켬", key: "F6" }, "-", { label: "도스 명령", key: "@J", id: "doscmd" } ] },
    { title: "특수기능", items: [
      { label: "챙긴글보기", key: "F5", id: "backscroll" }, "-", { label: "챙긴글지움", key: "@E", id: "clearhist" }, { label: "이야기마당", key: "@C" },
      { label: "전화 걸기", key: "@D", id: "dial" }, "-", { label: "글쇠 정의", key: "@M" }, { label: "약속 시간", key: "@Q" }, { label: "글월 찾기", key: "@F" },
      { label: "화면 저장", key: "@G", id: "savescreen" }, { label: "정리하기", key: "^F8", id: "reset" } ] },
    { title: "모뎀", items: [
      { label: "메모리편지", key: "@K" }, { label: "전화 끊기", key: "^F9", id: "hangup" }, { label: "정지 신호", key: "@B" }, { label: "모뎀 상태", key: "F3", id: "modemstat" }, "-",
      { label: "상태 바꿈", key: "@1", id: "speed" } ] },
    { title: "전환", items: [
      { label: "영문 글꼴", key: "F7" }, { label: "한글 글꼴", key: "F8" }, "-", { label: "덧말 바꿈", key: "@T" }, { label: "색깔 바꿈", key: "@Z", id: "color" },
      { label: "그림 상태", key: "@N" }, { label: "화면 바꿈", key: "@A", id: "screencfg" }, { label: "메뉴 파일", key: "@H" } ] },
    { title: "한글", items: [ { label: "한글 종류", key: "F2", id: "hangul" }, { label: "한자 폰트", key: "^F6" }, { label: "한자 변환", key: "^F7" } ] },
    { title: "자동", items: [
      { label: "혼잣말하기", key: "@I" }, { label: "초기화명령", key: "@O" }, { label: "자국 반향", key: "@R", id: "echo" }, { label: "1:1 통신", key: "@U" },
      { label: "커서 모양", key: "^F1", id: "cursor" }, { label: "한영 비율", key: "^F2" }, { label: "<CR> 변환", key: "^F3" }, { label: "접속 만듦", key: "^F4" }, { label: "한자 이름", key: "^F5" } ] },
  ];
  const KEYMAP = {};
  for (const m of MENUS) for (const it of m.items) if (it !== "-" && it.key) KEYMAP[it.k || it.key] = it.id || "none";
  KEYMAP["@2"] = "speed";

  const menu = {
    open: false, col: 0, row: 0, dd: null,
    show(col) {
      if (mode !== "term" && mode !== "editor" && mode !== "backscroll") return;
      this.open = true;
      this.col = col || 0;
      this.row = 0;
      kbd.blur();
      this.render();
    },
    hide() {
      this.open = false;
      menubar.hidden = true;
      menubar.textContent = "";
      focusKbd();
    },
    render() {
      menubar.hidden = false;
      menubar.textContent = "";
      const positions = [8, 40, 120, 216, 288, 360, 432];
      const widths = [24, 64, 80, 56, 56, 56, 56];
      MENUS.forEach((m, i) => {
        const s = document.createElement("span");
        s.className = "mi" + (i === this.col ? " sel" : "");
        s.textContent = m.title;
        s.style.left = positions[i] + "px";
        s.style.width = widths[i] + "px";
        s.dataset.col = i;
        menubar.appendChild(s);
        m._x = positions[i];
      });
      const brand = document.createElement("span");
      brand.className = "brand";
      brand.textContent = "이야기 5.3";
      menubar.appendChild(brand);
      const m = MENUS[this.col];
      const dd = document.createElement("div");
      dd.className = "dd";
      dd.style.left = m._x + "px";
      m.items.forEach((it, i) => {
        if (it === "-") {
          dd.appendChild(document.createElement("hr"));
          return;
        }
        const r = document.createElement("div");
        r.className = "it" + (i === this.row ? " sel" : "") + (it.id ? "" : " dim");
        const label = it.id === "capture" && capture ? "갈무리 멈춤" : it.label;
        r.innerHTML = `<span>${esc(label)}</span><span>${esc(it.key || "")}</span>`;
        r.dataset.row = i;
        dd.appendChild(r);
      });
      menubar.appendChild(dd);
    },
    move(dr) {
      const items = MENUS[this.col].items;
      let r = this.row;
      do r = (r + dr + items.length) % items.length;
      while (items[r] === "-");
      this.row = r;
      this.render();
    },
    onKey(e, k) {
      if (k === "Escape" || k === "F10") return this.hide();
      if (k === "ArrowLeft") {
        this.col = (this.col + MENUS.length - 1) % MENUS.length;
        this.row = 0;
        return this.render();
      }
      if (k === "ArrowRight") {
        this.col = (this.col + 1) % MENUS.length;
        this.row = 0;
        return this.render();
      }
      if (k === "ArrowUp") return this.move(-1);
      if (k === "ArrowDown") return this.move(1);
      if (k === "Enter" || k === "Space") return this.pick(this.row);
      if (k.length === 1) {
        const items = MENUS[this.col].items;
        const i = items.findIndex((it) => it !== "-" && it.label.toUpperCase().startsWith(k));
        if (i >= 0) return this.pick(i);
      }
    },
    pick(i) {
      const it = MENUS[this.col].items[i];
      this.hide();
      if (it && it !== "-") runAction(it.id);
    },
  };
  menubar.addEventListener("click", (e) => {
    const mi = e.target.closest(".mi");
    if (mi) {
      menu.col = +mi.dataset.col;
      menu.row = 0;
      return menu.render();
    }
    const it = e.target.closest(".it");
    if (it) menu.pick(+it.dataset.row);
  });
  menubar.addEventListener("mouseover", (e) => {
    const mi = e.target.closest(".mi");
    if (mi && +mi.dataset.col !== menu.col) {
      menu.col = +mi.dataset.col;
      menu.row = 0;
      menu.render();
    }
  });

  // ------------------------------------------------------------ 동작
  const ACTIONS = {
    about() {
      msgBox("이야기란..", [
        "갈무리 보관소 - 이야기 5.3 화면 재현물",
        "",
        "이 화면은 큰사람의 PC통신 프로그램 '이야기 5.3'(1992)의",
        "모습을 본떠 HTML/CSS 로 새로 만든 재현물입니다.",
        "큰사람과는 관계가 없으며, 원본 프로그램의 실행 파일과",
        "글꼴, 그림은 쓰지 않았습니다.",
        "",
        "글꼴 : Neo둥근모 (SIL Open Font License 1.1)",
        "글   : 1994 ~ 1997 년 PC통신에서 갈무리한 글 " + POSTS.length + " 편",
      ]);
    },
    help: () => helpBox(),
    shell() {
      dosReturn = "shell";
      setMode("dos");
      dos.start("이야기로 돌아오려면 EXIT 를 치십시오.");
    },
    quit() {
      const go = () => {
        if (modem.state !== "cmd") modem.hangup();
        stopCapture();
        dosReturn = "quit";
        setMode("dos");
        dos.start("이야기를 끝냈습니다. 다시 시작하려면 I 를 치십시오.");
      };
      if (modem.state === "online") confirmBox("끝내기", ["전화가 연결되어 있습니다.", "전화를 끊고 나갈까요?"], (y) => y && go());
      else go();
    },
    upload() {
      msgBox("파일 보냄", ["웹 이야기에서는 파일을 보낼 수 없습니다."]);
    },
    download() {
      const c = modem.state === "online" ? modem.bbs.current : null;
      if (!c) return msgBox("파일 받음", ["받을 파일이 없습니다.", "글을 읽는 중에 PgDn 을 누르면 그 글을 내려받습니다."]);
      zmodemBox(c.p);
    },
    edit() {
      promptBox("파일 편집", "읽어 들일 파일 이름은 ?", "*.CAP", (v) => {
        if (v == null) return;
        v = v.trim() || "*.CAP";
        if (/[*?]/.test(v)) return filePicker(v, (f) => f && editor.open(f));
        const f = dos.find(v) || dos.find(v + ".CAP");
        if (!f || !f.post) return msgBox("파일 편집", [`${v.toUpperCase()} 파일을 찾을 수 없습니다.`]);
        editor.open(f);
      });
    },
    savecnf() {
      msgBox("환경 저장", [saveCnf() ? "I.CNF 에 저장했습니다." : "저장할 수 없습니다. (브라우저 저장소 막힘)"]);
    },
    capture() {
      if (capture) return stopCapture(true);
      promptBox("갈무리 시작", "갈무리할 파일 이름은 ?", `I${mmdd()}.CAP`, (v) => {
        if (v == null) return;
        v = v.trim() || `I${mmdd()}.CAP`;
        if (!/\./.test(v)) v += ".CAP";
        capture = { name: v.toUpperCase(), buf: "" };
        term.capture = (ch) => (capture.buf += ch);
        updateStatus();
      });
    },
    doscmd() {
      promptBox("도스 명령", "실행할 도스 명령은 ?", "", (v) => {
        if (v == null || !v.trim()) return;
        dosReturn = "cmd";
        setMode("dos");
        dosTerm.clear();
        dosTerm.write(dos.cwd + ">" + v + CRLF);
        dos.run(v, () => {
          dosTerm.write(CRLF + "아무 글쇠나 누르면 이야기로 돌아갑니다 . . ." + KEY);
          dos.waitKey = () => setMode("term");
        });
      });
    },
    backscroll: () => backscroll.enter(),
    clearhist() {
      term.clearHistory();
      msgBox("챙긴글 지움", ["챙겨 두었던 글을 모두 지웠습니다."]);
    },
    dial: () => dialBox(),
    savescreen() {
      const name = `I${mmdd()}.CHA`;
      saveFile(name, term.screenText().replace(/\n/g, CRLF));
      msgBox("화면 저장", [`${name} 에 저장했습니다.`]);
    },
    reset() {
      confirmBox("정리하기", ["설정을 처음 상태로 되돌리고", "챙긴글을 지울까요?"], (y) => {
        if (!y) return;
        cnf = Object.assign({}, DEFAULT_CNF);
        try {
          localStorage.removeItem(CNF_KEY);
        } catch (e) {}
        term.clearHistory();
        applyAll();
        msgBox("정리하기", ["처음 상태로 되돌렸습니다."]);
      });
    },
    hangup() {
      if (modem.state === "cmd") return msgBox("전화 끊기", ["연결되어 있지 않습니다."]);
      modem.hangup();
    },
    modemstat() {
      msgBox("모뎀 상태", [
        `상태 : ${modem.state === "online" ? "연결됨" : modem.state === "dialing" ? "거는 중" : "명령 대기"}`,
        `선로 : COM4  ${cnf.bps}-N-8-1`,
        "모뎀 : 이야기 5.3 웹 모뎀 (재현물)",
      ]);
    },
    speed() {
      listBox("선로 속도", SPEEDS.map((s) => ` ${String(s).padStart(6)} bps `), SPEEDS.indexOf(cnf.bps), (i) => {
        if (i < 0) return;
        cnf.bps = SPEEDS[i];
        term.bps = cnf.bps;
        updateStatus();
      });
    },
    color() {
      cnf.color = (cnf.color + 1) % COLORS.length;
      applyColor();
    },
    screencfg: () => screenCfgBox(),
    hangul() {
      cnf.hangul = cnf.hangul === "ks" ? "johab" : "ks";
      term.garble = cnf.hangul === "johab";
      term.invalidate();
      updateStatus();
    },
    echo() {
      cnf.echo = !cnf.echo;
      updateStatus();
    },
    cursor() {
      cnf.cursor = (cnf.cursor + 1) % CURSORS.length;
      applyCursor();
    },
  };
  function runAction(id) {
    if (id && ACTIONS[id]) ACTIONS[id]();
    else notImpl();
  }
  function stopCapture(tell) {
    if (!capture) return;
    const c = capture;
    capture = null;
    term.capture = null;
    saveFile(c.name, c.buf.replace(/\n/g, CRLF));
    updateStatus();
    if (tell) msgBox("갈무리 멈춤", [`${c.name} 에 ${H.eucBytes(c.buf)} 바이트를 저장했습니다.`]);
  }

  // ------------------------------------------------------------ 전화 걸기 창
  function dialBox() {
    if (modem.state !== "cmd") return msgBox("전화 걸기", ["이미 연결되어 있습니다. 먼저 전화를 끊으십시오. (^F9)"]);
    const book = H.PHONEBOOK;
    let sel = 0;
    const el = document.createElement("div");
    el.className = "dial";
    const rows = () =>
      book.map((e, i) => `<div class="li${i === sel ? " sel" : ""}" data-i="${i}">${esc(fit(String(i + 1), 2, true))} ${e.star ? "*" : " "}${esc(fit(e.name, 24))}${esc(fit(e.number, 12))}${esc(e.speed)}[${esc(e.memo)}]</div>`).join("") +
      '<div class="li"> </div>'.repeat(Math.max(0, 10 - book.length));
    const key = (label, action) => `<button type="button" data-a="${action}">${label}</button>`;
    const command = (label, letter) => `<span>${label} <b>${letter}</b></span>`;
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", "전화 걸기");
    el.innerHTML =
      '<div class="band"><span>이 름 [ 곳 ]</span><span>전 화 번 호 ☎</span><span>선 택 사 항</span></div>' +
      `<div class="list">${rows()}</div>` +
      '<div class="keys"><div class="keyrow"><div class="keygroup">' +
      key("▲", "up") + key("PgUp", "first") + key("Home", "first") + key("∨", "down") +
      '</div><div class="keygroup commands">' + command("읽기", "R") + command("순서", "S") + command("청소", "A") + command("고침", "E") +
      '</div></div><div class="keyrow"><div class="keygroup">' +
      key("▼", "down") + key("PgDn", "last") + key("End", "last") + key("☎", "dial") +
      '</div><div class="keygroup commands">' + command("저장", "W") + command("찾기", "F") + command("반전", "V") + key('설명 <b>H</b>', "help") +
      '</div></div><div class="keyrow"><div class="keygroup"><span class="together">이야기 <b>동시걸기 TAB ♪</b></span></div>' +
      '<div class="keygroup commands">' + command("삽입", "I") + command("지움", "D") + command("옮김", "M") + key('멈춤 <b>Esc</b>', "close") +
      '</div></div></div><div class="dial-hint">Enter · 두 번 누르기: 전화 걸기 / Esc: 닫기</div>';
    const list = el.querySelector(".list");
    const draw = () => (list.innerHTML = rows());
    const go = () => {
      const e = book[sel];
      closeDialog(d);
      modem.dial(e.number, false);
    };
    const d = {
      el, x: 72, y: 8,
      onKey(e, k) {
        if (k === "ArrowUp") sel = (sel + book.length - 1) % book.length;
        else if (k === "ArrowDown") sel = (sel + 1) % book.length;
        else if (k === "Home" || k === "PageUp") sel = 0;
        else if (k === "End" || k === "PageDown") sel = book.length - 1;
        else if (k === "Enter" || k === "Space") return go(), true;
        else if (k === "Escape") return closeDialog(d), true;
        else if (/^[1-9]$/.test(k) && +k <= book.length) sel = +k - 1;
        else if (k === "H") return closeDialog(d), helpBox(), true;
        draw();
        return true;
      },
    };
    el.addEventListener("click", (e) => {
      const li = e.target.closest(".li");
      if (li && li.dataset.i != null) {
        sel = +li.dataset.i;
        draw();
      }
      const action = e.target.closest("[data-a]")?.dataset.a;
      if (action === "dial") return go();
      if (action === "close") return closeDialog(d);
      if (action === "help") return helpBox();
      if (action === "up") sel = (sel + book.length - 1) % book.length;
      if (action === "down") sel = (sel + 1) % book.length;
      if (action === "first") sel = 0;
      if (action === "last") sel = book.length - 1;
      if (action) draw();
    });
    el.addEventListener("dblclick", (e) => {
      if (e.target.closest(".li[data-i]")) go();
    });
    openDialog(d);
  }

  // ------------------------------------------------------------ Z모뎀 받기 창
  function zmodemBox(p) {
    const text = p.text.replace(/\n/g, CRLF) + CRLF;
    const bytes = H.eucBytes(p.text);
    const cps = cnf.bps / 10;
    const dur = Math.min(6, Math.max(1.5, bytes / cps)) * 1000;
    const el = document.createElement("div");
    el.className = "zm";
    el.innerHTML = `<div class="ttl">Z모뎀  파일 받음</div><div class="bd">` +
      `<div>파일 이름 : ${esc(p.cap)}</div><div>파일 크기 : ${bytes.toLocaleString()} bytes</div>` +
      `<div style="margin-top:8px"><span class="bar"><i></i></span> <span class="pct">0%</span></div>` +
      `<div class="got" style="margin-top:8px">받은 양   : 0 bytes</div><div class="eta">속도 : ${cps} cps    남은 시간 : -</div>` +
      `<div class="hint" style="margin-top:8px">Esc : 그만두기</div></div>`;
    const bar = el.querySelector(".bar i"), pct = el.querySelector(".pct"), got = el.querySelector(".got"), eta = el.querySelector(".eta");
    const t0 = performance.now();
    let raf = 0, done = false;
    const tick = () => {
      const r = Math.min(1, (performance.now() - t0) / dur);
      bar.style.width = Math.floor(r * 100) + "%";
      pct.textContent = Math.floor(r * 100) + "%";
      got.textContent = `받은 양   : ${Math.floor(bytes * r).toLocaleString()} bytes`;
      eta.textContent = `속도 : ${cps} cps    남은 시간 : ${Math.ceil(((1 - r) * dur) / 1000)} 초`;
      if (r < 1) raf = requestAnimationFrame(tick);
      else {
        done = true;
        saveFile(p.cap, text);
        setTimeout(() => closeDialog(d), 600);
      }
    };
    const d = {
      el,
      onKey(e, k) {
        if (k === "Escape" && !done) {
          cancelAnimationFrame(raf);
          closeDialog(d);
        }
        return true;
      },
    };
    openDialog(d);
    raf = requestAnimationFrame(tick);
  }

  // ------------------------------------------------------------ 화면 바꿈 창
  function screenCfgBox() {
    let sel = 0;
    const el = document.createElement("div");
    el.className = "cfg";
    const lines = () => [
      `소리       : ${cnf.sound ? "켬" : "끔"}`,
      `선로 속도  : ${cnf.bps} bps`,
      `색깔       : ${COLOR_NAMES[cnf.color]}`,
      `커서 모양  : ${CURSORS[cnf.cursor]}`,
      `한글 종류  : ${cnf.hangul === "ks" ? "KS5601 완성" : "상용 조합형"}`,
    ];
    el.innerHTML = `<div class="ttl">화 면   바 꿈</div><div class="bd" style="padding:4px 0"></div><div class="hint" style="padding:0 8px 8px"> ↑↓ 고르기   ←→ Space 바꾸기   Esc 닫기</div>`;
    const bd = el.querySelector(".bd");
    const draw = () => (bd.innerHTML = lines().map((l, i) => `<div class="li${i === sel ? " sel" : ""}" data-i="${i}"> ${esc(l)} </div>`).join(""));
    const change = (dir) => {
      if (sel === 0) cnf.sound = !cnf.sound;
      else if (sel === 1) {
        cnf.bps = SPEEDS[(SPEEDS.indexOf(cnf.bps) + dir + SPEEDS.length) % SPEEDS.length];
        term.bps = cnf.bps;
      } else if (sel === 2) {
        cnf.color = (cnf.color + dir + COLORS.length) % COLORS.length;
        applyColor();
      } else if (sel === 3) {
        cnf.cursor = (cnf.cursor + dir + CURSORS.length) % CURSORS.length;
        applyCursor();
      } else ACTIONS.hangul();
      updateStatus();
      draw();
    };
    const d = {
      el,
      onKey(e, k) {
        if (k === "ArrowUp") sel = (sel + 4) % 5;
        else if (k === "ArrowDown") sel = (sel + 1) % 5;
        else if (k === "ArrowRight" || k === "Space" || k === "Enter") return change(1), true;
        else if (k === "ArrowLeft") return change(-1), true;
        else if (k === "Escape") return closeDialog(d), true;
        draw();
        return true;
      },
    };
    bd.addEventListener("click", (e) => {
      const li = e.target.closest(".li");
      if (!li) return;
      sel = +li.dataset.i;
      change(1);
    });
    draw();
    openDialog(d);
  }

  // ------------------------------------------------------------ 도움말 창
  const HELP_PAGES = [
    ["이야기 통신 화면", [
      ["F10", "차림표 (메뉴)"], ["F1", "이 도움말"], ["F2", "한글 종류 (KS 완성형 / 상용 조합형)"],
      ["F5", "챙긴글 보기 (Back Scroll)  - 다람쥐 휠을 위로 굴려도 됨"], ["PgDn", "파일 받음 (읽고 있는 글을 내려받기)"],
      ["Alt-D", "전화 걸기               Ctrl-F9  전화 끊기"], ["Alt-L", "갈무리 시작 / 멈춤      Alt-G    화면 저장"],
      ["Alt-V", "파일 편집 (읽기 전용)   Alt-E    챙긴글 지움"], ["Alt-W", "환경 저장 (I.CNF)       Ctrl-F8  정리하기"],
      ["Alt-Z", "색깔 바꿈               Alt-A    화면 바꿈"], ["Alt-1", "선로 속도               Ctrl-F1  커서 모양"],
      ["Alt-S", "나들이 (도스로)         Alt-X    끝내기"], ["Alt-J", "도스 명령 하나 실행"],
      ["Enter", "출력 중이면 나머지를 한꺼번에 찍는다 (Space 도 같음)"], ["다람쥐", "화면의 밝은 글자를 누르면 그 명령을 친 것과 같다"],
    ]],
    ["갈무리 보관소 (BBS) 명령", [
      ["번호", "그 번호의 글을 읽는다 (1 ~ " + POSTS.length + ")"], ["1 ~ 8", "주 메뉴에서 게시판을 고른다      9  전체 목록"],
      ["N / P", "다음 쪽 / 이전 쪽.  글을 읽은 뒤에는 N 이 다음 글"], ["L", "목록으로              T  처음 메뉴로"],
      ["S 낱말", "제목과 본문에서 낱말 찾기"], ["H, ?", "도움말                X  접속 끝"],
      ["", ""], ["읽는 중", "쪽이 끝나면  [Enter] 계속  [B] 이전 쪽  [L] 목록  [Q] 그만"],
      ["", "글 끝에서  [N] 다음 글  [L] 목록  [T] 처음"], ["PgDn", "읽고 있는 글을 Z모뎀으로 내려받는다"],
      ["", ""], ["모뎀 명령", "ATZ  AT  ATI  ATH  ATDT 번호   (전화번호부: 555-1996)"],
    ]],
    ["이야기 문서 편집기", [
      ["↑ ↓ ← →", "커서 옮기기"], ["PgUp / PgDn", "한 화면 위 / 아래"], ["Home / End", "줄 처음 / 줄 끝"],
      ["Ctrl-Home", "글 처음          Ctrl-End  글 끝"], ["다람쥐 휠", "위 아래로 굴리기"],
      ["F1", "이 도움말"], ["Esc, Ctrl-X", "통신 화면으로 돌아가기"], ["", ""],
      ["", "웹 이야기의 편집기는 읽기 전용입니다."], ["", "파일 이름에 * ? 를 쓰면 파일 고르기 창이 나옵니다."],
    ]],
    ["챙긴글 보기 (F5)", [
      ["↑ ↓", "한 줄씩"], ["PgUp / PgDn", "한 화면씩"], ["Home / End", "맨 처음 / 맨 끝"], ["다람쥐 휠", "위 아래로 굴리기. 맨 아래까지 내리면 빠져나온다"],
      ["S", "지금 보이는 화면과 챙긴글을 .CHA 파일로 저장"], ["F5, Esc", "빠짐"], ["", ""],
      ["", "챙긴글은 최대 600 줄 (화면 약 20 장) 을 기억합니다."],
    ]],
    ["도스 화면 (나들이 · 끝내기)", [
      ["DIR [파일] [/P]", "파일 목록      DIR *.CAP | MORE"], ["TYPE 파일", "파일 내용 보기  TYPE AUTO.CAP | MORE"],
      ["CLS / VER / MEM", "화면 지움 / 판 번호 / 기억 용량"], ["CD / DATE / TIME", "도스 명령 흉내"],
      ["EXIT", "이야기로 돌아감 (나들이였을 때)"], ["I", "이야기 다시 시작"], ["", ""],
      ["", "파일을 만들거나 지우는 명령은 Access denied 가 됩니다."],
    ]],
  ];
  function helpBox(page) {
    let pg = page || 0;
    const el = document.createElement("div");
    el.className = "help";
    const draw = () => {
      const [title, rows] = HELP_PAGES[pg];
      el.innerHTML =
        `<div class="ttl">사 용 설 명 서   (${pg + 1}/${HELP_PAGES.length})</div>` +
        `<div class="pane"><div class="hbox">${esc(title)}</div>` +
        rows.map(([k, v]) => `<div class="hl"><b>${esc(fit(k, 16))}</b><span>${esc(v)}</span></div>`).join("") +
        "<div class=\"hl\"> </div>".repeat(Math.max(0, 15 - rows.length)) +
        `</div><div class="foot"><span class="kb" data-k="PageUp">▲</span><span class="kb" data-k="PageDown">▼</span>` +
        `<span class="red">남은 기억용량: 259 Kbytes</span>` +
        `<span class="kb k1" data-k="PageUp">PgUp</span><span class="kb k1" data-k="PageDown">PgDn</span><span class="kb k2" data-k="Escape">CR</span>` +
        `<span class="kb k3" data-k="PageDown">TAB</span><span class="kb k3" data-k="PageUp">S_TAB</span><span class="kb k4" data-k="Escape">F1</span><span class="kb k4" data-k="Escape">@F1</span></div>`;
    };
    const d = {
      el,
      onKey(e, k) {
        if (k === "PageDown" || k === "ArrowDown" || k === "Space" || k === "ArrowRight" || k === "Tab") pg = (pg + 1) % HELP_PAGES.length;
        else if (k === "PageUp" || k === "ArrowUp" || k === "ArrowLeft") pg = (pg + HELP_PAGES.length - 1) % HELP_PAGES.length;
        else if (k === "Home") pg = 0;
        else if (k === "End") pg = HELP_PAGES.length - 1;
        else if (k === "Escape" || k === "Enter" || k === "F1") return closeDialog(d), true;
        else return true;
        draw();
        return true;
      },
    };
    el.addEventListener("click", (e) => {
      const kb = e.target.closest(".kb");
      if (kb) d.onKey(null, kb.dataset.k);
    });
    draw();
    openDialog(d);
  }

  // ------------------------------------------------------------ 파일 고르기 창
  function filePicker(pattern, cb) {
    const re = new RegExp("^" + pattern.toUpperCase().replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
    const files = dos.files().filter((f) => f.post && re.test(f.name)).sort((a, b) => (a.name < b.name ? -1 : 1));
    if (!files.length) return msgBox("파일 편집", [`${pattern.toUpperCase()} 에 맞는 파일이 없습니다.`]), cb(null);
    const COLS = 4, ROWS = 10;
    let sel = 0, top = 0;
    const el = document.createElement("div");
    el.className = "picker";
    el.innerHTML = `<div class="ttl">C:\\${esc(pattern.toUpperCase())}</div><div class="bd"><div class="grid"><div class="cells"></div><div class="sb"><i></i></div></div>` +
      `<div class="hint" style="margin-top:8px"> 화살표 PgUp PgDn : 고르기    Enter : 열기    Esc : 취소</div></div>`;
    const cells = el.querySelector(".cells"), thumb = el.querySelector(".sb i");
    const totalRows = Math.ceil(files.length / COLS);
    const draw = () => {
      const r = Math.floor(sel / COLS);
      if (r < top) top = r;
      if (r >= top + ROWS) top = r - ROWS + 1;
      let h = "";
      for (let i = top * COLS; i < (top + ROWS) * COLS; i++) {
        const f = files[i];
        h += `<div class="cell${i === sel ? " sel" : ""}" data-i="${i}">${f ? esc(f.name) : ""}</div>`;
      }
      cells.innerHTML = h;
      const vis = Math.min(1, ROWS / totalRows);
      thumb.style.height = Math.max(8, Math.floor(vis * ROWS * 16)) + "px";
      thumb.style.top = Math.floor((top / Math.max(1, totalRows)) * ROWS * 16) + "px";
    };
    const finish = (f) => {
      closeDialog(d);
      cb(f);
    };
    const d = {
      el,
      onKey(e, k) {
        const n = files.length;
        if (k === "ArrowLeft") sel = Math.max(0, sel - 1);
        else if (k === "ArrowRight") sel = Math.min(n - 1, sel + 1);
        else if (k === "ArrowUp") sel = Math.max(0, sel - COLS);
        else if (k === "ArrowDown") sel = Math.min(n - 1, sel + COLS);
        else if (k === "PageUp") sel = Math.max(0, sel - COLS * ROWS);
        else if (k === "PageDown") sel = Math.min(n - 1, sel + COLS * ROWS);
        else if (k === "Home") sel = 0;
        else if (k === "End") sel = n - 1;
        else if (k === "Enter" || k === "Space") return finish(files[sel]), true;
        else if (k === "Escape") return finish(null), true;
        else if (k.length === 1) {
          const i = files.findIndex((f, j) => j > sel && f.name.startsWith(k));
          sel = i >= 0 ? i : Math.max(0, files.findIndex((f) => f.name.startsWith(k)));
        }
        draw();
        return true;
      },
    };
    cells.addEventListener("click", (e) => {
      const c = e.target.closest(".cell");
      if (c && files[+c.dataset.i]) {
        sel = +c.dataset.i;
        draw();
      }
    });
    cells.addEventListener("dblclick", (e) => {
      const c = e.target.closest(".cell");
      if (c && files[+c.dataset.i]) finish(files[+c.dataset.i]);
    });
    el.addEventListener("wheel", (e) => {
      e.preventDefault();
      d.onKey(null, e.deltaY > 0 ? "ArrowDown" : "ArrowUp");
    }, { passive: false });
    draw();
    openDialog(d);
  }

  // ------------------------------------------------------------ 문서 편집기 (읽기 전용)
  function wrapLines(lines) {
    const out = [];
    for (const line of lines) {
      let cur = "", w = 0;
      for (const ch of line) {
        const c = T.cw(ch);
        if (w + c > 80) {
          out.push(cur);
          cur = "";
          w = 0;
        }
        cur += ch;
        w += c;
      }
      out.push(cur);
    }
    return out;
  }
  const editor = {
    file: null, rows: [], top: 0, cy: 0, cx: 0, cursorEl: null,
    open(f) {
      this.file = f;
      this.rows = wrapLines(H.postLines(f.post));
      this.top = 0;
      this.cy = 0;
      this.cx = 0;
      if (!this.cursorEl) {
        this.cursorEl = document.createElement("div");
        this.cursorEl.className = "cursor blink";
        editorEl.appendChild(this.cursorEl);
      }
      setMode("editor");
      this.render();
    },
    close() {
      setMode("term");
    },
    render() {
      let h = "";
      for (let i = 0; i < 29; i++) h += `<div class="row">${T.textRowHTML(this.rows[this.top + i] || "", 80)}</div>`;
      etext.innerHTML = h;
      const line = this.rows[this.top + this.cy] || "";
      const col = Math.min(this.cx, strWidth(line));
      this.cx = col;
      this.cursorEl.style.left = col * 8 + "px";
      this.cursorEl.style.top = this.cy * 16 + "px";
      this.renderStatus();
    },
    renderStatus() {
      if (!this.file) return;
      estat.innerHTML = `${hangulMode ? "한글" : "영문"}>-2  <b></b><b></b>  ${this.top + this.cy + 1}줄 ${this.cx + 1}칸  삽입  <i class="act" data-k="PageUp">▲</i> <i class="act" data-k="PageDown">▼</i>  C:${esc(this.file.name)}  ${this.rows.length}줄  ${clock()}`;
    },
    scroll(d) {
      const maxTop = Math.max(0, this.rows.length - 29);
      this.top = Math.max(0, Math.min(maxTop, this.top + d));
      this.render();
    },
    onKey(e, k) {
      const n = this.rows.length;
      const abs = this.top + this.cy;
      const setAbs = (a) => {
        a = Math.max(0, Math.min(n - 1, a));
        if (a < this.top) this.top = a;
        else if (a >= this.top + 29) this.top = a - 28;
        this.cy = a - this.top;
      };
      switch (k) {
        case "ArrowUp": setAbs(abs - 1); break;
        case "ArrowDown": setAbs(abs + 1); break;
        case "ArrowLeft": this.cx = Math.max(0, this.cx - 1); break;
        case "ArrowRight": this.cx = Math.min(80, this.cx + 1); break;
        case "PageUp": this.top = Math.max(0, this.top - 28); setAbs(abs - 28); break;
        case "PageDown": this.top = Math.min(Math.max(0, n - 29), this.top + 28); setAbs(abs + 28); break;
        case "Home": this.cx = 0; break;
        case "End": this.cx = 80; break;
        case "^Home": this.top = 0; this.cy = 0; break;
        case "^End": this.top = Math.max(0, n - 29); this.cy = Math.min(28, n - 1 - this.top); break;
        case "^PageUp": this.cy = 0; break;
        case "^PageDown": this.cy = Math.min(28, n - 1 - this.top); break;
        case "Escape": case "^X": this.close(); return true;
        case "F1": case "F10": return false;
        default: return !e.altKey;
      }
      this.render();
      return true;
    },
  };
  editorEl.addEventListener("wheel", (e) => {
    e.preventDefault();
    editor.scroll(e.deltaY > 0 ? 3 : -3);
  }, { passive: false });
  estat.addEventListener("click", (e) => {
    const i = e.target.closest("i[data-k]");
    if (i) editor.onKey({ altKey: false }, i.dataset.k);
  });

  // ------------------------------------------------------------ 챙긴글 보기
  const backscroll = {
    enter(lines) {
      if (mode !== "term") return;
      if (!term.history.length) return msgBox("챙긴글 보기", ["챙겨 둔 글이 없습니다."]);
      setMode("backscroll");
      term.scrollView(lines || Math.min(29, term.history.length));
      updateStatus();
    },
    exit() {
      term.viewOffset = 0;
      term.invalidate();
      setMode("term");
    },
    scroll(d) {
      const v = term.scrollView(d);
      if (v === 0) this.exit();
      else updateStatus();
    },
    save() {
      const name = `I${mmdd()}.CHA`;
      const lines = term.history.map((r) => term.rowText(r)).concat(term.screenText().split("\n"));
      saveFile(name, lines.join(CRLF));
      msgBox("화면 저장", [`${name} 에 챙긴글 ${lines.length} 줄을 저장했습니다.`]);
    },
    onKey(e, k) {
      if (k === "ArrowUp") this.scroll(1);
      else if (k === "ArrowDown") this.scroll(-1);
      else if (k === "PageUp") this.scroll(28);
      else if (k === "PageDown" || k === "Space") this.scroll(-28);
      else if (k === "Home") this.scroll(term.history.length);
      else if (k === "End" || k === "Enter") this.exit();
      else if (k === "S") this.save();
      else if (k === "F5" || k === "Escape") this.exit();
      else if (k === "F10") menu.show();
      else if (k === "F1") helpBox(3);
    },
  };

  // ------------------------------------------------------------ 글쇠
  function keyName(e) {
    let k = e.key;
    if (k === " ") k = "Space";
    else if (k === "Esc") k = "Escape";
    else if (k.length === 1) k = k.toUpperCase();
    return (e.ctrlKey ? "^" : "") + (e.altKey ? "@" : "") + k;
  }
  function onKeyDown(e) {
    if (e.isComposing || e.keyCode === 229) return;
    ensureAudio();
    const k = keyName(e);
    if (k.length === 1 && !e.ctrlKey && !e.altKey) hangulMode = false;
    if (mode === "init") return;
    if (mode === "boot") {
      e.preventDefault();
      return skipBoot();
    }
    if (mode === "splash") {
      e.preventDefault();
      if (!e.ctrlKey && !e.altKey && !e.metaKey && !/^F\d/.test(e.key)) startTerm();
      return;
    }
    if (dialogs.length) {
      if (dialogs[dialogs.length - 1].onKey(e, k) !== false) e.preventDefault();
      return;
    }
    if (menu.open) {
      e.preventDefault();
      return menu.onKey(e, k);
    }
    if (e.metaKey) return;
    if (mode === "dos") return dosKey(e, k);
    if (mode === "editor" && editor.onKey(e, k)) return e.preventDefault();
    if (mode === "backscroll") {
      e.preventDefault();
      return backscroll.onKey(e, k);
    }
    if (k === "F10") {
      e.preventDefault();
      return menu.show();
    }
    const act = KEYMAP[k];
    if (act) {
      e.preventDefault();
      return runAction(act);
    }
    if (mode === "term") termKey(e, k);
  }
  function termKey(e, k) {
    if (modem.state === "dialing") {
      e.preventDefault();
      return modem.cancelDial();
    }
    if (term.busy && (k === "Enter" || k === "Space")) {
      e.preventDefault();
      return term.flush();
    }
    if (term.keyMode) {
      if (e.key.length === 1 || k === "Enter" || k === "Escape" || k === "Space" || /^(Arrow|Page)/.test(k)) {
        e.preventDefault();
        modem.key(e.key);
      }
      return;
    }
    if (k === "Enter") {
      e.preventDefault();
      return commitLine();
    }
    if (k === "Escape") {
      e.preventDefault();
      kbd.value = "";
      term.setInput("");
      return;
    }
    if (e.ctrlKey || e.altKey) return;
    focusKbd();
  }
  function commitLine() {
    const v = kbd.value;
    kbd.value = "";
    term.commitInput(v);
    modem.line(v);
  }
  function dosKey(e, k) {
    if (dosTerm.keyMode) {
      if (e.key.length === 1 || k === "Enter" || k === "Space" || k === "Escape") {
        e.preventDefault();
        dos.key(e.key);
      }
      return;
    }
    if (k === "Enter") {
      e.preventDefault();
      const v = kbd.value;
      kbd.value = "";
      dosTerm.commitInput(v);
      dos.line(v);
    } else if (k === "Escape") {
      e.preventDefault();
      kbd.value = "";
      dosTerm.setInput("");
    } else if (k === "F10" || /^[@^]/.test(k)) {
      if (k === "@X" || k === "@S") e.preventDefault();
    } else focusKbd();
  }
  document.addEventListener("keydown", onKeyDown);
  kbd.addEventListener("input", () => {
    if (dialogs.length) {
      kbd.value = "";
      return;
    }
    activeTerm().setInput(kbd.value);
  });
  kbd.addEventListener("compositionstart", () => {
    hangulMode = true;
    updateStatus();
  });
  kbd.addEventListener("compositionend", () => activeTerm().setInput(kbd.value));
  function pressKey(key, mods) {
    onKeyDown(Object.assign({ key, ctrlKey: false, altKey: false, metaKey: false, isComposing: false, keyCode: 0, preventDefault() {} }, mods || {}));
  }

  // ------------------------------------------------------------ 다람쥐
  screenEl.addEventListener("click", (e) => {
    if (dialogs.length || menu.open) return;
    const a = e.target.closest("a.lk");
    if (a && mode === "term" && modem.state === "online") {
      const cmd = a.dataset.cmd;
      if (term.busy) term.flush();
      if (term.keyMode) modem.key(cmd === "ENTER" ? "Enter" : cmd);
      else {
        kbd.value = cmd === "ENTER" ? "" : cmd;
        term.setInput(kbd.value);
        commitLine();
      }
      return;
    }
    if (mode === "backscroll") backscroll.exit();
    focusKbd();
  });
  screenEl.addEventListener("wheel", (e) => {
    e.preventDefault();
    if (dialogs.length || menu.open) return;
    if (mode === "term") {
      if (e.deltaY < 0 && term.history.length) backscroll.enter(3);
    } else if (mode === "backscroll") backscroll.scroll(e.deltaY < 0 ? 3 : -3);
  }, { passive: false });
  dosEl.addEventListener("click", () => {
    if (mode === "boot") skipBoot();
    else focusKbd();
  });
  splash.addEventListener("click", () => startTerm());
  layer.addEventListener("mousedown", (e) => e.preventDefault());
  menubar.addEventListener("mousedown", (e) => e.preventDefault());
  document.addEventListener("pointerdown", ensureAudio, { passive: true });
  document.addEventListener("click", (e) => {
    if (menu.open && !e.target.closest("#menubar")) menu.hide();
  });

  softkeys.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    e.preventDefault();
    if (b.dataset.act === "dial") return runAction(modem.state === "online" ? "hangup" : "dial");
    if (b.dataset.act === "kbd") {
      if (dialogs.length) {
        const d = dialogs[dialogs.length - 1];
        if (d.input) d.input.focus();
      } else {
        kbd.focus();
        kbd.click();
      }
      return;
    }
    const k = b.dataset.k;
    if (mode === "term" && !term.keyMode && !dialogs.length && !menu.open && k.length === 1) {
      kbd.value = k;
      term.setInput(k);
      return commitLine();
    }
    pressKey(k);
  });

  // ------------------------------------------------------------ 시작: 도스 → 시작 화면 → 통신 화면
  function typeInto(t, text, i, cb) {
    if (i > text.length) return cb();
    t.setInput(text.slice(0, i));
    bootTimers.push(setTimeout(() => typeInto(t, text, i + 1, cb), 70 + Math.random() * 60));
  }
  function boot() {
    setMode("boot");
    dos.cwd = "C:\\";
    dosTerm.write("Starting DOS..." + CRLF + CRLF + "HIMEM is testing extended memory...done." + CRLF);
    dos.prompt();
    bootTimers.push(setTimeout(() => {
      typeInto(dosTerm, "CD \\I", 0, () => {
        dosTerm.commitInput("CD \\I");
        dos.line("CD \\I");
        bootTimers.push(setTimeout(() => {
          typeInto(dosTerm, "I", 0, () => {
            dosTerm.commitInput("I");
            bootTimers.push(setTimeout(() => dos.line("I"), 400));
          });
        }, 400));
      });
    }, 600));
  }
  function skipBoot() {
    for (const t of bootTimers) clearTimeout(t);
    bootTimers.length = 0;
    dos.cwd = "C:\\I";
    showSplash();
  }
  function showSplash() {
    if (mode === "splash") return;
    dosTerm.inputPos = null;
    setMode("splash");
  }
  function startTerm() {
    if (mode !== "splash") return;
    setMode("term");
    applyAll();
    modem.init(() => {
      if (!dialOpenedOnce && modem.state === "cmd" && !dialogs.length) {
        dialOpenedOnce = true;
        dialBox();
      }
    });
  }
  function dosExit(kind) {
    if (kind === "i") {
      if (mode === "boot") return showSplash();
      location.reload();
      return;
    }
    if (dosReturn === "shell" || dosReturn === "cmd") {
      dosReturn = null;
      setMode("term");
      term.invalidate();
    } else {
      dosTerm.write(CRLF + "이야기를 다시 시작하려면 I 를 치십시오." + CRLF);
      dos.prompt();
    }
  }

  // ------------------------------------------------------------ 창 크기
  function layout() {
    const vv = window.visualViewport;
    const W = vv ? vv.width : window.innerWidth;
    const Hh = (vv ? vv.height : window.innerHeight) - (getComputedStyle(softkeys).display === "none" ? 0 : softkeys.offsetHeight);
    // 위아래에 얇은 검은 여백을 두고, 남은 화면을 4:3 비율로 최대한 채운다.
    const marginY = Math.min(16, Hh * 0.03);
    const s = Math.min(W / 640, (Hh - marginY * 2) / 480);
    stage.style.transform = `scale(${s})`;
    stage.style.left = Math.floor((W - 640 * s) / 2) + "px";
    stage.style.top = Math.floor((Hh - 480 * s) / 2) + "px";
  }
  window.addEventListener("resize", layout);
  if (window.visualViewport) window.visualViewport.addEventListener("resize", layout);

  const fontReady = document.fonts && document.fonts.load ? Promise.race([document.fonts.load('16px "Neo둥근모"'), new Promise((r) => setTimeout(r, 2000))]) : Promise.resolve();
  fontReady.then(() => {
    layout();
    applyColor();
    applyCursor();
    term.bps = cnf.bps;
    term.garble = cnf.hangul === "johab";
    if (!startFromRoute()) boot();
  });

  window.IYAGI = { term, dosTerm, modem, dos, cnf, setMode, pressKey, get mode() { return mode; }, editor, backscroll, menu, dialogs, dialBox, helpBox };
})();
