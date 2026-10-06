# Tender Package Builder

**Turn a pile of tender PDFs into one checked, correctly ordered package, ready to submit. In the browser, in Bangla or English, with no server.**

Built for the AI DevFest *Vibe Coding* contest (problem: *Tender Document Package Builder*).

| | |
| --- | --- |
| **Live site** | https://md-irfanur-islam-rahat.vercel.app |
| **Source code** | https://github.com/irfan0072/MD-Irfanur-Islam-Rahat |
| **Final package from the sample pack** | [`output/T-2026-0417_Package.pdf`](output/T-2026-0417_Package.pdf) |

![Landing screen with the file drop area](screenshots/01-landing.png)

*The start screen: drop everything at once, or press "Try with sample files".*

---

## What problem does it solve?

When a company bids for a tender, it must hand in a fixed set of documents (trade license, TIN and VAT certificates, bank solvency letter, experience certificates, proposals, and so on). Some are mandatory, some optional, some must still be valid on the submission date, and they must appear in the order the tender states. In many offices this is done by hand, and one missing, expired, duplicated or misplaced paper can get the bid rejected.

This app does that checking for office staff:

1. The user opens the tender's `requirements.json` and adds the PDF files.
2. The user matches each file to a required document. The app suggests matches, and one file can serve only one document.
3. The app shows exactly one status for every required document (Missing, Expiry date needed, Expired, Not provided, OK) and updates it after every change.
4. When nothing blocks, one button builds a single PDF: an English cover page, the documents in tender order, and a `<tender_id> | Page X of Y` footer on every page.

