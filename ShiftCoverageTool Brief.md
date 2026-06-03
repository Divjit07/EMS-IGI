# Emergency Shift Coverage Tool — Full Build Brief

> Internal tool for a security company. Built by DJ (Divjit Singh). To be pitched to management after MVP is ready.

-----

## What This Tool Does

When a guard calls in sick or a shift needs last-minute coverage, a supervisor currently spends 30–60 minutes manually calling guards to find someone available. This tool cuts that to under 2 minutes.

**The flow:**

1. Supervisor uploads a shift screenshot from a group chat or scheduling system
1. AI reads the image and extracts shift details (date, time, location, shift code)
1. App pulls all guards from the database
1. Cross-references the schedule to find who is NOT already working
1. Filters guards by proximity to the shift location
1. Displays available guards with phone numbers, distance, and certifications
1. Supervisor taps Contact → SMS is sent automatically to the guard
1. Guard replies YES or NO
1. If YES → shift is assigned back into TrackTik automatically

-----

## Build Phases

### Phase 1 — MVP / Demo (Google Sheets backend)

**Goal:** Working demo to pitch to management. No API approval needed.

- Google Sheets as the guard database (name, phone, address, certifications)
- Google Sheets as the schedule (who is working when and where)
- AI image parsing via Claude API (already working)
- Distance filtering by radius (5, 10, 15, 25 km)
- Contact log (who was contacted, at what time)
- No SMS yet — supervisor calls manually after seeing the list

**Cost:** ~$0 (free Google Sheets API, minimal Claude API usage)
**Timeline:** 1–2 weeks

-----

### Phase 2 — Production (TrackTik integration)

**Goal:** Replace Google Sheets with live TrackTik data.

- Connect to TrackTik REST API (requires API credentials from management)
- Pull guard roster automatically
- Pull live schedule automatically
- Write shift assignment back into TrackTik after confirmation

**Requires:** TrackTik API access enabled on company account (need to ask manager/IT)
**Timeline:** 1 week after credentials received

-----

### Phase 3 — Full Automation (SMS)

**Goal:** Fully hands-off after supervisor uploads the screenshot.

- Twilio integration for outbound SMS to available guards
- Inbound SMS webhook to capture YES/NO replies
- Auto-assign first guard who replies YES
- Notify other guards that shift is filled
- Real-time UI update showing confirmation status

**Cost:** ~$0.008 per SMS (very cheap), ~$15 Twilio setup
**Timeline:** 1 week

-----

## Tech Stack

|Layer                           |Tool                       |Notes                                 |
|--------------------------------|---------------------------|--------------------------------------|
|Frontend                        |React + Tailwind           |Already built (prototype done)        |
|AI Image Parsing                |Claude API (Anthropic)     |Extracts shift details from screenshot|
|Guard + Schedule Data (Phase 1) |Google Sheets API          |Free, manual entry                    |
|Guard + Schedule Data (Phase 2+)|TrackTik REST API          |Requires company API access           |
|SMS Sending                     |Twilio                     |~$0.008/text outbound                 |
|SMS Receiving                   |Twilio Webhook             |Captures YES/NO replies               |
|Backend / API Logic             |Node.js or Python (FastAPI)|Handles all API calls and logic       |
|Distance Calculation            |Google Maps API            |Free up to 28k calls/month            |
|Hosting                         |Railway or Render          |~$5–10/month                          |

**Estimated monthly running cost: under $30/month**

-----

## API Integrations Needed

### 1. TrackTik API

- Base URL: Your company’s TrackTik instance
- Auth: OAuth2 (client_id + client_secret)
- Endpoints needed:
  - `GET /v1/employees` — full guard roster
  - `GET /v1/schedules` — shifts by date range
  - `GET /v1/sites` — site locations and addresses
  - `POST /v1/schedules` — assign a guard to a shift
- **Action needed:** Ask your manager or IT if API access is enabled on your TrackTik account

### 2. Claude API (Anthropic)

- Already integrated in prototype
- Used for: reading shift screenshots and extracting structured data
- Model: claude-sonnet-4-20250514
- Get API key at: <https://console.anthropic.com>

### 3. Twilio (Phase 3)

- Used for: sending SMS to guards, receiving YES/NO replies
- Setup: Create account at twilio.com, buy a number (~$1.15/month)
- Webhook: Twilio calls your backend URL when a guard replies

### 4. Google Maps API

- Used for: calculating distance between guard home address and shift location
- Free tier: 28,000 calls/month
- Get API key at: <https://console.cloud.google.com>

-----

## Google Sheets Structure (Phase 1)

### Sheet 1: Guards

