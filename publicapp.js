// app.js
const socket = io();

let myId = null;
let myName = '';
let myLat = null;
let myLon = null;
let myHeading = null; // degrees from north [0..360)
let watchId = null;
let room = 'default';

const peers = {}; // id -> peer object

const statusEl = document.getElementById('status');
const peersEl = document.getElementById('peers');
const startBtn = document.getElementById('startBtn');
const roomInput = document.getElementById('room');
const nameInput = document.getElementById('name');

function setStatus(s) { statusEl.textContent = s; }

function toRadians(d){ return d * Math.PI/180; }
function toDegrees(r){ return r * 180/Math.PI; }

// compute initial bearing from (lat1,lon1) to (lat2,lon2)
function computeBearing(lat1, lon1, lat2, lon2){
  const φ1 = toRadians(lat1);
  const φ2 = toRadians(lat2);
  const Δλ = toRadians(lon2 - lon1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1)*Math.sin(φ2) - Math.sin(φ1)*Math.cos(φ2)*Math.cos(Δλ);
  let θ = Math.atan2(y, x);
  θ = toDegrees(θ);
  return (θ + 360) % 360; // [0..360)
}

// normalize angle to [-180,180)
function normalize180(a){
  a = ((a + 180) % 360) - 180;
  if (a === -180) return 180;
  return a;
}

function relativeAngleToPeer(peer){
  if (myLat == null || myLon == null) return null;
  if (peer.lat == null || peer.lon == null) return null;
  const bearing = computeBearing(myLat, myLon, peer.lat, peer.lon); // where the peer is from me
  if (myHeading == null) return bearing; // absolute bearing if no heading
  const rel = normalize180(bearing - myHeading);
  return rel; // degrees: positive = clockwise from device forward (i.e., rotate clockwise)
}

// what direction the peer sees you (relative to their heading)
function reciprocalAngleForPeer(peer){
  if (myLat == null || myLon == null) return null;
  if (peer.lat == null || peer.lon == null) return null;
  if (peer.heading == null) return null;
  const bearingFromPeerToMe = computeBearing(peer.lat, peer.lon, myLat, myLon);
  const rel = normalize180(bearingFromPeerToMe - peer.heading);
  return rel;
}

function createPeerElement(id){
  const el = document.createElement('div');
  el.className = 'peer';
  el.id = 'peer-'+id;
  el.innerHTML = `
    <div class="arrow">
      <svg viewBox="-50 -50 100 100" class="arrow-svg">
        <g>
          <path d="M0,-32 L12,-4 L6,-4 L6,36 L-6,36 L-6,-4 L-12,-4 Z" fill="#1976d2" stroke="#0b57a4" stroke-width="1"/>
        </g>
      </svg>
    </div>
    <div>
      <div class="info"><strong class="peer-name"></strong> <span class="muted peer-id"></span></div>
      <div class="muted peer-meta"></div>
      <div class="muted peer-reciprocal"></div>
    </div>
  `;
  peersEl.appendChild(el);
  return el;
}

function updatePeerElement(peer){
  let el = document.getElementById('peer-'+peer.id);
  if (!el) el = createPeerElement(peer.id);
  el.querySelector('.peer-name').textContent = peer.name || peer.id;
  el.querySelector('.peer-id').textContent = `(${peer.id.slice(0,6)})`;
  const meta = (peer.lat && peer.lon) ? `lat:${peer.lat.toFixed(5)}, lon:${peer.lon.toFixed(5)}` : 'no location';
  el.querySelector('.peer-meta').textContent = meta + (peer.heading != null ? ` • heading:${peer.heading.toFixed(0)}°` : '');
  // rotation for arrow
  const rel = relativeAngleToPeer(peer);
  const svg = el.querySelector('.arrow-svg');
  if (rel == null){
    svg.style.opacity = 0.3;
    svg.style.transform = 'rotate(0deg)';
  } else {
    svg.style.opacity = 1;
    // we want 0deg to mean "pointing straight ahead", and positive clockwise rotation
    svg.style.transform = `rotate(${rel}deg)`;
  }
  // reciprocal
  const recip = reciprocalAngleForPeer(peer);
  const recipText = recip == null ? 'reciprocal: unknown' : `reciprocal: ${recip.toFixed(0)}° (what they see)`;
  el.querySelector('.peer-reciprocal').textContent = recipText;
}

