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
function animateDashedLine(polyline, direction) {
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
        offset = (offset - delta * direction) % total;
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
function showStop(index, pushUrl = true, direction = 0) {
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
    const geometry = direction > 0 ? stopData.geometry : stops[(index + 1) % stops.length].geometry;
    if (geometry && Number(direction) !== 0) {
        removePulsatingCircle();
        currentPath = L.polyline(geometry, {
            color: 'green',
            weight: 3,
            dashArray: '20,5',
            dashOffset: '20'
        }).addTo(map);
        dashAnimationId = animateDashedLine(currentPath, Math.sign(direction));
    } else {
        addPulsatingCircle(stopData.lat, stopData.lon);
    }

    // Scroll content to top
    if (scrollableEl) scrollableEl.scrollTop = 0;
}

function nextStop() {
    showStop((currentIndex + 1) % stops.length, true, 1);
}

function prevStop() {
    showStop((currentIndex - 1 + stops.length) % stops.length, true, -1);
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

/**
 * Show a temporary text bubble (Leaflet popup) at the given lat/lng or at the map center.
 * The popup auto‐closes after 3 seconds.
 * @param {string} message
 * @param {[number, number]} [latlng]  Array [lat, lng]. If omitted, uses map.getCenter().
 */
function showTemporaryBubble(message, latlng) {
    const position = map.getCenter();
    const popup = L.popup({
        closeButton: false,
        autoClose: true,
        closeOnClick: true,
        className: 'temporary-bubble'
    })
        .setLatLng(position)
        .setContent(`<div style="padding: 6px; font-size: 14px;">${message}</div>`)
        .addTo(map);

    // Remove after 3 seconds
    setTimeout(() => {
        map.removeLayer(popup);
    }, 3000);
}

// ─── INITIALIZE MAP AND CONTROLS ─────────────────────────────────────────────────
if (typeof L !== 'undefined') {
    // Initialize map
    map = L.map('map',
        {
            rotate: true,
            rotateControl: {
                closeOnZeroBearing: false,
                position: 'bottomleft',
            },
            // attributionControl: false,
            // zoomControl: false,
            // compassBearing: false,
            // trackContainerMutation: false,
            // shiftKeyRotate: false,
            // touchGestures: true,
            touchRotate: true,
            //touchZoom: true
        }
    );
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

    const comp = new L.Control.Compass({autoActive: true, showDigit: false});
    map.addControl(comp);

    if (navigator.geolocation) {
        // Handle “locationfound” (start blinking if following)
        map.on('locationfound', e => {
            stopBlinkingCircle();
            stopPlaceholderPulse();

            if (locMarker) {
                map.removeLayer(locMarker);
                locMarker = null;
            }

            locMarker = L.circle([e.latlng.lat, e.latlng.lng], {
                radius: e.accuracy * 2,
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
            showTemporaryBubble("Couldn't get your location: " + e.message);
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
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <!-- Outer circle for pin background -->
                  <circle id="outerCircle" cx="12" cy="12" r="10" stroke="#212121" stroke-width="2" fill="#d7d7d7"/>
                  <!-- Location pin shape -->
                  <path id="pin" d="M12 7a4 4 0 1 1 0 8a4 4 0 0 1 0-8z" fill="#212121" opacity="0.7"/>
                  <!-- Compass arrow (needle) -->
                  <polygon id="arrow" points="12,4 14,12 12,10 10,12" fill="#d7d7d7"/>
                  <!-- Center dot -->
                  <circle id="center" cx="12" cy="12" r="2" fill="#212121"/>
                </svg>      
            `;
                btn.title = 'Follow My Location';

                L.DomEvent.disableClickPropagation(container);
                L.DomEvent.on(btn, 'click', e => {
                    L.DomEvent.stop(e);

                    if (locMarker) {
                        map.removeLayer(locMarker);
                        locMarker = null;
                    }

                    const circle = btn.querySelector('#outerCircle');
                    const pin = btn.querySelector('#pin');
                    const arrow = btn.querySelector('#arrow');
                    const center = btn.querySelector('#center');

                    if (!following) {
                        following = true;
                        circle.setAttribute('fill', '#d7ecfc');
                        circle.setAttribute('stroke', '#2196f3')
                        pin.setAttribute('fill', '#2196f3')
                        arrow.setAttribute('fill', '#f44336')
                        center.setAttribute('fill', '#2196f3')
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
                        circle.setAttribute('fill', '#d7d7d7');
                        circle.setAttribute('stroke', '#212121')
                        pin.setAttribute('fill', '#212121')
                        arrow.setAttribute('fill', '#d7d7d7')
                        center.setAttribute('fill', '#212121')
                        map.stopLocate();
                        stopBlinkingCircle();
                        stopPlaceholderPulse();
                    }
                });

                return container;
            }
        });
        map.addControl(new FollowControl());

        // ─── MODIFIED: Center‐on‐my‐location control (now draws walking path) ─────────────────────────────────────────────────────────────
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
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <!-- My location: blue dot at bottom center -->
                  <circle cx="12" cy="20" r="2.2" fill="#2196f3" stroke="#1565c0" stroke-width="1"/>
                  <!-- Zigzag curved dashed path -->
                  <path 
                    d="M12 18
                       Q14 16, 12 14
                       Q10 12, 12 10
                       Q14 8, 12 6"
                    stroke="#2196f3"
                    stroke-width="1.5"
                    fill="none"
                    stroke-dasharray="2,2"
                  />
                  <!-- Current stop: red marker at top center -->
                  <path d="M12 4a2.2 2.2 0 0 1 2.2 2.2c0 1.7-2.2 4-2.2 4s-2.2-2.3-2.2-4A2.2 2.2 0 0 1 12 4z" fill="#f44336" stroke="#b71c1c" stroke-width="1"/>
                  <circle cx="12" cy="6.2" r="0.8" fill="#fff"/>
                </svg>
            `;
                btn.title = 'Show Walking Path to Current Stop';
                btn.href = '#';

                L.DomEvent.disableClickPropagation(container);
                L.DomEvent.on(btn, 'click', e => {
                    L.DomEvent.stop(e);

                    // Remove any existing marker or placeholder pulse
                    if (locMarker) {
                        map.removeLayer(locMarker);
                        locMarker = null;
                    }
                    stopPlaceholderPulse();

                    // Get current stop’s coordinates
                    const stopData = stops[currentIndex];
                    if (!stopData) {
                        showTemporaryBubble('No current stop data available.');
                        return;
                    }

                    navigator.geolocation.getCurrentPosition(
                        position => {
                            const userLat = position.coords.latitude;
                            const userLng = position.coords.longitude;
                            const destLat = stopData.lat;
                            const destLng = stopData.lon;

                            // Build OSRM request URL for walking profile
                            const osrmUrl = `https://routing.openstreetmap.de/routed-foot/route/v1/foot/` +
                                `${userLng},${userLat};${destLng},${destLat}` + `?overview=full&geometries=geojson&steps=false&alternatives=false`;

                            fetch(osrmUrl)
                                .then(response => {
                                    if (!response.ok) {
                                        response.text()
                                            .then(text => showTemporaryBubble(`Failed to calculate path ${text}`))
                                        return {};
                                    }
                                    return response.json();
                                })
                                .then(data => {
                                    if (!data.routes || data.routes.length === 0) {
                                        console.warn('No route found.');
                                        return;
                                    }
                                    // Remove any existing marker or placeholder pulse
                                    if (locMarker) {
                                        map.removeLayer(locMarker);
                                        locMarker = null;
                                    }
                                    stopPlaceholderPulse();

                                    const routeGeoJSON = data.routes[0].geometry;
                                    // Convert [lng, lat] to [lat, lng]
                                    const latlngs = routeGeoJSON.coordinates.map(coord => [coord[1], coord[0]]);

                                    if (currentPath) {
                                        map.removeLayer(currentPath);
                                        currentPath = null;
                                        stopDashAnimation();
                                    }

                                    // Draw the walking path in blue
                                    currentPath = L.polyline(latlngs, {
                                        color: 'green',
                                        weight: 3,
                                        dashArray: '20,5',
                                        dashOffset: '20'
                                    }).addTo(map);
                                    dashAnimationId = animateDashedLine(currentPath, 1);

                                    if (!following) {
                                        addPulsatingCircle(userLat, userLng,
                                            {
                                                maxRadius: position.accuracy,
                                                color: '#136AEC',
                                                fillOpacity: 0.3
                                            });

                                    }

                                    // Zoom/center the map to fit the route
                                    const bounds = currentPath.getBounds();
                                    map.fitBounds(bounds, {padding: [20, 20]});
                                })
                                .catch(err => {
                                    showTemporaryBubble(`Error fetching route from OSRM: ${err.message}`);
                                });
                        },
                        err => {
                            showTemporaryBubble(`Could not get current position: ${err.message}`);
                        },
                        {
                            enableHighAccuracy: true,
                            timeout: 10000
                        }
                    );
                });

                return container;
            }
        });
        map.addControl(new CenterControl());
    }

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
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <!-- Faint map/grid outline -->
                  <rect x="4" y="4" width="16" height="16" rx="3" stroke="#90caf9" stroke-width="1.2" fill="#e3f2fd"/>
                  <!-- Four arrows pointing to center -->
                  <polygon points="12,2 13,6 11,6" fill="#2196f3"/>
                  <polygon points="12,22 13,18 11,18" fill="#2196f3"/>
                  <polygon points="2,12 6,13 6,11" fill="#2196f3"/>
                  <polygon points="22,12 18,13 18,11" fill="#2196f3"/>
                  <!-- Central red location pin, shifted higher -->
                  <path
                    d="M12 6.5a4 4 0 0 1 4 4c0 2.5-4 7-4 7s-4-4.5-4-7a4 4 0 0 1 4-4z"
                    fill="#f44336" stroke="#b71c1c" stroke-width="1"/>
                  <circle cx="12" cy="10.5" r="1.2" fill="#fff"/>
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