Everything runs in the browser. PDFs are never uploaded anywhere by the app (the only exception is the optional AI help, which the user must start on purpose; see [AI help and privacy](#ai-help-and-privacy)).

---

## Website preview

All images below were captured from the built app (`npm run build` and `npm run preview`) using only the fictional sample pack, by [`scripts/readme-shots.mjs`](scripts/readme-shots.mjs).

### Document statuses with problems

Four different statuses at once: **Expired** (old trade license, date before the deadline), **Missing** (TIN certificate has no file), **OK**, and **Expiry date needed** (bank letter has no date yet). The bottom bar says "7 problems to fix" and **Make package** is disabled.

![Required documents showing Expired, Missing, OK and Expiry date needed, with the Make package button disabled](screenshots/02-statuses-blocked.png)

### Resolved checklist

After the renewed license is used, dates are entered and the scanned declaration is matched, every required document is **OK**, the two optional documents are **Not provided**, and **Make package** is enabled. The image shows documents 4 to 10 and the file list beside them.

![Documents 4 to 10 with required documents OK and two optional documents Not provided, ready to make the package](screenshots/03-checklist-resolved.png)

### Bangla interface

The whole app switches to Bangla, including statuses, dates, digits and the summary line.

![The same checklist in Bangla](screenshots/04-bangla.png)

### Phone layout

Same blocked state as above on a 390 px wide screen. On phones and tablets the file list folds away and a "Go to required documents" button jumps to the statuses.

<img src="screenshots/05-mobile.png" alt="Mobile layout showing Expired and Missing statuses and a disabled Make package button" width="320">

### Package ready

![Dialog saying the package T-2026-0417_Package.pdf with 17 pages is ready to download](screenshots/06-package-ready.png)

*Shown after pressing "Make package" on the resolved sample pack.*

---

## Quick start

Needs Node.js and npm. The project was built and tested with Node 20.

```bash
git clone https://github.com/irfan0072/MD-Irfanur-Islam-Rahat.git
cd MD-Irfanur-Islam-Rahat
npm install
npm run build      # type-check, then production build into dist/
npm run preview    # serves the build at http://localhost:4173
```

Open http://localhost:4173 in Chrome and press **Try with sample files**. That loads the fictional sample pack that ships in [`public/sample/`](public/sample/).

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite development server (prints its address; Vite's default is port 5173) |
| `npm run build` | `tsc --noEmit`, then `vite build` into `dist/` |
| `npm run preview` | Serves `dist/` on port 4173 |
| `npm run e2e` | Browser test against the preview server (see [Validation](#validation-and-limitations)) |
| `node scripts/readme-shots.mjs` | Re-captures the README screenshots (preview server must be running) |

`dist/` is a plain static site with relative paths, so it also works on any static host.

---

## How to use it

1. **Open the tender list and the files.** Drop `requirements.json` and the PDFs together (or a whole folder, or a ZIP file) on the page, or use **Choose files** / **Choose folder**. The tender card (ID, title, entity, bidder, deadline) and the document list appear.
2. **Check the files.** Each file card shows its name, page count and size. Anything that is not a valid PDF is refused with a message. Exact copies are marked **Copy**.
3. **Match files to documents.** Press **Match automatically** for suggestions, or use **Choose file** on a document, the drop-down on a file card, or drag a file onto a document. **Change** or the cross removes a match, and **Undo** in the header steps back.
4. **Enter expiry dates.** Documents with an expiry show a date field once a file is matched. If the PDF text says "valid until ...", a button offers that date.
5. **Resolve blockers.** The bottom bar counts problems; tap it for the list and press **Fix** to jump to a document.
6. **Make the package.** When nothing blocks, press **Make package**, then **Download**. The file is named `<tender_id>_Package.pdf`.

The **English / বাংলা** switch in the header changes the whole app at any time.

---

## Main requirements (problem statement section 4)

| Task | How it is implemented |
| --- | --- |
| **4.1** Load the list | `requirements.json` is read in the browser; tender details are shown and documents are sorted by `order` (whatever order the file lists them in). A list with a missing tender ID or a deadline that is not a real calendar date (for example `2026-02-31`) is refused with a message and the open project is left unchanged. |
| **4.2** Upload files | Many files at once; name, page count and size on each card; a remove button on each. A file is accepted only if it has a PDF header, whatever its name says; other files get a clear message. Locked and damaged PDFs get their own messages. |
| **4.3** Match files | One file per document and one document per file. Choosing a file that is already used elsewhere moves it. Matches can be changed, removed and undone (**Undo** steps back through recent changes). |
| **4.4** Expiry dates | A date field appears on every matched document with `has_expiry = true`. |
| **4.5** Check everything | One status per document, recalculated after every change. |
| **4.6** Duplicates | Files are compared by the SHA-256 hash of their bytes, so renamed copies are found. Copies are marked, and a copy cannot be matched to a second document (its option is disabled, with an explanation). |
| **4.7** Make the package | **Make package** is disabled while any document blocks. The reason is shown as a list with a **Fix** button for each item. |
| **4.8** Download | `<tender_id>_Package.pdf`. Characters that are not safe in file names are replaced by `-` (for example `DPHE/2026/W-88` becomes `DPHE-2026-W-88_Package.pdf`). |
| **4.9** Two languages | Whole interface in Bangla or English; document names come from `title_bn` or `title_en`. Tender title, entity and bidder are shown as written in the JSON. |

---

## Status rules (section 5)

Every required document shows exactly one status.

| Status | When | Blocks the package? |
| --- | --- | --- |
| **Missing** | Mandatory document, no file matched | Yes |
| **Expiry date needed** | `has_expiry` is true, a file is matched, no date entered | Yes |
| **Expired** | Expiry date is before the submission deadline | Yes |
| **Not provided** | Optional document, no file matched | No |
| **OK** | File matched and, if `has_expiry`, the date is on or after the deadline | No |

- **Expiry on the same day as the deadline is OK.** One day earlier is Expired.
- An optional document that has a file matched but no date, and `has_expiry` true, shows **Expiry date needed** and blocks, because it is no longer unmatched.
- The expiry date belongs to the file, so it follows the file if the match changes.

---

## The generated PDF (section 6)

| Rule | What the app does |
| --- | --- |
| **Cover page (6.1)** | Page 1, in English: tender ID, title, procuring entity, bidder, submission deadline, the date the package was made, and the list of included documents in order with their page counts. Text the built-in PDF font cannot write (for example a Bangla tender title) is drawn by the browser as a picture, so it still displays correctly. |
| **Order and pages (6.2)** | Documents follow the cover sorted by `order`, with every page of every file in its original order. Optional documents without a file are skipped. |
| **Footer (6.3)** | Every page, cover included, ends with `<tender_id> \| Page X of Y`, where Y is the total page count of the package. |
| **Footer never covers content (6.4)** | Each document page is made slightly taller: a white strip is added at its visible bottom edge and the footer is written in that strip. The original page is not scaled, moved or drawn over, so full-page scans and landscape or rotated pages are handled as well. |

### Optional index page

The *Add an index page* switch under **More options** puts one extra page after the cover. It lists each document in English and Bangla, with the page it starts on and its page range. **It is on by default**, and then the package is cover, index, documents, and the footer counts the index page in `Y`. Switch it off for a strict "cover, then documents" package.

---

## Traps in the sample pack and how the app handles them

| Trap | What happens |
| --- | --- |
| `company_logo.png` is not a PDF | Refused with "This is not a PDF file", and offered as a seal image instead. |
| `experience_cert.pdf` and `experience_cert (1).pdf` have identical content | Both marked **Copy**. Only one can be used, and the other cannot be matched to another document. |
| `trade_license_2025.pdf` expired on 2025-06-30; `trade_license_2026.pdf` is valid to 2027-06-30 | The old one shows **Expired** and blocks. Automatic matching prefers the renewed one. |
| `scan_0042.pdf` is an image-only scan with a meaningless name (it is the signed declaration) | Not guessed. The user opens the preview and matches it to *Signed Declaration* by hand. |
| Number prefixes `01_financial...` and `02_technical...` do not follow the tender order | Order always comes from `requirements.json`, never from file names. |
| No file for *Audited Financial Statement* and *Manufacturer's Authorization* | **Not provided**. Skipped in the package. |

The app logic does not depend on these file names or this tender (only the "Try with sample files" button knows them), because the app must also work on a pack it has not seen.

---

## Bonus features

| Feature | Implemented as | Checked |
| --- | --- | --- |
| **Index page** | Optional page after the cover (see above) | Browser test; an independent QA pass saw the 16-page result with it off |
| **Bangla on the index** | Bangla document names are drawn by the browser so conjuncts and vowel signs are correct | Rendered and viewed (index page) |
| **Seal or signature** | Upload a PNG or JPEG; place it on the cover, the last page of each document, every page, or custom pages (`1, 3-5`); six positions; adjustable size | Package builds with a seal and is larger; placement viewed on the cover only |
| **Checklist export** | CSV (opens in Excel, Bangla safe): No., document, required, file name, pages, expiry date, status. Named `<tender_id>_Checklist.csv`. | Download completed and contents checked in the browser test |
| **Save and reopen** | Work (files, matches, dates, index and seal settings) is kept in the browser's IndexedDB and restored on the next visit. **Start over** erases it. There is no project-file export. | Reload with saved work checked in the browser test |
| **Auto-match** | Scores file names and the first-page text against the document titles, prefers still-valid documents, keeps one file per document and skips exact copies | Browser test on the sample pack and an ad-hoc second pack |
| **Bad files** | Locked, damaged, empty and non-PDF files each get a message; the app keeps working | Ad-hoc test pack and the QA pass |
| **AI help** | Optional, see below | **Not tested with a real key** |

Also included: a themed start screen while saved work is restored, Undo, drag and drop between the file list and documents, ZIP and folder import, and keyboard-friendly dialogs.

---

## AI help and privacy

**What is implemented.** One optional provider: **Anthropic Claude**, model `claude-opus-5-5`, at low effort, returning JSON that matches a fixed schema. **Gemini, GPT-4o and a model picker are not implemented.**

**How it works.** In **More options → AI help**, the user pastes their own Anthropic API key and presses **Ask AI**. Nothing is sent before that: the button stays disabled until a key is typed, and no request is made on load, on typing, or on language or file changes. The AI is asked which required document each file is and whether it states an expiry date. Its answer only fills documents that have no match yet and dates that have not been typed. Duplicate prevention and the one-file-per-document rule still apply, the result can be undone, and automatic dates are marked "Read from the file. Please check it."

**What is sent, and where.** The browser sends the request directly to Anthropic (no server of this project is involved). It contains:

- the tender title, ID and deadline, and each required document's ID, English and Bangla title and whether it has an expiry;
- for each file: its name, page count and the text of its first (up to three) pages, capped at 6,000 characters;
- for a file with no readable text (a scan), a JPEG of its first page.

Other pages and the rest of the file content are not sent. Using it may cost money on the user's Anthropic account.

**The key.** It is kept in the browser tab's `sessionStorage` only: not in the saved project, not in IndexedDB, not in any export. It disappears when the tab is closed. It is never bundled in the app.

**Fallback behaviour.** The request asks Anthropic to retry on its own recommended fallback model if a safety check declines it, so a different Claude model than `claude-opus-5-5` may answer in that case. If the API answers 400 to that option, the same request is retried once without it, on the same model. No other provider is ever contacted.

**Local versus external.** Reading PDFs, page counts, previews, duplicate detection, automatic matching, date hints, validation and building the PDF all happen in the browser and work without any key. During a normal session without AI, the browser's requests go only to the site's own origin, plus inline `data:` URLs (checked on one full run of the sample pack, switching to Bangla, through to the finished package).

**Browser storage.** Saved work includes the PDF bytes, kept in IndexedDB on that device until **Start over** is pressed. On a shared computer, press **Start over** when finished.

---

## Limits and compatibility

- **Up to 30 PDF files and 50 MB in total** (the tender list does not count). Extra files are refused with a message (`MAX_FILES` and `MAX_BYTES` in [`src/store.ts`](src/store.ts)).
- **Google Chrome** is the target browser. The app was exercised in a headless Chromium build, **Chrome for Testing 153.0.8010.12**, through `puppeteer-core`. The Google Chrome application itself was not installed on the development machine, so **retail Google Chrome was not used for verification**, and other browsers were not tested.
- Duplicate detection uses `crypto.subtle` (SHA-256), which browsers allow on HTTPS and `localhost`. On a plain `http://` address it falls back to a weaker fingerprint.
- The PDF cover is English only, as the problem statement requires. The interface text in Bangla was written with an AI assistant and has not been reviewed by a native speaker.

---

## Validation and limitations

### Checks that were run

- **Browser test, `npm run e2e`.** 82 checks, all passing on the last run, in Chrome for Testing 153. It loads the sample pack in a real browser and checks: document order, page counts, non-PDF refusal, duplicates, every status rule (including expiry one day before, on, and after the deadline), copy blocking, removing a match, keyboard use of the file picker and preview dialogs (focus stays inside, Escape, focus returns), refusal of bad deadlines and missing tender IDs, Bangla titles and names, the start screen (including reduced motion and a failed start), PDF and CSV downloads (exact names, same bytes), reload with saved work, and layouts at 768, 390 and 320 px without sideways scrolling. It also reads the generated package back page by page: 17 pages, cover fields, optional documents absent, order of documents, `T-2026-0417 | Page X of 17` on all 17 pages, and the index page.
- **Viewed by eye:** cover, index and last (scanned) page of the package; the six screenshots above.
- **Independent QA pass** (a separate tool, on an earlier build) covering the sample workflow, ZIP import with a 30-file cap, a 51 MB file refusal, damaged and locked PDFs and restore after reload. Its seven findings (dialog focus, unnamed buttons, success dialog close button, phone navigation, impossible dates, summary wording, hint spacing) were fixed and are now covered by the browser test. That pass was not repeated on the latest build.
- **Ad-hoc second pack** (not committed): unsorted `order` values, rotated and cropped pages, a very large page, a locked PDF, a damaged PDF, a text file named `.pdf`, an upper-case `.PDF` name and a Bangla tender title. Statuses and the built package were checked; footers were viewed on rotated and cropped pages.

Run the browser test yourself:

```bash
npm run build
npm run preview        # leave running in one terminal
npm run e2e            # in another terminal
```

`npm run e2e` reads the contest sample pack from `docs/sample-pack/` (that folder is not committed; copy the pack there), looks for Chrome in the usual macOS places (set `CHROME=/path/to/chrome` elsewhere), and **rewrites** `output/T-2026-0417_Package.pdf` and `screenshots/qa/`.

### Material gaps

- Not verified in retail Google Chrome (see above).
- **AI help was never run against a real API key**, so its success and error paths are untested.
- Not automated: dragging files from the operating system, the system folder chooser, and folder recursion.
- Seal placement was viewed only on the cover; the page-range option and other positions were not inspected.
- Not tested: the exact 50 MB boundary, browser storage quota errors, and a full colour-contrast accessibility audit.
- There are no unit tests, only the browser test above.
- The official contest rulebook was not available while building, so compliance with rules that appear only there is unchecked.
- Undo restores matches and dates but does not bring back a file that was removed.

---

## Submission artifacts

| Artifact | Status |
| --- | --- |
| Public GitHub repository | https://github.com/irfan0072/MD-Irfanur-Islam-Rahat (public when checked) |
| Public HTTPS deployment | https://md-irfanur-islam-rahat.vercel.app (reachable, HTTP 200, when checked; it shows what was last pushed) |
| `output/<tender_id>_Package.pdf` | [`output/T-2026-0417_Package.pdf`](output/T-2026-0417_Package.pdf): made by the app from the sample pack after resolving its problems. 17 pages: cover, index, 15 document pages. |
| `screenshots/` with a statuses screenshot | [`02-statuses-blocked.png`](screenshots/02-statuses-blocked.png) and [`03-checklist-resolved.png`](screenshots/03-checklist-resolved.png) show document statuses; the other README images are in the same folder. [`screenshots/qa/`](screenshots/qa/) holds the screenshots written by the browser test. |
| GitHub Pages workflow | [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) is included, but GitHub Pages is not enabled for the repository, so its runs show as failed. The live site is the Vercel one. |

---

## Technology

| Part | Choice |
| --- | --- |
| UI | [Preact](https://preactjs.com) 10, TypeScript 5 |
| Build | [Vite](https://vite.dev) 6 |
| Styling | [Tailwind CSS](https://tailwindcss.com) 4; Bangla font [Hind Siliguri](https://fontsource.org/fonts/hind-siliguri) via `@fontsource` |
| Build the PDF | [pdf-lib](https://pdf-lib.js.org) 1.17 |
| Page counts, previews, text | [pdf.js](https://mozilla.github.io/pdf.js/) (`pdfjs-dist` 4) |
| ZIP import | [fflate](https://github.com/101arrowz/fflate) |
| Optional AI | [`@anthropic-ai/sdk`](https://github.com/anthropics/anthropic-sdk-typescript), loaded only when **Ask AI** is pressed |
| Browser test | `puppeteer-core` (development only) |

**Speed.** On first load the browser downloads about **36 kB of JavaScript and 10 kB of CSS (gzip)**, measured from `dist/`. The PDF libraries are loaded on demand: pdf-lib when the first PDF is added, pdf.js in the background after files are listed. A small inline start screen shows immediately while saved work is restored.

### Project structure

```
index.html               start screen (inline HTML and CSS) and page shell
src/
  app.tsx                main screens: header, landing, requirement and file cards, bottom bar
  panels.tsx             dialogs (picker, preview, package ready) and "More options"
  store.ts               state, status rules, duplicates, intake, persistence, CSV, AI call site
  i18n.ts                Bangla and English texts, number and date formatting
  lib/build.ts           package builder (cover, index, footer strip, seal)
  lib/match.ts           auto-match and expiry-date hints
  lib/pdf.ts             PDF checks, page counts, SHA-256
  lib/preview.ts         thumbnails, previews, text extraction (pdf.js)
  lib/textimg.ts         browser-drawn text for Bangla in the PDF
  lib/ai.ts              optional Anthropic request
public/sample/           fictional sample pack used by "Try with sample files"
scripts/                 e2e.mjs (browser test), readme-shots.mjs, render.mjs (PDF pages to images)
output/                  T-2026-0417_Package.pdf
screenshots/             README images; qa/ holds browser test screenshots
.github/workflows/       GitHub Pages workflow (Pages is not enabled)
```

---

## Author
# MD-Irfanur-Islam-Rahat
**Name:** MD Irfanur Islam Rahat  
**GitHub:** [irfan0072](https://github.com/irfan0072)  
**Registration No.:** 251-15-857
