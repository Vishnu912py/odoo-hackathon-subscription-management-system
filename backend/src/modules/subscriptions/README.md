# Subscriptions module

Routes: subscription CRUD, quote/confirm/activate/pause/resume/renew/close/add-on actions, events and available add-ons.

Current handlers are 501 placeholders in `../index.ts`. Services own lifecycle and effective-date behavior; repositories own transactions. Preserve draft -> quotation -> confirmed -> active -> closed. A pause is separate from lifecycle status. Enforce ownership and plan policies server-side; calculate capabilities for UI hints. Keep agreement prices, tax assignments, policies and recurrence aligned with the shared API contract.
