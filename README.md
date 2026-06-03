# Emergency Shift Coverage Tool

Phase 1 MVP for quickly finding guards who can cover an emergency security shift.

The current build is intentionally **zero-install** because this machine has Node available but no `npm`, `pnpm`, or `yarn`. It runs with the bundled Node runtime and does not require dependencies.

## What is built

- Screenshot upload flow
- Gemini-powered screenshot parsing with demo fallback
- Google Maps geocoding support
- Editable shift details
- Radius filter: 5, 10, 15, 25, 50 km
- Active guard roster from seed data
- Schedule conflict detection
- Distance sorting using the Haversine formula
- Available / busy / outside-radius results
- Manual contact logging
- Twilio SMS for texting one guard or all available guards
- First `YES` reply wins, with live status updates in the UI
- AI auto-fill agent: escalating SMS waves, then AI voice calls to non-responders
- Twilio Voice calls (press 1 to accept / 2 to decline) for emergency escalation
- Compliance guardrails: blocks guards over 44h/week or with an expired license
- JSON runtime state persistence for contact logs and SMS coverage requests
- Polished browser UI for demoing to management

## Run it

```bash
node server.js
```

Open:

```text
http://localhost:3001
```

The server also exposes:

- `GET /api/health`
- `GET /api/guards`
- `GET /api/schedule`
- `POST /api/parse-shift`
- `POST /api/coverage`
- `GET /api/contact-log`
- `POST /api/contact-log`
- `GET /api/sms/config`
- `POST /api/sms/contact`
- `GET /api/sms/request?id=<requestId>`
- `POST /api/sms/inbound`

## Demo data

Seed data is in:

- `backend/src/data/guards.json`
- `backend/src/data/schedule.json`

The seed roster is anonymized Toronto-area test data.

## MVP behavior

When you upload a screenshot, the app uses Gemini if `GEMINI_API_KEY` is configured. If parsing is unavailable, the app falls back to a demo parsed shift so the rest of the workflow still works.

The core availability algorithm:

1. Loads active guards.
2. Loads shifts for the selected date.
3. Marks guards busy if their schedule overlaps the open shift.
4. Calculates distance from guard home coordinates to the site.
5. Filters available guards by selected radius.
6. Sorts available guards by distance.

## SMS workflow

1. Find available guards for the open shift.
2. Click **Text** on one guard, or **Text all available**.
3. The app sends SMS messages through Twilio.
4. Guards reply `YES` or `NO`.
5. The first guard who replies `YES` is marked as the winner.
6. Other contacted guards are marked as lost once the shift is filled.

For local testing, expose the app with a tunnel and set Twilio's inbound webhook to:

```text
<public-url>/api/sms/inbound
```

For deployment, use the Render URL instead.

### AI auto-fill agent

Clicking **Start AI auto-fill** runs an autonomous fill loop:

1. Wave 1 texts the top 3 eligible guards.
2. After ~45 seconds with no `YES`, the next wave of 3 is texted.
3. When SMS waves are exhausted, the agent escalates to AI **voice calls**
   (press 1 to accept) for guards who never replied.
4. The first guard to accept by text or voice wins; everyone else is notified
   the shift is filled.

Voice escalation requires `PUBLIC_BASE_URL` to be set to a public HTTPS URL
(Render or a tunnel) so Twilio can reach the call instructions.

### Compliance guardrails

Before contacting anyone, the tool removes guards who would break the rules and
shows the reason instead:

- Already on an overlapping shift.
- Would exceed 44 hours in the shift's week (overtime).
- Security license expired before the shift date.

## Deploying to Render for a demo

This repo includes `render.yaml`, so Render can detect the app as a Node web service.

Recommended demo setup:

1. Push the project to GitHub.
2. Create a new Render web service from the GitHub repo.
3. Use:
   - Build command: `npm install`
   - Start command: `node server.js`
   - Health check path: `/api/health`
4. Add the environment variables from your local `.env` into Render's environment settings.
5. Set `PUBLIC_BASE_URL` to your deployed Render URL, for example:

```text
https://your-app-name.onrender.com
```

6. In Twilio, set the inbound SMS webhook to:

```text
https://your-app-name.onrender.com/api/sms/inbound
```

Important: Render free services can sleep or restart. JSON state works for the demo app, but for the most reliable week-long demo, use a small persistent disk or be okay with contact/SMS history resetting if the service restarts.

## Next build steps

1. Replace seed JSON with Google Sheets or a database for production data.
2. Add Google Maps Distance Matrix for drive-time distance.
3. Add TrackTik API integration once credentials are approved.
4. Add login/access control for internal users.
5. Move runtime state from JSON to a production database.

## Environment variables

Copy `.env.example` to `.env` locally, and set the same values in Render's environment settings for deployment.

Never commit `.env`.
