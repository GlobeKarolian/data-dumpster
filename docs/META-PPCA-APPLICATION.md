# Meta Page Public Content Access application runbook

**Owner:** Boston Globe Media

**Product:** Data Dumpster

**Verified:** 3 August 2026 against the official Meta pages linked below

**Current state:** Tech Provider Access Verification verified; Page Public
Content Access production approval is not evidenced by the available records
and must be confirmed in the dashboard; app unpublished

This is the submission and production-readiness checklist for Meta's **Page
Public Content Access** feature (PPCA). It contains no app ids, Page ids, access
tokens, reviewer passwords or other secrets. Put those only in Meta's protected
submission fields and the approved secret store.

## 1. The status boundary

Boston Globe Media's **Tech Provider Access Verification is verified**. The
accepted submission classified Data Dumpster as SaaS and described the product
as collecting public Facebook Page followers, posts, reactions, comments and
shares so newsroom users can compare Pages and produce benchmarks, rankings,
reports and alerts.

That verification is useful but narrow:

- Access Verification establishes Boston Globe Media as a verified Tech
  Provider. Meta says the verification check belongs to the claimant business,
  applies to any apps that business claims, and allows listed endpoint checks to
  continue when the person granting access is not an app-role user.
- Access Verification is **independent of App Review and access levels**. It
  does not grant PPCA, Advanced Access to a permission, or live Page data.
- PPCA still requires a successful App Review, business verification, and
  potentially additional contracts. The app must remain unpublished until that
  review succeeds and the production checklist in section 10 is complete.
- Do not set `ppcaApproved`, provision a production PPCA token, or describe
  competitor Facebook as first-party-covered until Meta's dashboard explicitly
  shows PPCA approved.

The accepted Tech Provider wording is the baseline for App Review. Do not
silently change the product category or broaden the data use between the two
submissions.

## 2. What PPCA does and does not authorize

Meta describes PPCA as access to Pages Search and public Page data when the app
lacks `pages_read_engagement` and `pages_read_user_content` for that Page.
Readable data includes business metadata, public posts and public comments. Its
allowed use is to **analyze and/or display Page posts and engagement**.

Meta lists these common endpoints:

- `/{page-id}/feed`
- `/{page-post-id}`
- `/{page-post-id}/comments`

Before approval, the app may test only Pages whose administrator also holds an
app role. Putting the app in Live mode early does not widen that access: without
PPCA, a Live app receives no public Page content for Pages it does not
administer.

Data Dumpster's conservative production use is smaller than the available
surface:

| Use | In scope | Deliberately out of scope |
|---|---|---|
| Page facts | Page identity and public follower stock, when Meta returns it | Administrator lists, private settings and owner insights |
| Posts | Public Page-authored posts, timestamp, text, permalink and public media reference | Stories, deleted/private content and signed owner media |
| Engagement | Public reaction, comment and share counts | Reach, impressions, saves, clicks and per-user engagement history |
| Comments | Aggregate comment count | Comment bodies and commenter profiles in the normal collection path |
| Product use | Comparisons, benchmarks, rankings, reports and alerts | Advertising, targeting, eligibility decisions, resale or user profiling |

PPCA is not a historical archive. It does not restore CrowdTangle history from
before collection begins.

**Instagram is separate.** Instagram Public Content Access unlocks the
Instagram Graph API's hashtag-search endpoints. It does not unlock arbitrary
competitor accounts or account timelines. Do not add it to this submission as a
substitute for PPCA, and do not claim that a Facebook grant changes Instagram
coverage.

## 3. Conservative requested-access set

Submit the smallest set the reviewer can reproduce.

