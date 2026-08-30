# Screenshot-a-Day v0.1.0 promotion runbook

This runbook turns the first release into a 30-day search for real users. The primary outcomes are confirmed independent installs, retained operators, and useful feedback. Pageviews and stars are supporting signals, not substitutes.

Start only after every go-live gate in the [technical release runbook](../plans/release-v0.1.0.md) is complete.

## Launch record and goals

| Field                          | Value                                           |
| ------------------------------ | ----------------------------------------------- |
| T0 GitHub Release time         |                                                 |
| Pages URL                      | `https://arts-link.github.io/screenshot-a-day/` |
| Demo URL                       | `https://screenshots.arts-link.com/`            |
| GitHub Release URL             |                                                 |
| Show HN date/time              |                                                 |
| New Project Friday date/time   |                                                 |
| Product Hunt date/time         |                                                 |
| Awesome-Selfhosted eligibility | T0 plus four months and one day                 |

Thirty-day targets:

- **Core:** five independently confirmed installations.
- **Retention:** three installations still running at least 14 days later.
- **Learning:** five substantive feedback items from people outside Arts-Link.
- **Stretch:** one external contribution or one approved public deployment story.

Do not claim an install from a pageview, outbound click, container pull, star, or social reaction. Record an install only when the operator confirms a working capture.

## Positioning and claims

Lead with:

> A Wayback Machine for the sites you are responsible for—self-hosted, able to capture authenticated or internal pages, and able to publish a visual record people can actually browse.

Keep the messages in this order:

1. The operator owns the archive: AGPL, self-hosted, their storage, and no product telemetry from the installed application.
2. Authenticated and explicitly allowlisted internal pages can stay within operator-controlled infrastructure.
3. The result is presentable: private, unlisted, and indexable galleries plus GIF/WebM timelines.

Do not position Screenshot-a-Day as general change alerting, CI visual regression, a screenshot API, a compliance archive, or a tamper-proof evidence system. “Signed” applies only to outbound webhook authentication.

## Campaign links

The canonical URL remains clean in visible copy:

```text
https://arts-link.github.io/screenshot-a-day/
```

Use this taxonomy only where tagged links are accepted:

| Field          | Values                                                                                                   |
| -------------- | -------------------------------------------------------------------------------------------------------- |
| `utm_campaign` | `sad-v0-1-0`                                                                                             |
| `utm_source`   | `arts-link`, `github`, `selfh-st`, `alternativeto`, `openalternative`, `product-hunt`, `direct-outreach` |
| `utm_medium`   | `release`, `social`, `directory`, `community`, `outreach`                                                |
| `utm_content`  | Short lowercase placement such as `hero`, `launch-post`, `agency-invite`                                 |

Example:

```text
https://arts-link.github.io/screenshot-a-day/?utm_source=arts-link&utm_medium=social&utm_campaign=sad-v0-1-0&utm_content=launch-post
```

Use the clean canonical URL for Hacker News and Reddit. Use their referrer for aggregate attribution. Never put personal information in a campaign value.

## PostHog launch dashboard

Before T0, create one dashboard filtered to the Pages hostname and `/screenshot-a-day/` path:

- Daily anonymous visitors and `$pageview` events.
- `marketing_cta_clicked` conversion by `destination` and `placement`.
- `install_command_copied` rate per visitor.
- Referring domain and allowlisted UTM source/medium/campaign.
- Demo, GitHub, release, deployment-guide, and source click-through rates.
- Annotations at T0, Show HN, New Project Friday, and Product Hunt.

Exclude the release operator's verification traffic from the reporting view. Keep raw analytics anonymous and cookieless. The dashboard measures marketing behavior only; the user tracker below remains the source of truth for adoption.

## User and feedback tracker

Maintain a private working table with only the minimum information volunteered during outreach:

| Contact | Segment | Source | Environment | Invited | Installed | Day-7 | Day-14 | Feedback | Public permission |
| ------- | ------- | ------ | ----------- | ------- | --------- | ----- | ------ | -------- | ----------------- |

Environment should record only useful compatibility facts such as architecture, operating system, Docker version, and reverse proxy. Never copy API tokens, target URLs, cookies, headers, screenshots, logs containing secrets, or other installation data into the tracker.

