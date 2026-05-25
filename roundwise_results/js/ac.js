/* AC detail page */

const AC_ANIM_MS  = 500;
const AC_PAUSE_MS = 1100;

let acChart      = null;
let acAnimTimer  = null;
let acCurRound   = 0;
let acMaxRound   = 0;
let acRoundData  = {};
let acRoundTotals = {};
let acCandidates = [];
let acChartCands = [];
let acIsPlaying  = false;
let acPostalData     = {};  // { party: postal votes } for this AC
let acPostalCandData = {};  // { candKey: postal votes } for this AC

const MAX_LINES = 8;

/* Unique key to handle duplicate candidate names across different parties */
function candKey(name, party) { return name + '|||' + party; }

async function initAC() {
  const params   = new URLSearchParams(window.location.search);
  const acParam  = params.get('ac');
  if (!acParam) { window.location.href = 'index.html'; return; }

  const parts       = acParam.split('_');
  const acNum       = parts[0];
  const acName      = parts.slice(1).join('_');
  const displayName = titleCase(acName);

  document.title = `${displayName} — SIR Round Data`;
  document.getElementById('acTitle').innerHTML =
    `<em>#${parseInt(acNum)}</em> ${displayName}`;
  document.getElementById('acMeta').textContent =
    `West Bengal Assembly · Constituency ${parseInt(acNum)}`;

  try {
    const resp = await fetch(`RoundWise/S25/AC${acParam}.csv`);
    if (!resp.ok) throw new Error('not found');
    const text = await resp.text();
    const rows = parseCSV(text);

    processACData(rows);
    document.getElementById('loadingMsg').style.display = 'none';
    document.getElementById('chartWrap').style.display = '';
    buildACChart();
    buildPostalBar();
    buildTable();
    const slider = document.getElementById('acRoundSlider');
    slider.max = acMaxRound;
    slider.value = 0;
    updateSliderFill(slider);
    buildSliderTicks(document.getElementById('acRoundTicks'), acMaxRound);
    buildRoundButtons();
    document.querySelector('#roundBtnRow .filter-btn')?.click();

    hideSplash();
    setTimeout(() => playACanim(), 400);
  } catch (e) {
    document.getElementById('loadingMsg').textContent = 'Error loading data for this constituency.';
    hideSplash();
  }
}

function processACData(rows) {
  const candMap    = {};  // key -> { name, party }
  const finalVotes = {};
  acPostalData     = {};

  const evmRows    = rows.filter(r => !isNaN(parseInt(r.Round)));
  const postalRows = rows.filter(r =>  isNaN(parseInt(r.Round)));

  acPostalCandData = {};
  postalRows.forEach(r => {
    const v   = parseInt(r.Current_Round_Votes) || 0;
    const key = candKey(r.Candidate, r.Party);
    acPostalData[r.Party] = (acPostalData[r.Party] || 0) + v;
    acPostalCandData[key] = (acPostalCandData[key] || 0) + v;
  });

  evmRows.forEach(r => {
    const key = candKey(r.Candidate, r.Party);
    if (!candMap[key]) candMap[key] = { name: r.Candidate, party: r.Party };
  });

  const rounds = [...new Set(evmRows.map(r => parseInt(r.Round)))].sort((a, b) => a - b);
  acMaxRound = rounds[rounds.length - 1];

  rounds.forEach(round => {
    acRoundData[round] = {};
    evmRows.filter(r => parseInt(r.Round) === round).forEach(r => {
      const key = candKey(r.Candidate, r.Party);
      acRoundData[round][key] = {
        party:   r.Party,
        name:    r.Candidate,
        current: parseInt(r.Current_Round_Votes) || 0,
        total:   parseInt(r.Total_Votes) || 0,
      };
    });
  });

  const last = acRoundData[acMaxRound];
  Object.keys(candMap).forEach(key => {
    finalVotes[key] = last[key]?.total || 0;
  });

  const sorted = Object.keys(candMap).sort((a, b) => finalVotes[b] - finalVotes[a]);
  acCandidates = sorted.map(key => ({ key, name: candMap[key].name, party: candMap[key].party }));

  /* Precompute round totals */
  rounds.forEach(r => {
    acRoundTotals[r] = Object.values(acRoundData[r])
      .reduce((s, v) => s + v.total, 0);
  });

  const postalTotal = Object.values(acPostalData).reduce((s, v) => s + v, 0);
  const totalVotes  = Object.values(finalVotes).reduce((s, v) => s + v, 0) + postalTotal;
  const winner = acCandidates[0];
  document.getElementById('statRounds').textContent  = acMaxRound;
  document.getElementById('statVotes').textContent   = fmtN(totalVotes);
  document.getElementById('statCands').textContent   = acCandidates.length;
  document.getElementById('statWinner').textContent  = winner ? getPartyAbbr(winner.party) : '—';
}