|Column        |Description                                            |
|--------------|-------------------------------------------------------|
|id            |Unique guard ID (e.g. G001)                            |
|name          |Full name                                              |
|phone         |Phone number                                           |
|email         |Email address                                          |
|address       |Home address                                           |
|postal_code   |Postal code for distance calc                          |
|lat           |Latitude (can be geocoded from address)                |
|lng           |Longitude                                              |
|certifications|Comma-separated (e.g. “Security Guard, First Aid, CPR”)|
|status        |active / inactive                                      |

### Sheet 2: Schedule

|Column      |Description                 |
|------------|----------------------------|
|guard_id    |Matches id from Guards sheet|
|guard_name  |For readability             |
|shift_date  |YYYY-MM-DD                  |
|start_time  |HH:MM (24hr)                |
|end_time    |HH:MM (24hr)                |
|site_name   |Location name               |
|site_address|Full address                |
|shift_code  |e.g. Metro 235 (TT)         |

-----

## Backend Logic (Core Algorithm)

```
function findAvailableGuards(shiftDate, startTime, endTime, siteLocation, radiusKm):

  1. Pull all active guards from database
  2. Pull all shifts for shiftDate from schedule
  3. For each guard:
     a. Check if they have ANY shift that overlaps with startTime–endTime on shiftDate
     b. If no overlap → mark as AVAILABLE
     c. If overlap → mark as BUSY (include what shift they're on)
  4. Calculate distance from each guard's home to siteLocation
  5. Filter: keep only guards within radiusKm
  6. Sort: by distance ascending
  7. Return: available guards first, then busy guards (for reference)
```

-----

## SMS Flow (Phase 3)

**Outbound message sent to available guards:**

```
Hi [Name], this is [Company]. A shift needs coverage:
📅 [Date] | ⏰ [Start]–[End]
📍 [Location]
Reply YES to take it or NO to pass.
```

**On YES reply:**

- Mark shift as filled in the app
- Assign guard in TrackTik (Phase 2+)
- Send confirmation SMS: “You’re confirmed for [shift]. See you there.”
- Send to all other guards: “Thanks, shift has been filled.”

**On NO reply:**

- Mark that guard as declined
- Move to next available guard on the list

**Edge case — multiple YES replies:**

- Only first YES is accepted
- Others get “Thanks, shift is already filled.”

-----

## File Structure (When Building)

```
shift-coverage-tool/
├── frontend/
│   ├── src/
│   │   ├── App.jsx              # Main app (prototype already done)
│   │   ├── components/
│   │   │   ├── UploadZone.jsx   # Screenshot upload
│   │   │   ├── ShiftCard.jsx    # Parsed shift display
│   │   │   ├── GuardList.jsx    # Available guards
│   │   │   └── ContactLog.jsx   # Who was contacted
│   │   └── api/
│   │       └── client.js        # API calls to backend
├── backend/
│   ├── index.js (or main.py)    # Entry point
│   ├── routes/
│   │   ├── parse-shift.js       # Claude API image parsing
│   │   ├── guards.js            # Guard data (Sheets or TrackTik)
│   │   ├── schedule.js          # Schedule data
│   │   └── sms.js               # Twilio send/receive
│   └── utils/
│       ├── distance.js          # Haversine formula or Google Maps
│       └── availability.js      # Core availability algorithm
├── .env                         # API keys (never commit this)
└── README.md
```

-----

## Environment Variables Needed

```
# Claude / Anthropic
ANTHROPIC_API_KEY=

# TrackTik (Phase 2+)
TRACKTIK_BASE_URL=
TRACKTIK_CLIENT_ID=
TRACKTIK_CLIENT_SECRET=

# Google Sheets (Phase 1)
GOOGLE_SHEETS_API_KEY=
GUARDS_SHEET_ID=
SCHEDULE_SHEET_ID=

# Twilio (Phase 3)
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=

# Google Maps
GOOGLE_MAPS_API_KEY=

# App
PORT=3001
```

-----

## Pitch Script (For Management)

> “Right now when a shift needs emergency coverage, we spend 30–60 minutes going through contacts manually. I built a tool that does this automatically — a supervisor uploads the shift screenshot, the AI reads it, finds all guards in the area who aren’t already working, and sends them a text. First one to say yes gets the shift. The whole thing takes under 2 minutes. I’d like to demo it — can I get 10 minutes with you this week?”

**Key numbers to track before pitching:**

- How many emergency coverage situations happen per month?
- How long does it currently take to fill each one?
- How often do shifts go unfilled?

Those numbers make the business case concrete.

-----

## What To Do Right Now

1. Set up Google Sheets with guard roster (use anonymized test data to start)
1. Get Anthropic API key from console.anthropic.com
1. Get Google Sheets API key from console.cloud.google.com
1. Hook up the frontend prototype (already built) to read from Sheets
1. Test with real shift screenshots
1. Demo to supervisor
1. Ask: “Is our TrackTik API access enabled?” — this unlocks Phase 2

-----

*Built by DJ (Divjit Singh) | Stack: React, Node.js, Claude API, TrackTik API, Twilio, Google Sheets API*