| Item | Default action | Reason |
|---|---|---|
| **Page Public Content Access** feature | Request | This is the grant required for unadministered public Pages |
| `public_profile` | Use only at its default access level if Facebook Login requires it | Do not request broader access merely because it is present by default |
| `pages_read_engagement` | Do not add unless the review build actually reads a Page administered by the signing-in test user through this permission | PPCA exists to read public Page data where this permission is absent |
| `pages_show_list` | Do not add unless the review build presents a Page picker populated from the signing-in user's administered Pages | A manually configured controlled Page does not need a Page-list permission |
| `pages_read_user_content` | Do not request | Data Dumpster does not need visitor-authored Page content for competitive output |
| Page management/publishing permissions | Do not request | Data Dumpster does not publish, edit, moderate or message as a Page |
| Page Public Metadata Access | Do not request | Meta identifies PPCA as the broader successor; do not request both |
| Instagram Public Content Access | Do not request here | It is hashtag search only and does not serve this Page use case |

If Meta's dashboard requires a supporting permission, document the exact
dependency and add only that item. Each requested permission or feature needs
its own successful call, description and screen recording. A convenient extra
permission is not a harmless checkbox; it adds another independent reason for
rejection.

## 4. Exact dashboard checklist

Use a Boston Globe Media business administrator and an app administrator. Keep
screenshots and decision emails in a restricted compliance archive, never in
this repository.

### Business and ownership

- [ ] Confirm the app is claimed by the Boston Globe Media business.
- [x] **Access Verification / Tech Provider** shows verified.
- [ ] Capture the current **Business Verification** approved screen and date.
- [ ] Confirm the business and app show no restriction, policy warning or
  required action.
- [ ] Confirm the people preparing and submitting the review have only the app
  roles they need.
- [ ] Confirm at least two controlled Facebook Pages are each administered by a
  person who also holds an admin, developer or tester role on the app. Meta
  permits those Pages for the pre-review comparison test.

### App Settings > Basic

- [ ] Display name is **Data Dumpster** and matches the review build.
- [ ] Upload a compliant **1024 x 1024** app icon with no Meta trademark misuse.
- [ ] App domain and HTTPS website/platform URL point to the exact testable
  review environment.
- [ ] Privacy Policy URL is
  `https://pressbox-kappa.vercel.app/about/privacy` (`/about/privacy`), is
  public and login-free, and explains the Meta data collected, purpose,
  retention, deletion request path and contact.
- [ ] Data deletion instructions URL is
  `https://pressbox-kappa.vercel.app/about/data-deletion`
  (`/about/data-deletion`) and is public and login-free. If the dashboard
  separately requires a callback, configure and test it without replacing this
  instructions URL.
- [ ] App purpose preserves the accepted Tech Provider/SaaS classification. Do
  not switch it to a consumer or personal-use answer to simplify review.
- [ ] Category is **Business**, or the closest current dashboard category if
  Meta has renamed that choice.
- [ ] Contact email is a monitored Boston Globe Media group, not an individual's
  disposable inbox.
- [ ] Terms URL is `https://pressbox-kappa.vercel.app/about/terms`
  (`/about/terms`) and is public and login-free. Namespace, authorized domains
  and OAuth redirect URLs are complete wherever the chosen app product requires
  them.
- [ ] No token, app secret, Page id or reviewer password appears in a URL,
  screenshot, video caption, source repository or support ticket body.

### Testable review build

- [ ] Reviewer URL is reachable outside the corporate network without a VPN.
- [ ] Reviewer account instructions work in a clean browser session.
- [ ] Any reviewer password is entered only in Meta's protected credential
  field, not in the description, video or repository.
- [ ] The build starts with two controlled Pages whose Page admins are also app
  roles, as Meta requires before approval. Do not use an unadministered Page as
  the second side of the pre-review comparison.
- [ ] The build visibly labels the source as public Facebook Page data.
- [ ] The build shows missing reach, impressions and saves as unavailable, not
  as measured zero.
- [ ] The review path works without a production PPCA token and without any
  unrelated vendor credential.
- [ ] Error, empty and expired-session states give the reviewer an actionable
  recovery path.

### App Review > Permissions and Features

- [ ] Add **Page Public Content Access** and only the supporting items justified
  in section 3.
- [ ] Make at least one successful API call with every requested permission or
  feature within **30 days** before submission.
- [ ] Allow up to **two days** for Meta to log the successful call and enable
  the request button.
- [ ] Supply one distinct use description for every requested permission or
  feature.