function buildACChart() {
  const ctx = document.getElementById('acChart').getContext('2d');

  const top      = acCandidates.slice(0, MAX_LINES);
  const hasOthers = acCandidates.length > MAX_LINES;
  acChartCands   = hasOthers ? [...top, { key: '__others__', name: '__others__', party: 'Others' }] : top;

  const datasets = acChartCands.map(cand => ({
    label:            cand.key === '__others__' ? 'Others' : getPartyAbbr(cand.party),
    data:             [],
    borderColor:      getPartyColor(cand.party),
    backgroundColor:  getPartyColor(cand.party) + '18',
    borderWidth:      cand.key === '__others__' ? 1 : 1,
    tension:          0.4,
    fill:             false,
    pointRadius:          3,
    pointHoverRadius:     5,
    pointBackgroundColor: 'transparent',
    pointBorderColor:     getPartyColor(cand.party),
    pointBorderWidth:     1,
    _cand:            cand.key,
    _party:           cand.party,
    _fullName:        cand.key === '__others__'
                        ? 'Others'
                        : `${cand.name} (${getPartyAbbr(cand.party)})`,
  }));

  acChart = new Chart(ctx, {
    type: 'line',
    data: { labels: [], datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation:   { duration: AC_ANIM_MS, easing: 'easeInOutCubic' },
      layout:      { padding: { top: 10 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1e1e1e',
          borderColor:     '#2a2a2a',
          borderWidth:     1,
          titleColor:      '#888',
          bodyColor:       '#e8e8e8',
          callbacks: {
            title: ctx => `Round ${ctx[0].label.replace('R', '')}`,
            label: ctx => ` ${ctx.dataset._fullName}: ${fmtN(ctx.raw)}`,
          },
        },
      },
      scales: {
        x: {
          grid:  { color: '#2a2a2a' },
          ticks: { color: '#888', font: { family: 'Courier New', size: 11 } },
          title: { display: true, text: 'Round', color: '#888',
                   font: { family: 'Barlow', size: 12 } },
        },
        y: {
          grid:  { color: '#2a2a2a' },
          ticks: { color: '#888', font: { family: 'Courier New', size: 11 },
                   callback: v => fmtN(v) },
          title: { display: true, text: 'Cumulative EVM Votes', color: '#888',
                   font: { family: 'Barlow', size: 12 } },
        },
      },
    },
  });

  /* Legend */
  const leg = document.getElementById('acLegend');
  acChartCands.forEach(cand => {
    const shortName = cand.key === '__others__'
      ? 'Others'
      : cand.name.split(' ').slice(0, 2)
          .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');

    const el = document.createElement('div');
    el.className = 'legend-item';
    el.innerHTML = `<div class="legend-dot" style="background:${getPartyColor(cand.party)}"></div>
                    <span title="${cand.key === '__others__' ? 'Others' : cand.name}">
                      ${getPartyAbbr(cand.party)}: ${shortName}
                    </span>`;
    leg.appendChild(el);
  });
}

function buildPostalBar() {
  const NOTA_KEY = 'None of the Above';
  const nota     = acPostalData[NOTA_KEY] || 0;
  const rest     = Object.entries(acPostalData)
    .filter(([p]) => p !== NOTA_KEY)
    .sort(([, a], [, b]) => b - a);
  const top6   = rest.slice(0, 6);
  const others = rest.slice(6).reduce((s, [, v]) => s + v, 0);

  const labels   = [...top6.map(([p]) => getPartyAbbr(p)), ...(others > 0 ? ['Others'] : []), 'NOTA'];
  const values   = [...top6.map(([, v]) => v), ...(others > 0 ? [others] : []), nota];
  const bgColors = [...top6.map(([p]) => getPartyColor(p) + 'bb'), ...(others > 0 ? ['#66666688'] : []), '#44444488'];
  const bdColors = [...top6.map(([p]) => getPartyColor(p)), ...(others > 0 ? ['#666666'] : []), '#444444'];

  const ctx = document.getElementById('acPostalChart').getContext('2d');
  new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{ data: values, backgroundColor: bgColors, borderColor: bdColors, borderWidth: 1, borderRadius: 4 }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1e1e1e', borderColor: '#2a2a2a', borderWidth: 1,
          titleColor: '#888', bodyColor: '#e8e8e8',
          callbacks: { label: ctx => ` ${fmtN(ctx.raw)} postal votes` }
        }
      },
      scales: {
        x: {
          grid:  { color: '#2a2a2a' },
          ticks: { color: '#888', font: { family: 'Courier New', size: 11 }, callback: v => fmtN(v) },
          title: { display: true, text: 'Postal Votes', color: '#888', font: { family: 'Barlow', size: 12 } }
        },
        y: {
          grid:  { color: 'transparent' },
          ticks: { color: '#e8e8e8', font: { family: 'Courier New', size: 12 } }
        }
      }
    }
  });
}

