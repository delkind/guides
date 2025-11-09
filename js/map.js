// ═══════════════════════════════════════════════════════════════════════════
// AUDIO TOUR MAP - COMPLETE OPTIMIZED VERSION
// ═══════════════════════════════════════════════════════════════════════════

// ─── Global State ──────────────────────────────────────────────────────────
const state = {
    currentIndex: 0,
    map: null,
    markers: [],
    player: null,
    isDark: false,
    locMarker: null,
    following: false,
    currentPath: null,
    pulseCircle: null,
    mapReady: false,
    intervals: {
        blink: null,
        dash: null,
        pulse: null
    }
};

// ─── Constants ─────────────────────────────────────────────────────────────
const CONFIG = {
    ANIMATION: {
        SCROLL_DURATION: 400,
        FADE_DURATION: 300,
        MAP_FLY_DURATION: 0.8
    },
    MAP: {
        MAX_ZOOM: 19,
        TILE_BUFFER: 2,
        INVALIDATE_DELAY: 100,
        INIT_PADDING: [50, 50]
    },
    NOTIFICATION: {
        DISPLAY_TIME: 3000,
        FADE_TIME: 300
    }
};

// ─── DOM Cache ─────────────────────────────────────────────────────────────
const DOM = {
    info: document.getElementById('info'),
    title: document.getElementById('title'),
    scrollable: document.querySelector('.tour-content')
};

// ═══════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Smooth scroll to top using requestAnimationFrame
 */
function smoothScrollToTop(element, duration = CONFIG.ANIMATION.SCROLL_DURATION) {
    if (!element) return;

    const start = element.scrollTop;
    const startTime = performance.now();

    const animate = (currentTime) => {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const easeOutCubic = 1 - Math.pow(1 - progress, 3);

        element.scrollTop = start * (1 - easeOutCubic);

        if (progress < 1) {
            requestAnimationFrame(animate);
        }
    };

    requestAnimationFrame(animate);
}

/**
 * Update URL with stop number
 */
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

/**
 * Get initial stop index from URL
 */
function getInitialStopIndex() {
    const params = new URLSearchParams(window.location.search);
    return params.has('stop') ? Number(params.get('stop')) : undefined;
}

/**
 * Clear all intervals safely
 */
