// ─── Global State ───────────────────────────────────────────────────────────────
let currentIndex = 0;

// Cache DOM elements
const infoEl = document.getElementById('info');
const titleEl = document.getElementById('title');
const scrollableEl = document.getElementById('scrollable');

let map;
let markers = [];
let player;
let isDark = false;

let locMarker = null;
let blinkInterval = null;
let following = false;

let currentPath = null;
let dashAnimationId = null;

let pulseCircle = null;
let pulseInterval = null;


// ─── URL STATE HELPERS ────────────────────────────────────────────────────────────
function updateUrl(stopNo, pushUrl = true) {
    const params = new URLSearchParams(window.location.search);
    params.set('stop', stopNo);
    const newUrl = `?${params.toString()}`;
    if (pushUrl) {
        history.pushState(null, '', newUrl);
    } else {
        history.replaceState(null, '', newUrl);
    }
}

function getInitialStopIndex() {
    const params = new URLSearchParams(window.location.search);
    return params.has('stop') ? Number(params.get('stop')) : undefined;
}


// ─── DASHED LINE ANIMATION ───────────────────────────────────────────────────────
function animateDashedLine(polyline) {
    const pathEl = polyline.getElement();
    if (!pathEl) {
        console.warn('Polyline SVG element not found.');
        return null;
    }
    let offset = 0;
    const delta = 2;         // px per tick
    const dashLength = 20;
    const gapLength = 5;
    const total = dashLength + gapLength;

    return setInterval(() => {
        offset = (offset - delta) % total;
        pathEl.setAttribute('stroke-dashoffset', offset);
    }, 50);
}

function stopDashAnimation() {
    if (dashAnimationId !== null) {
        clearInterval(dashAnimationId);
        dashAnimationId = null;
    }
}


// ─── PULSATING CIRCLE (REUSED) ──────────────────────────────────────────────────
/**
 * Create a pulsating circle at the given lat/lng. If one exists, remove it first.
 * @param {number} lat
 * @param {number} lng
 * @param {object} [options] — optional style overrides
 */
function addPulsatingCircle(lat, lng, options = {}) {
    removePulsatingCircle();

    const {
        minRadius = 5,
        maxRadius = 20,
        color = '#28a745',
        weight = 2,
        fillOpacity = 0.4,
        intervalMs = 100,
        step = 2
    } = options;

    let currentRadius = minRadius;
    let growing = true;

    pulseCircle = L.circle([lat, lng], {
        radius: currentRadius,
        color,
        weight,
        fillColor: color,
        fillOpacity
    }).addTo(map);

    pulseInterval = setInterval(() => {
        if (growing) {
            currentRadius = Math.min(currentRadius + step, maxRadius);
            if (currentRadius >= maxRadius) growing = false;
        } else {
            currentRadius = Math.max(currentRadius - step, minRadius);
            if (currentRadius <= minRadius) growing = true;
        }
        pulseCircle.setRadius(currentRadius);
    }, intervalMs);
}

function removePulsatingCircle() {
    if (pulseInterval !== null) {
        clearInterval(pulseInterval);
        pulseInterval = null;
    }
    if (pulseCircle) {
        map.removeLayer(pulseCircle);
        pulseCircle = null;
    }
}


