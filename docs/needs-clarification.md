# Needs clarification

Open questions from the latest FE work (S8-16, S8-38, S8-41, V1, V2, V3). Each says who is asked and what is blocked until it is answered. The earlier PM questions (Sprint 8 tickets up to S8-37 and the BE gaps) are in `questions-for-pm.md`; what was left undone is in `not-done-yet.md`.

## For the PM

| # | Ticket | Question | Blocked until answered | Current behaviour |
|---|---|---|---|---|
| 1 | S8-16 (D8-12) | Which contact route is approved for the public footer (email, phone, form)? | Contact link in the footer (AC4) | No contact link; nothing made up |
| 2 | S8-16 (D8-12) | Who is the approved rights holder for the "© year" line? | Final copyright line | Uses the campus name, "PUP Quezon City" |
| 3 | S8-16 (D8-12) | Will Privacy and Accessibility pages exist? If yes, who writes them? | Those two footer links | No links, since no page exists |
| 4 | S8-16 | The ticket says "track a transaction", but there is no public page for it. Is the complaint status page enough, or is a public transaction tracking page wanted? | Footer link list | Links to "Check a complaint" |
| 5 | V3 #2 | Staff creation password with Clerk sign-in on: is "Initial password (optional)" the decided behaviour (Clerk review §4.3)? | Closing #2 as "changed by decision" | Password is optional |
| 6 | V3 #10 | Is "This was already done." the approved wording for a late entry, replacing "backdated"? | Closing #10 | New wording is live |
| 7 | V3 #8 | Edit is inside the row menu ("Actions for ..."). Keep it, or add a visible Edit button? | Closing #8 | Row menu only |
| 8 | S8-36 (D8-20) | Menu order per role (already in `questions-for-pm.md`): confirm the rule "the page you land on is first". | Menu order | Landing page first |
| 9 | S8-41 | Who runs the real walkthrough with an Office Staff, an Office Head, a Super Admin and a citizen, and when? | AC1 with real people (no SUS without them) | Only a scripted walkthrough exists |

## For QA

| # | Ticket | Ask | Why |
|---|---|---|---|
| 1 | V3 | Send the DEFECTS rows for **#6, #7 and #9**. | The ticket does not name them and the sheet is not in the repo, so they were not retested |
| 2 | V1 (DEF-14) | Run M6-10: send a complaint email with a named sender to a test mailbox. | Needs SMTP and a mailbox that are not on the FE machine |
| 3 | V1, V2 | Repeat DEF-16, 17, 18, 19, 20 on the QA stack (S8-18) with real Office Head and Executive accounts. | They were checked on a local stack with mocked roles |
| 4 | V2 | Apply the DEF-19 migration on the QA / target Identity database first (S8-19). | The older Identity DB here (port 5433) still has `employee_no` NOT NULL |
| 5 | V2 | Do the real saves: two blank employee numbers, a real duplicate, and turning "applies to" off after removing its entries. | Writes were not sent to the real system |
| 6 | V3 #3, #12 | Use a real inactive office and save a service with documents. | There is no inactive record in the real data, and those saves write records |
| 7 | S8-41 | Give a test office for Start, Hold/Resume and Complete end to end. | Those steps write records |

## For the BE team (read only for FE; asked, not changed)

| # | Ask | Why |
|---|---|---|
| 1 | Operations `receipt.test.js` did not finish in 3 minutes on this machine. Does it pass on yours? | DEF-14 evidence |
| 2 | Confirm the Identity mailer sends the bare address for password reset (BE Dev 2, handover §2.2). Read from the code only. | DEF-14 |
| 3 | Fix or explain the orphan office id `2b696c02-5adc-43d5-8977-a2818ed94552` (1 transaction not in the catalogue). | The new Office Performance view shows "Unknown office" |
| 4 | Confirm Core ignores removed calendar entries when turning "applies to" off (fix 08aa866, read only). | DEF-20 needs a real run |

## For accessibility and design

| # | Ask | Why |
|---|---|---|
| 1 | A person with a screen reader checks the account menu in the header. | axe still reports "label in name" at 640 px and wider, even when the name equals the visible text |
| 2 | Check the print slip, the queue countdown message, and the Office Head and Staff pages with real accounts. | Not covered by the S8-38 audit |

## Added for S8-17 and S8-22

| For | Ask | Why |
|---|---|---|
| BE team / PM | Give an Office Head a way to read the names of their own office's staff (a names list limited to the office, or a name inside the per-staff KPI rows). | Today every row of "By staff member" says "Staff member" (S8-17 #3). Only a Super Admin may read accounts. |
| PM (D8-11) | S8-22 (four chains on the hosted release): approve protected demo accounts and hosted actions, give the hosted URL, and say which SHA is deployed. | Not started by FE. There is no hosted address or approved demo account here, and the chains create records. Without approval the ticket says to mark "Blocked, no safe environment". |
| QA / BE | S8-22 (a): file the dated screenshot of the October report on the deployed site, with the deployed commit. | A developer reported it on 11/20, but no proof is filed yet. |