function acShowStats(r) {
  const panel = document.getElementById('acStatsPanel');
  const total = acRoundTotals[r] || 1;
  panel.innerHTML = acChartCands.map(cand => {
    const d   = acRoundData[r]?.[cand.key];
    const v   = cand.key === '__others__'
      ? acCandidates.slice(MAX_LINES).reduce((s, c) => s + (acRoundData[r]?.[c.key]?.total || 0), 0)
      : (d?.total || 0);
    const pct = ((v / total) * 100).toFixed(1);
    const lbl = cand.key === '__others__' ? 'Others' : getPartyAbbr(cand.party);
    return `<div class="stats-item">
      <div class="stats-dot" style="background:${getPartyColor(cand.party)}"></div>
      <span class="stats-abbr">${lbl}</span>
      <span class="stats-val">${fmtN(v)} <span class="stats-pct">(${pct}%)</span></span>
    </div>`;
  }).join('');
  panel.classList.add('visible');
}

function acHideStats() {
  document.getElementById('acStatsPanel').classList.remove('visible');
}

function addACRound(r) {
  const data = acRoundData[r];
  if (!data) return;

  acChart.data.labels.push(`R${r}`);
  acChart.data.datasets.forEach(ds => {
    if (ds._cand === '__others__') {
      const val = acCandidates.slice(MAX_LINES)
        .reduce((s, c) => s + (data[c.key]?.total || 0), 0);
      ds.data.push(val);
    } else {
      ds.data.push(data[ds._cand]?.total || 0);
    }
  });

  acChart.update();
  document.getElementById('acRoundBadge').textContent = `Round ${r} / ${acMaxRound}`;
  const sl = document.getElementById('acRoundSlider');
  sl.value = r;
  updateSliderFill(sl);
}

function jumpToACRound(r) {
  pauseACanim();
  acChart.data.labels = [];
  acChart.data.datasets.forEach(d => (d.data = []));
  for (let i = 1; i <= r; i++) {
    const data = acRoundData[i];
    if (!data) continue;
    acChart.data.labels.push(`R${i}`);
    acChart.data.datasets.forEach(ds => {
      if (ds._cand === '__others__') {
        ds.data.push(acCandidates.slice(MAX_LINES).reduce((s, c) => s + (data[c.key]?.total || 0), 0));
      } else {
        ds.data.push(data[ds._cand]?.total || 0);
      }
    });
  }
  acCurRound = r;
  acChart.update('none');
  const sl = document.getElementById('acRoundSlider');
  sl.value = r;
  updateSliderFill(sl);
  document.getElementById('acRoundBadge').textContent = r > 0 ? `Round ${r} / ${acMaxRound}` : 'Round — / —';
  document.getElementById('acPlayBtn').textContent = r >= acMaxRound ? '▶ Replay' : '▶ Play';
  if (r > 0) acShowStats(r); else acHideStats();
}

function playACanim() {
  if (acIsPlaying) return;
  acIsPlaying = true;
  document.getElementById('acPlayBtn').textContent = '⏸ Pause';

  function tick() {
    if (!acIsPlaying) return;
    acCurRound++;
    if (acCurRound > acMaxRound) {
      acIsPlaying = false;
      document.getElementById('acPlayBtn').textContent = '▶ Replay';
      return;
    }
    addACRound(acCurRound);
    acAnimTimer = setTimeout(() => {
      acShowStats(acCurRound);
      acAnimTimer = setTimeout(tick, AC_PAUSE_MS);
    }, AC_ANIM_MS);
  }
  tick();
}

function pauseACanim() {
  acIsPlaying = false;
  clearTimeout(acAnimTimer);
  document.getElementById('acPlayBtn').textContent = '▶ Play';
}

function resetACanim() {
  pauseACanim();
  acHideStats();
  acCurRound = 0;
  acChart.data.labels = [];
  acChart.data.datasets.forEach(d => (d.data = []));
  acChart.update('none');
  document.getElementById('acRoundBadge').textContent = 'Round — / —';
  document.getElementById('acPlayBtn').textContent = '▶ Play';
  const sl = document.getElementById('acRoundSlider');
  sl.value = 0;
  updateSliderFill(sl);
}

