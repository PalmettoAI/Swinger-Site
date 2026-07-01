'use strict';

/**
 * Lightweight geo helpers. For the MVP we ship a bundled lookup of major US
 * metros so users can pick a city and get lat/lng without an external API.
 * At scale, swap resolveCity() for a geocoding service (Google Maps / Mapbox).
 */

// A compact seed of US metros (lat, lng). Extend freely.
const METROS = {
  'Atlanta, GA': [33.749, -84.388],
  'Austin, TX': [30.267, -97.743],
  'Charlotte, NC': [35.227, -80.843],
  'Chicago, IL': [41.878, -87.629],
  'Columbia, SC': [34.0, -81.035],
  'Dallas, TX': [32.777, -96.797],
  'Denver, CO': [39.739, -104.99],
  'Houston, TX': [29.76, -95.369],
  'Las Vegas, NV': [36.169, -115.14],
  'Los Angeles, CA': [34.052, -118.244],
  'Miami, FL': [25.762, -80.192],
  'Nashville, TN': [36.163, -86.781],
  'New Orleans, LA': [29.951, -90.072],
  'New York, NY': [40.713, -74.006],
  'Orlando, FL': [28.538, -81.379],
  'Phoenix, AZ': [33.448, -112.074],
  'Portland, OR': [45.515, -122.678],
  'Raleigh, NC': [35.779, -78.638],
  'San Diego, CA': [32.716, -117.161],
  'San Francisco, CA': [37.775, -122.419],
  'Seattle, WA': [47.606, -122.332],
  'Tampa, FL': [27.951, -82.457],
  'Washington, DC': [38.907, -77.037],
};

function metroList() {
  return Object.keys(METROS).sort();
}

/** "City, ST" -> { city, state, lat, lng } | null */
function resolveCity(label) {
  if (!label) return null;
  const coords = METROS[label];
  const [city, state] = label.split(',').map((s) => s.trim());
  if (!coords) return { city, state, lat: null, lng: null };
  return { city, state, lat: coords[0], lng: coords[1] };
}

/** Haversine distance in miles. */
function milesBetween(lat1, lng1, lat2, lng2) {
  if ([lat1, lng1, lat2, lng2].some((v) => v == null)) return null;
  const R = 3958.8;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

module.exports = { METROS, metroList, resolveCity, milesBetween };