## Audience cohort

Prepare 15 individual contacts before T0:

- Five experienced self-hosters covering amd64, arm64, Docker Desktop, and at least two reverse proxies.
- Five agencies or freelancers responsible for multiple client sites.
- Five relevant open-source maintainers or web-archiving practitioners.

Use existing relationships and public, relevant contact routes. Personalize every message, disclose that you built the project, and send one follow-up at most unless the person replies. Do not scrape addresses, bulk-message communities, or ask anyone to vote.

## Outreach templates

### Early self-hoster invitation

> I have just released Screenshot-a-Day, a self-hosted visual history for websites. I am looking for a few experienced operators to try the documented Docker Compose install and tell me where it breaks or feels ambiguous. It supports amd64/arm64, Chromium/Firefox/WebKit, comparisons, galleries, and static publishing. Would you be willing to run one authorized test site and share the environment plus any rough edges? Project: [tagged Pages link]

### Agency or freelancer interview

> I built Screenshot-a-Day to keep a dated, client-presentable visual history of sites an agency is responsible for. It runs on infrastructure you control and can capture authenticated pages without handing cookies to a screenshot SaaS. I am not selling anything in this release; I want to learn whether this solves a real client or maintenance problem. Would you have 20 minutes to show me how you handle this today?

### Day-2 install follow-up

> Were you able to reach a completed capture? If not, where did the process stop? A command, screenshot with secrets removed, or short description is enough. Please do not send credentials, cookies, private URLs, or administrator tokens.

### Day-7 retention follow-up

> Is the instance still running, and have you looked at a second capture or comparison? What is the one change that would make you keep it installed?

### Public story permission

> Would you be comfortable with me naming your deployment or linking an approved public gallery? I will publish nothing unless you approve the exact wording and URL first.

## Timeline

### T-minus 3 to T0: prepare

- [ ] Complete all technical go-live gates and freeze the verified links.
- [ ] Finish three real screenshots, a 45–60 second walkthrough, a 240×240 Product Hunt thumbnail, and four Product Hunt gallery images using the [asset brief](asset-brief.md).
- [ ] Proofread every channel-specific draft in [announcement copy](announcement-copy.md) against the released behavior.
- [ ] Prepare the 15-person cohort and personalize the first five invitations.
- [ ] Create the PostHog dashboard and confirm sanitized production test events.
- [ ] Capture T0 baselines: GitHub stars/forks/issues, PostHog visitors/conversions, and confirmed installs.
- [ ] Create or complete a personal Product Hunt profile. A new account must age at least one week before it can post; build a real community presence rather than soliciting launch votes.

### T0: release announcement

- [ ] Verify the GitHub Release, both public GHCR images, exact-digest demo, Pages launch state, privacy disclosure, and analytics once more.
- [ ] Publish the Arts-Link announcement and one personal post using the clean Pages URL or the approved Arts-Link campaign link.
- [ ] Send no more than five personalized early-user invitations.
- [ ] Stay available for six hours, acknowledge actionable reports within four business hours, and label security reports for private handling.
- [ ] Record the announcement URLs and annotate the PostHog dashboard.

### T+1 to T+7: directories and onboarding

