# UX glossary: one set of words for the same thing (DRAFT for decision D8-16)

Status: **DRAFT.** Nothing in this table has been applied to the screens yet, except where the last column says so. It waits for the
PM's approval under D8-16 (S8-35). The "today" column is a count of the wordings found in the frontend source, so the PM can see how
far apart the screens are.

## Terms

| Term (from S8-35) | Proposed wording | What the screens say today | Decision needed |
|---|---|---|---|
| Start transaction | **Start transaction** (button, page title, breadcrumb) | "Start transaction" 5x, "Add Transaction" 4x (the button and the breadcrumb), "Record a new" / "New transaction" 2x | Use "Start transaction" everywhere, including the "+ Add Transaction" button? |
| Put on hold | **Put on hold** (action), **On hold** (status) | Action: "Hold" 9x and "Put on hold" 5x. Status of a held transaction: "Pending" 20x | Show the status as "On hold" instead of "Pending"? ("Pending" is also used for sync and requests, which is confusing.) |
| Resume | **Resume** | "Resume" 31x, consistent | None |
| Complete | **Complete** | "Complete" 11x, consistent | None |
| Print acknowledgement | **Print acknowledgement** | "acknowledgement" 17x; "acknowledgment" 0x. The ticket writes "acknowledgment" | Which spelling? (Philippine English usually follows the British "acknowledgement".) |
| Tracking number | **Tracking number** | "Tracking number" 14x, "Tracking #" and "Tracking No" 2x | Use the full words everywhere |
| Email queued | **Email queued** (waiting to be sent; never shown as "sent") | No screen shows the email status of a transaction yet (the read-only status page is S8-31) | Wording for the status page when it is built |
| Email failed | **Email failed** (with the next step) | The complaint form says "We could not send the reference number by email, so please write it down" | Same wording on the status page |
| Access pending | **Access pending** | "No access yet" (the page title) and "Access pending" (the code name) | One of the two on the page and in the menu |
| System temporarily unavailable | **This service is temporarily unavailable. Please try again in a moment.** | "temporarily unavailable" 5x, but also "is not available right now" and "cannot be reached right now" 9x | One sentence, said the same way for every outage |
| Partner system (defect #13) | **Syllabus Management System (SCMS)** | Was "(SMS)" in 14 places | **Confirm the full name.** The abbreviation is now SCMS everywhere (one constant, `lib/constants/brand.js`); the full name was left as it was because the repository does not define what SCMS stands for |

## Rules for every message (applied in S8-35)

1. Say **what happened**, in plain words. No code, no ticket number, no technical term, no text copied from the server.
2. Say **whether anything was saved or changed** ("Nothing was changed." / "It is still on file.").
3. Give **one next step** ("Please try again in a moment.").
4. A success sentence is shown **only after the server answered**. A queued or unconfirmed action is never described as done.

## Already applied (they did not need a glossary decision)

- One helper, `plainFailure` (`lib/ui/save-feedback.js`), turns any failed request into a sentence with those three parts. It keeps a
  plain sentence from the server for a refused request (4xx), and replaces anything that looks like internals, a 5xx or a timeout.
- It now replaces 18 places that showed the server's own message directly (account, Clerk access, permission switches, forecast, dashboard details,
  late-risk, receipt, access pending, sign-in with Clerk).
- Tests keep it that way: no screen may put a raw server message on screen, no internal ticket code may appear in a sentence, and every
  success message must follow an awaited request.
- The partner system is called SCMS in every sentence (14 places).

## Not applied until D8-16 is approved

The renames in the table above (Add Transaction to Start transaction, Hold to Put on hold, Pending to On hold, "No access yet" to
"Access pending", the outage sentence) and the spelling of "acknowledgement".