- [ ] Supply one distinct high-resolution screen recording for every requested
  permission or feature; record at **1080p or better**.
- [ ] Answer every data-handling question from the deployed behavior and the
  approved privacy policy. Do not answer from intended future behavior.
- [ ] Complete purpose, category, contact, privacy URL and test instructions
  before opening the final submission dialog.
- [ ] Re-run the reviewer instructions from a clean browser immediately before
  submitting.
- [ ] Submit while the app remains in Development mode.
- [ ] Switch the app to Live only after App Review approves PPCA and section 10
  passes.

## 5. Test-call plan

Use the app selected in Meta's Graph API Explorer or the actual review build.
Use the Graph version selected for the review build and record that version in
the restricted evidence log. Do not paste real ids or tokens into this file.

### Controlled test data

Prepare:

- `{CONTROLLED_PAGE_A_ID}` and `{CONTROLLED_PAGE_B_ID}`: two Pages whose
  administrators also have app roles;
- `{CONTROLLED_POST_A_ID}` and `{CONTROLLED_POST_B_ID}`: one recent
  Page-authored post per Page, each with at least one visible engagement count;
  and
- date-stamped screenshots of both public Pages and posts for a reasonableness
  check, with personal information redacted.

### Required PPCA exercise

1. For each controlled Page, read Page identity and the public follower field:

   ```text
   GET /{CONTROLLED_PAGE_A_ID}?fields=id,name,followers_count
   GET /{CONTROLLED_PAGE_B_ID}?fields=id,name,followers_count
   ```

   If `followers_count` is not returned for the selected Graph version, record
   that as unavailable. Do not silently substitute likes or a vendor number.

2. For each controlled Page, read a bounded Page feed with the exact
   public-comparable counters used by Data Dumpster:

   ```text
   GET /{CONTROLLED_PAGE_A_ID}/feed
     ?fields=id,from,message,created_time,permalink_url,full_picture,shares,
             reactions.limit(0).summary(true),comments.limit(0).summary(true)
     &limit=5

   GET /{CONTROLLED_PAGE_B_ID}/feed
     ?fields=id,from,message,created_time,permalink_url,full_picture,shares,
             reactions.limit(0).summary(true),comments.limit(0).summary(true)
     &limit=5
   ```

3. Read one post from each Page directly:

   ```text
   GET /{CONTROLLED_POST_A_ID}
     ?fields=id,from,message,created_time,permalink_url,shares,
             reactions.limit(0).summary(true),comments.limit(0).summary(true)

   GET /{CONTROLLED_POST_B_ID}
     ?fields=id,from,message,created_time,permalink_url,shares,
             reactions.limit(0).summary(true),comments.limit(0).summary(true)
   ```

4. Do not call `/{page-post-id}/comments` merely to strengthen the demo. The
   endpoint is officially available, but Data Dumpster needs the aggregate
   count and does not normally collect comment bodies or commenter profiles. If
   a reviewer explicitly requires the endpoint, request only the minimum fields,
   do not persist the result, and add the decision to the evidence log.

5. Confirm each response belongs to its controlled Page, the `from.id` filter
   excludes visitor-authored feed items, and the counters are non-negative
   public values. Redact tokens, ids, names and response bodies before archiving
   evidence.

6. In App Review, confirm Meta has logged a successful call for every requested
   item. Wait the documented two-day logging window before diagnosing a missing
   call as a failure.

The pre-review call proves the implementation on a controlled Page. It cannot
prove unadministered-Page access; Meta deliberately reserves that for an
approved feature in Live mode.

## 6. Reviewer-ready descriptions

Paste only the description matching each item actually requested. Replace the
bracketed navigation labels with the final review build's exact labels. Put
credentials only in Meta's credential field.

### Page Public Content Access

