(() => {
  'use strict';

  const MONTHS = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December'
  ];

  const input       = document.getElementById('date-input');
  const clearBtn    = document.getElementById('clear-btn');
  const calendar    = document.getElementById('calendar');
  const monthYear   = document.getElementById('month-year');
  const calGrid     = document.getElementById('cal-grid');
  const prevYear    = document.getElementById('prev-year');
  const prevMonth   = document.getElementById('prev-month');
  const nextMonth   = document.getElementById('next-month');
  const nextYear    = document.getElementById('next-year');
  const todayBtn    = document.getElementById('today-btn');
  const selectedDisp = document.getElementById('selected-display');

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let viewYear   = today.getFullYear();
  let viewMonth  = today.getMonth();   // 0-based
  let selected   = null;               // Date | null
  let isOpen     = false;

  /* ─── Helpers ─────────────────────────────── */

  function sameDay(a, b) {
    return a && b &&
      a.getFullYear() === b.getFullYear() &&
      a.getMonth()    === b.getMonth()    &&
      a.getDate()     === b.getDate();
  }

  function formatDate(d) {
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${mm} / ${dd} / ${yyyy}`;
  }

  /* ─── Render ───────────────────────────────── */

  function renderCalendar() {
    monthYear.textContent = `${MONTHS[viewMonth]} ${viewYear}`;

    const firstDay = new Date(viewYear, viewMonth, 1).getDay(); // 0=Sun
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const daysInPrev  = new Date(viewYear, viewMonth, 0).getDate();

    calGrid.innerHTML = '';

    // Leading days from previous month
    for (let i = firstDay - 1; i >= 0; i--) {
      const day = daysInPrev - i;
      const date = new Date(viewYear, viewMonth - 1, day);
      calGrid.appendChild(makeDay(day, date, ['other-month']));
    }

    // Days of current month
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(viewYear, viewMonth, d);
      const classes = [];
      if (sameDay(date, today))    classes.push('today');
      if (sameDay(date, selected)) classes.push('selected');
      calGrid.appendChild(makeDay(d, date, classes));
    }

    // Trailing days to complete the last row
    const total = firstDay + daysInMonth;
    const trailing = total % 7 === 0 ? 0 : 7 - (total % 7);
    for (let d = 1; d <= trailing; d++) {
      const date = new Date(viewYear, viewMonth + 1, d);
      calGrid.appendChild(makeDay(d, date, ['other-month']));
    }
  }

  function makeDay(label, date, extraClasses = []) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.className = ['day', ...extraClasses].join(' ');
    btn.setAttribute('aria-label', date.toDateString());
    if (extraClasses.includes('selected')) {
      btn.setAttribute('aria-pressed', 'true');
    }
    btn.addEventListener('click', () => selectDate(date));
    return btn;
  }

  /* ─── Open / Close ─────────────────────────── */

  function open() {
    if (isOpen) return;
    isOpen = true;
    calendar.removeAttribute('hidden');
    input.classList.add('open');
    input.setAttribute('aria-expanded', 'true');
    renderCalendar();
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    calendar.setAttribute('hidden', '');
    input.classList.remove('open');
    input.setAttribute('aria-expanded', 'false');
  }

  function toggle() {
    isOpen ? close() : open();
  }

  /* ─── Selection ────────────────────────────── */

  function selectDate(date) {
    selected = new Date(date);
    selected.setHours(0, 0, 0, 0);
    input.value = formatDate(selected);
    clearBtn.removeAttribute('hidden');
    selectedDisp.textContent = `Selected: ${selected.toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    })}`;
    viewYear  = selected.getFullYear();
    viewMonth = selected.getMonth();
    renderCalendar();
    close();
    input.focus();
  }

  function clearSelection() {
    selected = null;
    input.value = '';
    clearBtn.setAttribute('hidden', '');
    selectedDisp.textContent = '';
  }

  /* ─── Navigation ───────────────────────────── */

  function navigate(deltaYear, deltaMonth) {
    viewMonth += deltaMonth;
    viewYear  += deltaYear;

    if (viewMonth > 11) { viewMonth -= 12; viewYear++; }
    if (viewMonth < 0)  { viewMonth += 12; viewYear--; }

    renderCalendar();
  }

  /* ─── Event listeners ──────────────────────── */

  input.addEventListener('click', toggle);

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    if (e.key === 'Escape') close();
  });

  clearBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    clearSelection();
  });

  prevYear.addEventListener('click',  () => navigate(-1,  0));
  nextYear.addEventListener('click',  () => navigate( 1,  0));
  prevMonth.addEventListener('click', () => navigate( 0, -1));
  nextMonth.addEventListener('click', () => navigate( 0,  1));

  todayBtn.addEventListener('click', () => selectDate(today));

  // Close when clicking outside
  document.addEventListener('click', (e) => {
    if (isOpen && !calendar.contains(e.target) && e.target !== input) {
      close();
    }
  });

  // Keyboard navigation inside the grid
  calGrid.addEventListener('keydown', (e) => {
    const days = [...calGrid.querySelectorAll('.day:not(.other-month)')];
    const idx  = days.indexOf(document.activeElement);
    if (idx === -1) return;

    const moves = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 7, ArrowUp: -7 };
    if (e.key in moves) {
      e.preventDefault();
      const next = days[idx + moves[e.key]];
      if (next) next.focus();
    }
    if (e.key === 'Escape') { close(); input.focus(); }
  });

  // Initial render
  renderCalendar();
})();