// ─── SHOW A SPECIFIC STOP ────────────────────────────────────────────────────────
function showStop(index, pushUrl = true) {
    currentIndex = index;
    localStorage.setItem(`${tour_id}_stop_no`, currentIndex);
    updateUrl(currentIndex, pushUrl);

    const stopData = stops[index];

    // Update title
    titleEl.innerText = `${stopData.id}. ${stopData.title}`;

    // Build description HTML (paragraphs from double-newline splits)
    const paragraphs = stopData.description
        .trim()
        .split(/\n\n+/)
        .map(p => `<tr><td>${p.replace(/\n/g, '<br>')}</td></tr>`)
        .join('');
    infoEl.innerHTML = `
    <audio id="audio-player" controls>
      <source src="${stopData.audio}" type="audio/mpeg">
    </audio>
    <table class="stop-text">${paragraphs}</table>
  `;

    // Initialize Plyr
    player = new Plyr('#audio-player', {
        controls: ['play', 'progress', 'current-time', 'mute', 'volume', 'settings'],
        settings: ['speed', 'quality', 'loop'],
        speed: {selected: 1, options: [0.5, 0.75, 1, 1.25, 1.5, 2]}
    });
    player.elements.container.classList.toggle('plyr--dark', isDark);

    // Pan map to the stop’s coordinates
    map.panTo([stopData.lat, stopData.lon]);

    // Highlight selected marker
    markers.forEach((m, idx) => {
        const sel = idx === index;
        m.getElement().classList.toggle('selected', sel);

        if (sel) {
            const tip = m.getTooltip && m.getTooltip();
            if (tip && tip.bringToFront) tip.bringToFront();
            else if (tip && tip.getElement) tip.getElement().style.zIndex = 10000;
        }
    });

    // Remove existing path and stop its animation
    if (currentPath) {
        map.removeLayer(currentPath);
        currentPath = null;
        stopDashAnimation();
    }

    // If geometry exists, draw a dashed polyline; otherwise pulsate on stop location
    if (stopData.geometry) {
        removePulsatingCircle();
        currentPath = L.polyline(stopData.geometry, {
            color: 'green',
            weight: 3,
            dashArray: '20,5',
            dashOffset: '20'
        }).addTo(map);
        dashAnimationId = animateDashedLine(currentPath);
    } else {
        addPulsatingCircle(stopData.lat, stopData.lon);
    }

    // Scroll content to top
    if (scrollableEl) scrollableEl.scrollTop = 0;
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


// ─── PLACEHOLDER PULSE ───────────────────────────────────────────────────────────
function startPlaceholderPulse() {
    const center = map.getCenter();
    addPulsatingCircle(center.lat, center.lng, {
        minRadius: 20,
        maxRadius: 50,
        color: '#136AEC',
        fillOpacity: 0.3,
        step: 2,
        intervalMs: 100
    });
}

function stopPlaceholderPulse() {
    removePulsatingCircle();
}


// ─── LOCATION BLINKING HELPERS ──────────────────────────────────────────────────
function startBlinkingCircle(marker, options = {}) {
    const {
        blinkMs = 500,
        visibleOpacity = marker.options.fillOpacity ?? 0.3,
        hiddenOpacity = 0
    } = options;

    if (blinkInterval) return;

    let showing = true;
    blinkInterval = setInterval(() => {
        showing = !showing;
        marker.setStyle({fillOpacity: showing ? visibleOpacity : hiddenOpacity});
    }, blinkMs);
}

function stopBlinkingCircle() {
    if (blinkInterval) {
        clearInterval(blinkInterval);
        blinkInterval = null;
    }
    if (locMarker) {
        locMarker.setStyle({fillOpacity: locMarker.options.fillOpacity ?? 0.3});
    }
}


// ─── INITIALIZE MAP AND CONTROLS ─────────────────────────────────────────────────
if (typeof L !== 'undefined') {
    // Initialize map
    map = L.map('map');
    const bounds = L.latLngBounds(stops.map(s => [s.lat, s.lon]));
    map.fitBounds(bounds, {padding: [10, 10]});

    // Base layers
    const layers = {
        Map: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap'
        }),
        Satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            attribution: 'Tiles &copy; Esri'
        })
    };
    layers.Map.addTo(map);
    L.control.layers(layers).addTo(map);

    // Scale control
    L.control.scale({
        position: 'bottomleft',
        metric: true,
        imperial: false,
        maxWidth: 100
    }).addTo(map);

    // Create and bind markers
    markers = stops.map((stopData, idx) => {
        const m = L.marker([stopData.lat, stopData.lon]).addTo(map);
        m.bindTooltip(String(stopData.id), {
            permanent: true,
            direction: 'center',
            className: 'number-label'
        });
        m.on('click', () => showStop(idx));
        return m;
    });

    // Handle “locationfound” (start blinking if following)
    map.on('locationfound', e => {
        stopBlinkingCircle();
        stopPlaceholderPulse();

        if (locMarker) {
            map.removeLayer(locMarker);
            locMarker = null;
        }

        locMarker = L.circle([e.latlng.lat, e.latlng.lng], {
            radius: e.accuracy * (map.getMaxZoom() - map.getZoom()) ,
            color: '#136AEC',
            weight: 2,
            fillColor: '#136AEC',
            fillOpacity: 0.3
        }).addTo(map);

        if (following) {
            map.setView([e.latlng.lat, e.latlng.lng]);
            startBlinkingCircle(locMarker, {blinkMs: 500, visibleOpacity: 0.3, hiddenOpacity: 0});
        }
    });

    map.on('locationerror', e => {
        console.warn("Couldn't get your location: " + e.message);
        stopBlinkingCircle();
        stopPlaceholderPulse();
    });

    // Follow‐my‐location control
    const FollowControl = L.Control.extend({
        options: {position: 'topleft'},
        onAdd: function () {
            const container = L.DomUtil.create('div', 'leaflet-bar');
            const btn = L.DomUtil.create('a', '', container);

            Object.assign(btn.style, {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '30px',
                height: '30px'
            });

            btn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" fill="none" stroke="black" stroke-width="2"/>
          <polygon id="up-triangle"   points="12,4 8,12 16,12" fill="#D3D3D3"/>
          <polygon id="down-triangle" points="12,20 8,12 16,12" fill="#A9A9A9"/>
        </svg>
      `;
            btn.title = 'Follow My Location';

            L.DomEvent.disableClickPropagation(container);
            L.DomEvent.on(btn, 'click', e => {
                L.DomEvent.stop(e);
                const upTri = btn.querySelector('#up-triangle');
                const downTri = btn.querySelector('#down-triangle');

                if (locMarker) {
                    map.removeLayer(locMarker);
                    locMarker = null;
                }

                if (!following) {
                    following = true;
                    upTri.setAttribute('fill', '#136AEC');
                    downTri.setAttribute('fill', '#E74C3C');
                    btn.title = 'Stop Following';
                    startPlaceholderPulse();
                    map.locate({
                        watch: true,
                        setView: false,
                        maxZoom: 16,
                        enableHighAccuracy: true
                    });
                } else {
                    following = false;
                    upTri.setAttribute('fill', '#D3D3D3');
                    downTri.setAttribute('fill', '#A9A9A9');
                    btn.title = 'Follow My Location';
                    map.stopLocate();
                    stopBlinkingCircle();
                    stopPlaceholderPulse();
                }
            });

            return container;
        }
    });
    map.addControl(new FollowControl());

    // Center‐on‐my‐location control
    const CenterControl = L.Control.extend({
        options: {position: 'topleft'},
        onAdd: function () {
            const container = L.DomUtil.create('div', 'leaflet-bar');
            const btn = L.DomUtil.create('a', '', container);

            Object.assign(btn.style, {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '30px',
                height: '30px'
            });

            btn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
             fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="22" y1="12" x2="18" y2="12"></line>
          <line x1="6" y1="12"  x2="2" y2="12"></line>
          <line x1="12" y1="6"  x2="12" y2="2"></line>
          <line x1="12" y1="22" x2="12" y2="18"></line>
        </svg>
      `;
            btn.title = 'Center on My Location';
            btn.href = '#';

            L.DomEvent.disableClickPropagation(container);
            L.DomEvent.on(btn, 'click', e => {
                L.DomEvent.stop(e);
                if (locMarker) {
                    map.removeLayer(locMarker);
                    locMarker = null;
                }
                startPlaceholderPulse();
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

    // ─── Center‐on‐Current‐Stop control ─────────────────────────────────────────────
    const StopCenterControl = L.Control.extend({
        options: {position: 'topleft'},
        onAdd: function () {
            const container = L.DomUtil.create('div', 'leaflet-bar');
            const btn = L.DomUtil.create('a', '', container);

            Object.assign(btn.style, {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '30px',
                height: '30px'
            });

            // Simple “target” icon: circle with a dot
            btn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" fill="none" stroke="black" stroke-width="2"/>
          <circle cx="12" cy="12" r="3" fill="black"/>
        </svg>
      `;
            btn.title = 'Center on Current Stop';

            L.DomEvent.disableClickPropagation(container);
            L.DomEvent.on(btn, 'click', e => {
                L.DomEvent.stop(e);
                const stopData = stops[currentIndex];
                if (stopData) {
                    showStop(currentIndex, false);
                }
            });

            return container;
        }
    });
    map.addControl(new StopCenterControl());
}
