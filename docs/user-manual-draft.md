# CCCMS user manual (draft, front end)

**Status:** draft written by the FE developer on 2026-11-24, from the screens as they are on commit `01e63ae`. It covers what a person sees and does. It is not final: the PM and QA must read it against the released version, and the screens must be checked by a person who has not built them (see `walkthrough-log-S8-41.md`). Backend behaviour that was not seen on screen is not described.

CCCMS (Campus Citizen's Charter Management System) of PUP Quezon City tracks how long each service takes against the time the Citizen's Charter promises.

## Who sees what

| Role | Menu, first to last |
|---|---|
| Super Admin | Dashboard, Transactions, Queue, Reports, Complaints, Late-risk / Accounts, Offices, Registry, Roles and permissions, Logs, Settings / Services, Calendar |
| Office Head | Office Home, Dashboard, Transactions, Queue, Reports, Complaints, Late-risk / Services, Calendar, Settings |
| Office Staff | Office Home, Dashboard, Transactions, Queue, Late-risk / Services, Calendar, Settings (Reports and Complaints only while the Super Admin has switched them on) |
| Executive | Campus Home, Dashboard, Transactions, Reports, Complaints, Late-risk / Services, Calendar, Settings (read only) |

Sign out and "My account" are in the menu under your name at the top right.

## Citizens (no sign-in)
1. **Find a service:** open the home page, search by service or office name, or choose *Browse all services*. *View requirements* shows the requirements, steps and processing time.
2. **File a complaint:** *File a complaint*, fill in the form, send. Keep the reference number you are given.
3. **Check a complaint:** *Check a complaint*, enter the reference number (for example `CMP-20261124-ABC123`).
4. **Take a queue number:** *Take a queue number* and choose the office.

## Office Staff
- **Start a transaction:** *Transactions*, then *+ Add Transaction*. Choose the service, tick the documents the client brought, fill in the client, save. If the work was already done, tick *This was already done* and give the start and end time and the reason.
- **Hold and resume:** open the transaction (*View Details*), then *Hold* with a reason, and *Resume* later.
- **Complete:** open the transaction and choose *Complete*. A cancelled transaction cannot take a receipt.
- **Queue:** *Queue*, choose your office, *Call Next Ticket*.
- **Late-risk:** *Late-risk* lists open transactions ranked by how likely they are to miss the deadline. *Review* opens the record.
- **Office Home:** your own figures for the period.

## Office Head
Everything Office Staff do, plus:
- **Office Home** shows the office tiles (received, completed, on-time rate, pending) and *By staff member*. Staff names are not shown to Office Heads yet, so the rows say "Staff member".
- **Dashboard:** trend, forecast, late-risk and the *Service Charter Compliance* tab (office performance by service).
- **Reports** and **Complaints** for the office.
- **Settings:** working hours, holidays, transaction settings are visible but only a Super Admin can change them.

## Super Admin
- **Accounts:** *+ Add Account*. The employee number is optional. Edit, reset password and deactivate are in the row menu ("Actions for ..." at the end of the row).
- **Settings:** the hub groups Transaction settings and Calendar settings. Every change is recorded in **Logs**.
- **Calendar:** working hours (campus or one office), holidays and the class-suspension setting, academic terms (read only: they come from the Syllabus Management System).
- **Offices, Services, Registry, Roles and permissions** manage the reference data and switches.

## Executive
- **Campus Home:** campus tiles and one row per office. No per-staff figures. Nothing can be changed.

## Good to know
- The deadline counts working days only; holidays and weekends are skipped.
- Times are Asia/Manila.
- When a form has errors, the cursor moves to the first one. A form with unsaved changes asks before you leave the page.
