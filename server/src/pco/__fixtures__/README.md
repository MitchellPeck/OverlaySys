# PCO Live fixture

**UNVERIFIED — reconcile against a real capture before release.**

`live.json` was written by hand from the documented Services API shape, not captured
(no PCO credentials / live plan were available). Verify these names against a real
response of `GET /service_types/:st/plans/:plan/live?include=current_item_time,next_item_time`,
`/plans/:plan/items?per_page=100` and `/plans/:plan/plan_times`:

- `Live`: attributes `title` (fallback `series_title`); relationships `current_item_time`, `next_item_time` -> `ItemTime`.
- `ItemTime`: attributes `live_start_at`, `live_end_at`; relationship `item` -> `Item`.
- `Item`: attributes `title`, `sequence`, `item_type`, `length` (seconds).
- `PlanTime`: attributes `time_type` (`service` used), `starts_at`, `ends_at`.

Keys in `live.json`: `live` (Live doc with included ItemTimes), `items`, `planTimes`.
Unknowns to check: whether `Live` really carries a plan title, and whether the included
`ItemTime` carries its `item` relationship.