> Data Dumpster is Boston Globe Media's SaaS social-intelligence application
> for newsroom teams. It reads public Facebook Page identity, follower stock,
> Page-authored posts, and public reaction, comment and share totals. Users add
> Pages to a private competitive landscape and use those public facts to compare
> Pages, create benchmarks and rankings, and generate reports and alerts. The
> application does not publish to Pages, manage Pages, read private Page data,
> use owner insights, or collect reach, impressions, saves or advertising data
> for comparison Pages. In the review build, sign in with the supplied reviewer
> account, open **[Landscapes]**, select **[PPCA Review Landscape]**, and open
> **[Facebook]**. Both controlled Pages are administered by app-role users, so
> Meta permits the reviewer to reproduce the comparison during controlled
> pre-review testing without relying on production PPCA access. Open a post row
> to see the public reactions, comments and shares used in the Page comparison.
> The attached recording follows these exact steps.

### `pages_read_engagement` — only if the final build truly requires it

> Data Dumpster uses `pages_read_engagement` only for controlled Pages
> administered by the signing-in test user, to demonstrate the same public Page
> identity, follower and engagement fields used in the PPCA review flow. It
> does not use this permission to publish, moderate, message, advertise or read
> Page insights. In the review build, sign in, open **[Data Sources]**, choose
> a controlled Page, and select **[Verify public Page data]**. The attached
> recording is specific to this permission.

### `pages_show_list` — only if the final build truly has a Page picker

> Data Dumpster uses `pages_show_list` solely to populate the Page selector for
> Pages administered by the signing-in test user. After sign-in, open **[Data
> Sources]** and choose **[Connect controlled Page]**. Selecting a Page stores
> its id for the public-data demonstration; the application does not modify the
> Page. The attached recording is specific to this selector and permission.

## 7. Data-handling answer sheet

Use this as the consistency check, not as a substitute for Legal or Privacy
review.

- **Data collected:** public Page identity, public follower stock when exposed,
  Page-authored public posts and aggregate public reactions, comments and
  shares.
- **Purpose:** comparative newsroom analytics, benchmarks, rankings, reports
  and alerts described in the accepted Tech Provider submission.
- **Data not collected for this feature:** private profiles, messages, Page
  administration data, advertising data, owner insights, comment bodies in the
  normal path, or reach/impressions/saves for comparison Pages.
- **Users:** authenticated Boston Globe Media newsroom and product staff with
  access to an organization-private landscape.
- **Sharing:** public observations may be reused internally across landscapes
  so the same Page is not repurchased or recollected. Organization-private
  landscape membership, tags, reports and alerts are not shared.
- **Sale/targeting:** the feature is not used to sell Meta data, target ads,
  determine eligibility, or build profiles of individual Facebook users.
- **Retention/deletion/security:** answer only after Legal, Privacy and Security
  confirm the deployed policy, subprocessors, retention period, access controls,
  encryption claims, incident response and deletion workflow. Link the same
  policy the reviewer can open from App Settings.

If the deployed system does not match one of these statements, fix the product
or the draft before submission. Do not edit the answer to hide the mismatch.

## 8. Screencast storyboard

Record in English at 1080p or better with a readable cursor and no browser
password manager, token, developer id or personal notification visible. Use one
file per requested feature or permission.

### PPCA recording, target 4–6 minutes

| Time | Show | Reviewer proof |
|---|---|---|
| 0:00 | Review URL and Data Dumpster sign-in | The submitted app is real and reachable |
| 0:20 | Sign in with the reviewer account | Reviewer can reproduce the flow |
| 0:45 | Open **[PPCA Review Landscape]** | The feature is part of the product, not Graph Explorer only |
| 1:10 | Show the two controlled Pages configured for the pre-review comparison | Page selection and scope are explicit; no unadministered Page is implied to work before approval |
| 1:40 | Run **[Refresh public Facebook data]** and show successful source status | The app makes the API call |
| 2:15 | Show follower stock, post count and measured-availability labels | Public Page facts are displayed honestly |
| 2:50 | Open a post and show reactions, comments and shares | The PPCA engagement fields power the UI |
| 3:30 | Open ranking/benchmark view | The accepted competitive-analysis use is visible |
| 4:00 | Open a report or alert preview | The accepted report/alert use is visible |
| 4:30 | Show that reach, impressions and saves are unavailable | The app does not invent owner-only metrics |
| 5:00 | End on exact reviewer navigation steps | Reviewer can replay without assistance |

