# Class Scheduler — Bi-fold Brochure Brief

**What this document is:** everything needed to design a bi-fold marketing brochure for
Class Scheduler. It covers what the product is, who it is for, every feature, the
exact brand colours and fonts, the logo, a panel-by-panel layout, and ready-to-use copy.
Hand this whole file to a designer (or to Claude) with the instruction:
*"Design a print-ready A4 bi-fold brochure from this brief."*

Everything described here exists in the product today. Section 11 lists what **not** to
claim.

---

## 1. The product in one breath

**Class Scheduler** is a web-based training timetable platform for colleges and training
institutes. It plans every batch, trainer and training hall in one place, prevents
double-bookings before they happen, handles holidays and substitute trainers, emails
trainers when their timetable changes, and shows the whole operation on a live analytics
dashboard. It works in any browser, on desktop, tablet and phone.

- **Category:** Academic / training timetable management (SaaS-style web application)
- **Built for:** Colleges, universities, Training & Placement cells, skill-development and
  corporate training teams that run many batches across many trainers and halls
- **Who uses it:**
  - **Administrators** run the whole system.
  - **Coordinators** build and maintain the timetable.
  - **Trainers** see their own schedule.
  - **Students and staff** view the public board. No login is needed for that.

### Tagline options (pick one for the cover)

1. **Every class. Every trainer. Every hall. One timetable.**
2. **Scheduling without the clashes.**
3. **The training timetable that runs itself.**
4. **Plan smarter. Teach on time.**

### Elevator pitch (≈50 words)

> Class Scheduler replaces spreadsheets and WhatsApp messages with one live timetable.
> Coordinators build batches in minutes, the system refuses double-bookings, holidays and
> substitutions apply everywhere automatically, and trainers get an email the moment their
> week changes. Leaders see workload and hall utilisation at a glance on a live dashboard.

---

## 2. Key value propositions (the five big messages)

| # | Headline | Supporting line |
|---|---|---|
| 1 | **No more double-bookings** | A trainer or hall can never be put in two classes at once. The system checks every save, including two people saving at the same moment. |
| 2 | **One source of truth** | Enter each batch's sessions once. Trainer timetables, hall occupancy, the calendar and every report are calculated from it, so they can never disagree. |
| 3 | **Real life, handled** | Holidays, a cancelled class, a substitute trainer for one day: record it once and every view, report and dashboard reflects it. |
| 4 | **Everyone informed** | "Save & notify trainers" emails each affected trainer a personal summary of what changed plus their updated weekly timetable. |
| 5 | **Decisions from data** | A live analytics dashboard shows teaching load, hall utilisation, busy periods, trends and what needs attention. |

---

## 3. Complete feature catalogue

Group these on the inside spread. Each line is: **feature name**, then the benefit in plain
words.

### A. Public Schedule Board (no login needed)

- **Five connected views of one timetable**
  - **Overall Schedule:** every batch grouped by year, with a day highlight filter.
  - **Day-Wise Schedule:** a period-by-period timeline, or grouped by batch, with day metrics.
  - **Monthly Calendar:** a month grid and agenda list. It shows real dates, holidays, cancelled classes and substitutes.
  - **Trainer Schedule:** each trainer's week, showing main mentor, support mentor, free, lunch and assigned work.
  - **Venue Schedule:** each training hall's occupancy across the week.
- **Live "Now / Next":** highlights the period running right now and the next one, refreshing itself through the day.
- **"This week" notices:** a strip naming this week's holidays, cancellations and substitutions, so nobody turns up to a cancelled class.
- **Instant search and filters:** by day, batch, subject, trainer, hall, year group, and Teaching or Non-Teaching staff.
- **Schedule Assistant:** a built-in chat that answers plain-English questions such as "Who is free on Friday slot 2?", "Monday timetable" or "October schedule".
- **One-click PDF reports**, in five types: batch schedule, single trainer, all trainers (consolidated), a single day, and a whole month.
- **Light and dark themes**, with a smooth circular theme transition.
- **Works everywhere:** a fully responsive layout for phones, tablets and desktops, plus a clean printed version.
- **Shareable links** open straight to a view, for example the trainer schedule.

### B. Admin Console (sign-in)

