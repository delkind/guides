
let currentIndex = 0;
const mapEl = document.getElementById('map');
const isMap = mapEl && stops[0].lat && stops[0].lon;

/* ----- карта (если есть координаты) ----- */
let markers = [];
if (isMap){
  const map = L.map('map').setView([stops[0].lat, stops[0].lon], 16);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
    attribution:'&copy; OpenStreetMap contributors'
  }).addTo(map);

  stops.forEach((s,i)=>{
    const m = L.marker([s.lat,s.lon]).addTo(map);
    m.bindPopup(s.title); m.on('click', ()=>showStop(i)); markers.push(m);
  });
}

const info = document.getElementById('info');

function showStop(i){
  currentIndex = i;
  const s = stops[i];
  info.innerHTML = `<h2>${s.title}</h2><p>${s.description}</p>
                    <img src="${s.image}" alt="">
                    <audio controls src="${s.audio}"></audio>`;
  if(isMap){
    markers.forEach((m,j)=>m.getElement().classList.toggle('selected',j===i));
  }
}
function nextStop(){ showStop((currentIndex+1)%stops.length); }

setTimeout(()=>showStop(0),400);