If `pages_read_engagement` or `pages_show_list` is requested, make a separate
short recording for each. Do not reuse the PPCA video and assume the reviewer
will infer the other use.

## 9. Evidence and status log

Evidence lives in the restricted compliance archive. This repository records
status and the type of proof, not the proof itself.

| Item | Status on 3 Aug 2026 | Evidence to retain | Owner | Next action |
|---|---|---|---|---|
| Tech Provider Access Verification | **Verified** | Dashboard status, decision email, accepted answers | Business admin | Monitor for status changes |
| Accepted business classification | **SaaS** | Submitted answer export | Business admin | Keep App Review consistent |
| Accepted use | **Public Page followers/posts/engagement; comparisons, benchmarks, rankings, reports, alerts** | Submitted answer export | Product | Keep scope narrow |
| Business Verification | Confirm and archive current green status | Dashboard screenshot | Business admin | Block submission if not approved |
| PPCA | Production approval is not evidenced in the available records | Permissions and Features screen | App admin | Confirm the current dashboard state before submission, resubmission or production activation |
| App mode | **Unpublished**; confirm the dashboard mode | App dashboard screenshot | App admin | Keep unpublished until approval and validation |
| Additional Meta contract | Confirm whether the dashboard requests one | Contract request and signed copy | Legal | Treat any required contract as a production blocker |
| Policy pages | Confirm `/about/privacy`, `/about/data-deletion` and `/about/terms` are current and publicly reachable | Public URLs and dated PDF capture | Privacy/Legal | Complete before submission or resubmission |
| Successful feature call | Confirm current logged-call status | Dashboard logged-call status, sanitized request note | Engineering | Run within 30 days; allow two days to log |
| Reviewer build and account | Confirm current readiness | Clean-session test record | Engineering | Verify outside corporate network |
| Distinct descriptions | Drafted in section 6 | Final submitted text | Product/Engineering | Remove unused permission drafts |
| 1080p recordings | Confirm current readiness | Final files and checksums | Product/Engineering | Record after UI and instructions freeze |
| Data-handling questions | Confirm current readiness | Submitted answer export and approvals | Privacy/Legal | Answer from deployed behavior |
| App Review submission | Confirm in dashboard; do not infer from Access Verification | Submission or resubmission receipt | App admin | Submit only when every box is green |
| App Review decision | No production PPCA approval is evidenced here; confirm the latest dashboard decision | Decision and reviewer notes | App admin | Do not enable PPCA until the dashboard explicitly evidences approval |

Record every rejection, requested clarification, changed description, changed
permission set and resubmission date. Never overwrite the previous evidence.

## 10. Post-approval token and production validation

Approval is the start of production validation, not permission to paste a token
into the current deployment.

1. Confirm the dashboard names **Page Public Content Access** as approved and
   record the approval date and any contract condition.
2. Confirm Business Verification and Tech Provider verification remain green.
3. Sign any additional contract Meta requires before making a live call.
4. Align the review build and adapter on a currently supported Graph API
   version. Re-test the documented fields before changing the adapter's pinned
   version; do not make a blind version bump.
5. Create the least-privileged production token type supported for the approved
   app. Meta's rate-limit guidance recommends a system user token for PPCA.
   Inspect it with the Access Token Debugger, record scopes and expiration in
   the restricted archive, and store the value only in the approved secret
   store.
6. Switch the app to Live. First call the controlled Page, then one public Page
   that no app-role user administers. A successful second call is the actual
   proof of PPCA.
7. Validate Page identity/follower availability, `/{page-id}/feed`, direct post
   reads, pagination, `from.id` Page-author filtering, reaction/comment/share
   summaries, and Meta's rate-usage headers. Do not log response tokens or raw
   personal data.
8. Compare a small sample with the public Facebook UI. Differences are evidence
   to investigate, not numbers to overwrite by hand.