- **Analytics Dashboard**, the home page for admins and coordinators. It shows:
  - headline KPIs (weekly class periods, batches, trainers, hall utilisation, staff utilisation, items needing attention, upcoming changes);
  - a 16-week trend line with holidays and cancellations applied;
  - pie charts of weekly periods by year group and of batch status;
  - stacked trainer workload bars and hall utilisation bars;
  - a day × period heatmap, periods per weekday and top subjects;
  - an "upcoming in the next 30 days" feed, recent activity, and a list of what needs attention.

  Every chart has hover details and a table view.
- **Workload & Utilisation:** every trainer's weekly periods (main, support, assigned work), utilisation meters, and every hall's booked share. It's sortable, searchable and exports to Excel.
- **Free Finder:** pick a date or a weekday plus periods to see every free trainer (least loaded first) and every free hall. It accounts for holidays, cancellations and substitutions.
- **Batches & Sessions:**
  - Build a batch's weekly sessions: day, periods, subject, hall, and main and support mentors.
  - Busy trainers and halls are flagged live while you edit.
  - Batches have tentative start and end dates.
  - Batches can be duplicated, reordered, searched and sorted.
  - Deep links open a batch straight from the dashboard.
- **Holidays & Exceptions:**
  - Holidays can be one day or a range.
  - One class can be cancelled on one date.
  - A substitute can cover one class on one date. Only trainers who are actually free are offered.
- **Save & Notify:** every timetable change can be saved quietly, or saved and emailed to each affected trainer with their full updated week. Each email and its result is logged.
- **Assign work from the timetable:** click any free period on a trainer's grid to record lunch or other duties (exam duty, curriculum design, meetings and so on).
- **Trainers:** Teaching / Non-Teaching tracks, contact details, active or hidden status, weekly load, and a PDF timetable per trainer.
- **Training Halls and Year Groups:** capacity and status; year groups can show "awaiting schedule".
- **Time Slots & Days:** reshape the teaching day (add, remove or rename periods and days). Every class moves with its period automatically, and removing a period that's in use is refused.
- **Import & Export (Excel and CSV):**
  - Export batches, the weekly timetable, holidays and exceptions, trainers and halls.
  - Import trainers, halls and full timetables from a spreadsheet, with templates.
  - Each import is checked row by row before anything is saved, then applied all-or-nothing.
- **My Schedule (trainer portal):** each trainer's weekly timetable, the next 30 days as they will really run (holidays, cancellations, covers), and the notices sent to them.
- **Users & Roles:** create accounts, assign roles, link trainers, deactivate, and reset passwords with one-time temporary passwords.
- **Change History (audit trail):** every create, edit, delete, import, sign-in and failed sign-in, with who did it, when, and the exact before → after values. It's filterable and exportable.

### C. Roles and permissions

| Role | What they can do |
|---|---|
| **Admin** | Everything: users and roles, change history, time slots, trainers, halls, year groups, all imports and exports |
| **Coordinator** | Build and run the timetable: batches, sessions, assigned work, holidays and exceptions, batch imports, notifications, dashboard, workload |
| **Trainer** | Read-only personal portal: My Schedule, Free Finder |
| **Public** | View the schedule board, calendar and PDFs, no login |

Every permission is enforced on the server, not just hidden in the interface.

### D. Built-in data integrity (why the timetable stays right)

- **Single source of truth:** only batch sessions are stored. Every trainer grid, hall grid, calendar and report is derived from them.
- **Double-booking prevention:** checked against batch date ranges, so back-to-back batches are allowed and overlapping ones are refused. A batch can't overlap itself.
- **Safe concurrent editing:** two coordinators saving at the same moment can't both book the same trainer.
- **Renames carry through everywhere:** renaming a trainer, hall or year group updates every session, exception and record.
- **All-or-nothing saves:** related changes are written in a single database transaction.
- **Classes always win:** assigned work can never hide a class, and booking a class over assigned work replaces it cleanly.
- **Date-aware:** finished and not-yet-started batches drop off this week's board automatically but stay on the calendar.

### E. Enterprise-grade security

- Role-based access control, enforced on every request
- Secure httpOnly session cookies; changing a password, role or access signs that person out on every device
- One-time temporary passwords that must be changed at first sign-in
- Brute-force protection on sign-in (rate limiting), without letting attackers lock real users out
- Protection against cross-site request forgery; strict CORS allow-list; standard security headers
- Personal contact details (emails, phones) never appear on the public board
- Spreadsheet exports guarded against formula injection; emails safely escaped
- Complete, tamper-evident change history of every action
- Dependencies audited with zero known vulnerabilities on the server

### F. Experience and performance

