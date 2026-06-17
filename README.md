# Advanced log analysis with facets, correlation, enrichment, and automation in Amazon CloudWatch Log Analytics

This repository contains a companion AWS CDK stack and walkthrough for exploring the advanced capabilities of [Amazon CloudWatch Log Analytics](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/LogAnalytics.html): facets, lookup tables, parameterized queries, JOIN and sub-queries, and scheduled queries.

The CDK stack creates two CloudWatch log groups (`/demo/security/api-activity` and `/demo/security/access-logs`), pushes sample events, and provisions the index policies and query definitions used throughout this walkthrough.

> **Repository:** [sample-cloudwatch-logs-advanced-analysis-environment](https://github.com/aws-samples/sample-cloudwatch-logs-advanced-analysis-environment)

---

## Table of contents

- [Introduction](#introduction)
- [Where these features fit in your observability strategy](#where-these-features-fit-in-your-observability-strategy)
- [Prerequisites](#prerequisites)
- [Deploy the example environment](#deploy-the-example-environment)
- [Example environment](#example-environment)
- [Facets for visual exploration](#facets-for-visual-exploration)
- [Lookup tables for contextual enrichment](#lookup-tables-for-contextual-enrichment)
- [Parameterized queries for reusable templates](#parameterized-queries-for-reusable-templates)
- [JOIN for cross-log-group correlation](#join-for-cross-log-group-correlation)
- [Sub-queries for multi-step analysis](#sub-queries-for-multi-step-analysis)
- [Scheduled queries for automated analysis](#scheduled-queries-for-automated-analysis)
- [Putting it together](#putting-it-together)
- [From templates to AI-assisted operations](#from-templates-to-ai-assisted-operations)
- [Cost considerations](#cost-considerations)
- [Cleaning up](#cleaning-up)
- [Conclusion](#conclusion)
- [Additional resources](#additional-resources)

---

## Introduction

Teams working with distributed applications accumulate logs across multiple log groups, including application logs, access logs, and audit trails. When something needs investigating, an engineer opens the console and starts writing queries from scratch. The same query gets written differently by different people. The results lack context because the log event does not contain who owns the service or what environment it belongs to. Checking two log groups means running two separate queries and manually comparing results. And when the investigation is done, the query disappears from the console history. These are common friction points when working with logs at scale. Amazon CloudWatch Log Analytics now includes capabilities that address them directly.

1. **Facets** for exploring log data visually without writing a query.
2. **Lookup tables** for enriching query results with external metadata.
3. **Parameterized queries** for saving reusable templates with fill-in variables.
4. **JOIN and sub-queries** for correlating data across log groups in a single query.
5. **Scheduled queries** for running queries automatically and delivering results to [Amazon Simple Storage Service (Amazon S3)](https://aws.amazon.com/s3/) or [Amazon EventBridge](https://aws.amazon.com/eventbridge/).

This walkthrough covers each capability with working examples. It shows the customer problem each one solves, how to set it up, and how to save it for your team. At the end, the capabilities are combined in a short example to show how they compose together, including how these reusable templates integrate with [AI-assisted operations (AIOps)](https://aws.amazon.com/what-is/aiops/) workflows.

---

## Where these features fit in your observability strategy

The [AWS Observability Maturity Model](https://aws-observability.github.io/observability-best-practices/guides/observability-maturity-model/) defines four stages of observability maturity. The features in this walkthrough support **Stage 3 (Advanced Observability)**, where teams correlate signals across sources, detect anomalies, and gain contextual understanding of issues. They complement the tools you use at earlier stages.

| Stage | Focus | AWS tools |
|-------|-------|-----------|
| **Stage 1: Foundational** | Collecting telemetry (metrics, logs, traces) | [Amazon CloudWatch Metrics](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/working_with_metrics.html), [Amazon CloudWatch Logs](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/WhatIsCloudWatchLogs.html), [AWS X-Ray](https://aws.amazon.com/xray/) |
| **Stage 2: Intermediate** | Analysis, alerting, visualization | [Amazon CloudWatch Alarms](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Alarms.html), [Amazon CloudWatch Dashboards](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Dashboards.html), [Amazon GuardDuty](https://aws.amazon.com/guardduty/) |
| **Stage 3: Advanced** | Cross-signal correlation, contextual enrichment, anomaly detection | Amazon CloudWatch Log Analytics (JOIN, sub-queries, lookup, parameterized queries, scheduled queries) |
| **Stage 4: Proactive** | AI/ML-driven root cause, automated remediation | [Amazon CloudWatch Anomaly Detection](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Anomaly_Detection.html) |

At Stage 3, teams move beyond individual metrics and traces to correlate data across multiple sources with custom logic. The features in this walkthrough facilitate that correlation within your log data.

For cross-service request tracing, use AWS X-Ray or OpenTelemetry. For automated threat detection, use Amazon GuardDuty. The Log Analytics features covered here are for custom log analysis that spans multiple log groups. They apply your organization's business rules and produce reusable templates your team can share.

---

## Prerequisites

To follow this walkthrough, you need:

- An [AWS account](https://signin.aws.amazon.com/signin) with structured logs flowing to at least two [Amazon CloudWatch](https://aws.amazon.com/cloudwatch/) log groups (this walkthrough uses `/demo/security/api-activity` and `/demo/security/access-logs`).
- [AWS Identity and Access Management (IAM)](https://aws.amazon.com/iam/) permissions for the following actions:
  - `logs:PutQueryDefinition`
  - `logs:StartQuery`
  - `logs:DescribeQueryDefinitions`
  - `logs:GetQueryResults`
  - `logs:PutIndexPolicy`
  - `logs:DeleteQueryDefinition`
  - `logs:DeleteIndexPolicy`
- [AWS CLI](https://aws.amazon.com/cli/) version 2.34.56 or later installed and configured.
- [Node.js](https://nodejs.org/) 18 or later and [AWS Cloud Development Kit (AWS CDK)](https://aws.amazon.com/cdk/) version 2.100 or later installed.
- Basic familiarity with [CloudWatch Logs Insights query syntax](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CWL_QuerySyntax.html) (fields, filter, stats, sort).

---

## Deploy the example environment

To deploy the example environment with sample log data, use the companion CDK stack in this repository. The stack creates both log groups (`/demo/security/api-activity` and `/demo/security/access-logs`) and pushes sample events matching the schemas used in this walkthrough.

Clone the repository and deploy the stack:

```bash
git clone https://github.com/aws-samples/sample-cloudwatch-logs-advanced-analysis-environment.git
cd sample-cloudwatch-logs-advanced-analysis-environment
npm install
npx cdk bootstrap
npx cdk deploy
```

The `cdk bootstrap` command is required only once per account and Region. After the stack deploys successfully (approximately 5 minutes), the log groups begin receiving sample events. Wait 2–3 minutes for log data to accumulate before running the queries below.

Set your Region for this terminal session so you can omit `--region` from the CLI commands that follow:

```bash
export AWS_REGION=<your-region>
```

Replace `<your-region>` with the Region where you deployed the CDK stack. This variable persists for the current terminal session only.

> **Alternative:** If you already have structured logs flowing to CloudWatch, you can skip the deployment and use your own log groups throughout the walkthrough.

---

## Example environment

The walkthrough uses two log groups:

- **`/demo/security/api-activity`** — API activity events with fields like `eventSource`, `eventName`, `sourceIPAddress`, `errorCode`, and `userIdentity_principalId`.
- **`/demo/security/access-logs`** — Application access logs with fields like `userId`, `resource`, `action`, and `sourceIP`.
- A **lookup table** (created in the [Lookup tables](#lookup-tables-for-contextual-enrichment) section) maps account IDs to organizational metadata.

<img width="5200" height="2560" alt="figure-01-architecture-cloudops-2335" src="https://github.com/user-attachments/assets/a8714939-c135-4a58-aeaa-7c72c595c559" />

*Figure 1: Example environment showing log sources, key fields, and lookup table*

---

## Facets for visual exploration

> **Customer problem:** "I want to see what patterns exist in my logs before I write a query. I do not know what to filter on yet."

With facets, you first run a query to load log events, and CloudWatch Log Analytics displays interactive facets in the right panel based on your indexed fields. Each facet shows the distribution of values for that field. You can select a facet value to add it as a filter, then run the query again to see only the matching results.

### Explore logs with facets

1. Open the CloudWatch console and under **Logs**, select **Log Analytics**.
2. In Log Analytics, run the following query, which includes the `errorCode` facet filtered to `AccessDenied`. Replace `123456789012` with your AWS account number:

   ```text
   SOURCE "arn:aws:logs:us-east-1:123456789012:log-group:/demo/security/api-activity" START=-3600s END=0s |
   fields @timestamp, eventSource, eventName, errorCode, sourceIPAddress
   | sort @timestamp desc
   | limit 50
   | filterIndex errorCode in ["AccessDenied"]
   ```

3. Run the query. The results now show only events where `errorCode` is `AccessDenied`, displaying the correlated `sourceIPAddress` values for each denied request.

<img width="1498" height="741" alt="figure-02-facets-errorcode-distribution-cloudops-2335" src="https://github.com/user-attachments/assets/f1b200a4-dec1-4d67-8aef-1a086202a828" />

*Figure 2: Facets showing `errorCode` distribution with `AccessDenied` selected as a filter*

### Default facets

Every log group includes four default facets:

- `@aws.region` — the AWS Region that generated the log event
- `@data_format` — the log data format
- `@data_source_name` — the log group name
- `@data_source_type` — the log source type (for example, Lambda, ECS, EC2)

These work out of the box, with no configuration required.

<img width="1497" height="741" alt="figure-03-default-facets-cloudops-2335" src="https://github.com/user-attachments/assets/3ab8358f-dff7-4a07-94cb-2b427d12d63d" />

*Figure 3: Default facets panel showing `@aws.region`, `@data_format`, `@data_source_name`, and `@data_source_type`*

### Creating custom facets using index policies

If you deployed the companion CDK stack, the index policies for `/demo/security/api-activity` and `/demo/security/access-logs` are already in place. The commands below show what the stack created, so you can inspect or replicate them in your own environment.

Default facets are useful but generic. For your application logs, you want facets on fields that matter to your team. You define index policies per log group, so create one for each of your two log groups with fields relevant to their content.

For the API activity log group, index fields like `eventSource`, `eventName`, `errorCode`, and `sourceIPAddress`:

```bash
aws logs put-index-policy \
  --log-group-identifier "/demo/security/api-activity" \
  --policy-document '{
    "FieldsV2": {
      "eventSource": {"type": "FACET"},
      "eventName": {"type": "FACET"},
      "errorCode": {"type": "FACET"},
      "sourceIPAddress": {"type": "FACET"},
      "userIdentity_accountId": {"type": "FACET"},
      "userIdentity_principalId": {"type": "FIELD_INDEX"}
    }
  }'
```

For the access logs group, index fields useful for tracking who accessed what:

```bash
aws logs put-index-policy \
  --log-group-identifier "/demo/security/access-logs" \
  --policy-document '{
    "FieldsV2": {
      "userId": {"type": "FACET"},
      "resource": {"type": "FACET"},
      "action": {"type": "FACET"},
      "sourceIP": {"type": "FACET"}
    }
  }'
```

After a few minutes, these fields appear as selectable facets in the Log Analytics console. An engineer can run a query, then choose `errorCode` in the right facet panel to see the distribution of values. Selecting a specific value like `AccessDenied` adds it as a filter. Running the query again returns only matching events, without manually rewriting the query syntax.

### Best practice for facet field selection

Index policies work best on low-cardinality fields. Facets with more than 100 unique values each day are classified as high-cardinality, and their values are not displayed in the console. This walkthrough uses `eventSource`, `errorCode`, and `userIdentity_accountId` because they have a small number of distinct values and are useful for visual exploration. For more information on facet field selection, see [Use facets to group and explore logs](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CloudWatchLogs-Facets.html).

---

## Lookup tables for contextual enrichment

> **Customer problem:** "My log events contain a service name or account ID, but I need to know who owns it, what environment it belongs to, and who to contact. That information lives in a spreadsheet, not in the logs."

With lookup tables, you can enrich query results with external metadata. Upload a CSV once, and any query can reference it to add columns that do not exist in the original log event.

### Download the CSV file

This walkthrough maps account IDs to organizational context. Download the [`account-metadata.csv`](https://github.com/aws-samples/sample-cloudwatch-logs-advanced-analysis-environment/blob/main/assets/account-metadata.csv) file from this repository and save it to your computer.

### Upload the lookup table

Upload the CSV file as a lookup table named `account_metadata`:

1. Open the CloudWatch console.
2. In the navigation pane, choose **Settings**, and then choose the **Logs** tab.
3. Scroll to **Lookup tables** and choose **Manage**.
4. Choose **Create lookup table**.
5. Enter `account_metadata` as the table name.
6. Upload the `account-metadata.csv` file you downloaded earlier, then choose **Create lookup table**.

To verify the table is queryable, run the following query in Log Analytics. Replace `123456789012` with your AWS account number:

```text
SOURCE "arn:aws:logs:us-east-1:123456789012:log-group:/demo/security/api-activity" START=-10800s END=0s |
fields @timestamp, userIdentity_principalId, userIdentity_accountId, eventName
| filter ispresent(userIdentity_accountId)
| lookup account_metadata account_id as userIdentity_accountId OUTPUTNEW account_name, environment, owner
| fields @timestamp, userIdentity_principalId, userIdentity_accountId, account_name, environment, owner
| limit 10
```

If `account_name`, `environment`, and `owner` populate in the results, the table is working.

<img width="1510" height="741" alt="figure-04-lookup-query-results-cloudops-2335" src="https://github.com/user-attachments/assets/a8cf47a5-c9c6-424d-b1e4-b27fa8ce832b" />

*Figure 4: Lookup query results showing `account_name` and `owner` columns enriched from the CSV*

---

## Parameterized queries for reusable templates

> **Customer problem:** "I write the same query every time with different values. New team members do not know what queries to run. There is no shared library of useful queries."

With parameterized queries, you save a query template with `{{parameter_name}}` placeholders. When someone loads the saved query from the console, the parameters are replaced with default values that they can adjust before running. The query appears in the **Saved and sample queries** panel, discoverable by the whole team.

### Create a parameterized query

If you deployed the companion CDK stack, the `Security/PrincipalActivityAudit` query definition is already created. The command below shows what the stack deployed, so you can inspect or replicate it in your own environment.

This query shows all activity for a given principal, enriched with account metadata from the lookup table. The `{{principalId}}` parameter lets any team member run this query for any principal without rewriting it.

```text
SOURCE "/demo/security/api-activity" START=-604800s END=0s |
fields @timestamp, userIdentity_principalId, eventSource, eventName, sourceIPAddress, errorCode, userIdentity_accountId
| filter userIdentity_principalId = "{{principalId}}"
| lookup account_metadata account_id as userIdentity_accountId OUTPUTNEW account_name, environment, owner
| sort @timestamp desc
```

**Parameters**

| Parameter | Description | Default value |
|-----------|-------------|---------------|
| `principalId` | The principal ID to investigate | `AIDA1234567890EXAMPLE` |

To make this query available to your team, save it as a query definition using the following CLI command:

```bash
aws logs put-query-definition \
  --name "Security/PrincipalActivityAudit" \
  --log-group-names "/demo/security/api-activity" \
  --query-string 'fields @timestamp, userIdentity_principalId, eventSource, eventName, sourceIPAddress, errorCode, userIdentity_accountId | filter userIdentity_principalId = "{{principalId}}" | lookup account_metadata account_id as userIdentity_accountId OUTPUTNEW account_name, environment, owner | sort @timestamp desc' \
  --parameters '[{"name":"principalId","defaultValue":"AIDA1234567890EXAMPLE","description":"The principal ID to investigate"}]'
```

To see the saved query, open **Saved and sample queries** in the Log Analytics console, navigate to the **Security** folder, and choose `PrincipalActivityAudit`. The query loads with the `principalId` parameter input field pre-filled with the default value `AIDA1234567890EXAMPLE`.

<img width="1497" height="740" alt="figure-05-parameterized-query-input-cloudops-2335" src="https://github.com/user-attachments/assets/afc42985-bb2b-4817-9d4b-2e5f33cad485" />

*Figure 5: Saved parameterized query showing the `principalId` input field in the Log Analytics console*

Any team member can now open **Saved and sample queries**, find the **Security** folder, choose `PrincipalActivityAudit`, adjust the principal ID, and run it — no query writing required.

### Enable correlated anomaly data

The remaining sections (JOIN, sub-queries, and scheduled queries) correlate data across both log groups. For meaningful results, all three log generators need anomaly mode enabled so they produce correlated events from IP `198.51.100.42`. Run the following commands in [AWS CloudShell](https://aws.amazon.com/cloudshell/) in the same Region where you deployed the CDK stack.

```bash
aws lambda update-function-configuration \
  --function-name demo-anomaly-generator \
  --environment "Variables={API_LOG_GROUP=/demo/security/api-activity,ACCESS_LOG_GROUP=/demo/security/access-logs,ANOMALY_MODE=true}"
```

```bash
aws lambda update-function-configuration \
  --function-name demo-cloudtrail-generator \
  --environment "Variables={LOG_GROUP_NAME=/demo/security/api-activity,ANOMALY_MODE=true}"
```

```bash
aws lambda update-function-configuration \
  --function-name demo-access-log-generator \
  --environment "Variables={LOG_GROUP_NAME=/demo/security/access-logs,ANOMALY_MODE=true}"
```

Wait 5–10 minutes for correlated events to accumulate before proceeding to the JOIN section.

---

## JOIN for cross-log-group correlation

> **Customer problem:** "I need to see data from two log groups together. Right now, I run two separate queries and manually compare the results."

With JOIN, you can correlate events across log groups in a single query. The primary query runs against one log group. The JOIN pulls matching events from a second log group based on a shared field, such as an IP address, user ID, or request ID.

### Create a JOIN query

This query shows both what API calls were made and what application resources were accessed from a given IP, in one result set. Run the following in Log Analytics. Replace `123456789012` with your AWS account number:

```text
SOURCE "arn:aws:logs:us-east-1:123456789012:log-group:/demo/security/api-activity" START=-3600s END=0s |
fields @timestamp, userIdentity_principalId, eventSource, eventName, sourceIPAddress, errorCode
| join type=inner left=api right=access where api.sourceIPAddress=access.sourceIP (SOURCE "/demo/security/access-logs")
| filter api.sourceIPAddress = "198.51.100.42"
| fields api.@timestamp, api.eventName, api.eventSource, api.errorCode, access.userId, access.resource, access.action
| sort api.@timestamp desc
| limit 10
```

**Parameters**

| Parameter | Description | Default value |
|-----------|-------------|---------------|
| `suspiciousIP` | IP address to investigate across log sources | `198.51.100.42` |

Save this query as a reusable definition using the [`put-query-definition`](https://docs.aws.amazon.com/cli/latest/reference/logs/put-query-definition.html) CLI command:

```bash
aws logs put-query-definition \
  --name "Security/CrossSourceCorrelation" \
  --log-group-names "/demo/security/api-activity" \
  --query-string 'fields @timestamp, userIdentity_principalId, eventSource, eventName, sourceIPAddress, errorCode | join type=inner left=api right=access where api.sourceIPAddress=access.sourceIP (SOURCE "/demo/security/access-logs") | filter api.sourceIPAddress = "{{suspiciousIP}}" | fields api.@timestamp, api.eventName, api.eventSource, api.errorCode, access.userId, access.resource, access.action | sort api.@timestamp desc | limit 100' \
  --parameters '[{"name":"suspiciousIP","defaultValue":"198.51.100.42","description":"IP address to investigate across log sources"}]'
```

<img width="1511" height="739" alt="figure-06-join-correlation-cloudops-2335" src="https://github.com/user-attachments/assets/296a062e-5420-46fb-8fee-b0966d4d1c53" />

*Figure 6: JOIN results showing API calls and resource access correlated by source IP*

---

## Sub-queries for multi-step analysis

> **Customer problem:** "I want to find entities that match a condition in one log group, then look up their activity in another. This takes two queries today."

With sub-queries, the output of one query feeds into the filter of another. The inner query identifies a set of values (like principal IDs or service names), and the outer query uses those values to retrieve related data.

### Create a sub-query

This example finds principals with repeated access denied errors, then retrieves all their successful actions. Run the following in Log Analytics. Replace `123456789012` with your AWS account number:

```text
SOURCE "arn:aws:logs:us-east-1:123456789012:log-group:/demo/security/api-activity" START=-3600s END=0s |
filter userIdentity_principalId in (
    SOURCE "/demo/security/api-activity"
    | filter errorCode = "AccessDenied"
    | stats count(*) as denied_count by userIdentity_principalId
    | filter denied_count > 3
    | fields userIdentity_principalId
)
| filter errorCode != "AccessDenied"
| stats count(*) as successful_actions by userIdentity_principalId, eventSource, eventName
| sort successful_actions desc
```

**Parameters**

| Parameter | Description | Default value |
|-----------|-------------|---------------|
| `deniedThreshold` | Minimum denied actions to flag a principal | `3` |

Save this query as a reusable definition using the [`put-query-definition`](https://docs.aws.amazon.com/cli/latest/reference/logs/put-query-definition.html) CLI command:

```bash
aws logs put-query-definition \
  --name "Security/DeniedThenSucceeded" \
  --log-group-names "/demo/security/api-activity" \
  --query-string 'filter userIdentity_principalId in (SOURCE "/demo/security/api-activity" | filter errorCode = "AccessDenied" | stats count(*) as denied_count by userIdentity_principalId | filter denied_count > {{deniedThreshold}} | fields userIdentity_principalId) | filter errorCode != "AccessDenied" | stats count(*) as successful_actions by userIdentity_principalId, eventSource, eventName | sort successful_actions desc' \
  --parameters '[{"name":"deniedThreshold","defaultValue":"3","description":"Minimum denied actions to flag a principal"}]'
```

<img width="1497" height="740" alt="figure-07-subquery-results-cloudops-2335" src="https://github.com/user-attachments/assets/485f52bd-79b5-47c5-97ae-216c3b7547e2" />

*Figure 7: Sub-query results showing successful actions by principals who had repeated access denied errors*

---

## Scheduled queries for automated analysis

> **Customer problem:** "I want this query to run automatically on a schedule and alert me if it finds something. I should not have to open the console to check."

With scheduled queries, you run Log Analytics queries on a recurring cadence and deliver results to Amazon S3, Amazon EventBridge, or both. Scheduled queries support [CloudWatch Logs Insights QL](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CWL_AnalyzeLogData_LogsInsights.html), [OpenSearch PPL](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CWL_AnalyzeLogData_PPL.html), and [OpenSearch SQL](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CWL_AnalyzeLogData_SQL.html).

### Create a scheduled query

This example schedules a query that runs every 5 minutes and flags principals with repeated access denied errors. When it finds results, they land in Amazon S3. You can then configure an Amazon S3 event notification or use Amazon EventBridge to trigger downstream alerting.

The CDK stack does not create scheduled queries. Before creating one, retrieve the stack outputs you need for the CLI command:

```bash
aws cloudformation describe-stacks \
  --stack-name SecurityLogsInsightsStack \
  --query "Stacks[0].Outputs" \
  --output table
```

From the output, note the values for `ScheduledQueryRoleArn` (the execution-role ARN) and `ResultsBucketName` (the S3 path). Use these values to replace the corresponding placeholders in the following command:

```bash
aws logs create-scheduled-query \
  --name "ProactiveAccessDeniedDetection" \
  --query-language "CWLI" \
  --query-string 'fields @timestamp, userIdentity_principalId, eventSource, eventName, sourceIPAddress | filter errorCode = "AccessDenied" | stats count(*) as denied_count by userIdentity_principalId, sourceIPAddress | filter denied_count > 10 | sort denied_count desc' \
  --log-group-identifiers "/demo/security/api-activity" \
  --schedule-expression "cron(0/5 * * * ? *)" \
  --start-time-offset 600 \
  --execution-role-arn "<ScheduledQueryRoleArn>" \
  --destination-configuration '{"s3Configuration":{"destinationIdentifier":"s3://<ResultsBucketName>/scheduled-query-results","roleArn":"<ScheduledQueryRoleArn>"}}'
```

To verify, open the CloudWatch console and navigate to **Logs**, then **Log Analytics**. Select the **Scheduled Queries** icon, and in the pop-up window you will see `ProactiveAccessDeniedDetection`. Select it to view the scheduled details.

<img width="1494" height="648" alt="figure-08-scheduled-query-config-cloudops-2335" src="https://github.com/user-attachments/assets/c7a769ca-a677-4d12-8649-612625401b3b" />

*Figure 8: Scheduled query configuration in the CloudWatch console*

The execution role needs `logs:StartQuery`, `logs:GetQueryResults`, and `s3:PutObject` permissions. The schedule expression uses cron syntax; `cron(0/5 * * * ? *)` runs every 5 minutes.

### Weekly summary to Amazon S3

Optionally, you can also set up a weekly summary report that groups access denied events by principal and account and delivers the results to Amazon S3. This scheduled query is not created by the CDK stack. Run the following command, using the same stack output values you retrieved earlier for `<ScheduledQueryRoleArn>` and `<ResultsBucketName>`:

```bash
aws logs create-scheduled-query \
  --name "WeeklyAccessDeniedReport" \
  --query-language "CWLI" \
  --query-string 'fields @timestamp, userIdentity_principalId, userIdentity_accountId, eventSource, eventName, sourceIPAddress | filter errorCode = "AccessDenied" | stats count(*) as denied_count by userIdentity_principalId, userIdentity_accountId, eventSource | sort denied_count desc' \
  --log-group-identifiers "/demo/security/api-activity" \
  --schedule-expression "cron(0 8 ? * MON *)" \
  --start-time-offset 604800 \
  --execution-role-arn "<ScheduledQueryRoleArn>" \
  --destination-configuration '{"s3Configuration":{"destinationIdentifier":"s3://<ResultsBucketName>/weekly-reports","roleArn":"<ScheduledQueryRoleArn>"}}'
```

This runs every Monday at 08:00 UTC and scans the previous 7 days (604,800 seconds).

---

## Putting it together

The following example shows how the features compose. This is not a prescribed methodology — it is a demonstration of how facets, parameterized queries, lookup, JOIN and sub-queries, and scheduled queries work together in a single workflow.

<img width="1640" height="760" alt="figure-09-investigation-flow-cloudops-2335" src="https://github.com/user-attachments/assets/79c47fa9-dc78-4498-b2b5-005cf267f5c0" />

*Figure 9: Example workflow showing features used in combination*

**Scenario:** A scheduled query flags a principal with repeated access denied errors from an unfamiliar IP. An engineer investigates.

1. **Scheduled query (detection).** The scheduled query `ProactiveAccessDeniedDetection` runs its 5-minute cycle and flags principal `AIDA9876543210SUSPECT` with access denied errors from IP `198.51.100.42`. The results land in Amazon S3 and an EventBridge event notifies the team.
2. **Facets (triage).** The engineer opens CloudWatch Log Analytics and chooses the `/demo/security/api-activity` log group. The `errorCode` facet in the right panel shows elevated `AccessDenied` events. They choose the value to filter the results and identify which IPs and principals are involved.
3. **Parameterized query + lookup (audit).** The engineer opens the **Saved and sample queries** panel, navigates to the **Security** folder, and chooses `PrincipalActivityAudit`. The query loads with the `principalId` parameter pre-filled. They change it to the flagged principal and run the query. The results show all API calls by that principal, enriched with account name and environment from the lookup table.
4. **JOIN (correlate).** The engineer chooses `CrossSourceCorrelation` from the same **Saved and sample queries** panel. The query loads with the `suspiciousIP` parameter (the IP address to investigate across both log groups). They set it to the flagged IP and run the query. The results correlate API activity with application access logs from the same IP in a single view.
5. **Sub-query (scope).** The engineer chooses `DeniedThenSucceeded` from the **Saved and sample queries** panel. The query loads with the `deniedThreshold` parameter (the minimum number of denied actions to flag a principal). They set it to 3 and run the query. The results show what the flagged principal successfully accomplished after their denied attempts.

Each step builds on the previous one. In this example, the engineer did not write any queries from scratch. They used saved templates, adjusted parameters, and got enriched, correlated results.

---

## From templates to AI-assisted operations

The parameterized queries and workflows in this walkthrough are not just for human engineers running queries manually. They are structured, API-accessible building blocks that AI agents and automation tools can consume directly.

Each saved query definition has a name, parameters with descriptions, and a target log group. An AI agent can load a saved query by name and fill in the parameters based on an alert or user request. It then runs the query via the CloudWatch Logs API and interprets the results. The agent does not need to know the query syntax. It needs to know which query to run and what parameters to provide.

For example, in [Kiro](https://kiro.dev/) (an AI-powered development environment), you can create a skill. This skill contains your saved query names, parameter descriptions, investigation workflows, and syntax rules. When you ask Kiro to "investigate IP `198.51.100.42`," it knows to run `Security/CrossSourceCorrelation` with that parameter, interpret the correlated results, and suggest next steps. Other AI-assisted tools (ChatOps bots, custom automation, or any agent with access to the CloudWatch Logs API) can consume the same saved query definitions.

This is the progression from manual investigation to AIOps:

1. **Manual.** An engineer writes a query from scratch every time.
2. **Templated.** The team saves parameterized queries. Engineers select a template and fill in values.
3. **Automated.** Scheduled queries run on a cadence without human intervention.
4. **AI-assisted.** An engineer asks an AI-powered tool (like Kiro) to investigate a principal or IP. The tool knows which saved query to run, fills in the parameters, executes it, and presents the results with context.

The features in this walkthrough get you from step 1 to step 3. The saved query definitions, lookup tables, and structured workflows you create become the "skills" that an AI agent can use at step 4. The investment in building reusable templates pays off twice: once for your team today and again when you integrate AI-assisted tooling.

---

## Cost considerations

CloudWatch Log Analytics charges you based on the amount of data each query scans. For current pricing, see [Amazon CloudWatch pricing](https://aws.amazon.com/cloudwatch/pricing/).

**Optimization tips**

- Place `filter` commands as early as possible in your query to reduce the amount of data scanned. For JOIN queries, place the filter after the JOIN using the aliased field name (for example, `filter api.sourceIPAddress = "value"`).
- JOIN scans both the primary log group and the SOURCE log group. Use specific field selections in the initial `fields` command to limit what gets processed.
- Lookup table data does not count toward scanned data charges.
- Use `stats` to aggregate before joining rather than joining raw events.
- For scheduled queries, set `start-time-offset` to the minimum window that provides reliable detection.
- Field indexes can speed up queries and can reduce costs by skipping log events that do not match the indexed field. Index only fields you will actively use as facets or filter on frequently. For more information, see [Create field indexes to improve query performance and reduce costs](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CloudWatchLogs-Field-Indexing.html).
- Parameterized templates encourage targeted, filtered queries instead of broad exploratory scans, reducing total scan costs over time.

---

## Cleaning up

To avoid ongoing charges from the resources created in this walkthrough, remove the following. The companion CDK stack generates continuous log data, which incurs CloudWatch Logs ingestion and storage charges for as long as it remains deployed.

- If you deployed the example environment using the CDK companion stack, run `npx cdk destroy` to remove the stack resources (log groups, Lambda functions, index policies, sample data generators, and the `PrincipalActivityAudit` query definition).

  > ⚠️ **This action is irreversible and deletes all log data in the stack-created log groups.**

Delete the following resources that you created manually during the walkthrough:

- **Lookup tables.** Remove the `account_metadata` lookup table through the CloudWatch console. For instructions, see [Creating and managing lookup tables](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CWL_QuerySyntax-Lookup.html).
- **Scheduled queries.** Delete `ProactiveAccessDeniedDetection` and `WeeklyAccessDeniedReport`. To find the query IDs, run the following command, then delete each with the scheduled query ID. For more information, see [Automating log analysis with scheduled queries](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/ScheduledQueries.html).

  ```bash
  aws logs describe-scheduled-queries
  aws logs delete-scheduled-query --scheduled-query-id <query-id>
  ```

---

## Conclusion

This walkthrough covered each new CloudWatch Log Analytics capability with working examples, showing the customer problem each one solves:

1. **Facets** let engineers explore log patterns visually without writing queries.
2. **Lookup tables** enrich results with organizational context that lives outside your logs.
3. **Parameterized queries** turn ad-hoc queries into reusable, shareable templates.
4. **JOIN and sub-queries** correlate data across log groups and chain multi-step analysis together without manual copy-paste between queries.
5. **Scheduled queries** automate recurring analysis and deliver results without anyone opening the console.

These capabilities support Stage 3 (Advanced Observability) of the [AWS Observability Maturity Model](https://aws-observability.github.io/observability-best-practices/guides/observability-maturity-model/), where teams correlate signals across sources and detect anomalies with contextual enrichment. They complement CloudWatch Metrics and Alarms (for known thresholds), distributed tracing with AWS X-Ray (for cross-service request correlation), and Amazon GuardDuty (for automated threat detection).

To get started, create an index policy on one of your log groups and explore the facets that appear. From there, save your first parameterized query and share it with your team.

---

## Additional resources

- [AWS Observability Maturity Model](https://aws-observability.github.io/observability-best-practices/guides/observability-maturity-model/)
- [Amazon CloudWatch Logs Insights query syntax](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CWL_QuerySyntax.html)
- [Save and re-run Logs Insights queries](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CWL_Insights-Saving-Queries.html)
- [CloudWatch Logs lookup tables](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CWL_QuerySyntax-Lookup.html)
- [CloudWatch Logs Insights JOIN command](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CWL_QuerySyntax-Join.html)
- [CloudWatch Logs Insights sub-queries](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CWL_QuerySyntax-Subqueries.html)
- [CloudWatch Logs scheduled queries](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/ScheduledQueries.html)
- [CloudWatch Logs facets](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CloudWatchLogs-Facets.html)
- [Amazon CloudWatch pricing](https://aws.amazon.com/cloudwatch/pricing/)

---

## Security

See [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications) for more information.

## License

This library is licensed under the MIT-0 License. See the [LICENSE](LICENSE) file.
