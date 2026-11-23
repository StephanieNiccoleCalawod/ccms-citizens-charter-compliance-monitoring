# Walkthrough notes: navigation by role (S8-36)

These are **scripted checks, not a usability test with people.** They show that each task is reachable in a few clicks and that each
role's menu holds only what the role may use. The ticket's own check (three tasks per role finished without help) still needs real
staff; the tasks below are the ones to give them. Decision D8-20 is still open, so the order of the menu is a proposal.

## What changed

The page a person lands on after signing in is now the first item of their menu: Office Home for Office Head and Office Staff, Campus
Home for the Executive. The Dashboard follows it. Before, the Dashboard was first for everyone, although none of these three roles
lands on it. A Super Admin lands on Accounts (an Administration item), so their menu is unchanged. Nothing was added or removed, and the
groups (Main, Administration, Reference) are in the same order. Account and Sign out are last, in the menu under the person's name.

## Menus now (first to last)

| Role | Menu |
|---|---|
| Super Admin | Dashboard, Transactions, Queue, Reports, Complaints, Late-risk / Accounts, Offices, Registry, Roles and permissions, Logs, Settings / Services, Calendar |
| Office Head | Office Home, Dashboard, Transactions, Queue, Reports, Complaints, Late-risk / Services, Calendar, Settings |
| Office Staff | Office Home, Dashboard, Transactions, Queue, Late-risk / Services, Calendar, Settings (Reports and Complaints appear only while their switches are on) |
| Executive | Campus Home, Dashboard, Transactions, Reports, Complaints, Late-risk / Services, Calendar, Settings |

No group has more than seven items. The Executive has no Queue, Registry or Accounts.

## Three tasks per role

| Role | Task | Path | Clicks | How it was checked |
|---|---|---|---|---|
| Super Admin | Create an account | Accounts, then "+ Add Account" | 2 | Real system; the form was opened and cancelled |
| Super Admin | Change a transaction setting | Settings, then "Transaction settings" | 2 | Real system; the form was opened, nothing changed |
| Super Admin | See who changed a setting | Logs | 1 | Real system |
| Office Head | See which services are late in my office | Dashboard, then the "Service Charter Compliance" tab | 2 | Source check (the menu and the tab exist) |
| Office Head | Review an overdue open transaction | Late-risk, then Review, then "Open Transaction Record" | 3 | Source check |
| Office Head | Look at my office's working hours | Settings, then "Working hours" | 2 | Source check |
| Office Staff | Start a transaction | Transactions, then "+ Add Transaction" | 2 | Source check |
| Office Staff | Call the next ticket | Queue, then "Call Next Ticket" | 2 | Source check |
| Office Staff | Resume a held transaction | Transactions, then the transaction, then "Resume" | 3 | Source check |

The Office Head and Office Staff menus were also opened with a mocked sign-in (there is no real account of those roles to use), and the
order above was confirmed.

## Forms

The Start transaction form already has labelled sections (Service, Queue ticket (optional), Late entry, Standard, Required documents,
Client), and the late-entry fields appear only when the box is ticked. No other form was split: there is no evidence yet that one is
too long. That needs the walkthrough with staff.

## For the PM (D8-20)

1. Is "the page you land on is the first menu item" the rule you want, or do you prefer a different order? It is one function
   (`homeFirst` in `lib/auth/permissions.js`) and easy to change.
2. For Office Staff, should Dashboard stay second, or move below Transactions and Queue (the daily work)?
3. Which three tasks should staff be given in the real walkthrough?