function buildTable() {
  const tbody = document.getElementById('resultsBody');
  const last  = acRoundData[acMaxRound];

  const withTotals = [...acCandidates].map(cand => {
    const evm    = last[cand.key]?.total || 0;
    const postal = acPostalCandData[cand.key] || 0;
    return { ...cand, evm, postal, total: evm + postal };
  }).sort((a, b) => b.total - a.total);

  const lead = withTotals.length >= 2 ? withTotals[0].total - withTotals[1].total : null;

  withTotals.forEach((cand, idx) => {
    const tr = document.createElement('tr');
    if (idx === 0) tr.classList.add('winner');
    const totalCell = idx === 0 && lead !== null
      ? `${fmtN(cand.total)} <span style="color:var(--accent);font-size:11px">(+${fmtN(lead)})</span>`
      : fmtN(cand.total);
    tr.innerHTML = `
      <td style="color:var(--muted);font-family:var(--font-mono)">${idx + 1}</td>
      <td style="font-weight:600">${titleCase(cand.name)}</td>
      <td><div class="party-badge">
        <div class="party-dot" style="background:${getPartyColor(cand.party)}"></div>
        <span title="${cand.party}">${getPartyAbbr(cand.party)}</span>
      </div></td>
      <td style="font-family:var(--font-mono)">${fmtN(cand.evm)}</td>
      <td style="font-family:var(--font-mono)">${fmtN(cand.postal)}</td>
      <td style="font-family:var(--font-mono)">${totalCell}</td>
    `;
    tbody.appendChild(tr);
  });
}

function buildRoundButtons() {
  const row = document.getElementById('roundBtnRow');
  row.innerHTML = '';
  for (let r = 1; r <= acMaxRound; r++) {
    const btn = document.createElement('button');
    btn.className = 'filter-btn';
    btn.textContent = `R${r}`;
    btn.dataset.round = r;
    btn.addEventListener('click', function () {
      row.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      showRoundBreak(parseInt(this.dataset.round));
    });
    row.appendChild(btn);
  }
}

function showRoundBreak(r) {
  const data = acRoundData[r];
  if (!data) return;

  document.getElementById('roundBreakTitle').textContent = `Round ${r} — Candidate Breakdown`;

  const rows = Object.entries(data).map(([key, d]) => {
    const prev   = d.total - d.current;
    const postal = acPostalCandData[key] || 0;
    return { name: d.name, party: d.party, prev, current: d.current, postal, total: d.total + postal };
  }).sort((a, b) => b.total - a.total);

  const tbody = document.getElementById('roundTableBody');
  tbody.innerHTML = '';

  rows.forEach((c, idx) => {
    const tr = document.createElement('tr');
    if (idx === 0) tr.classList.add('winner');
    tr.innerHTML = `
      <td style="color:var(--muted);font-family:var(--font-mono)">${idx + 1}</td>
      <td style="font-weight:600">${titleCase(c.name)}</td>
      <td><div class="party-badge">
        <div class="party-dot" style="background:${getPartyColor(c.party)}"></div>
        <span title="${c.party}">${getPartyAbbr(c.party)}</span>
      </div></td>
      <td style="font-family:var(--font-mono);color:var(--muted)">${fmtN(c.prev)}</td>
      <td style="font-family:var(--font-mono);color:var(--accent);font-weight:600">${fmtN(c.current)}</td>
      <td style="font-family:var(--font-mono)">${fmtN(c.postal)}</td>
      <td style="font-family:var(--font-mono);font-weight:600">${fmtN(c.total)}</td>
    `;
    tbody.appendChild(tr);
  });

  document.getElementById('roundBreakTable').style.display = '';
}

function hideSplash() {
  const el = document.getElementById('splash');
  if (!el) return;
  el.classList.add('hide');
  setTimeout(() => el.remove(), 700);
}

document.addEventListener('DOMContentLoaded', () => {
  injectLogo(document.querySelector('.logo-svg'), '270 455 540 187');
  injectLogo(document.querySelector('.sp-logo'),  '270 455 540 187');

  document.getElementById('acPlayBtn').addEventListener('click', () => {
    if (acCurRound >= acMaxRound) {
      resetACanim();
      setTimeout(playACanim, 80);
    } else if (acIsPlaying) {
      pauseACanim();
    } else {
      playACanim();
    }
  });

  document.getElementById('acResetBtn').addEventListener('click', resetACanim);

  document.getElementById('acRoundSlider').addEventListener('input', function () {
    updateSliderFill(this);
    jumpToACRound(parseInt(this.value));
  });

  initAC();
});