function clearIntervals() {
    Object.keys(state.intervals).forEach(key => {
        if (state.intervals[key] !== null) {
            clearInterval(state.intervals[key]);
            state.intervals[key] = null;
        }
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// ANIMATION FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Animate dashed line along path
 */
function animateDashedLine(polyline, direction) {
    const pathEl = polyline?.getElement();
    if (!pathEl) return null;

    let offset = 0;
    const delta = 2;
    const dashLength = 20;
    const gapLength = 5;
    const total = dashLength + gapLength;

    return setInterval(() => {
        offset = (offset - delta * direction) % total;
        pathEl.setAttribute('stroke-dashoffset', offset);
    }, 50);
}

/**
 * Stop dashed line animation
 */
function stopDashAnimation() {
    if (state.intervals.dash) {
        clearInterval(state.intervals.dash);
        state.intervals.dash = null;
    }
}

/**
 * Add pulsating circle at location
 */
function addPulsatingCircle(lat, lng, options = {}) {
    if (!state.map) return;

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

    state.pulseCircle = L.circle([lat, lng], {
        radius: currentRadius,
        color,
        weight,
        fillColor: color,
        fillOpacity
    }).addTo(state.map);

    state.intervals.pulse = setInterval(() => {
        if (growing) {
            currentRadius = Math.min(currentRadius + step, maxRadius);
            if (currentRadius >= maxRadius) growing = false;
        } else {
            currentRadius = Math.max(currentRadius - step, minRadius);
            if (currentRadius <= minRadius) growing = true;
        }
        if (state.pulseCircle) {
            state.pulseCircle.setRadius(currentRadius);
        }
    }, intervalMs);
}

/**
 * Remove pulsating circle
 */
function removePulsatingCircle() {
    if (state.intervals.pulse) {
        clearInterval(state.intervals.pulse);
        state.intervals.pulse = null;
    }
    if (state.pulseCircle && state.map) {
        state.map.removeLayer(state.pulseCircle);
        state.pulseCircle = null;
    }
}

/**
 * Start blinking circle animation
 */
function startBlinkingCircle(marker, options = {}) {
    const {
        blinkMs = 500,
        visibleOpacity = marker.options.fillOpacity ?? 0.3,
        hiddenOpacity = 0
    } = options;

    if (state.intervals.blink) return;

    let showing = true;
    state.intervals.blink = setInterval(() => {
        showing = !showing;
        marker.setStyle({ fillOpacity: showing ? visibleOpacity : hiddenOpacity });
    }, blinkMs);
}

/**
 * Stop blinking circle animation
 */
function stopBlinkingCircle() {
    if (state.intervals.blink) {
        clearInterval(state.intervals.blink);
        state.intervals.blink = null;
    }
    if (state.locMarker) {
        state.locMarker.setStyle({ fillOpacity: state.locMarker.options.fillOpacity ?? 0.3 });
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// UI FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Show loading state
 */
function showLoadingState() {
    if (!DOM.info) return;

    DOM.info.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 3rem; gap: 1rem;">
            <div class="loading-spinner"></div>
            <p style="color: var(--text-secondary); font-size: 0.95rem;">Loading stop information...</p>
        </div>
    `;
}

/**
 * Show temporary notification bubble
 */
function showTemporaryBubble(message, latlng, type = 'info') {
    if (!state.map) return;

    const position = latlng || state.map.getCenter();

    const styles = {
        info: { bg: 'var(--glass-bg)', border: 'var(--glass-border)', icon: 'ℹ️' },
        error: { bg: 'rgba(244, 67, 54, 0.15)', border: 'rgba(244, 67, 54, 0.3)', icon: '⚠️' },
        success: { bg: 'rgba(76, 175, 80, 0.15)', border: 'rgba(76, 175, 80, 0.3)', icon: '✓' }
    };

    const style = styles[type] || styles.info;

    const popup = L.popup({
        closeButton: false,
        autoClose: true,
        closeOnClick: true,
        className: 'temporary-bubble modern-popup'
    })
    .setLatLng(position)
    .setContent(`
        <div style="
            padding: 12px 16px;
            font-size: 14px;
            display: flex;
            align-items: center;
            gap: 10px;
            background: ${style.bg};
            backdrop-filter: blur(20px);
            border: 1px solid ${style.border};
            border-radius: 12px;
            color: var(--text-primary);
            font-weight: 500;
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
        ">
            <span style="font-size: 18px;">${style.icon}</span>
            <span>${message}</span>
        </div>
    `)
    .addTo(state.map);

    const popupEl = popup.getElement();
    if (popupEl) {
        popupEl.style.opacity = '0';
        popupEl.style.transform = 'translateY(-10px)';
        requestAnimationFrame(() => {
            popupEl.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
            popupEl.style.opacity = '1';
            popupEl.style.transform = 'translateY(0)';
        });
    }

    setTimeout(() => {
        if (popupEl) {
            popupEl.style.opacity = '0';
            popupEl.style.transform = 'translateY(-10px)';
        }
        setTimeout(() => {
            if (state.map) state.map.removeLayer(popup);
        }, CONFIG.NOTIFICATION.FADE_TIME);
    }, CONFIG.NOTIFICATION.DISPLAY_TIME);
}

// ═══════════════════════════════════════════════════════════════════════════
// STOP NAVIGATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Display a specific stop
 */
function showStop(index, pushUrl = true, direction = 0) {
    // Guard clause: wait for map to be ready
    if (!state.mapReady || !state.map) {
        console.warn('Map not ready yet, deferring showStop call');
        setTimeout(() => showStop(index, pushUrl, direction), 200);
        return;
    }

    if (!DOM.info || !DOM.title) {
        console.error('Required DOM elements not found');
        return;
    }

    showLoadingState();

    state.currentIndex = index;
    localStorage.setItem(`${tour_id}_stop_no`, state.currentIndex);
    updateUrl(state.currentIndex, pushUrl);

    const stopData = stops[index];
    if (!stopData) {
        console.error('Stop data not found for index:', index);
        return;
    }

    // Animate title change
    DOM.title.style.opacity = '0';
    setTimeout(() => {
        DOM.title.innerText = `${stopData.id}. ${stopData.title}`;
        DOM.title.style.transition = 'opacity 0.3s ease';
        DOM.title.style.opacity = '1';
    }, 150);

    // Build description HTML
    const paragraphs = stopData.description
        .trim()
        .split(/\n\n+/)
        .map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`)
        .join('');

    // Update content with fade animation
    setTimeout(() => {
        DOM.info.innerHTML = `
            <div class="audio-player-wrapper">
                <audio id="audio-player" controls>
                    <source src="${stopData.audio}" type="audio/mpeg">
                </audio>
            </div>
            <div class="stop-description">${paragraphs}</div>
        `;

        // Initialize Plyr
        if (typeof Plyr !== 'undefined') {
            state.player = new Plyr('#audio-player', {
                controls: ['play', 'progress', 'current-time', 'mute', 'volume', 'settings'],
                settings: ['speed', 'quality', 'loop'],
                speed: { selected: 1, options: [0.5, 0.75, 1, 1.25, 1.5, 2] },
                tooltips: { controls: true, seek: true }
            });

            state.player.elements.container.classList.toggle('plyr--dark', state.isDark);
        }

        // Fade in content
        DOM.info.style.opacity = '0';
        DOM.info.style.transform = 'translateY(10px)';
        requestAnimationFrame(() => {
            DOM.info.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
            DOM.info.style.opacity = '1';
            DOM.info.style.transform = 'translateY(0)';
        });
    }, 200);

    // Animate map
    if (state.map && state.map.flyTo) {
        state.map.flyTo([stopData.lat, stopData.lon], state.map.getZoom(), {
            duration: CONFIG.ANIMATION.MAP_FLY_DURATION,
            easeLinearity: 0.5
        });
    }

    // Highlight markers
    state.markers.forEach((m, idx) => {
        const isSelected = idx === index;
        const markerEl = m.getElement();

        if (markerEl) {
            markerEl.classList.toggle('selected', isSelected);

            if (isSelected) {
                markerEl.style.transition = 'transform 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55)';
                markerEl.style.transform = 'scale(1.3)';
                setTimeout(() => markerEl.style.transform = 'scale(1)', 300);
            } else {
                markerEl.style.transform = 'scale(1)';
            }
        }

        if (isSelected) {
            const tip = m.getTooltip?.();
            if (tip?.bringToFront) tip.bringToFront();
            else if (tip?.getElement) {
                tip.getElement().style.zIndex = '10000';
            }
        }
    });

    // Handle path/pulse
    if (state.currentPath && state.map) {
        state.currentPath.setStyle({ opacity: 0.5 });
        setTimeout(() => {
            if (state.map) {
                state.map.removeLayer(state.currentPath);
                state.currentPath = null;
                stopDashAnimation();
            }
        }, 300);
    }

    const geometry = direction > 0 ? stopData.geometry : stops[(index + 1) % stops.length]?.geometry;

    if (geometry && direction !== 0 && state.map) {
        removePulsatingCircle();
        setTimeout(() => {
            if (!state.map) return;

            state.currentPath = L.polyline(geometry, {
                color: '#28a745',
                weight: 4,
                dashArray: '20,5',
                dashOffset: '20',
                opacity: 0,
                lineJoin: 'round',
                lineCap: 'round'
            }).addTo(state.map);

            setTimeout(() => {
                if (state.currentPath) state.currentPath.setStyle({ opacity: 1 });
            }, 50);

            state.intervals.dash = animateDashedLine(state.currentPath, Math.sign(direction));
        }, 300);
    } else {
        addPulsatingCircle(stopData.lat, stopData.lon, {
            color: '#667eea',
            fillOpacity: 0.3,
            weight: 3
        });
    }

    smoothScrollToTop(DOM.scrollable);
}

function nextStop() {
    showStop((state.currentIndex + 1) % stops.length, true, 1);
}

function prevStop() {
    showStop((state.currentIndex - 1 + stops.length) % stops.length, true, -1);
}

function firstStop() {
    showStop(0);
}

// ═══════════════════════════════════════════════════════════════════════════
// GEOLOCATION HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function startPlaceholderPulse() {
    if (!state.map) return;
    const center = state.map.getCenter();
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

// ═══════════════════════════════════════════════════════════════════════════
// MAP INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════

function initMap() {
    const mapContainer = document.getElementById('map');
    if (!mapContainer) {
        console.error('Map container not found');
        return;
    }

    // Ensure container has dimensions
    const parentHeight = mapContainer.parentElement.offsetHeight;
    if (parentHeight === 0) {
        mapContainer.parentElement.style.height = '50vh';
        mapContainer.parentElement.style.minHeight = '400px';
    }

    const rect = mapContainer.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
        mapContainer.style.width = '100%';
        mapContainer.style.height = '100%';
        setTimeout(initMap, CONFIG.MAP.INVALIDATE_DELAY);
        return;
    }

    try {
        // Initialize map
        state.map = L.map('map', {
            rotate: true,
            rotateControl: { closeOnZeroBearing: false, position: 'bottomleft' },
            touchRotate: true,
            zoomAnimation: true,
            fadeAnimation: true,
            markerZoomAnimation: true,
            preferCanvas: false,
            trackResize: true
        });

        const bounds = L.latLngBounds(stops.map(s => [s.lat, s.lon]));
        state.map.fitBounds(bounds, { padding: CONFIG.MAP.INIT_PADDING, animate: false });

        // Add tile layers
        const layers = {
            Map: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '&copy; OpenStreetMap',
                maxZoom: CONFIG.MAP.MAX_ZOOM,
                keepBuffer: CONFIG.MAP.TILE_BUFFER
            }),
            Satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
                attribution: 'Tiles &copy; Esri',
                maxZoom: CONFIG.MAP.MAX_ZOOM,
                keepBuffer: CONFIG.MAP.TILE_BUFFER
            })
        };

        layers.Map.addTo(state.map);
        L.control.layers(layers, null, { position: 'topright', collapsed: true }).addTo(state.map);

        // Invalidate size after tile load
        setTimeout(() => state.map.invalidateSize(true), CONFIG.MAP.INVALIDATE_DELAY);
        layers.Map.on('load', () => state.map.invalidateSize(true));

        // Scale control
        L.control.scale({
            position: 'bottomleft',
            metric: true,
            imperial: false,
            maxWidth: 100
        }).addTo(state.map);

        // Create markers
        state.markers = stops.map((stopData, idx) => {
            const m = L.marker([stopData.lat, stopData.lon], {
                riseOnHover: true,
                riseOffset: 250
            }).addTo(state.map);

            m.bindTooltip(String(stopData.id), {
                permanent: true,
                direction: 'center',
                className: 'number-label'
            });

            m.on('click', () => showStop(idx));
            return m;
        });

        // Add compass
        if (typeof L.Control.Compass !== 'undefined') {
            new L.Control.Compass({ autoActive: true, showDigit: false }).addTo(state.map);
        }

        // Add custom controls
        if (navigator.geolocation) {
            addGeolocationControls();
        }

        addNavigationControls();

        // Handle resize and visibility
        let resizeTimeout;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                if (state.map) state.map.invalidateSize(true);
            }, 200);
        });

        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && state.map) {
                setTimeout(() => state.map.invalidateSize(true), CONFIG.MAP.INVALIDATE_DELAY);
            }
        });

        // Mark map as ready
        state.mapReady = true;
        console.log('Map initialized successfully');

        // Trigger initial stop display if needed
        const initialStop = getInitialStopIndex() ?? Number(localStorage.getItem(`${tour_id}_stop_no`)) ?? 0;
        setTimeout(() => showStop(initialStop, false), 200);

    } catch (error) {
        console.error('Error initializing map:', error);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// LEAFLET CUSTOM CONTROLS
// ═══════════════════════════════════════════════════════════════════════════

function addGeolocationControls() {
    state.map.on('locationfound', e => {
        stopBlinkingCircle();
        stopPlaceholderPulse();

        if (state.locMarker) {
            state.map.removeLayer(state.locMarker);
        }

        state.locMarker = L.circle([e.latlng.lat, e.latlng.lng], {
            radius: e.accuracy * 2,
            color: '#136AEC',
            weight: 3,
            fillColor: '#136AEC',
            fillOpacity: 0.3
        }).addTo(state.map);

        if (state.following) {
            state.map.setView([e.latlng.lat, e.latlng.lng], null, { animate: true, duration: 0.5 });
            startBlinkingCircle(state.locMarker, { blinkMs: 500, visibleOpacity: 0.3, hiddenOpacity: 0 });
        }
    });

    state.map.on('locationerror', e => {
        showTemporaryBubble(`Couldn't get your location: ${e.message}`, null, 'error');
        stopBlinkingCircle();
        stopPlaceholderPulse();
    });

    // Follow Location Control
    const FollowControl = L.Control.extend({
        options: { position: 'topleft' },
        onAdd: function () {
            const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control-custom');
            const btn = L.DomUtil.create('a', '', container);

            Object.assign(btn.style, {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '34px',
                height: '34px',
                cursor: 'pointer'
            });

            btn.innerHTML = `
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <circle id="outerCircle" cx="12" cy="12" r="10" stroke="#212121" stroke-width="2" fill="#d7d7d7"/>
                    <path id="pin" d="M12 7a4 4 0 1 1 0 8a4 4 0 0 1 0-8z" fill="#212121" opacity="0.7"/>
                    <polygon id="arrow" points="12,4 14,12 12,10 10,12" fill="#d7d7d7"/>
                    <circle id="center" cx="12" cy="12" r="2" fill="#212121"/>
                </svg>`;
            btn.title = 'Follow My Location';

            L.DomEvent.disableClickPropagation(container);
            L.DomEvent.on(btn, 'click', e => {
                L.DomEvent.stop(e);

                if (state.locMarker) {
                    state.map.removeLayer(state.locMarker);
                    state.locMarker = null;
                }

                const svg = btn.querySelector('svg');
                if (!svg) return;

                const elements = {
                    circle: svg.querySelector('#outerCircle'),
                    pin: svg.querySelector('#pin'),
                    arrow: svg.querySelector('#arrow'),
                    center: svg.querySelector('#center')
                };

                if (!Object.values(elements).every(el => el)) return;

                if (!state.following) {
                    state.following = true;
                    elements.circle.setAttribute('fill', '#d7ecfc');
                    elements.circle.setAttribute('stroke', '#2196f3');
                    elements.pin.setAttribute('fill', '#2196f3');
                    elements.arrow.setAttribute('fill', '#f44336');
                    elements.center.setAttribute('fill', '#2196f3');
                    btn.title = 'Stop Following';
                    startPlaceholderPulse();
                    state.map.locate({
                        watch: true,
                        setView: false,
                        maxZoom: 16,
                        enableHighAccuracy: true
                    });
                } else {
                    state.following = false;
                    elements.circle.setAttribute('fill', '#d7d7d7');
                    elements.circle.setAttribute('stroke', '#212121');
                    elements.pin.setAttribute('fill', '#212121');
                    elements.arrow.setAttribute('fill', '#d7d7d7');
                    elements.center.setAttribute('fill', '#212121');
                    btn.title = 'Follow My Location';
                    state.map.stopLocate();
                    stopBlinkingCircle();
                    stopPlaceholderPulse();
                }
            });

            return container;
        }
    });
    state.map.addControl(new FollowControl());

    // Walking Path Control
    const WalkingPathControl = L.Control.extend({
        options: { position: 'topleft' },
        onAdd: function () {
            const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control-custom');
            const btn = L.DomUtil.create('a', '', container);

            Object.assign(btn.style, {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '34px',
                height: '34px',
                cursor: 'pointer'
            });

            btn.innerHTML = `
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="20" r="2.2" fill="#2196f3" stroke="#1565c0" stroke-width="1"/>
                    <path d="M12 18 Q14 16, 12 14 Q10 12, 12 10 Q14 8, 12 6" stroke="#2196f3" stroke-width="1.5" fill="none" stroke-dasharray="2,2"/>
                    <path d="M12 4a2.2 2.2 0 0 1 2.2 2.2c0 1.7-2.2 4-2.2 4s-2.2-2.3-2.2-4A2.2 2.2 0 0 1 12 4z" fill="#f44336" stroke="#b71c1c" stroke-width="1"/>
                    <circle cx="12" cy="6.2" r="0.8" fill="#fff"/>
                </svg>`;
            btn.title = 'Show Walking Path to Current Stop';

            L.DomEvent.disableClickPropagation(container);
            L.DomEvent.on(btn, 'click', e => {
                L.DomEvent.stop(e);
                calculateWalkingPath();
            });

            return container;
        }
    });
    state.map.addControl(new WalkingPathControl());
}

function addNavigationControls() {
    // Center on Current Stop Control
    const StopCenterControl = L.Control.extend({
        options: { position: 'topleft' },
        onAdd: function () {
            const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control-custom');
            const btn = L.DomUtil.create('a', '', container);

            Object.assign(btn.style, {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '34px',
                height: '34px',
                cursor: 'pointer'
            });

            btn.innerHTML = `
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <rect x="4" y="4" width="16" height="16" rx="3" stroke="#90caf9" stroke-width="1.2" fill="#e3f2fd"/>
                    <polygon points="12,2 13,6 11,6" fill="#2196f3"/>
                    <polygon points="12,22 13,18 11,18" fill="#2196f3"/>
                    <polygon points="2,12 6,13 6,11" fill="#2196f3"/>
                    <polygon points="22,12 18,13 18,11" fill="#2196f3"/>
                    <path d="M12 6.5a4 4 0 0 1 4 4c0 2.5-4 7-4 7s-4-4.5-4-7a4 4 0 0 1 4-4z" fill="#f44336" stroke="#b71c1c" stroke-width="1"/>
                    <circle cx="12" cy="10.5" r="1.2" fill="#fff"/>
                </svg>`;
            btn.title = 'Center on Current Stop';

            L.DomEvent.disableClickPropagation(container);
            L.DomEvent.on(btn, 'click', e => {
                L.DomEvent.stop(e);
                const stopData = stops[state.currentIndex];
                if (stopData && state.map) {
                    state.map.flyTo([stopData.lat, stopData.lon], 16, { duration: 0.8 });
                    showStop(state.currentIndex, false);
                }
            });

            return container;
        }
    });
    state.map.addControl(new StopCenterControl());
}

// ═══════════════════════════════════════════════════════════════════════════
// WALKING PATH CALCULATION
// ═══════════════════════════════════════════════════════════════════════════

function calculateWalkingPath() {
    if (!state.map) return;

    if (state.locMarker) {
        state.map.removeLayer(state.locMarker);
        state.locMarker = null;
    }
    stopPlaceholderPulse();

    const stopData = stops[state.currentIndex];
    if (!stopData) {
        showTemporaryBubble('No current stop data available', null, 'error');
        return;
    }

    showTemporaryBubble('Calculating route...', null, 'info');

    navigator.geolocation.getCurrentPosition(
        position => {
            const { latitude: userLat, longitude: userLng } = position.coords;
            const { lat: destLat, lon: destLng } = stopData;

            const osrmUrl = `https://routing.openstreetmap.de/routed-foot/route/v1/foot/${userLng},${userLat};${destLng},${destLat}?overview=full&geometries=geojson`;

            fetch(osrmUrl)
                .then(response => {
                    if (!response.ok) throw new Error('Route calculation failed');
                    return response.json();
                })
                .then(data => {
                    if (!data.routes?.length) {
                        showTemporaryBubble('No route found', null, 'error');
                        return;
                    }

                    if (state.locMarker && state.map) state.map.removeLayer(state.locMarker);
                    stopPlaceholderPulse();

                    const latlngs = data.routes[0].geometry.coordinates.map(coord => [coord[1], coord[0]]);

                    if (state.currentPath && state.map) {
                        state.map.removeLayer(state.currentPath);
                        stopDashAnimation();
                    }

                    if (!state.map) return;

                    state.currentPath = L.polyline(latlngs, {
                        color: '#28a745',
                        weight: 4,
                        dashArray: '20,5',
                        opacity: 0.9,
                        lineJoin: 'round',
                        lineCap: 'round'
                    }).addTo(state.map);

                    state.intervals.dash = animateDashedLine(state.currentPath, 1);

                    if (!state.following) {
                        addPulsatingCircle(userLat, userLng, {
                            maxRadius: position.accuracy,
                            color: '#136AEC',
                            fillOpacity: 0.3
                        });
                    }

                    state.map.flyToBounds(state.currentPath.getBounds(), { padding: [50, 50], duration: 0.8 });

                    const distance = (data.routes[0].distance / 1000).toFixed(2);
                    const duration = Math.round(data.routes[0].duration / 60);
                    showTemporaryBubble(`Route: ${distance} km, ~${duration} min`, null, 'success');
                })
                .catch(err => showTemporaryBubble(`Error: ${err.message}`, null, 'error'));
        },
        err => showTemporaryBubble(`Could not get location: ${err.message}`, null, 'error'),
        { enableHighAccuracy: true, timeout: 10000 }
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════

if (typeof L !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(initMap, CONFIG.MAP.INVALIDATE_DELAY));
    } else {
        setTimeout(initMap, CONFIG.MAP.INVALIDATE_DELAY);
    }
}

window.addEventListener('beforeunload', clearIntervals);