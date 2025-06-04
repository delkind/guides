let currentIndex = 0;
const info = document.getElementById('info');
let map;       // <-- declare in outer scope
let markers;   // if you also want your markers array visible outside
let player;
let isDark;
var locMarker = undefined;
var pulseCircle = null;
var pulseInterval = null;
var pulseGrowing = true;
let following = false;
var currentPath = undefined;
var intervalId = undefined;

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

function animateDashedLine(polyline) {
    // Получаем SVG-элемент (<path d="…">) у Leaflet-линии
    const pathEl = polyline.getElement();

    if (!pathEl) {
        console.warn('Polyline SVG element not found.');
        return null;
    }

    let offset = 0;
    // Скорость «движения» штриха (px за шаг). Можно подбирать под желаемую скорость.
    const delta = 2;

    // Запускаем таймер, который каждые 50 мс смещает штрих
    const intervalId = setInterval(() => {
        offset = (offset - delta) % 25; // 25 = dashLength + gapLength (20 + 5)
        pathEl.setAttribute('stroke-dashoffset', offset);
    }, 50);

    return intervalId;
}

function stopAnimation(intervalId) {
    if (intervalId) {
        clearInterval(intervalId);
    }
}

let pulsatingCircle = null;
let pulsatingInterval = null;

/**
 * Добавляет на карту пульсирующий зелёный круг в заданных координатах.
 * @param {number} lat — широта.
 * @param {number} lng — долгота.
 */
function addPulsatingCircle(lat, lng) {
    // Если уже есть активный круг — удалим его перед созданием нового
    removePulsatingCircle();

    // Параметры радиусов (в метрах)
    const minRadius = 5;
    const maxRadius = 20;
    let currentRadius = minRadius;
    let growing = true;

    // Создаём круг с начальным радиусом и зелёным стилем
    pulsatingCircle = L.circle([lat, lng], {
        radius: currentRadius,
        color: '#28a745',       // зелёная обводка
        weight: 2,
        fillColor: '#28a745',   // заливка того же цвета
        fillOpacity: 0.4
    }).addTo(map);

    // Запускаем интервал: изменяем radius каждые 100 мс
    pulsatingInterval = setInterval(() => {
        if (growing) {
            currentRadius += 2;
            if (currentRadius >= maxRadius) {
                currentRadius = maxRadius;
                growing = false;
            }
        } else {
            currentRadius -= 2;
            if (currentRadius <= minRadius) {
                currentRadius = minRadius;
                growing = true;
            }
        }
        pulsatingCircle.setRadius(currentRadius);
    }, 100);
}

/**
 * Удаляет пульсирующий круг, если он есть.
 */
function removePulsatingCircle() {
    if (pulsatingInterval) {
        clearInterval(pulsatingInterval);
        pulsatingInterval = null;
    }
    if (pulsatingCircle) {
        map.removeLayer(pulsatingCircle);
        pulsatingCircle = null;
    }
}

