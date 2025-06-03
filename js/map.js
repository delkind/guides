let currentIndex = 0;
const info = document.getElementById('info');
let map;       // <-- declare in outer scope
let markers;   // if you also want your markers array visible outside
let player;
let isDark;
var locMarker = undefined;
var currentPath = undefined;

function updateUrl(stopNo, pushUrl) {
    const params = new URLSearchParams(window.location.search);
    params.set('stop', stopNo);
    if (pushUrl) {
        history.pushState(null, '', '?' + params.toString());
    } else {
        history.replaceState(null, '', '?' + params.toString());
    }
}

function getInitialState() {
    const params = new URLSearchParams(window.location.search);
    return params.get("stop") ? Number(params.get('stop')) : undefined;
}

function showStop(i, pushUrl = true) {
    currentIndex = i;
    localStorage.setItem(`${tour_id}_stop_no`, currentIndex);
    updateUrl(currentIndex, pushUrl);
    const s = stops[i];
    document.getElementById('title').innerText = `${s.id}. ${s.title}`;
    const paragraphs = s.description.trim().split(/\n\n+/).map(p => `<tr><td>${p.replace(/\n/g, '<br>')}</td></tr>`).join("");
    const table = `<table class="stop-text">${paragraphs}</table></p></p></p>`;
    info.innerHTML = `<audio id="audio-player" controls><source src="${s.audio}" type="audio/mpeg" /></audio>` + table;
    player = new Plyr('#audio-player', {
        controls: [
            'play',
            'progress',
            'current-time',
            'mute',
            'volume',
            'settings'        // ← includes the settings menu
        ],
        settings: [
            'speed',          // ← show the speed tab
            'quality',        // ← you can leave these in or out
            'loop'
        ],
        speed: {
            selected: 1,      // default playback rate
            options: [0.5, 0.75, 1, 1.25, 1.5, 2]  // the menu options
        }
    });
    player.elements.container.classList.toggle('plyr--dark', isDark);

    map.panTo([s.lat, s.lon]);
    if (typeof markers !== 'undefined') {
        markers.forEach((m, j) => {
            const isSel = j === i;
            // переключаем класс на маркере
            m.getElement().classList.toggle('selected', isSel);

            if (isSel) {
                // и тултип
                const tip = m.getTooltip && m.getTooltip();
                if (tip && tip.bringToFront) {
                    tip.bringToFront();
                } else if (tip && tip.getElement) {
                    // fallback: повысим z-index у DOM-элемента тултипа
                    tip.getElement().style.zIndex = 10000;
                }
            }
        });
    }

    if (currentPath) {
        map.removeLayer(currentPath);
        currentPath = undefined;
    }

    if (s.geometry) {
        currentPath = directPolyline = L.polyline(s.geometry,
            {   color: 'green',
                weight: 3,
                dashArray: '20, 5',
                dashOffset: '20'
            }).addTo(map);
    }

    // Прокрутить контейнер наверх при смене остановки
    const scrollable = document.getElementById('scrollable');
    if (scrollable) {
        scrollable.scrollTop = 0;
    }
}

function nextStop() {
    showStop((currentIndex + 1) % stops.length);
}

function prevStop() {
    showStop((currentIndex - 1 + stops.length) % stops.length);
}

function firstStop() {
    showStop(0);
}

if (typeof L !== 'undefined') {
    map = L.map('map');
    const bounds = L.latLngBounds(stops.map(s => [s.lat, s.lon]));
    map.fitBounds(bounds, {padding: [10, 10]});
    layers = {
        "Map": L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap'
        }),
        "Satellite": L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
        }),
    };

    layers.Map.addTo(map);
    L.control.layers(layers).addTo(map);

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

// 1) Create the control
    const locateControl = L.Control.extend({
        options: {position: 'topleft'},  // choose any corner

        onAdd: function (map) {
            // container
            const container = L.DomUtil.create('div', 'leaflet-bar leaflet‐control');
            // button
            const btn = L.DomUtil.create('a', '', container);
            btn.innerHTML = '📍';                  // or an <img> icon
            btn.href = '#';
            btn.title = 'Show my location';

            // prevent map drag when clicking
            L.DomEvent.disableClickPropagation(container);

            // on click → locate
            L.DomEvent.on(btn, 'click', function (e) {
                L.DomEvent.stop(e);
                map.locate({setView: true, maxZoom: 16});
            });

            return container;
        }
    });

// 2) Add it to the map
    map.addControl(new locateControl());

// 3) Listen for location events (if you haven't already)
    map.on('locationfound', e => {
        if (locMarker) {
            map.removeLayer(locMarker);
        }

        locMarker = L.circleMarker(e.latlng, {
            radius: 10,
            fillColor: '#e74c3c',   // any CSS color
            color: '#c0392b',       // stroke color
            weight: 2,
            fillOpacity: 0.5
        })
            .addTo(map)
            .bindPopup('You are here');
    });

    map.on('locationerror', e => {
        console.log("Couldn't get your location: " + e.message);
    });
}