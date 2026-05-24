/* Home page — cumulative round-wise line chart + AC grid */

const ANIM_MS  = 500;
const PAUSE_MS = 1100;

let chartInst      = null;
let animTimer      = null;
let curRound       = 0;
let maxRound       = 0;
let roundData      = {};
let roundTotals    = {};
let allParties     = [];
let allACs         = [];
let acWinners      = {};  // { acNum: { name, party, margin } }
let sweepSet       = new Set();
let isPlaying      = false;
let sortMode       = 'num';   // 'num' | 'margin-desc' | 'margin-asc'
let filterSweep    = false;
let postalPartyData = {};  // { party: total postal votes } cumulative all ACs

/* ALL_roundwise_S25.csv has no header — parse positionally */
function parseAllCSV(text) {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().split('\n')
    .map(line => {
      const v = line.split(',');
      return {
        AC_Number:           v[1],
        AC_Name:             v[2],
        Round:               v[3],
        Candidate:           v[4],
        Party:               v[5],
        Current_Round_Votes: v[7],
        Total_Votes:         v[8],
      };
    });
}

function parseSweepCSV(text) {
  const s = new Set();
  text.replace(/\r\n/g, '\n').trim().split('\n').slice(1).forEach(line => {
    const n = parseInt(line.split(',')[0]);
    if (!isNaN(n)) s.add(n);
  });
  return s;
}

async function initHome() {
  try {
    const [allResp, sweepResp] = await Promise.all([
      fetch('RoundWise/S25/ALL_roundwise_S25.csv'),
      fetch('sweep.csv'),
    ]);
    if (!allResp.ok) throw new Error('fetch failed');

    const [allText, sweepText] = await Promise.all([
      allResp.text(),
      sweepResp.ok ? sweepResp.text() : Promise.resolve(''),
    ]);

    const rows = parseAllCSV(allText);
    if (sweepText) sweepSet = parseSweepCSV(sweepText);

    processData(rows);
    buildChart();
    buildPostalChart();
    renderGrid();
    const slider = document.getElementById('roundSlider');
    slider.max = maxRound;
    slider.value = 0;
    updateSliderFill(slider);
    buildSliderTicks(document.getElementById('roundTicks'), maxRound);
    setTimeout(hideSplash, 20);
    setTimeout(() => playAnim(), 420);
  } catch (e) {
    document.getElementById('loadErr').style.display = '';
    setTimeout(hideSplash, 20);
  }
}

function processData(rows) {
  const roundParty  = {};
  const partyTotals = {};
  const acMap       = {};
  const acMaxRoundNum = {};

  /* Pass 1: EVM chart aggregates + max round per AC (skip postal rows) */
  rows.forEach(r => {
    const round = parseInt(r.Round);
    if (isNaN(round)) return;
    const party = r.Party;
    const curr  = parseInt(r.Current_Round_Votes) || 0;
    const acNum = r.AC_Number;
    const acKey = acNum + '|' + r.AC_Name;

    if (!acMap[acKey]) acMap[acKey] = { num: parseInt(acNum), name: r.AC_Name };
    if (!roundParty[round]) roundParty[round] = {};
    roundParty[round][party] = (roundParty[round][party] || 0) + curr;
    partyTotals[party] = (partyTotals[party] || 0) + curr;

    if (!acMaxRoundNum[acNum] || round > acMaxRoundNum[acNum])
      acMaxRoundNum[acNum] = round;
  });

  /* Pass 2: winners from last EVM round */
  const acLastCands = {};
  rows.forEach(r => {
    const round = parseInt(r.Round);
    if (isNaN(round)) return;
    const acNum = r.AC_Number;
    if (round !== acMaxRoundNum[acNum]) return;
    const total = parseInt(r.Total_Votes) || 0;
    if (!acLastCands[acNum]) acLastCands[acNum] = [];
    acLastCands[acNum].push({ name: r.Candidate, party: r.Party, total });
  });
  Object.entries(acLastCands).forEach(([acNum, cands]) => {
    cands.sort((a, b) => b.total - a.total);
    const w = cands[0], r2 = cands[1];
    acWinners[acNum] = { ...w, margin: r2 ? w.total - r2.total : w.total };
  });

  /* Pass 3: postal ballot — collect party votes + update winners to EVM+postal */
  postalPartyData = {};
  const acPostalCands = {};
  rows.forEach(r => {
    if (r.Round !== 'Postal Ballot') return;
    const party     = r.Party;
    const postalV   = parseInt(r.Current_Round_Votes) || 0;
    const combTotal = parseInt(r.Total_Votes) || 0;
    const acNum     = r.AC_Number;
    postalPartyData[party] = (postalPartyData[party] || 0) + postalV;
    if (!acPostalCands[acNum]) acPostalCands[acNum] = [];
    acPostalCands[acNum].push({ name: r.Candidate, party, total: combTotal });
  });
  Object.entries(acPostalCands).forEach(([acNum, cands]) => {
    if (!cands.length) return;
    cands.sort((a, b) => b.total - a.total);
    const w = cands[0], r2 = cands[1];
    acWinners[acNum] = { ...w, margin: r2 ? w.total - r2.total : w.total };
  });

  /* Top 8 parties (excl IND/NOTA), append those */
  const sorted = Object.entries(partyTotals)
    .filter(([p]) => p !== 'None of the Above' && p !== 'Independent')
    .sort(([, a], [, b]) => b - a);

  allParties = [...sorted.slice(0, 8).map(([p]) => p), 'Independent', 'None of the Above'];

  /* Cumulative per round */
  maxRound = Math.max(...Object.keys(roundParty).map(Number));
  const running = {};
  allParties.forEach(p => (running[p] = 0));

  for (let r = 1; r <= maxRound; r++) {
    const rData = roundParty[r] || {};
    allParties.forEach(p => { running[p] += rData[p] || 0; });
    roundData[r]   = { ...running };
    roundTotals[r] = allParties.reduce((s, p) => s + running[p], 0);
  }

  allACs = Object.values(acMap).sort((a, b) => a.num - b.num);
}