- Instant view switching, no artificial loading screens
- Light first load: heavy features (PDF, charts, admin) load only when needed
- Accessible: full keyboard navigation, visible focus, screen-reader labels, reduced-motion support
- Clear feedback: toast notifications, "Saving…" states, and confirmation dialogs that spell out exactly what will change
- Unsaved-changes protection on every form

### G. Technology (for IT buyers, one small box)

React web application · Node.js / Express API · MongoDB Atlas (cloud database) · deployable on
Vercel and Render (or any Node host) · SMTP email (works with Gmail / Google Workspace,
Microsoft 365 or any mail server) · Excel/CSV/PDF output.

---

## 4. Proof points and numbers (all true; use freely)

| Number | Meaning |
|---|---|
| **5** | connected schedule views (Overall, Day-Wise, Calendar, Trainer, Venue) |
| **3** | access roles (Admin, Coordinator, Trainer) plus a public board |
| **5** | one-click PDF report types |
| **2** | spreadsheet formats in and out (Excel `.xlsx`, CSV) |
| **0** | double-bookings: clashes are refused at save time |
| **100%** | of changes recorded in the audit trail |
| **30-day** | real-date look-ahead for every trainer |
| **16-week** | analytics trend (4 weeks back, 11 ahead, plus this week) |
| **2** | themes (light and dark), everywhere |

---

## 5. Bi-fold layout plan

**Format:** A4 landscape sheet (297 × 210 mm) folded once to A5 (148.5 × 210 mm).
Add **3 mm bleed** on all sides and keep text **5 mm inside** the trim.
Four panels:

```
 OUTSIDE (printed side 1)                 INSIDE (printed side 2)
┌────────────────┬────────────────┐      ┌────────────────┬────────────────┐
│  Panel 4       │  Panel 1       │      │  Panel 2       │  Panel 3       │
│  BACK COVER    │  FRONT COVER   │      │  INSIDE LEFT   │  INSIDE RIGHT  │
└────────────────┴────────────────┘      └────────────────┴────────────────┘
```

### Panel 1: Front cover

- **Background:** the signature dark band: a 135° gradient `#050505 → #0A0F1C → #0B2350`
  (black fading into deep cobalt), with a soft cobalt glow (`#0047AB` at ~60% opacity, radial)
  in the top-right corner and faint vertical cobalt pinstripes.
- Logo (Section 7) top-left, white wordmark.
- Small eyebrow line in JetBrains Mono, letter-spaced, `#4D8BEA`:
  **TRAINING TIMETABLE PLATFORM**
- Headline in Space Grotesk Bold, white, with one word in highlight blue `#4D8BEA`:
  **Every class. Every trainer. Every hall. *One timetable.***
- One line of body text in `#C9D3E3`:
  *Plan batches, prevent clashes, handle holidays and keep every trainer informed, all in one place.*
- Optional: a device mock-up (laptop with the Dashboard, phone with the Trainer Schedule).

### Panel 2: Inside left ("The problem → the fix" + core features)

- Headline: **Scheduling without the clashes**
- A short "Before / After" pair:
  - *Before:* spreadsheets, double-booked trainers, missed messages, last-minute surprises.
  - *After:* one live timetable, clashes refused automatically, everyone notified.
- Then the **five value propositions** from Section 2, each with a small cobalt line icon.
- A screenshot strip: the Trainer Schedule grid (cobalt "Main" cells, dashed "Free" cells,
  black "Lunch" row) is the most recognisable visual.

### Panel 3: Inside right (the console and analytics)

- Headline: **Run the whole operation from one console**
- A large Dashboard screenshot (KPIs, trend line, donut, heatmap).
- A 2-column feature grid (icon, title and one line each): Analytics Dashboard · Free Finder ·
  Holidays & Exceptions · Save & Notify · Import & Export · Change History · Roles & Permissions ·
  My Schedule for trainers.
- The **roles table** from Section 3C as three compact cards.

### Panel 4: Back cover

- **Security & trust** box (5–6 bullets from Section 3E) on a white card with a cobalt left border.
- **Proof numbers** row (Section 4): big Space Grotesk numerals in cobalt, small labels.
- **Technology** one-liner (Section 3G).
- Call to action: **Book a live demo**, with placeholders for website, email, phone and a QR
  code (to the demo or the public board).
- Small logo plus "Class Scheduler" at the bottom.

---

## 6. Brand colour system

