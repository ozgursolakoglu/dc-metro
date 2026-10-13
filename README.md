# DC Metro – Live Digital Shadow

A live dashboard for the Washington DC Metrorail network, built for teaching artificial intelligence and digital twin concepts.

## Features

- Map of all six Metrorail lines (Red, Orange, Silver, Blue, Yellow, Green) drawn from WMATA's own station and track data
- Live train positions from WMATA's track-circuit feed, refreshed about every 10 seconds
- Train occupancy (many seats / few seats / full) from the GTFS-Realtime vehicle feed
- Trains held at the same location for 3 minutes or more are outlined in red
- Search any station; indicators for the selected station: next train, trains in the next 15 minutes, average interval, share of 8-car trains, share of full trains on its lines and active alerts, plus an arrivals board
- Occupancy chart by line, network overview and WMATA service alerts
- Falls back to simulated data automatically when the live feed is unavailable

Data source: [WMATA Developer API](https://developer.wmata.com/) (free Default Tier key required).

## How it works

The page is static. A small Netlify Function (`netlify/functions/wmata.mjs`) forwards a fixed set of WMATA requests, adds the API key from a Netlify environment variable, decodes the GTFS-Realtime feed to JSON and lets Netlify's CDN cache each response for a few seconds. The key never appears in the browser or in this repository, and many viewers share the same upstream requests.

## Setup

1. Create a free account at [developer.wmata.com](https://developer.wmata.com/), subscribe to the **Default Tier** product and copy your **Primary key**.
2. Push these files to a GitHub repository (`index.html`, `netlify.toml`, `README.md`, `.gitignore` and the `netlify/functions/wmata.mjs` file).
3. In [Netlify](https://app.netlify.com), choose **Add new site > Import an existing project > GitHub** and select the repository. Leave the build settings empty.
4. Before or after the first deploy, open **Site configuration > Environment variables**, add a variable named `WMATA_API_KEY` with your key as the value, and save.
5. Go to **Deploys** and choose **Trigger deploy > Deploy site** so the function picks up the key.
6. Open the site. The status pill in the header should read **Live data**.

Never put the API key in `index.html` or any other file in the repository.

## Limitations

- Positions are based on track circuits, so a train's location is accurate to the circuit it occupies, not to the metre.
- Occupancy is matched to trains by ID or, failing that, by nearest position on the same line; some trains may show no occupancy.
- The Default Tier allows 10 calls per second and 50,000 calls per day. The CDN cache keeps usage well below this.
- The system only observes trains and cannot control them, so it is a **digital shadow** rather than a true digital twin.
