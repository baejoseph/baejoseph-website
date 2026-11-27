/* Behaviour for the manuscript reference table (/manuscript/ and /사본/).
   One file serves both languages: everything is discovered from the markup, and
   the words that differ (button labels) come from data attributes.
   Jobs: the hover note, the reading-order switch, the change pills that follow
   it, the collapsible books, the collapse-all button, and the column headings
   that repeat under every book. */
(function () {
  var table = document.querySelector('.trt');
  if (!table) return;

  var root = document.documentElement;
  var lang = table.classList.contains('ko') ? 'ko' : 'en';

  /* What a pill says depends on which reading is printed first: a word the TR
     carries and the CT drops reads as "removed" going TR -> CT, "added" going
     the other way. The colour follows the same reading — mint for what the
     second line gains, rose for what it loses. */
  var KINDS = {
    en: {
      add:  { ct: ['added', 'k-add'],    tr: ['removed', 'k-drop'] },
      drop: { ct: ['dropped', 'k-drop'], tr: ['added', 'k-add'] },
      rest: { ct: ['restored', 'k-rest'], tr: ['removed', 'k-drop'] },
      chg:  { ct: ['changed', 'k-chg'],  tr: ['changed', 'k-chg'] },
      move: { ct: ['moved', 'k-move'],   tr: ['moved', 'k-move'] },
      mix:  { ct: ['mixed', 'k-mix'],    tr: ['mixed', 'k-mix'] },
      cut:  { ct: ['cut', 'k-cut'],      tr: ['cut', 'k-cut'] }
    },
    ko: {
      add:  { ct: ['추가', 'k-add'],   tr: ['삭제', 'k-drop'] },
      drop: { ct: ['삭제', 'k-drop'],  tr: ['추가', 'k-add'] },
      rest: { ct: ['복원', 'k-rest'],  tr: ['삭제', 'k-drop'] },
      chg:  { ct: ['변경', 'k-chg'],   tr: ['변경', 'k-chg'] },
      move: { ct: ['이동', 'k-move'],  tr: ['이동', 'k-move'] },
      mix:  { ct: ['복합', 'k-mix'],   tr: ['복합', 'k-mix'] },
      cut:  { ct: ['미수록', 'k-cut'], tr: ['미수록', 'k-cut'] }
    }
  };

  /* Which palette is the page actually painting? The note card and the change
     marks are drawn to sit on top of a surface, so read the rendered background
     instead of trusting data-theme: a browser can hold a "light" preference
     while the stylesheet still serves dark surfaces, and a light card on that
     page is what made the note unreadable. */
  function palette() {
    var bg = getComputedStyle(root).backgroundColor || '';
    var m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(bg);
    var lum = m ? (+m[1] * 0.299 + +m[2] * 0.587 + +m[3] * 0.114) / 255 : 0;
    var name = lum > 0.5 ? 'light' : 'dark';
    if (root.getAttribute('data-trt-palette') !== name) {
      root.setAttribute('data-trt-palette', name);
    }
  }
  palette();

  /* ── The note that follows a verse ───────────────────────────────────── */
  var rows = table.querySelectorAll('tr.tr[data-note]');

  var tip = document.createElement('div');
  tip.className = 'trt-tip';
  tip.setAttribute('role', 'tooltip');
  tip.innerHTML = '<span class="tref"></span><span class="tnote"></span>';
  document.body.appendChild(tip);

  var refEl = tip.querySelector('.tref');
  var noteEl = tip.querySelector('.tnote');
  var current = null;
  var pinned = false;

  function place(row) {
    var r = row.getBoundingClientRect();
    var tw = tip.offsetWidth;
    var th = tip.offsetHeight;
    var gap = 11;
    var above = r.top - th - gap > 8;
    var y = above ? r.top - th - gap : r.bottom + gap;
    var x = Math.min(Math.max(8, r.left - 6), window.innerWidth - tw - 8);
    tip.classList.toggle('below', !above);
    tip.style.top = Math.round(y) + 'px';
    tip.style.left = Math.round(x) + 'px';
    var ax = Math.round(r.left - x + 18);
    tip.style.setProperty('--ax', Math.max(14, Math.min(tw - 16, ax)) + 'px');
  }

  function show(row) {
    palette();
    current = row;
    refEl.textContent = row.getAttribute('data-ref') || '';
    noteEl.textContent = row.getAttribute('data-note') || '';
    tip.classList.add('on');
    place(row);
  }

  function hide() {
    current = null;
    pinned = false;
    tip.classList.remove('on');
  }

  rows.forEach(function (row) {
    row.addEventListener('mouseenter', function () { if (!pinned) show(row); });
    row.addEventListener('mouseleave', function () { if (!pinned) hide(); });
    row.addEventListener('focusin', function () { show(row); });
    row.addEventListener('focusout', function () { if (!pinned) hide(); });
    row.addEventListener('click', function (e) {
      // Touch devices have no hover: a tap pins the note, a second tap clears it.
      if (pinned && current === row) { hide(); return; }
      e.preventDefault();
      pinned = true;
      show(row);
    });
  });

  // Tap outside a row drops a pinned (touch) note.
  document.addEventListener('click', function (e) {
    if (!pinned) return;
    var row = e.target.closest ? e.target.closest('.trt tr.tr') : null;
    if (!row) hide();
  }, true);

  window.addEventListener('scroll', function () {
    if (!current) return;
    var r = current.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight) hide();
    else place(current);
  }, { passive: true });
  window.addEventListener('resize', function () { if (current) hide(); });

  /* ── Reading order ───────────────────────────────────────────────────────
     The two lines keep their identity — CT is the critical reading, TR the
     Received Text — and only which one sits on top changes. The rows are marked
     up TR first, so the switch starts on TR -> CT. The nodes are moved rather
     than visually reversed, so selecting a verse copies the lines in the order
     they are read. */
  var cells = table.querySelectorAll('tr.tr > td.c-text');
  var pills = table.querySelectorAll('.k[data-k]');

  function applyOrder(trFirst) {
    for (var i = 0; i < cells.length; i++) {
      var cell = cells[i];
      var ct = cell.querySelector('.ln.ct');
      var tr = cell.querySelector('.ln.tr');
      if (!ct || !tr) continue;
      if (trFirst) {
        if (cell.firstElementChild !== tr) cell.insertBefore(tr, ct);
      } else if (cell.firstElementChild !== ct) {
        cell.insertBefore(ct, tr);
      }
    }
  }

  function renderKinds(dir) {
    var map = KINDS[lang] || KINDS.en;
    for (var i = 0; i < pills.length; i++) {
      var pill = pills[i];
      var spec = map[pill.getAttribute('data-k')];
      if (!spec) continue;
      var v = spec[dir] || spec.tr;
      pill.textContent = v[0];
      pill.className = 'k ' + v[1];
    }
  }

  var swap = document.querySelector('.trt-swap');
  if (swap) {
    var nameA = swap.getAttribute('data-a') || 'CT';
    var nameB = swap.getAttribute('data-b') || 'TR';
    var nameLabel = swap.getAttribute('data-label') || 'Reading order';
    var slotA = swap.querySelector('.sw-a');
    var slotB = swap.querySelector('.sw-b');

    var setOrder = function (trFirst) {
      var first = trFirst ? nameB : nameA;
      var second = trFirst ? nameA : nameB;
      var spoken = nameLabel + ': ' + first + ' \u2192 ' + second;
      root.setAttribute('data-trt-order', trFirst ? 'tr' : 'ct');
      swap.setAttribute('aria-pressed', trFirst ? 'true' : 'false');
      swap.setAttribute('aria-label', spoken);
      swap.setAttribute('title', spoken);
      if (slotA) slotA.textContent = first;
      if (slotB) slotB.textContent = second;
      applyOrder(trFirst);
      renderKinds(trFirst ? 'tr' : 'ct');
      hide();
    };

    swap.addEventListener('click', function () {
      setOrder(root.getAttribute('data-trt-order') !== 'tr');
    });

    // The rows are marked up TR first, so that is the state to start from.
    setOrder(true);
  } else {
    applyOrder(true);
    renderKinds('tr');
  }

  /* ── Collapsible books ───────────────────────────────────────────────────
     Every book header becomes a real button, so the keyboard, the screen
     reader and aria-expanded all work without extra wiring. Collapsed is a
     class on the tbody, which is what the stylesheet hides. */
  var bodies = table.querySelectorAll('tbody.bk');
  var bookBtns = [];
  var books = table.querySelectorAll('tr.book');

  for (var j = 0; j < books.length; j++) {
    (function (row) {
      var td = row.children[0];
      var body = row.parentNode;
      if (!td || !body || body.tagName !== 'TBODY') return;

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'bkbtn';
      btn.setAttribute('aria-expanded', 'true');

      var caret = document.createElement('span');
      caret.className = 'bkc';
      caret.setAttribute('aria-hidden', 'true');
      btn.appendChild(caret);

      while (td.firstChild) btn.appendChild(td.firstChild);
      td.appendChild(btn);

      btn.addEventListener('click', function () {
        var open = btn.getAttribute('aria-expanded') !== 'false';
        btn.setAttribute('aria-expanded', open ? 'false' : 'true');
        body.classList.toggle('collapsed', open);
        if (open) hide();
        syncAll();
      });

      bookBtns.push(btn);
    })(books[j]);
  }

  /* ── Collapse all / expand all ───────────────────────────────────────────
     One button: it collapses everything while any book is open, and brings it
     all back once they are all closed. The label follows the state, so after
     closing books one at a time it reads "Expand all". */
  var allBtn = document.querySelector('.trt-all');

  function allCollapsed() {
    for (var i = 0; i < bodies.length; i++) {
      if (!bodies[i].classList.contains('collapsed')) return false;
    }
    return bodies.length > 0;
  }

  function syncAll() {
    if (!allBtn) return;
    var closed = allCollapsed();
    var label = allBtn.getAttribute(closed ? 'data-expand' : 'data-collapse');
    if (label && allBtn.textContent !== label) allBtn.textContent = label;
    allBtn.setAttribute('aria-pressed', closed ? 'true' : 'false');
  }

  if (allBtn) {
    allBtn.addEventListener('click', function () {
      var collapse = !allCollapsed();
      for (var i = 0; i < bodies.length; i++) {
        bodies[i].classList.toggle('collapsed', collapse);
      }
      for (var k = 0; k < bookBtns.length; k++) {
        bookBtns[k].setAttribute('aria-expanded', collapse ? 'false' : 'true');
      }
      if (collapse) hide();
      syncAll();
    });
    syncAll();
  }

  /* ── Column headings, repeated under every book ──────────────────────────
     The table's own header row is copied into each book and the original is
     hidden, so a reader who lands in the middle of Luke still has the three
     labels beside them. */
  var headRow = table.querySelector('thead tr');
  if (headRow && bodies.length) {
    table.classList.add('heads-per-book');
    for (var b = 0; b < bodies.length; b++) {
      var hrow = document.createElement('tr');
      hrow.className = 'colhead';
      for (var c = 0; c < headRow.children.length; c++) {
        var src = headRow.children[c];
        var td = document.createElement('td');
        td.className = src.className;
        td.textContent = src.textContent;
        hrow.appendChild(td);
      }
      var head = bodies[b].querySelector('tr.book');
      bodies[b].insertBefore(hrow, head ? head.nextSibling : bodies[b].firstChild);
    }
  }
})();
