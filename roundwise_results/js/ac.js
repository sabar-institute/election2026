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

const MAX_LINES = 8;

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
    buildACChart();
    buildTable();

    document.getElementById('loadingMsg').style.display = 'none';
    document.getElementById('chartWrap').style.display = '';

    hideSplash();
    setTimeout(() => playACanim(), 400);
  } catch (e) {
    document.getElementById('loadingMsg').textContent = 'Error loading data for this constituency.';
    hideSplash();
  }
}

function processACData(rows) {
  const candParty = {};
  const finalVotes = {};

  rows.forEach(r => {
    if (!candParty[r.Candidate]) candParty[r.Candidate] = r.Party;
  });

  const rounds = [...new Set(rows.map(r => parseInt(r.Round)))].sort((a, b) => a - b);
  acMaxRound = rounds[rounds.length - 1];

  rounds.forEach(round => {
    acRoundData[round] = {};
    rows.filter(r => parseInt(r.Round) === round).forEach(r => {
      acRoundData[round][r.Candidate] = {
        party:   r.Party,
        current: parseInt(r.Current_Round_Votes) || 0,
        total:   parseInt(r.Total_Votes) || 0,
      };
    });
  });

  const last = acRoundData[acMaxRound];
  Object.keys(candParty).forEach(name => {
    finalVotes[name] = last[name]?.total || 0;
  });

  const sorted = Object.keys(candParty).sort((a, b) => finalVotes[b] - finalVotes[a]);
  acCandidates = sorted.map(name => ({ name, party: candParty[name] }));

  /* Precompute round totals */
  rounds.forEach(r => {
    acRoundTotals[r] = Object.values(acRoundData[r])
      .reduce((s, v) => s + v.total, 0);
  });

  const totalVotes = Object.values(finalVotes).reduce((s, v) => s + v, 0);
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
  acChartCands   = hasOthers ? [...top, { name: '__others__', party: 'Others' }] : top;

  const datasets = acChartCands.map(cand => ({
    label:            cand.name === '__others__' ? 'Others' : getPartyAbbr(cand.party),
    data:             [],
    borderColor:      getPartyColor(cand.party),
    backgroundColor:  getPartyColor(cand.party) + '18',
    borderWidth:      cand.name === '__others__' ? 1 : 1,
    tension:          0.4,
    fill:             false,
    pointRadius:          3,
    pointHoverRadius:     5,
    pointBackgroundColor: 'transparent',
    pointBorderColor:     getPartyColor(cand.party),
    pointBorderWidth:     1,
    _cand:            cand.name,
    _party:           cand.party,
    _fullName:        cand.name === '__others__'
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
          title: { display: true, text: 'Cumulative Votes', color: '#888',
                   font: { family: 'Barlow', size: 12 } },
        },
      },
    },
  });

  /* Legend */
  const leg = document.getElementById('acLegend');
  acChartCands.forEach(cand => {
    const shortName = cand.name === '__others__'
      ? 'Others'
      : cand.name.split(' ').slice(0, 2)
          .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');

    const el = document.createElement('div');
    el.className = 'legend-item';
    el.innerHTML = `<div class="legend-dot" style="background:${getPartyColor(cand.party)}"></div>
                    <span title="${cand.name === '__others__' ? 'Others' : cand.name}">
                      ${getPartyAbbr(cand.party)}: ${shortName}
                    </span>`;
    leg.appendChild(el);
  });
}

function acShowStats(r) {
  const panel = document.getElementById('acStatsPanel');
  const total = acRoundTotals[r] || 1;
  panel.innerHTML = acChartCands.map(cand => {
    const d   = acRoundData[r]?.[cand.name];
    const v   = cand.name === '__others__'
      ? acCandidates.slice(MAX_LINES).reduce((s, c) => s + (acRoundData[r]?.[c.name]?.total || 0), 0)
      : (d?.total || 0);
    const pct = ((v / total) * 100).toFixed(1);
    const lbl = cand.name === '__others__' ? 'Others' : getPartyAbbr(cand.party);
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
        .reduce((s, c) => s + (data[c.name]?.total || 0), 0);
      ds.data.push(val);
    } else {
      ds.data.push(data[ds._cand]?.total || 0);
    }
  });

  acChart.update();
  document.getElementById('acRoundBadge').textContent = `Round ${r} / ${acMaxRound}`;
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
}

function buildTable() {
  const tbody = document.getElementById('resultsBody');
  const last  = acRoundData[acMaxRound];

  acCandidates.forEach((cand, idx) => {
    const d  = last[cand.name] || {};
    const tr = document.createElement('tr');
    if (idx === 0) tr.classList.add('winner');
    tr.innerHTML = `
      <td style="color:var(--muted);font-family:var(--font-mono)">${idx + 1}</td>
      <td style="font-weight:600">${titleCase(cand.name)}</td>
      <td><div class="party-badge">
        <div class="party-dot" style="background:${getPartyColor(cand.party)}"></div>
        <span title="${cand.party}">${getPartyAbbr(cand.party)}</span>
      </div></td>
      <td style="font-family:var(--font-mono)">${fmtN(d.total || 0)}</td>
    `;
    tbody.appendChild(tr);
  });
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

  initAC();
});
