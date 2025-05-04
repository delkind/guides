let currentIndex = 0;
const mapElement = document.getElementById('map');
const isMap = mapElement && stops[0].lat && stops[0].lon;

if (isMap) {
  const map = L.map('map').setView([stops[0].lat, stops[0].lon], 16);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);
  var markers = [];

  stops.forEach((stop, i) => {
    const marker = L.marker([stop.lat, stop.lon]).addTo(map);
    marker.bindPopup(stop.title);
    marker.on('click', () => showStop(i));
    markers.push(marker);
  });

  function highlightMarker(i) {
    markers.forEach((m, j) => m.getElement().classList.remove("selected"));
    markers[i].getElement().classList.add("selected");
  }
} else {
  var markers = [];
  function highlightMarker(i) {}
}

const info = document.getElementById('info');

function showStop(index) {
  currentIndex = index;
  const stop = stops[index];
  info.innerHTML = `<h2>${stop.title}</h2><p>${stop.description}</p><img src="${stop.image}" alt=""><audio controls src="${stop.audio}"></audio>`;
  if (isMap) highlightMarker(index);
}

function nextStop() {
  const next = (currentIndex + 1) % stops.length;
  showStop(next);
}

setTimeout(() => showStop(0), 500);
