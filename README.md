# Advanced log analysis in Amazon CloudWatch Logs Insights — demo environment

This AWS CDK app deploys the demo environment used in the blog post
**"Advanced log analysis with facets, correlation, enrichment, and automation in Amazon CloudWatch Logs Insights."**

It creates two CloudWatch log groups with continuously generated sample data, custom
facets (index policies), and a library of saved Logs Insights query definitions so you
can follow along with the walkthrough.

## Architecture

The CDK stack provisions two Amazon CloudWatch log groups fed by sample-data generator
Lambda functions (on EventBridge schedules), custom facets via index policies, and a
library of saved Logs Insights query definitions, plus an S3 results bucket and an IAM
execution role for scheduled queries. The lookup table and the scheduled queries are
created manually as described in the walkthrough.

## What gets deployed

| Resource | Purpose |
| --- | --- |
| Log group `/demo/security/api-activity` | CloudTrail-style API activity events |
| Log group `/demo/security/access-logs` | Application access events |
| Lambda `demo-cloudtrail-generator` | Generates API activity sample data |
| Lambda `demo-access-log-generator` | Generates access-log sample data |
| Lambda `demo-anomaly-generator` | Injects suspicious patterns when `ANOMALY_MODE=true` |
| 3 EventBridge schedules (`rate(1 minute)`) | Invoke the generators continuously |
| Index policy on each log group | Enables the custom facets used in the post |
| 3 saved query definitions (`Security/*`) | Parameterized, JOIN, and sub-query templates |
| S3 bucket (auto-named) | Destination for scheduled query results |
| IAM role `SecurityLogsScheduledQueryRole` | Execution role for scheduled queries |

The saved query definitions created are:

- `Security/PrincipalActivityAudit` — parameterized query + lookup enrichment
- `Security/DeniedThenSucceeded` — parameterized query + sub-query
- `Security/CrossSourceCorrelation` — parameterized query + JOIN across both log groups

> **Note:** The lookup table (`account_metadata`) and the scheduled queries shown in the
> blog post are created manually (see steps 4 and 6 below). Lookup-table creation is a
> console action, and the scheduled-query API is demonstrated directly in the post.

## Prerequisites

- An AWS account and credentials configured for the AWS CLI (for example via
  `aws configure` or AWS IAM Identity Center / SSO).
- Node.js 18+ and npm.
- AWS CDK v2 (`npm install -g aws-cdk`) or use the bundled dev dependency via `npx cdk`.
- The target account/region must be CDK-bootstrapped: `npx cdk bootstrap`.

## Deploy

> **Cost consideration:** This stack creates resources that incur ongoing AWS charges,
> including Lambda functions that run every minute, CloudWatch Logs storage, S3 storage,
> and EventBridge schedules. See the [Production considerations](#production-considerations)
> section for details, and run `cdk destroy` when you are finished to avoid unnecessary
> charges.

```bash
npm install
npx cdk bootstrap        # first time only, per account/region
npx cdk deploy
```

After deployment, the generator Lambdas begin writing sample data every minute. Wait
about 15 minutes for enough data to accumulate before exploring facets and running the
saved queries.

## Follow-along steps

See [DEPLOY.md](./DEPLOY.md) for the full step-by-step sequence, including uploading the
lookup table and toggling anomaly mode for the investigation screenshots.

## Clean up

> **Warning:** The following step permanently deletes all resources created by this
> stack, including the CloudWatch log groups (and all accumulated sample log data) and
> the S3 results bucket and its contents (`autoDeleteObjects` is enabled). Save anything
> you need before proceeding.

```bash
npx cdk destroy
```

`cdk destroy` removes everything created by this stack. The lookup table is created
manually, so remove it separately through the CloudWatch console
(Logs → Settings → Lookup tables). If you created the scheduled queries from the post,
delete them with `aws logs delete-scheduled-query`.

## Production considerations

This is a self-contained demo. Before adapting it for a production workload, consider:

- **Encryption with customer-managed keys (CMKs).** The log groups use default
  CloudWatch encryption and the results bucket uses SSE-S3. For sensitive security
  logs, encrypt both with a KMS CMK you control.
- **Resource naming.** The scheduled-query IAM role uses a fixed name so the
  walkthrough is easy to follow. The results bucket is auto-named by CDK. For
  production, let CDK auto-generate the role name too, to avoid collisions and allow
  more than one deployment per account/region.
- **Retention.** Log groups are set to a 7-day retention for the demo. Set retention to
  match your compliance requirements.
- **Removal policy.** Resources use `RemovalPolicy.DESTROY` and `autoDeleteObjects` so
  the demo tears down cleanly. Production data stores should use `RETAIN`.

## Project layout

```
.
├── bin/app.ts                          CDK app entry point
├── lib/security-logs-insights-stack.ts CDK stack definition
├── lambda/
│   ├── cloudtrail-generator/index.py   API activity generator
│   ├── access-log-generator/index.py   Access-log generator
│   └── anomaly-generator/index.py      Suspicious-pattern generator
├── assets/account-metadata.csv         Lookup table source CSV
├── cdk.json
├── package.json
└── tsconfig.json
```
