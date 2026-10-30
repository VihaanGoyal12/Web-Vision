# ChargeZone Relay — buildathon prototype

This project preserves the downloaded ChargeZone marketing website and adds a runnable backend-backed reliability demo.

## Requirements
- Node.js 18+ (no npm packages required)

## Run
```bash
node server.js
```
Open:
- Main website: http://localhost:3000/
- Relay console: http://localhost:3000/relay.html

## Demo flow
1. In Relay, reserve one of the healthy available chargers.
2. Confirm the reservation and ₹500 simulated payment hold.
3. Click **Charger start failure** in Fault injection lab.
4. Watch the reservation become RELEASED, payment become RELEASED, session become ROLLED_BACK, and auto-recovery count increase.
5. The charger becomes available again and a new reservation can be created.
6. Try **Heartbeat timeout** to mark a charger offline and prevent new bookings.
7. Use **Reset demo** to restore sample data.

## API
- `GET /api/state`
- `POST /api/reserve` `{ "chargerId": "CZ-101", "userId": "rahul" }`
- `POST /api/simulate/start-failure` `{ "reservationId": "RES-..." }`
- `POST /api/simulate/heartbeat-loss` `{ "chargerId": "CZ-101" }`
- `POST /api/simulate/session-ended` `{ "reservationId": "RES-..." }`
- `POST /api/reset` `{}`

## Scope and honesty
- The original site is a static website mirror, not the ChargeZone production application.
- The Relay backend uses Node's built-in HTTP server and JSON-file persistence; no external services are connected.
- Charger telemetry, charging sessions, and payment holds are simulated. The event flow is OCPP-inspired but this is not a certified OCPP implementation.
- All charger names, IDs, user details, and ₹500 holds are illustrative sample data.

## Run the frontend with VS Code Live Server
Live Server serves the HTML/CSS/JS frontend, but it does not run the Node.js API. Run both:

1. Open this `www-chargezone-co-in` folder in VS Code.
2. Open a VS Code terminal in this folder and run `node server.js`. Keep this terminal running (API: `http://localhost:3000`).
3. In VS Code Explorer, right-click `relay.html` and choose **Open with Live Server** (usually `http://127.0.0.1:5500/relay.html`).
4. To view the original ChargeZone site through Live Server, right-click `index.html` and choose **Open with Live Server**.

The Relay frontend is configured to call the API at `http://localhost:3000`. If you change the backend port, update that API base URL in `relay.html` too.