function showStop(i, pushUrl = true) {
    currentIndex = i;
    localStorage.setItem(`${tour_id}_stop_no`, currentIndex);
    updateUrl(currentIndex, pushUrl);
    const s = stops[i];
    document.getElementById('title').innerText = `${s.id}. ${s.title}`;
    const paragraphs = s.description
        .trim()
        .split(/\n\n+/)
        .map(p => `<tr><td>${p.replace(/\n/g, '<br>')}</td></tr>`)
        .join("");
    const table = `<table class="stop-text">${paragraphs}</table>`;
    info.innerHTML =
        `<audio id="audio-player" controls>
       <source src="${s.audio}" type="audio/mpeg" />
     </audio>` + table;

    player = new Plyr('#audio-player', {
        controls: ['play', 'progress', 'current-time', 'mute', 'volume', 'settings'],
        settings: ['speed', 'quality', 'loop'],
        speed: {
            selected: 1,
            options: [0.5, 0.75, 1, 1.25, 1.5, 2]
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
        stopAnimation(intervalId);
        intervalId = undefined;
    }

    if (s.geometry) {
        removePulsatingCircle();
        currentPath = L.polyline(s.geometry, {
            color: 'green',
            weight: 3,
            dashArray: '20, 5',
            dashOffset: '20'
        }).addTo(map);
        intervalId = animateDashedLine(currentPath);
    } else {
        addPulsatingCircle(s.lat, s.lon)
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

// ─── Пульсирующий индикатор (grow/shrink) вместо мигания ────────────────────────
function startPulsePlaceholder() {
    if (pulseCircle) return; // уже запущен

    // Создаем круг в центре карты с минимальным радиусом
    const center = map.getCenter();
    const minRadius = 20;
    const maxRadius = 50;
    pulseCircle = L.circle(center, {
        radius: minRadius,
        color: '#136AEC',
        weight: 2,
        fillColor: '#136AEC',
        fillOpacity: 0.3
    }).addTo(map);

    pulseGrowing = true;
    let currentRadius = minRadius;

    pulseInterval = setInterval(() => {
        if (pulseGrowing) {
            currentRadius += 2;
            if (currentRadius >= maxRadius) {
                currentRadius = maxRadius;
                pulseGrowing = false;
            }
        } else {
            currentRadius -= 2;
            if (currentRadius <= minRadius) {
                currentRadius = minRadius;
                pulseGrowing = true;
            }
        }
        pulseCircle.setRadius(currentRadius);
    }, 100);
}

function stopPulsePlaceholder() {
    if (pulseInterval) {
        clearInterval(pulseInterval);
        pulseInterval = null;
    }
    if (pulseCircle) {
        map.removeLayer(pulseCircle);
        pulseCircle = null;
    }
}

if (typeof L !== 'undefined') {
    map = L.map('map');
    const bounds = L.latLngBounds(stops.map(s => [s.lat, s.lon]));
    map.fitBounds(bounds, {padding: [10, 10]});

    const layers = {
        "Map": L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap'
        }),
        "Satellite": L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            attribution: 'Tiles &copy; Esri'
        }),
    };

    layers.Map.addTo(map);
    L.control.layers(layers).addTo(map);

    L.control.scale({
        position: 'bottomleft',  // по умолчанию 'bottomleft'; можно 'bottomright', 'topleft' или 'topright'
        metric: true,            // показывать метрический масштаб (км/м). По умолчанию true.
        imperial: false,         // показывать имперский (мили/футы). По умолчанию false.
        maxWidth: 100            // максимальная ширина шкалы в пикселях (по умолчанию 100)
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

    // Обработка события успешного определения местоположения
    map.on('locationfound', e => {
        // Остановим пульсацию
        stopPulsePlaceholder();

        // Удалим предыдущий маркер, если есть
        if (locMarker) {
            map.removeLayer(locMarker);
        }

        // Добавим настоящий круг по полученным координатам и точности
        locMarker = L.circle([e.latlng.lat, e.latlng.lng], {
            radius: e.accuracy,
            color: '#136AEC',
            weight: 2,
            fillColor: '#136AEC',
            fillOpacity: 0.3
        }).addTo(map);

        if (following) {
            // Если мы в режиме «следования», центрируем карту
            map.setView([e.latlng.lat, e.latlng.lng]);
        }
    });

    map.on('locationerror', e => {
        console.warn("Couldn't get your location: " + e.message);
        stopPulsePlaceholder();
    });

// ─── Контрол «Follow My Location» с тултипом ───────────────────────────────────
    const FollowControl = L.Control.extend({
        options: {position: 'topleft'},

        onAdd: function (map) {
            const container = L.DomUtil.create('div', 'leaflet-bar');
            const btn = L.DomUtil.create('a', '', container);

            // Размер и flex-центровка
            btn.style.display = 'flex';
            btn.style.alignItems = 'center';
            btn.style.justifyContent = 'center';
            btn.style.width = '30px';
            btn.style.height = '30px';

            // Начальное состояние: disabled (lightgray/up, darkgray/down)
            btn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg"
           width="18" height="18" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10"
                fill="none" stroke="black" stroke-width="2"/>
        <polygon id="up-triangle"   points="12,4 8,12 16,12" fill="#D3D3D3"/>
        <polygon id="down-triangle" points="12,20 8,12 16,12" fill="#A9A9A9"/>
      </svg>
    `;

            // Устанавливаем тултип для кнопки
            btn.title = 'Follow My Location';

            L.DomEvent.disableClickPropagation(container);

            L.DomEvent.on(btn, 'click', e => {
                L.DomEvent.stop(e);

                const upTri = btn.querySelector('#up-triangle');
                const downTri = btn.querySelector('#down-triangle');

                if (!following) {
                    // Включаем «Follow»
                    following = true;
                    upTri.setAttribute('fill', '#136AEC');   // blue
                    downTri.setAttribute('fill', '#E74C3C'); // red

                    // Меняем тултип
                    btn.title = 'Stop Following';

                    startPulsePlaceholder();
                    map.locate({
                        watch: true,
                        setView: false,
                        maxZoom: 16,
                        enableHighAccuracy: true
                    });
                } else {
                    // Выключаем «Follow»
                    following = false;
                    upTri.setAttribute('fill', '#D3D3D3');   // lightgray
                    downTri.setAttribute('fill', '#A9A9A9'); // darkgray

                    // Возвращаем тултип
                    btn.title = 'Follow My Location';

                    map.stopLocate();
                    stopPulsePlaceholder();
                }
            });

            return container;
        }
    });
    map.addControl(new FollowControl());


// ─── Контрол «Center on My Location» с тултипом ────────────────────────────────
    const CenterControl = L.Control.extend({
        options: {position: 'topleft'},

        onAdd: function (map) {
            const container = L.DomUtil.create('div', 'leaflet-bar');
            const btn = L.DomUtil.create('a', '', container);

            // Сделаем кнопку flex-контейнером для центрирования SVG
            btn.style.display = 'flex';
            btn.style.alignItems = 'center';
            btn.style.justifyContent = 'center';
            btn.style.width = '30px';
            btn.style.height = '30px';

            // SVG-мишень
            btn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg"
           width="18" height="18" viewBox="0 0 24 24"
           fill="none" stroke="black" stroke-width="2"
           stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="22" y1="12" x2="18" y2="12"></line>
        <line x1="6" y1="12"  x2="2" y2="12"></line>
        <line x1="12" y1="6"  x2="12" y2="2"></line>
        <line x1="12" y1="22" x2="12" y2="18"></line>
      </svg>
    `;

            // Устанавливаем тултип
            btn.title = 'Center on My Location';

            btn.href = '#';

            L.DomEvent.disableClickPropagation(container);

            L.DomEvent.on(btn, 'click', e => {
                L.DomEvent.stop(e);
                startPulsePlaceholder();
                map.locate({
                    watch: false,
                    setView: true,
                    maxZoom: 16,
                    enableHighAccuracy: true
                });
            });

            return container;
        }
    });
    map.addControl(new CenterControl());
}