- [ ] Submit to [selfh.st/apps](https://selfh.st/apps-about/) with Pages as project, GitHub as source, and the live gallery as demo.
- [ ] Submit a verified application to [AlternativeTo](https://alternativeto.net/faq/) and propose only honest alternatives with the same job.
- [ ] Submit to [OpenAlternative](https://openalternative.co/submit) if its category and comparison requirements fit.
- [ ] Send the next five individualized invitations after resolving repeated onboarding problems from the first group.
- [ ] Follow up with installers on day 2 and day 7; turn repeated friction into GitHub issues.
- [ ] Publish patch releases for material defects; never silently change a released tag.

### T+8 to T+13: stabilize and prepare Show HN

- [ ] Review every external issue and verify the demo still represents the current stable release.
- [ ] Update the Show HN body with two or three concrete lessons from real installs.
- [ ] Confirm the demo is immediately usable without an email or account.
- [ ] Choose a weekday when the maker can answer throughout the first six hours.
- [ ] Send the final five individualized cohort invitations; do not mention or solicit the coming HN vote.

### T+14: Show HN

Use the clean demo or Pages URL and the title:

> Show HN: Screenshot-a-Day – self-hosted visual history for websites

- [ ] Follow the [Show HN guidelines](https://news.ycombinator.com/showhn.html): submit something directly usable, explain how and why it was built, and remain present for discussion.
- [ ] Lead with technical decisions that invite useful conversation: SSRF-safe authenticated capture, three engines on one schedule, local encrypted secrets, and portable static galleries.
- [ ] State the v0.1 limitations plainly.
- [ ] Do not ask friends, users, or followers to upvote, submit, or comment.
- [ ] Answer questions as the maker rather than pasting generated marketing replies.
- [ ] Annotate the dashboard and record substantive questions separately from traffic.

### Next eligible Friday, at least 48 hours after Show HN: r/selfhosted

Projects under three months old may be introduced only on “New Project Friday.” Recheck the live subreddit rules immediately before posting.

- [ ] Use the self-hosted-project flair and disclose that you are the author.
- [ ] Include what it does, a feature list, why it benefits self-hosters, the Docker install path, documentation, source, license, telemetry position, architecture support, and limitations.
- [ ] Link the clean Pages URL plus source and demo in the body.
- [ ] Add two or three real lessons or fixes learned since T0.
- [ ] Do not cross-post the HN or Product Hunt copy verbatim.
- [ ] Respond practically to ARM, proxy, storage, and backup questions.

### Following Tuesday within T+21 to T+30: Product Hunt

- [ ] Self-hunt from the maker's personal account; do not pay or wait for a prominent hunter.
- [ ] Schedule the prepared draft for 12:01 a.m. Pacific when the maker can remain available.
- [ ] Use the Pages URL, tagline, description, thumbnail, four gallery assets, walkthrough, correct free pricing, up to three relevant tags, and a substantial maker comment.
- [ ] Ask existing contacts to visit, try it, and leave honest feedback if they wish. Never ask for an upvote or reward engagement.
- [ ] Reply to every substantive question and route defects to GitHub.
- [ ] Follow the current [Product Hunt launch guide](https://www.producthunt.com/launch) and [preparation checklist](https://www.producthunt.com/launch/preparing-for-launch).

### T+30: review

Capture:

- Confirmed installs and the environment mix.
- Day-14 retained installs.
- Substantive feedback and repeated requests.
- External issues, pull requests, and public stories.
- Pageviews, CTA conversion, install-copy rate, and source mix.
- GitHub stars/forks only as context.

Decide:

- **Continue acquisition experiments** when five installs and three retained operators are met and feedback converges on solvable problems.
- **Narrow positioning and outreach** when installs exist but retention or use cases split by segment.
- **Maintain quietly** when fewer than three independent installs occur despite the full sequence; do not build a hosted product to compensate for absent demand.

### T0 plus four months and one day: Awesome-Selfhosted

- [ ] Confirm the first GitHub Release is older than four full months; the project clock starts from the release, not the first commit.
- [ ] Recheck the current [Awesome-Selfhosted contribution rules](https://github.com/awesome-selfhosted/awesome-selfhosted-data/blob/master/CONTRIBUTING.md).
- [ ] Submit the required YAML entry under Archiving and Digital Preservation with the canonical site, demo, source, AGPL licence, Docker platform, and accurate description.

## Daily response and triage

During every public launch day:

1. Confirm the demo, Pages, Release, and container pulls before posting.
2. Check replies at least hourly for the first six hours.
3. Move reproducible defects to GitHub with secrets removed.
4. Move vulnerability reports to private vulnerability reporting immediately.
5. Acknowledge compatibility reports and record architecture/proxy details only with permission.
6. Correct inaccurate claims publicly and update the durable copy.
7. Do not argue about rankings, votes, or competitors.

## Promotion stop conditions

Pause scheduled posts when a release image cannot be pulled, clean setup fails, the demo exposes private material, backup/restore is unreliable, a credible vulnerability is open, Pages links are broken, or analytics contradicts its privacy disclosure. Resume only after a verified patch or site correction.