The product uses a **three-colour identity: Cobalt `#0047AB`, Black and White.** Every
other colour is a tint or shade of those three. Use cobalt for emphasis and action, black for
strength and contrast, white for space.

> CMYK values below are straight conversions for guidance. **Ask the printer for a proof**
> and, for exact brand cobalt, match `#0047AB` to a Pantone swatch on press. Blues near
> Pantone 2945 C / 293 C are the usual candidates; confirm with a physical swatch book.

### 6.1 Core palette (light mode, the default for print)

| Name | Hex | RGB | CMYK (approx.) | Used for |
|---|---|---|---|---|
| **Cobalt** (primary) | `#0047AB` | 0, 71, 171 | 100, 58, 0, 33 | Brand colour, primary buttons, active tabs, "Main mentor" cells, logo tile |
| **Cobalt Deep** | `#00337D` | 0, 51, 125 | 100, 59, 0, 51 | Darker end of every cobalt gradient, strong text |
| **Cobalt Strong** | `#002A66` | 0, 42, 102 | 100, 59, 0, 60 | Text on pale-blue backgrounds, darkest chart series |
| **Sky Cobalt** | `#3D7DE3` | 61, 125, 227 | 73, 45, 0, 11 | Lighter accent, gradients, chart series |
| **Highlight Blue** | `#4D8BEA` | 77, 139, 234 | 67, 41, 0, 8 | Headline highlight word and eyebrow text on dark backgrounds |
| **Light Blue** | `#86B0EE` | 134, 176, 238 | 44, 26, 0, 7 | Lightest chart series |
| **Ice Blue** | `#DCE7F8` | 220, 231, 248 | 11, 7, 0, 3 | Soft fills, "Support mentor" cells, focus rings |
| **Mist** | `#EFF4FC` | 239, 244, 252 | 5, 3, 0, 1 | Faintest wash, hover rows, selected items |
| **Ink Black** | `#0A0A0A` | 10, 10, 10 | 0, 0, 0, 96 | Text, Non-Teaching tags, lunch and weekend cells |
| **Graphite** | `#2E333B` | 46, 51, 59 | 22, 14, 0, 77 | Secondary text |
| **Slate** | `#646B76` | 100, 107, 118 | 15, 9, 0, 54 | Muted labels, captions |
| **Silver** | `#A3ACB9` | 163, 172, 185 | 12, 7, 0, 27 | Fourth year-group colour, quiet accents |
| **Hairline** | `#E2E7EF` | 226, 231, 239 | 5, 3, 0, 6 | Borders, dividers |
| **Cloud** | `#F6F8FB` | 246, 248, 251 | 2, 1, 0, 2 | Page background |
| **White** | `#FFFFFF` | 255, 255, 255 | 0, 0, 0, 0 | Cards, panels, reversed text |

### 6.2 The signature dark band (hero, sidebar, login, cover)

| Stop | Hex | CMYK (approx.) |
|---|---|---|
| Start (0%) | `#050505` | 0, 0, 0, 98 |
| Middle (~55%) | `#0A0F1C` | 64, 46, 0, 89 |
| End (100%) | **Night Navy** `#0B2350` | 86, 56, 0, 69 |
| Body text on the band | `#C9D3E3` | 11, 7, 0, 11 |
| Wordmark second word on the band | **Pale Cobalt** `#A9C4EE` | 29, 18, 0, 7 |
| Glow | `#0047AB` at ~55–70% opacity, radial | — |

Direction: **135° (top-left → bottom-right)**.

### 6.3 Gradients

| Name | Definition | Used for |
|---|---|---|
| Primary button / active tab | `linear-gradient(135deg, #0047AB, #00337D)` | Buttons, selected tabs, KPI hero tile |
| Bright accent | `linear-gradient(135deg, #3D7DE3, #0047AB)` | Secondary active states |
| Deep accent | `linear-gradient(135deg, #00337D, #0A0A0A)` | Venue tab, deep emphasis |
| Hero / dark band | `linear-gradient(135deg, #050505, #0A0F1C 55%, #0B2350)` | Cover, headers |

### 6.4 Data-visualisation palette (charts)

The charts use one **ordered cobalt ramp**, validated for colour-blind safety and contrast in
both themes. The strongest colour marks the most important series.