9. Run an isolated ingestion canary twice and prove idempotency, audience-stock
   behavior, cursor continuation and honest coverage when the local five-page
   PPCA cap is reached.
10. Verify that no reach, impressions, saves, comment bodies, owner insights,
    signed media or credential-bearing raw payload enters pooled storage.

The current pooled runner deliberately excludes Meta owner and PPCA credentials
as part of the owned-data containment release gate. Before PPCA becomes a normal
source, implementation must provide a deployment-wide public credential path,
public-comparable provenance, source-scoped cursor state and field allowlisting
without letting an organization's owner token write global rows. Complete the
relevant gates in `docs/OWNED-DATA-ISOLATION.md`; do not work around them by
setting an organization credential.

Only after those checks pass:

- enable the public Meta source for one canary Page;
- set the product's approval/source flag from a controlled admin path;
- monitor 4xx permission errors, cursor caps, source completeness, API usage
  headers and ingestion cost for at least one full collection cadence; and
- expand Page-by-Page, preserving Bright Data as the explicitly labeled
  fallback until Meta reliability is established.

## 11. Rollback and fallback

### If App Review rejects the request

- Keep the app in Development mode and leave PPCA disabled.
- Preserve the reviewer response and submission artifact; fix the named defect
  before resubmitting.
- Do not add permissions to make the rejection disappear unless Meta identifies
  a real dependency.
- Continue the approved purchased-source policy for existing Facebook profiles.
  New Facebook onboarding remains disabled while identity resolution would buy
  the same crawl twice.
- Keep product coverage visibly vendor-sourced or unavailable. Never relabel a
  vendor crawl as official Meta coverage.

### If approval is revoked, a token fails, or live results are wrong

- Disable the Meta public source and revoke/rotate the affected token.
- Do not delete pooled identity, history or landscape demand. Mark the source
  unavailable or incomplete and leave the window for a safe repair.
- Do not advance certified coverage from a permission error, capped page set or
  unverifiable response.
- Fall back to Bright Data only where Legal/procurement approval and spend
  controls permit it; retain source provenance and its completeness warning.
- If a field mapping is in doubt, stop that field rather than substitute another
  counter.
- Notify Security/Privacy through the incident process if the failure involved
  credential exposure or data outside the approved public scope.

## 12. Official Meta references

- [Page Public Content Access](https://developers.facebook.com/docs/features-reference/page-public-content-access/)
- [Access Verification](https://developers.facebook.com/documentation/development/release/access-verification)
- [Tech Providers](https://developers.facebook.com/docs/development/release/tech-providers/)
- [Business Verification](https://developers.facebook.com/documentation/development/release/business-verification)
- [App Review overview](https://developers.facebook.com/documentation/resp-plat-initiatives/individual-processes/app-review)
- [App Review submission guide — updated 30 Jun 2026](https://developers.facebook.com/documentation/resp-plat-initiatives/individual-processes/app-review/submission-guide)
- [Screen-recording guide](https://developers.facebook.com/docs/app-review/submission-guide/screen-recordings)
- [Page feed reference](https://developers.facebook.com/docs/graph-api/reference/page/feed)
- [Page post reference](https://developers.facebook.com/docs/graph-api/reference/page-post)
- [Object comments reference](https://developers.facebook.com/docs/graph-api/reference/object/comments)
- [Pages permissions and features](https://developers.facebook.com/docs/pages/overview/permissions-features)
- [Graph API rate limiting](https://developers.facebook.com/docs/graph-api/overview/rate-limiting)
- [Graph API Explorer](https://developers.facebook.com/tools/explorer/)
- [Access Token Debugger](https://developers.facebook.com/tools/debug/accesstoken/)
- [Instagram Public Content Access](https://developers.facebook.com/docs/features-reference/instagram-public-content-access/)
- [Meta Platform Terms](https://developers.facebook.com/terms/dfc_platform_terms/)
- [Meta Developer Policies](https://developers.facebook.com/devpolicy/)

Meta changes dashboard labels and redirects documentation URLs. At submission
time, open every link, record the date and update this runbook if the official
requirements changed.
