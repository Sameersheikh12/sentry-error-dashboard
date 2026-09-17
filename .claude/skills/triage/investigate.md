# Investigating a specific error, user, or session

The sweep in `SKILL.md` answers "what changed?". This answers "what actually happened, and why?" —
for one issue, one user, or one request. Use it whenever someone names a thing: an issue id, a
user, a journey, an endpoint, a correlation id.

## Read the error properly — the title is usually the least useful field

Fetch the issue, then **read past the title**:

```
get_sentry_resource(organizationSlug, resourceType='issue', resourceId='<SHORT-ID or URL>')
```

Order to read it in:

1. **`Extra Data` — start here.** Applications commonly attach the real upstream response under
   `extra.detail` or `extra.logs`. This is where the actual cause lives.
2. **The most relevant stack frame** — the first-party one, not the SDK internals.
3. **Tags** — `environment`, `handled`, `transaction`, `url`, `os`, `browser`, plus any the team
   added themselves (correlation ids, tenant ids, feature flags).
4. **`user`** and **`user.geo`** — who hit it, and where.
5. Only then the title.

A real example from this project. The title reads:

> `PWA Journey API Error: API exception at /journey/fetch-user-info`

which says only "a call failed". The `extra.logs` field on the same event says:

> `{"success":false,"errors":{"errorMessage":"No Journey found with User Journey ID usrj_…","errorCode":411}}`

That is the actual fault — the backend has no journey for that id — across 12,080 occurrences and
7,062 users. **Always report the upstream error code and message when one is attached.** Saying
"an API call failed" when the payload says "411 No Journey found" is withholding the answer.

Then explain, in this order: what broke, the evidence you are reading it from, who is affected, and
what you cannot tell from Sentry alone. Do not guess at a fix from a stack trace you cannot see the
source for — say what the error reports and where it comes from.

## Everything that happened to one user

Users are identified by `user.id`. Find candidates first if you were given something else:

```
search_events(organizationSlug, projectSlug, dataset='errors', query='environment:prod',
              fields=['user.id','count()'], sort='-count()', period='24h', limit=100)
```

Then pull that user's timeline, oldest-to-newest when you report it:

```
search_events(organizationSlug, projectSlug, dataset='errors',
              query='user.id:<id>',
              fields=['timestamp','issue','title','message','transaction'],
              sort='-timestamp', period='24h', limit=100)
```

**Reconstruct the session, do not just list rows.** Group by transaction, note where it started and
what failed next, and call out repeats — the same call failing three times in forty seconds is a
retry loop, not three problems. A real trace from this project:

```
07:41:03  capture-event, track-user-journey   → journey begins failing
07:41:05  post-user-state
07:41:18  capture-event                        (retry)
07:41:43  capture-event, post-user-state       (retry)
07:42:08  capture-event, post-user-state, emi/create
07:42:13  fetch-user-info
```

Ten errors in seventy seconds across six endpoints: one user's journey collapsing, not six
independent faults. Say that.

## Who else is affected

For an issue, get the spread before anyone asks "is it just me?":

```
search_events(organizationSlug, projectSlug, dataset='errors',
              query='issue:<SHORT-ID>', fields=['user.id','count()'],
              sort='-count()', period='7d', limit=100)
```

Many users with few events each = broad and shallow, usually worse. Few users with many events =
a retry loop. Report which shape it is, because they need different responses.

## Search by anything else the team tagged

Any tag on the event is queryable, which is the fastest route from a support ticket to the error:

- `user.id:usrj_…`, `user.email:…`, `user.geo.country_code:IN`
- `transaction:/j/transaction-to-emi`, `url:*cardshub*`
- `correlationId:…`, `trackingId:…`, or whatever the app attaches
- `os.name:Android`, `browser.name:"Chrome Mobile"`, `handled:no`, `level:error`

Combine with `environment:prod` every time. Without it you are reading staging noise.

If a query returns nothing, say whether the tag exists at all before concluding the thing is fine —
"no results" and "that tag is not set on this project" are different answers.

## Rules

- **Quote the upstream error verbatim** when the payload carries one. That is the answer.
- **Never print a user identifier you were not given**, and never paste one into a shared channel.
  Reference the count instead: "7,062 users affected".
- State the window you searched. "No errors" means nothing without it.
- Sentry samples some data (`client_sample_rate` appears on the event) — do not present event counts
  as exact when sampling is on.
- If you cannot answer from Sentry, say what is missing rather than inferring. A stack trace without
  source is evidence of where, not why.