| Slot | Light mode | Dark mode | Typical meaning |
|---|---|---|---|
| 1 (strongest) | `#002A66` | `#C9DCFF` | Main mentor periods / first category |
| 2 | `#0047AB` | `#82AAF0` | Periods held / second category |
| 3 | `#3D7DE3` | `#3D7DE3` | Support periods / third category |
| 4 (lightest) | `#86B0EE` | `#2554A8` | Assigned work / cancelled / fourth category |
| Gridlines | `#EDF1F6` | `#1C2028` | — |
| Axis lines | `#C3CAD6` | `#2F3540` | — |
| Heatmap | Cobalt blended into white, light → dark = quiet → busy | Cobalt on dark | — |

### 6.5 Meaning-specific colours in the timetable

| Element | Light | Dark |
|---|---|---|
| Main mentor class cell | Cobalt gradient `#0047AB → #00337D`, white text | `#2F6FD6 → #0047AB` |
| Support mentor cell | Ice Blue `#DCE7F8` with diagonal hatch, text `#002A66` | `#0E2147`, text `#A9C8FF` |
| Free period | White with dashed `#9DB8E3` border, cobalt text | `#0C0E12`, dashed `#2B4C86` |
| Lunch break | Ink Black `#0A0A0A`, text `#A9C4EE` | `#000000`, text `#8FB0E6` |
| Weekend / non-teaching day | `#0A0A0A`, label `#8FB0E6` | `#08101F`, label `#7FA3DE` |
| Year groups (Final / Third / Second / First) | `#0047AB` / `#0A0A0A` / `#5B8EDC` / `#A3ACB9` | `#3D7DE3` / `#F5F7FA` / `#7FA8EC` / `#5F6878` |
| Teaching tag | Mist `#EFF4FC` fill, cobalt text | — |
| Non-Teaching tag | Ink Black fill, white text (inverted in dark) | — |

### 6.6 Dark-mode palette (for screenshots or a dark brochure variant)

| Role | Hex |
|---|---|
| Page background | `#070708` |
| Card / panel | `#101216` |
| Border | `#22262E` |
| Primary text | `#F5F7FA` |
| Secondary text | `#C4CAD4` |
| Muted text | `#8B93A1` |
| Accent (lifted cobalt for readability on black) | `#3D7DE3` |
| Accent text | `#82AAF0` / `#A9C8FF` |

### 6.7 Colour usage rules

- **Cobalt is the hero:** one strong cobalt element per panel (headline word, button, chart).
- **Black for weight, white for air:** generous white space; black for headings and bold blocks.
- **No other hues.** No red, green, orange or purple anywhere. Status is shown with labels and
  icons, not new colours.
- Body text: Ink Black `#0A0A0A` or Graphite `#2E333B` on white. On the dark band, use white
  and `#C9D3E3`.
- Keep the hero band's gradient direction at 135° for consistency.

---

## 7. Logo and wordmark

**Construction:** a rounded-square **cobalt tile** with a **white calendar icon**, followed
by the name **Class Scheduler**.

- Tile: `#0047AB`, corner radius 25% of the tile size.
- Calendar icon: white outline (2 px at 32 px size), two binder rings, a header rule, and two
  date squares. The first is solid white and the second is white at 45% opacity, which reads as
  "this day booked, the next one free".
- Wordmark: **"Class"** in Space Grotesk **Bold** and **"Scheduler"** in Space Grotesk
  **Medium**, letter-spacing −2%.
  - On dark backgrounds: "Class" white `#FFFFFF`, "Scheduler" pale cobalt `#A9C4EE`.
  - On white backgrounds: "Class" Ink Black `#0A0A0A`, "Scheduler" Cobalt `#0047AB`.
- Gap between tile and text: 30% of the tile height. Text size: 60% of the tile height.
- Clear space: at least half the tile height on every side.
- Minimum size: tile 8 mm in print.

**Logo mark (SVG, scalable, exactly as used in the app):**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="8" fill="#0047AB"/>
  <rect x="7" y="9" width="18" height="16" rx="2.6" fill="none" stroke="#fff" stroke-width="2"/>
  <path d="M7 13.6h18" stroke="#fff" stroke-width="2"/>
  <path d="M12 6.6v4.4M20 6.6v4.4" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
  <rect x="11" y="16.6" width="4" height="4" rx="1" fill="#fff"/>
  <rect x="17" y="16.6" width="4" height="4" rx="1" fill="#fff" opacity=".45"/>
