let currentIndex = 0;
const info = document.getElementById('info');

function showStop(i){
  currentIndex = i;
  const s = stops[i];
  document.getElementById('title').innerText = `Остановка ${s.id}: ${s.title}`;
  const paragraphs = s.description.trim().split(/\n\n+/).map(p => `<tr><td>${p.replace(/\n/g, '<br>')}</td></tr>`).join("");
  const table = `<table class="stop-text">${paragraphs}</table></p></p></p>`;
  info.innerHTML = `<audio controls src="${s.audio}"></audio>` + table;
  if (typeof markers !== 'undefined') {
    markers.forEach((m, j) => m.getElement().classList.toggle('selected', j === i));
  }
}

function nextStop(){ showStop((currentIndex + 1) % stops.length); }
function prevStop(){ showStop((currentIndex - 1 + stops.length) % stops.length); }
function firstStop(){ showStop(0); }

if (typeof L !== 'undefined') {
  const map = L.map('map');
  const bounds = L.latLngBounds(stops.map(s => [s.lat, s.lon]));
  map.fitBounds(bounds, { padding: [10, 10] });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap'
  }).addTo(map);

  markers = stops.map((s, i) => {
    const m = L.marker([s.lat, s.lon]).addTo(map);
    m.bindTooltip(String(s.id), {
      permanent: true,
      direction: 'center',
      className: 'number-label'
    });
    m.on('click', () => showStop(i));
    return m;
  });
}

setTimeout(() => showStop(0), 300);