function buildPostalChart() {
  const NOTA_KEY = 'None of the Above';
  const nota     = postalPartyData[NOTA_KEY] || 0;
  const rest     = Object.entries(postalPartyData)
    .filter(([p]) => p !== NOTA_KEY)
    .sort(([, a], [, b]) => b - a);
  const top6   = rest.slice(0, 6);
  const others = rest.slice(6).reduce((s, [, v]) => s + v, 0);

  const labels   = [...top6.map(([p]) => getPartyAbbr(p)), 'Others', 'NOTA'];
  const values   = [...top6.map(([, v]) => v), others, nota];
  const bgColors = [...top6.map(([p]) => getPartyColor(p) + 'bb'), '#66666688', '#44444488'];
  const bdColors = [...top6.map(([p]) => getPartyColor(p)), '#666666', '#444444'];

  const ctx = document.getElementById('postalChart').getContext('2d');
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

function buildChart() {
  const ctx = document.getElementById('mainChart').getContext('2d');

  const datasets = allParties.map(party => ({
    label:                getPartyAbbr(party),
    data:                 [0],
    borderColor:          getPartyColor(party),
    backgroundColor:      getPartyColor(party) + '18',
    borderWidth:          1,
    tension:              0.4,
    fill:                 false,
    pointRadius:          3,
    pointHoverRadius:     5,
    pointBackgroundColor: 'transparent',
    pointBorderColor:     getPartyColor(party),
    pointBorderWidth:     1,
    _fullName:            party,
  }));

  chartInst = new Chart(ctx, {
    type: 'line',
    data: { labels: ['R0'], datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation:   { duration: ANIM_MS, easing: 'easeInOutCubic' },
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

  const leg = document.getElementById('legend');
  allParties.forEach(party => {
    const el = document.createElement('div');
    el.className = 'legend-item';
    el.innerHTML = `<div class="legend-dot" style="background:${getPartyColor(party)}"></div>
                    <span title="${party}">${getPartyAbbr(party)}</span>`;
    leg.appendChild(el);
  });
}

function showStatsPanel(r) {
  const panel = document.getElementById('statsPanel');
  const total = roundTotals[r] || 1;
  const data  = roundData[r] || {};
  panel.innerHTML = allParties.map(p => {
    const v   = data[p] || 0;
    const pct = ((v / total) * 100).toFixed(1);
    return `<div class="stats-item">
      <div class="stats-dot" style="background:${getPartyColor(p)}"></div>
      <span class="stats-abbr">${getPartyAbbr(p)}</span>
      <span class="stats-val">${fmtN(v)} <span class="stats-pct">(${pct}%)</span></span>
    </div>`;
  }).join('');
  panel.classList.add('visible');
}

function hideStatsPanel() {
  document.getElementById('statsPanel').classList.remove('visible');
}

function addRound(r) {
  const data = roundData[r];
  if (!data) return;
  chartInst.data.labels.push(`R${r}`);
  allParties.forEach((p, i) => {
    chartInst.data.datasets[i].data.push(data[p] || 0);
  });
  chartInst.update();
  document.getElementById('roundBadge').textContent = `Round ${r} / ${maxRound}`;
  const sl = document.getElementById('roundSlider');
  sl.value = r;
  updateSliderFill(sl);
}

function jumpToRound(r) {
  pauseAnim();
  chartInst.data.labels = ['R0'];
  chartInst.data.datasets.forEach(d => (d.data = [0]));
  for (let i = 1; i <= r; i++) {
    const data = roundData[i];
    if (!data) continue;
    chartInst.data.labels.push(`R${i}`);
    allParties.forEach((p, idx) => { chartInst.data.datasets[idx].data.push(data[p] || 0); });
  }
  curRound = r;
  chartInst.update('none');
  const sl = document.getElementById('roundSlider');
  sl.value = r;
  updateSliderFill(sl);
  document.getElementById('roundBadge').textContent = r > 0 ? `Round ${r} / ${maxRound}` : 'Round — / —';
  document.getElementById('playBtn').textContent = r >= maxRound ? '▶ Replay' : '▶ Play';
  if (r > 0) showStatsPanel(r); else hideStatsPanel();
}

function playAnim() {
  if (isPlaying) return;
  isPlaying = true;
  document.getElementById('playBtn').textContent = '⏸ Pause';

  function tick() {
    if (!isPlaying) return;
    curRound++;
    if (curRound > maxRound) {
      isPlaying = false;
      document.getElementById('playBtn').textContent = '▶ Replay';
      return;
    }
    addRound(curRound);
    animTimer = setTimeout(() => {
      showStatsPanel(curRound);
      animTimer = setTimeout(tick, PAUSE_MS);
    }, ANIM_MS);
  }
  tick();
}

function pauseAnim() {
  isPlaying = false;
  clearTimeout(animTimer);
  document.getElementById('playBtn').textContent = '▶ Play';
}

function resetAnim() {
  pauseAnim();
  hideStatsPanel();
  curRound = 0;
  chartInst.data.labels = ['R0'];
  chartInst.data.datasets.forEach(d => (d.data = [0]));
  chartInst.update('none');
  document.getElementById('roundBadge').textContent = 'Round — / —';
  document.getElementById('playBtn').textContent = '▶ Play';
  const sl = document.getElementById('roundSlider');
  sl.value = 0;
  updateSliderFill(sl);
}

function makeCard(ac) {
  const numPad  = ac.num.toString().padStart(3, '0');
  const isSweep = sweepSet.has(ac.num);
  const winner  = acWinners[String(ac.num)];

  let winnerHTML = '';
  if (winner) {
    const shortName = titleCase(winner.name).split(' ').slice(-2).join(' ');
    winnerHTML = `<div class="ac-winner">
      <div class="party-dot" style="background:${getPartyColor(winner.party)}"></div>
      <span>${shortName} · ${getPartyAbbr(winner.party)}</span>
    </div>
    <div class="ac-margin">+${fmtN(winner.margin)}</div>`;
  }

  const a = document.createElement('a');
  a.className = 'ac-card' + (isSweep ? ' sweep' : '');
  a.href = `ac.html?ac=${numPad}_${ac.name}`;
  a.innerHTML = `
    <div class="ac-card-top">
      <div class="ac-num">AC ${numPad}</div>
      ${isSweep ? '<div class="sweep-badge">FLIP</div>' : ''}
    </div>
    <div class="ac-name">${titleCase(ac.name)}</div>
    ${winnerHTML}`;
  return a;
}

function renderGrid() {
  const q    = document.getElementById('search').value.toLowerCase();
  const grid = document.getElementById('acGrid');
  grid.innerHTML = '';

  let list = allACs.filter(ac => {
    if (filterSweep && !sweepSet.has(ac.num)) return false;
    if (q && !titleCase(ac.name).toLowerCase().includes(q) &&
             !String(ac.num).includes(q)) return false;
    return true;
  });

  if (sortMode === 'num') {
    list.sort((a, b) => a.num - b.num);
  } else {
    list.sort((a, b) => {
      const am = acWinners[String(a.num)]?.margin || 0;
      const bm = acWinners[String(b.num)]?.margin || 0;
      return sortMode === 'margin-desc' ? bm - am : am - bm;
    });
  }

  list.forEach(ac => grid.appendChild(makeCard(ac)));
  document.getElementById('acCount').textContent =
    `${list.length} constituency` + (list.length !== 1 ? 'ies' : 'y') +
    (filterSweep ? ' · sweep' : '');
}

function hideSplash() {
  const el = document.getElementById('splash');
  el.classList.add('hide');
  setTimeout(() => el.remove(), 700);
}

document.addEventListener('DOMContentLoaded', () => {
  injectLogo(document.querySelector('.logo-svg'), '270 455 540 187');
  injectLogo(document.querySelector('.sp-logo'),  '270 455 540 187');

  document.getElementById('playBtn').addEventListener('click', () => {
    if (curRound >= maxRound) {
      resetAnim();
      setTimeout(playAnim, 80);
    } else if (isPlaying) {
      pauseAnim();
    } else {
      playAnim();
    }
  });

  document.getElementById('resetBtn').addEventListener('click', resetAnim);

  document.getElementById('roundSlider').addEventListener('input', function () {
    updateSliderFill(this);
    jumpToRound(parseInt(this.value));
  });

  document.getElementById('search').addEventListener('input', renderGrid);

  /* Sort buttons */
  document.querySelectorAll('[data-sort]').forEach(btn => {
    btn.addEventListener('click', () => {
      sortMode = btn.dataset.sort;
      document.querySelectorAll('[data-sort]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderGrid();
    });
  });

  /* Sweep filter toggle */
  document.getElementById('sweepFilter').addEventListener('click', function () {
    filterSweep = !filterSweep;
    this.classList.toggle('active', filterSweep);
    renderGrid();
  });

  initHome();
});