</svg>
```

Files in this repository: `frontend/public/favicon.svg` (mark), `favicon-32.png`,
`apple-touch-icon.png` (180 px). For print, use the SVG above. It is vector and scales cleanly.

---

## 8. Typography

All three are free Google Fonts.

| Use | Font | Weights | Notes |
|---|---|---|---|
| Headlines, numbers, wordmark | **Space Grotesk** | 500, 600, 700 | Tight letter-spacing (−1% to −2%) on large sizes |
| Body text, UI | **Inter** | 400, 500, 600, 700 | Comfortable 1.5 line height |
| Eyebrows, labels, times, codes | **JetBrains Mono** | 500, 600 | UPPERCASE, letter-spaced (+12% to +20%) |

Suggested print sizes (A5 panel): cover headline 30–36 pt · panel headline 18–22 pt ·
feature title 10–11 pt bold · body 8.5–9.5 pt · eyebrow / labels 7–8 pt mono uppercase ·
proof numerals 24–30 pt.

---

## 9. Visual style

- **Shapes:** generous rounded corners (cards 18 px radius, large panels 26 px, pills fully round).
- **Shadows:** soft and low, with a faint cobalt tint (`0 18px 40px -22px` cobalt at 32%).
- **Icons:** simple 2 px line icons in cobalt or white, rounded caps: calendar, person, building,
  clock, search, chart, mail, shield, lock, download.
- **Patterns:**
  - Faint vertical cobalt pinstripes on the dark band.
  - Diagonal hatching (45°) marks "support" and lunch in the timetable. It's a nice subtle
    texture accent for the brochure.
- **Tone of voice:** confident, plain English, benefit-first, no jargon. Short sentences.
  "Clashes refused before they happen," not "Implements a constraint-validation layer."

### Screens to capture for the brochure

Capture from the live app at 1440 px wide, light theme, with representative (or anonymised)
data:

1. **Admin Dashboard**: the hero image for the inside right panel.
2. **Trainer Schedule** grid with the "Now" highlight: the most recognisable timetable visual.
3. **Monthly Calendar** showing a holiday and a substitute.
4. **Free Finder** with results.
5. **Batch editor** showing the "busy" flags and the *Save & notify trainers* button.
6. **Phone view** of the Trainer Schedule, for a device mock-up.
7. Optional **dark-mode Dashboard**, for a "works in light and dark" callout.

> Real trainer names appear in the live data. For a public brochure, consider renaming them
> in a demo copy of the database, or blurring names, before taking screenshots.

---

## 10. Copy bank (ready to paste)

**Cover headline:** Every class. Every trainer. Every hall. One timetable.

**Cover sub-line:** Plan batches, prevent clashes, handle holidays and keep every trainer
informed, all in one place.

**Section headlines:**

- Scheduling without the clashes
- Real life, handled
- Everyone on the same page
- Run the whole operation from one console
- Built for trust

**Feature blurbs (≤ 20 words each):**

- **No double-bookings:** A trainer or hall can never be in two classes at once. Clashes are refused the moment you save.
- **Holidays & substitutes:** Mark a holiday, cancel a class or assign a cover. Every view updates instantly.
- **Save & notify:** One click emails every affected trainer exactly what changed, plus their updated week.
- **Live dashboard:** Workload, hall utilisation, busy periods and trends at a glance, always current.
- **Free Finder:** Need a free trainer or hall at 2:30 on Friday? Find one in seconds.
- **Excel in, Excel out:** Import a whole timetable from a spreadsheet, checked row by row. Export anything, anytime.
- **Trainer portal:** Each trainer sees their own week and the next 30 days, including covers and cancellations.
- **Complete audit trail:** Every change, who made it and when, with before-and-after values.
- **Right access for every role:** Admins, coordinators and trainers each see exactly what they need.
- **Anywhere, any device:** Desktop, tablet or phone, in light or dark mode, no installation.

**Call to action:** **See it live: book a 20-minute demo.**
Website: `__________` · Email: `__________` · Phone: `__________`

---

## 11. Accuracy notes (please do not claim these)

- It is a **web application** that works in any browser on any device. It is **not** a
  native app on the App Store or Play Store.
- The **Schedule Assistant** answers questions using the live timetable data. Describe it as a
  "built-in Schedule Assistant", **not** as generative AI.
- **Email notifications** need the institution's mail server (SMTP) to be configured once.
  Gmail, Google Workspace and Microsoft 365 all work.
- There is **no** student login, attendance tracking, fee management or LMS integration.
  Don't imply them.
- "Zero known vulnerabilities" refers to the server dependencies at the time of writing. Say
  "regularly security-audited" if the brochure will be in circulation for a long time.
