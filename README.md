# Tender Package Builder

AI DevFest - Vibe Coding. A frontend-only web app that turns a set of PDF files into one complete, checked and correctly ordered tender package.

Everything runs in the browser. No file is uploaded to any server.

## How to use

1. Open the app and drop **everything at once**: `requirements.json`, the PDF files, a whole folder, or the ZIP file.
2. Press **Match automatically**, or pick a file for each document yourself (button, drop-down list, or drag and drop).
3. Type the expiry date where the app asks for one. If the date is written inside the PDF, the app offers it with one tap.
4. When nothing is blocking, press **Make package** and then **Download**. The file is named `<tender_id>_Package.pdf`.

The **English / বাংলা** switch at the top changes the whole app.

## Main tasks

| Task | Where |
| --- | --- |
| 4.1 Load the list | Tender card and the document list, sorted by `order` |
| 4.2 Upload files | Many files at once, name and page count on each card, non-PDF files rejected by content with a clear message, remove button |
| 4.3 Match files | One file per document and one document per file; change or remove at any time; **Undo** |
| 4.4 Expiry dates | Date field on every matched document with `has_expiry` |
| 4.5 Status | Exactly one of Missing / Expiry date needed / Expired / Not provided / OK, updated on every change |
| 4.6 Duplicates | SHA-256 of the file content; copies are marked and cannot go to two different documents |
| 4.7 Make the package | Button stays disabled while any document blocks, with the list of reasons and a **Fix** link for each |
| 4.8 Download | `<tender_id>_Package.pdf` |
| 4.9 Two languages | Whole app in Bangla or English, titles from `title_bn` / `title_en` |

A document that expires on the same day as the submission deadline is **OK**.

## Package rules

- Page 1 is an English cover page: tender ID, title, procuring entity, bidder, submission deadline, package date and the list of included documents in order.
- Documents follow in `order`, with all pages in their original order. Optional documents without a file are skipped.
- Every page has the footer `<tender_id> | Page X of Y`.
- The footer never covers document content: each document page gets a small extra strip at its bottom edge, and the footer is written there. The original page is not scaled, moved or drawn over. This also works for full-page scans and rotated pages.

## Bonus tasks

- **Index page** after the cover with the start page of every document (can be switched off).
- **Bangla text on the index page**, drawn by the browser so conjuncts and vowel signs are shaped correctly.
- **Seal or signature**: add a PNG, choose the pages (cover, last page of each document, every page, or a list such as `1, 3-5`), position and size.
- **Checklist export** as CSV that opens in Excel, Bangla included.
- **Save and reopen**: work is kept in the browser (IndexedDB) and restored on the next visit.
- **Auto-match** from file names and from the title found inside the PDF.
- **Bad files**: damaged and password-protected PDFs get a clear message instead of a crash.
- **AI help** with the user's own Anthropic API key (optional): Claude matches the files and reads scanned papers such as `scan_0042.pdf`. The request goes straight from the browser to Anthropic; the key is kept for the browser tab only. Nothing is sent unless the user types a key and presses **Ask AI**.

## Problems found in the sample pack

| Problem | What the app does |
| --- | --- |
| `company_logo.png` is not a PDF | Rejected with a message; offered as a seal instead |
| `experience_cert.pdf` and `experience_cert (1).pdf` have the same content | Both marked as copies; only one can be used |
| `trade_license_2025.pdf` expired on 2025-06-30 | Status **Expired**; `trade_license_2026.pdf` (valid until 2027-06-30) is used |
| `scan_0042.pdf` has no useful name and no text | Left for the user; the page preview shows it is the Signed Declaration |
| File name numbers (`01_financial...`, `02_technical...`) do not match the tender order | Order comes from `requirements.json`, never from file names |
| No file for the two optional documents | Status **Not provided**; skipped in the package |

The result is in [`output/T-2026-0417_Package.pdf`](output/T-2026-0417_Package.pdf). Screenshots are in [`screenshots/`](screenshots/).

## Tech

- [Vite](https://vite.dev) + [Preact](https://preactjs.com) + [Tailwind CSS](https://tailwindcss.com) - first load is about 33 kB of JavaScript (gzip)
- [pdf-lib](https://pdf-lib.js.org) builds the package, loaded only when a PDF is added
- [pdf.js](https://mozilla.github.io/pdf.js/) draws previews and reads date hints, loaded in the background
- No backend, no analytics, no external requests

## Run locally

```bash
npm install
npm run dev        # development
npm run build      # production build in dist/
npm run preview    # serve the build on http://localhost:4173
npm run e2e        # browser test against the preview server; rewrites output/ and screenshots/
```

## Deploy

`dist/` is a plain static site with relative paths, so it works on any static host. A GitHub Pages workflow is included in `.github/workflows/deploy.yml`: push to `main`, then set **Settings -> Pages -> Source** to **GitHub Actions**.


---

## Author
# MD-Irfanur-Islam-Rahat
**Name:** MD Irfanur Islam Rahat  
**GitHub:** [irfan0072](https://github.com/irfan0072)
