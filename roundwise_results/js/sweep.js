/* Flipped Seat Analysis page */

const SW_ANIM_MS  = 500;
const SW_PAUSE_MS = 1100;

let swChart    = null;
let swTimer    = null;
let swCurRound = 0;
let swMaxRound = 0;
let swRoundData   = {};
let swRoundTotals = {};
let swParties  = [];
let swACs      = [];
let swWinners  = {};
let swFlipInfo = {};   // { acNum: { party2021, party2026 } }
let swPlaying  = false;
let swSortMode = 'num';

function parseSwCSV(text) {
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

function parseSweepInfo(text) {
  const info = {};
  text.replace(/\r\n/g, '\n').trim().split('\n').slice(1).forEach(line => {
    const parts = line.split(',');
    const n = parseInt(parts[0]);
    if (!isNaN(n)) info[n] = { party2021: parts[2] || '', party2026: parts[3] || '' };
  });
  return info;
}

async function initSweep() {
  try {
    const [allResp, sweepResp] = await Promise.all([
      fetch('RoundWise/S25/ALL_roundwise_S25.csv'),
      fetch('sweep.csv'),
    ]);
    if (!allResp.ok || !sweepResp.ok) throw new Error('fetch failed');

    const [allText, sweepText] = await Promise.all([
      allResp.text(),
      sweepResp.text(),
    ]);

    swFlipInfo = parseSweepInfo(sweepText);
    const sweepSet = new Set(Object.keys(swFlipInfo).map(Number));

    const allRows = parseSwCSV(allText);
    const rows = allRows.filter(r => sweepSet.has(parseInt(r.AC_Number)));

    swProcessData(rows);
    swBuildChart();
    swRenderGrid();
    hideSplash();
    setTimeout(() => swPlay(), 400);
  } catch (e) {
    document.getElementById('loadErr').style.display = '';
    hideSplash();
  }
}

function swProcessData(rows) {
  const roundParty   = {};
  const partyTotals  = {};
  const acMap        = {};
  const acMaxRoundNum = {};

  rows.forEach(r => {
    const round = parseInt(r.Round);
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

  const acLastCands = {};
  rows.forEach(r => {
    const round = parseInt(r.Round);
    const acNum = r.AC_Number;
    if (round !== acMaxRoundNum[acNum]) return;
    const total = parseInt(r.Total_Votes) || 0;
    if (!acLastCands[acNum]) acLastCands[acNum] = [];
    acLastCands[acNum].push({ name: r.Candidate, party: r.Party, total });
  });
  Object.entries(acLastCands).forEach(([acNum, cands]) => {
    cands.sort((a, b) => b.total - a.total);
    const w = cands[0], r2 = cands[1];
    swWinners[acNum] = { ...w, margin: r2 ? w.total - r2.total : w.total };
  });

  const sorted = Object.entries(partyTotals)
    .filter(([p]) => p !== 'None of the Above' && p !== 'Independent')
    .sort(([, a], [, b]) => b - a);

  swParties = [...sorted.slice(0, 8).map(([p]) => p), 'Independent', 'None of the Above'];

  swMaxRound = Math.max(...Object.keys(roundParty).map(Number));
  const running = {};
  swParties.forEach(p => (running[p] = 0));

  for (let r = 1; r <= swMaxRound; r++) {
    const rData = roundParty[r] || {};
    swParties.forEach(p => { running[p] += rData[p] || 0; });
    swRoundData[r]   = { ...running };
    swRoundTotals[r] = swParties.reduce((s, p) => s + running[p], 0);
  }

  swACs = Object.values(acMap).sort((a, b) => a.num - b.num);
}

function swBuildChart() {
  const ctx = document.getElementById('swChart').getContext('2d');

  const datasets = swParties.map(party => ({
    label:                getPartyAbbr(party),
    data:                 [],
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

  swChart = new Chart(ctx, {
    type: 'line',
    data: { labels: [], datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation:   { duration: SW_ANIM_MS, easing: 'easeInOutCubic' },
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

  const leg = document.getElementById('swLegend');
  swParties.forEach(party => {
    const el = document.createElement('div');
    el.className = 'legend-item';
    el.innerHTML = `<div class="legend-dot" style="background:${getPartyColor(party)}"></div>
                    <span title="${party}">${getPartyAbbr(party)}</span>`;
    leg.appendChild(el);
  });
}

function swShowStats(r) {
  const panel = document.getElementById('swStatsPanel');
  const total = swRoundTotals[r] || 1;
  const data  = swRoundData[r] || {};
  panel.innerHTML = swParties.map(p => {
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

function swHideStats() {
  document.getElementById('swStatsPanel').classList.remove('visible');
}

function swAddRound(r) {
  const data = swRoundData[r];
  if (!data) return;
  swChart.data.labels.push(`R${r}`);
  swParties.forEach((p, i) => {
    swChart.data.datasets[i].data.push(data[p] || 0);
  });
  swChart.update();
  document.getElementById('swRoundBadge').textContent = `Round ${r} / ${swMaxRound}`;
}

function swPlay() {
  if (swPlaying) return;
  swPlaying = true;
  document.getElementById('swPlayBtn').textContent = '⏸ Pause';

  function tick() {
    if (!swPlaying) return;
    swCurRound++;
    if (swCurRound > swMaxRound) {
      swPlaying = false;
      document.getElementById('swPlayBtn').textContent = '▶ Replay';
      return;
    }
    swAddRound(swCurRound);
    swTimer = setTimeout(() => {
      swShowStats(swCurRound);
      swTimer = setTimeout(tick, SW_PAUSE_MS);
    }, SW_ANIM_MS);
  }
  tick();
}

function swPause() {
  swPlaying = false;
  clearTimeout(swTimer);
  document.getElementById('swPlayBtn').textContent = '▶ Play';
}

function swReset() {
  swPause();
  swHideStats();
  swCurRound = 0;
  swChart.data.labels = [];
  swChart.data.datasets.forEach(d => (d.data = []));
  swChart.update('none');
  document.getElementById('swRoundBadge').textContent = 'Round — / —';
  document.getElementById('swPlayBtn').textContent = '▶ Play';
}

function swMakeCard(ac) {
  const numPad = ac.num.toString().padStart(3, '0');
  const winner = swWinners[String(ac.num)];
  const flip   = swFlipInfo[ac.num];

  let winnerHTML = '';
  if (winner) {
    const shortName = titleCase(winner.name).split(' ').slice(-2).join(' ');
    winnerHTML = `<div class="ac-winner">
      <div class="party-dot" style="background:${getPartyColor(winner.party)}"></div>
      <span>${shortName} · ${getPartyAbbr(winner.party)}</span>
    </div>
    <div class="ac-margin">+${fmtN(winner.margin)}</div>`;
  }

  let flipHTML = '';
  if (flip) {
    flipHTML = `<div class="flip-arrow">${flip.party2021} → ${flip.party2026}</div>`;
  }

  const a = document.createElement('a');
  a.className = 'ac-card sweep';
  a.href = `ac.html?ac=${numPad}_${ac.name}`;
  a.innerHTML = `
    <div class="ac-card-top">
      <div class="ac-num">AC ${numPad}</div>
      <div class="sweep-badge">FLIP</div>
    </div>
    <div class="ac-name">${titleCase(ac.name)}</div>
    ${flipHTML}
    ${winnerHTML}`;
  return a;
}

function swRenderGrid() {
  const q    = document.getElementById('swSearch').value.toLowerCase();
  const grid = document.getElementById('swGrid');
  grid.innerHTML = '';

  let list = swACs.filter(ac => {
    if (q && !titleCase(ac.name).toLowerCase().includes(q) &&
             !String(ac.num).includes(q)) return false;
    return true;
  });

  if (swSortMode === 'num') {
    list.sort((a, b) => a.num - b.num);
  } else {
    list.sort((a, b) => {
      const am = swWinners[String(a.num)]?.margin || 0;
      const bm = swWinners[String(b.num)]?.margin || 0;
      return swSortMode === 'margin-desc' ? bm - am : am - bm;
    });
  }

  list.forEach(ac => grid.appendChild(swMakeCard(ac)));
  document.getElementById('swCount').textContent =
    `${list.length} flipped constituency` + (list.length !== 1 ? 'ies' : 'y');
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

  document.getElementById('swPlayBtn').addEventListener('click', () => {
    if (swCurRound >= swMaxRound) {
      swReset();
      setTimeout(swPlay, 80);
    } else if (swPlaying) {
      swPause();
    } else {
      swPlay();
    }
  });

  document.getElementById('swResetBtn').addEventListener('click', swReset);
  document.getElementById('swSearch').addEventListener('input', swRenderGrid);

  document.querySelectorAll('[data-sw-sort]').forEach(btn => {
    btn.addEventListener('click', () => {
      swSortMode = btn.dataset.swSort;
      document.querySelectorAll('[data-sw-sort]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      swRenderGrid();
    });
  });

  initSweep();
});
