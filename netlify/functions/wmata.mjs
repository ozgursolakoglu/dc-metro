// Netlify Function: forwards a fixed set of WMATA API calls, adds the secret API key,
// decodes the GTFS-RT occupancy feed to JSON and lets Netlify's CDN cache the results
// so many viewers share the same upstream request.
const BASE = 'https://api.wmata.com';
const ROUTES = {
  stations:    { path: '/Rail.svc/json/jStations',                    ttl: 86400 },
  routes:      { path: '/TrainPositions/StandardRoutes?contentType=json', ttl: 86400 },
  positions:   { path: '/TrainPositions/TrainPositions?contentType=json', ttl: 8 },
  predictions: { path: '/StationPrediction.svc/json/GetPrediction/All', ttl: 15 },
  incidents:   { path: '/Incidents.svc/json/Incidents',               ttl: 60 },
  occupancy:   { path: '/gtfs/rail-gtfsrt-vehiclepositions.pb',       ttl: 20, protobuf: true },
};

const json = (obj, status = 200, ttl = 0) => new Response(JSON.stringify(obj), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'public, max-age=0, must-revalidate',
    ...(ttl ? { 'netlify-cdn-cache-control': `public, durable, s-maxage=${ttl}, stale-while-revalidate=${ttl}` } : {}),
  },
});

export default async (req) => {
  const name = new URL(req.url).pathname.split('/').filter(Boolean).pop();
  const route = ROUTES[name];
  if (!route) return json({ error: 'Unknown endpoint' }, 404);

  const key = (globalThis.Netlify?.env?.get?.('WMATA_API_KEY')) || process.env.WMATA_API_KEY;
  if (!key) return json({ error: 'WMATA_API_KEY is not set in Netlify environment variables' }, 500);

  let upstream;
  try {
    upstream = await fetch(BASE + route.path, { headers: { api_key: key } });
  } catch (e) {
    return json({ error: 'Could not reach WMATA: ' + e.message }, 502);
  }
  if (!upstream.ok) {
    const msg = upstream.status === 401 ? 'WMATA rejected the API key (401)' : 'WMATA returned HTTP ' + upstream.status;
    return json({ error: msg }, upstream.status === 429 ? 429 : 502);
  }

  if (route.protobuf) {
    try {
      const buf = new Uint8Array(await upstream.arrayBuffer());
      return json(decodeVehiclePositions(buf), 200, route.ttl);
    } catch (e) {
      return json({ error: 'Could not decode occupancy feed: ' + e.message }, 502);
    }
  }
  return new Response(await upstream.text(), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=0, must-revalidate',
      'netlify-cdn-cache-control': `public, durable, s-maxage=${route.ttl}, stale-while-revalidate=${route.ttl}`,
    },
  });
};

export const config = { path: '/api/*' };

// ---- Minimal GTFS-Realtime (protobuf) decoder for vehicle positions ----
const td = new TextDecoder();
function reader(buf) {
  let p = 0;
  return {
    eof: () => p >= buf.length,
    varint() { let r = 0, s = 0, b; do { b = buf[p++]; r += (b & 0x7f) * 2 ** s; s += 7; } while (b & 0x80); return r; },
    bytes() { const l = this.varint(); const v = buf.subarray(p, p + l); p += l; return v; },
    f32() { const v = new DataView(buf.buffer, buf.byteOffset + p, 4).getFloat32(0, true); p += 4; return v; },
    skip(w) {
      if (w === 0) this.varint();
      else if (w === 1) p += 8;
      else if (w === 2) { const l = this.varint(); p += l; }
      else if (w === 5) p += 4;
      else throw new Error('unsupported wire type ' + w);
    },
  };
}
function each(buf, cb) { const r = reader(buf); while (!r.eof()) { const tag = r.varint(); cb(Math.floor(tag / 8), tag & 7, r); } }
const str = (r) => td.decode(r.bytes());

export function decodeVehiclePositions(buf) {
  let timestamp = 0; const vehicles = [];
  each(buf, (f, w, r) => {
    if (f === 1 && w === 2) each(r.bytes(), (f2, w2, r2) => { if (f2 === 3 && w2 === 0) timestamp = r2.varint(); else r2.skip(w2); });
    else if (f === 2 && w === 2) {
      const v = {};
      each(r.bytes(), (fe, we, re) => {
        if (fe !== 4 || we !== 2) return re.skip(we);
        each(re.bytes(), (fv, wv, rv) => {
          if (fv === 1 && wv === 2) each(rv.bytes(), (ft, wt, rt) => { if (ft === 1 && wt === 2) v.trip = str(rt); else if (ft === 5 && wt === 2) v.route = str(rt); else rt.skip(wt); });
          else if (fv === 2 && wv === 2) each(rv.bytes(), (fp, wp, rp) => { if (fp === 1 && wp === 5) v.lat = rp.f32(); else if (fp === 2 && wp === 5) v.lon = rp.f32(); else rp.skip(wp); });
          else if (fv === 8 && wv === 2) each(rv.bytes(), (fd, wd, rd) => { if (fd === 1 && wd === 2) v.id = str(rd); else if (fd === 2 && wd === 2) v.label = str(rd); else rd.skip(wd); });
          else if (fv === 9 && wv === 0) v.occ = rv.varint();
          else if (fv === 7 && wv === 2) v.stop = str(rv);
          else if (fv === 5 && wv === 0) v.ts = rv.varint();
          else rv.skip(wv);
        });
      });
      if (v.lat !== undefined || v.occ !== undefined) vehicles.push(v);
    } else r.skip(w);
  });
  return { timestamp, vehicles };
}