function removePeerElement(id){
  const el = document.getElementById('peer-'+id);
  if (el) el.remove();
}

socket.on('connect', () => {
  myId = socket.id;
  setStatus('connected to server');
});

// initial peers list
socket.on('peers', (list) => {
  list.forEach(p => {
    peers[p.id] = p;
    updatePeerElement(p);
  });
});

// peer update
socket.on('peer-update', (p) => {
  peers[p.id] = Object.assign(peers[p.id] || {}, p);
  updatePeerElement(peers[p.id]);
});

// peer left
socket.on('peer-left', (info) => {
  delete peers[info.id];
  removePeerElement(info.id);
});

function sendUpdate(){
  if (!myLat || !myLon) return;
  socket.emit('update', { lat: myLat, lon: myLon, heading: myHeading, name: myName });
}

// start geolocation & orientation
async function startSharing(){
  room = (roomInput.value || 'default');
  myName = (nameInput.value && nameInput.value.trim()) || 'Anonymous';
  socket.emit('join-room', room);
  setStatus('joined room ' + room + ' — waiting for geolocation & orientation');

  // geolocation watch
  if (navigator.geolocation){
    watchId = navigator.geolocation.watchPosition((pos) => {
      myLat = pos.coords.latitude;
      myLon = pos.coords.longitude;
      // prefer heading from device coords if available
      if (pos.coords.heading != null && isNaN(myHeading)){
        myHeading = pos.coords.heading;
      }
      setStatus(`pos ${myLat.toFixed(5)}, ${myLon.toFixed(5)} • heading: ${myHeading != null ? myHeading.toFixed(0)+'°' : 'unknown'}`);
      sendUpdate();
      // update peer UI (because reciprocal values changed)
      Object.values(peers).forEach(updatePeerElement);
    }, (err) => {
      setStatus('geolocation error: ' + err.message);
    }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 });
  } else {
    setStatus('Geolocation not supported');
  }

  // DeviceOrientation (compass)
  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
    // iOS 13+ requires explicit permission
    try {
      const resp = await DeviceOrientationEvent.requestPermission();
      if (resp !== 'granted') {
        setStatus('Device orientation permission denied');
      } else {
        window.addEventListener('deviceorientation', onDeviceOrientation, true);
      }
    } catch (e) {
      setStatus('Device orientation request error: ' + e);
    }
  } else if (window.DeviceOrientationEvent) {
    window.addEventListener('deviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation', onDeviceOrientation, true);
  } else {
    setStatus('Device orientation not supported');
  }
}

function onDeviceOrientation(e){
  // Try vendor-specific first (webkitCompassHeading), then absolute alpha, then fallback.
  let heading = null;
  if (e && e.webkitCompassHeading != null){ // iOS Safari
    heading = e.webkitCompassHeading;
  } else if (e && typeof e.absolute === 'boolean' && e.absolute && e.alpha != null){
    // absolute orientation, alpha is degrees clockwise from device's reference to north
    heading = 360 - e.alpha; // conversions vary across devices; this is commonly used
  } else if (e && e.alpha != null && e.beta != null && e.gamma != null){
    // This may not be absolute; still try to use alpha as an approximation
    heading = 360 - e.alpha;
  }
  if (heading != null){
    myHeading = (heading + 360) % 360;
    setStatus(`pos ${myLat != null ? myLat.toFixed(5) : '?'} , ${myLon != null ? myLon.toFixed(5) : '?'} • heading: ${myHeading.toFixed(0)}°`);
    sendUpdate();
    Object.values(peers).forEach(updatePeerElement);
  }
}

startBtn.addEventListener('click', () => {
  startBtn.disabled = true;
  startSharing().catch(err => {
    setStatus('start error: ' + err);
    startBtn.disabled = false;
  });
});
