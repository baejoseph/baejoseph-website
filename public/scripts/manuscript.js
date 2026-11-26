/* Behaviour for the manuscript reference table (/manuscript/ and /사본/).
   One file serves both languages: everything is discovered from the markup, and
   the two short names on the order switch come from its data attributes.
   Three jobs — the hover note, the reading-order switch, the collapsible books. */
(function () {
  var table = document.querySelector('.trt');
  if (!table) return;

  var root = document.documentElement;

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
     The two lines keep their identity — grey is the critical reading, the
     arrowed one the Received Text — and only which line sits on top changes.
     The nodes are moved rather than visually reversed, so selecting a verse
     copies the lines in the order they are read, and so the note keeps
     pointing at the same row. */
  var cells = table.querySelectorAll('td.c-text');

  function applyOrder(trFirst) {
    for (var i = 0; i < cells.length; i++) {
      var cell = cells[i];
      var before = cell.querySelector('.ln.b');
      if (!before) continue;
      if (trFirst) {
        if (cell.firstElementChild === before) cell.appendChild(before);
      } else if (cell.lastElementChild === before) {
        cell.insertBefore(before, cell.firstElementChild);
      }
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
      hide();
    };

    swap.addEventListener('click', function () {
      setOrder(root.getAttribute('data-trt-order') !== 'tr');
    });

    setOrder(root.getAttribute('data-trt-order') === 'tr');
  }

  /* ── Collapsible books ───────────────────────────────────────────────────
     Every book header becomes a real button, so the keyboard, the screen
     reader and aria-expanded all work without extra wiring. Collapsed is a
     class on the tbody, which is what the stylesheet hides. */
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
      });
    })(books[j]);
  }
})();
