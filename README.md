# Advanced log analysis with facets, correlation, enrichment, and automation in Amazon CloudWatch Logs Insights

## Introduction

Teams working with distributed applications accumulate logs across multiple log groups, including application logs, access logs, and audit trails. When something needs investigating, an engineer opens the console and starts writing queries from scratch. The same query gets written differently by different people. The results lack context because the log event does not contain who owns the service or what environment it belongs to. Checking two log groups means running two separate queries and manually comparing results. And when the investigation is done, the query disappears from the console history. These are common friction points when working with logs at scale. [Amazon CloudWatch Logs Insights](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/AnalyzingLogData.html) now includes capabilities that address them directly.

1. **Facets** for exploring log data visually without writing a query.
2. **Lookup tables** for enriching query results with external metadata.
3. **Parameterized queries** for saving reusable templates with fill-in variables.
4. **JOIN and sub-queries** for correlating data across log groups in a single query.
5. **Scheduled queries** for running queries automatically and delivering results to [Amazon Simple Storage Service (Amazon S3)](https://aws.amazon.com/s3/) or [Amazon EventBridge.](https://aws.amazon.com/eventbridge/)

In this post, we walk through each capability with working examples. We show the customer problem each one solves, how to set it up, and how to save it for your team. At the end, we combine them in a short example to show how they compose together. We also discuss how these reusable templates integrate with [AI-assisted operations (AIOps)](https://aws.amazon.com/what-is/aiops/) workflows.

## Where these features fit in your observability strategy

The [AWS Observability Maturity Model](https://aws-observability.github.io/observability-best-practices/guides/observability-maturity-model/) defines four stages of observability maturity. The features in this post support Stage 3 (Advanced Observability), where teams correlate signals across sources, detect anomalies, and gain contextual understanding of issues. They complement the tools you use at earlier stages.

| Stage | Focus | AWS tools |
| --- | --- | --- |
| Stage 1: Foundational | Collecting telemetry (metrics, logs, traces) | [Amazon CloudWatch Metrics](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/working_with_metrics.html), [Amazon CloudWatch Logs](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/WhatIsCloudWatchLogs.html), [AWS X-Ray](https://aws.amazon.com/xray/) |
| Stage 2: Intermediate | Analysis, alerting, visualization | [Amazon CloudWatch Alarms](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Alarms.html), [Amazon CloudWatch Dashboards](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Dashboards.html), [Amazon GuardDuty](https://aws.amazon.com/guardduty/) |
| Stage 3: Advanced | Cross-signal correlation, contextual enrichment, anomaly detection | Amazon CloudWatch Logs Insights (JOIN, sub-queries, lookup, parameterized queries, scheduled queries) |
| Stage 4: Proactive | AI/ML-driven root cause, automated remediation | [Amazon CloudWatch Anomaly Detection](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Anomaly_Detection.html) |

At Stage 3, teams move beyond individual metrics and traces to correlate data across multiple sources with custom logic. The features in this post facilitate that correlation within your log data.

For cross-service request tracing, use AWS X-Ray or OpenTelemetry. For automated threat detection, use Amazon GuardDuty. The Logs Insights features covered here are for custom log analysis that spans multiple log groups. They apply your organization's business rules and produce reusable templates your team can share.

## Prerequisites

To follow this walkthrough, you need:

- An [AWS account](https://signin.aws.amazon.com/signin?redirect_uri=https%3A%2F%2Fportal.aws.amazon.com%2Fbilling%2Fsignup%2Fresume&client_id=signup) with structured logs flowing to at least two [Amazon CloudWatch](https://aws.amazon.com/cloudwatch/) log groups (we use `/demo/security/api-activity` and `/demo/security/access-logs` in our examples).
- [AWS Identity and Access Management (IAM)](https://aws.amazon.com/iam/) permissions for the following actions: `logs:PutQueryDefinition`, `logs:StartQuery`, `logs:DescribeQueryDefinitions`, `logs:GetQueryResults`, `logs:PutIndexPolicy`, `logs:DeleteQueryDefinition`, `logs:DeleteIndexPolicy`
- [AWS CLI](https://aws.amazon.com/cli/) version 2.34.56 or later installed and configured.
- [Node.js](https://nodejs.org/) 18 or later and [AWS Cloud Development Kit (AWS CDK)](https://aws.amazon.com/cdk/) version 2.100 or later installed.
- Basic familiarity with [CloudWatch Logs Insights query syntax](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CWL_QuerySyntax.html) (fields, filter, stats, sort).

To deploy the example environment with sample log data, we provide a companion CDK stack in the [sample-cloudwatch-logs-advanced-analysis-environment GitHub repository](https://github.com/aws-samples/sample-cloudwatch-logs-advanced-analysis-environment).

The stack creates both log groups (`/demo/security/api-activity` and `/demo/security/access-logs`) and pushes sample events matching the schemas used in this post. Clone the repository and deploy the stack using the following commands.

```bash
git clone https://github.com/aws-samples/sample-cloudwatch-logs-advanced-analysis-environment.git
cd sample-cloudwatch-logs-advanced-analysis-environment
npm install
npx cdk bootstrap
npx cdk deploy
```

The `cdk bootstrap` command is required only once per account and region. After the stack deploys successfully (approximately 5 minutes), the log groups begin receiving sample events. Wait 2–3 minutes for log data to accumulate before running the queries in this post.

Set your Region for this terminal session so you can omit `--region` from the CLI commands that follow:

```bash
export AWS_REGION=<your-region>
```

Replace `<your-region>` with the region where you deployed the CDK stack. This variable persists for the current terminal session only.

Alternatively, if you already have structured logs flowing to CloudWatch, you can skip the deployment and use your own log groups throughout the walkthrough.

## Example environment

Figure 1 shows the example environment we use throughout this post. In our example, we have two log groups.

- The first (`/demo/security/api-activity`) contains API activity events with fields like `eventSource`, `eventName`, `sourceIPAddress`, `errorCode`, and `userIdentity_principalId`.
- The second (`/demo/security/access-logs`) contains application access logs with fields like `userId`, `resource`, `action`, and `sourceIP`.
- A lookup table (which you will create in the Lookup tables section) maps account IDs to organizational metadata.

<!-- TODO: add Figure 1 image -->
![Figure 1: Example environment showing log sources, key fields, and lookup table](images/figure-01-architecture.png)

*Figure 1: Example environment showing log sources, key fields, and lookup table*

## Facets for visual exploration

**Customer problem:** "I want to see what patterns exist in my logs before I write a query. I do not know what to filter on yet."

With facets, you first run a query to load log events, and CloudWatch Logs Insights displays interactive facets in the right panel based on your indexed fields. Each facet shows the distribution of values for that field. You can select a facet value to add it as a filter, then run the query again to see only the matching results.

### Explore logs with facets

To explore your logs with facets, follow these steps:

1. Open the CloudWatch console and under Logs, select Logs Insights.
2. Select the `/demo/security/api-activity` log group.
3. Set the time range to Last 1 hour.
4. Run a query that returns the fields you want to explore. For example:

   ```
   fields @timestamp, eventSource, eventName, errorCode, sourceIPAddress
   | sort @timestamp desc
   | limit 50
   ```

5. In the right facet panel, find `errorCode`. You should see a distribution of values, including `AccessDenied` with a count. Choose `AccessDenied` to add it as a filter.
6. Run the query again. The results now show only events where `errorCode` is `AccessDenied`, displaying the correlated `sourceIPAddress` values for each denied request.

Figure 2 shows the `errorCode` facet filtered to `AccessDenied`, with the results displaying the correlated `sourceIPAddress` values.

<!-- TODO: add Figure 2 image -->
![Figure 2: Facets showing errorCode distribution with AccessDenied selected as a filter](images/figure-02-facets-errorcode-distribution.png)

*Figure 2: Facets showing `errorCode` distribution with `AccessDenied` selected as a filter*

### Default facets

Every log group includes four default facets.

- `@aws.region`, the AWS Region that generated the log event
- `@data_source_name`, the log group name
- `@data_source_type`, the log source type (for example, Lambda, ECS, EC2)
- `@data_format`, the log data format

These work out of the box. No configuration required. Figure 3 shows how the default facets appear in the Logs Insights console before any custom index policies are applied.

<!-- TODO: add Figure 3 image -->
![Figure 3: Default facets panel showing @aws.region, @data_source_name, @data_source_type, and @data_format](images/figure-03-default-facets.png)

*Figure 3: Default facets panel showing `@aws.region`, `@data_source_name`, `@data_source_type`, and `@data_format`*

### Creating custom facets using index policies

If you deployed the companion CDK stack, the index policies for (`/demo/security/api-activity` and `/demo/security/access-logs`) are already in place. The commands below show what the stack created, so you can inspect or replicate them in your own environment.

Default facets are useful but generic. For your application logs, you want facets on fields that matter to your team. You define index policies per log group, so create one for each of your two log groups with fields relevant to their content. For the API activity log group, we index fields like `eventSource`, `eventName`, `errorCode`, and `sourceIPAddress`.

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

For the access logs group, we index fields useful for tracking who accessed what.

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

After a few minutes, these fields appear as selectable facets in the Logs Insights console. An engineer can run a query, then chooses `errorCode` in the right facet panel to see the distribution of values. Selecting a specific value like `AccessDenied` adds it as a filter. Running the query again returns only matching events, without the engineer needing to manually rewrite the query syntax.

### Best practice for facet field selection

Index policies work best on low-cardinality fields. Facets with more than 100 unique values each day are classified as high-cardinality, and their values are not displayed in the console. In our example, we chose `eventSource`, `errorCode`, and `userIdentity_accountId` because they have a small number of distinct values and are useful for visual exploration. For more information on facet field selection, see [Use facets to group and explore logs](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CloudWatchLogs-Facets.html).

## Lookup tables for contextual enrichment

**Customer problem:** "My log events contain a service name or account ID, but I need to know who owns it, what environment it belongs to, and who to contact. That information lives in a spreadsheet, not in the logs."

With lookup tables, you can enrich query results with external metadata. Upload a CSV once, and any query can reference it to add columns that do not exist in the original log event.

### Downloading the CSV file

In our example, we map account IDs to organizational context. Download the `account-metadata.csv` file from the [companion GitHub repository](https://github.com/aws-samples/sample-cloudwatch-logs-advanced-analysis-environment/blob/main/assets/account-metadata.csv) and save it to your computer.

### Uploading the lookup table

Upload the CSV file as a lookup table named `account_metadata` using the following steps:

1. Open the CloudWatch console and under Logs, select Logs Insights.
2. Choose the lightbulb icon, then choose Lookup tables, then Manage lookup tables.
3. Choose Create lookup table.
4. Enter `account_metadata` as the table name.
5. Upload the `account-metadata.csv` file you downloaded earlier, then choose Create.

You can verify the table is queryable. In Logs Insights, select `/demo/security/api-activity` and set the time range to Last 1 hour. Run the following query:

```
fields @timestamp, userIdentity_principalId, userIdentity_accountId, eventName
| filter ispresent(userIdentity_accountId)
| lookup account_metadata account_id as userIdentity_accountId OUTPUTNEW account_name, environment, owner
| fields @timestamp, userIdentity_principalId, userIdentity_accountId, account_name, environment, owner
| limit 10
```

If `account_name`, environment, and owner populate in the results, the table is working. Figure 4 shows the query output with the enriched organizational columns alongside the original log fields.

<!-- TODO: add Figure 4 image -->
![Figure 4: Lookup query results showing account_name and owner columns enriched from the CSV](images/figure-04-lookup-query-results.png)

*Figure 4: Lookup query results showing `account_name` and owner columns enriched from the CSV*

## Parameterized queries for reusable templates

**Customer problem:** "I write the same query every time with different values. New team members do not know what queries to run. There is no shared library of useful queries."

With parameterized queries, you save a query template with `{{parameter_name}}` placeholders. When someone loads the saved query from the console, the parameters are replaced with default values that they can adjust before running. The query appears in the Saved and sample queries panel, discoverable by the whole team.

### Creating a parameterized query

If you deployed the companion CDK stack, the `Security/PrincipalActivityAudit` query definition is already created. The command below shows what the stack deployed, so you can inspect or replicate it in your own environment.

In our example, we create a query that shows all activity for a given principal, enriched with account metadata from the lookup table. The `{{principalId}}` parameter lets any team member run this query for any principal without rewriting it.

```
fields @timestamp, userIdentity_principalId, eventSource, eventName, sourceIPAddress, errorCode, userIdentity_accountId
| filter userIdentity_principalId = "{{principalId}}"
| lookup account_metadata account_id as userIdentity_accountId OUTPUTNEW account_name, environment, owner
| sort @timestamp desc
```

**Parameters**

| Parameter | Description | Default value |
| --- | --- | --- |
| `principalId` | The principal ID to investigate | `AIDA1234567890EXAMPLE` |

To make this query available to your team, save it as a query definition using the following CLI command.

```bash
aws logs put-query-definition \
  --name "Security/PrincipalActivityAudit" \
  --log-group-names "/demo/security/api-activity" \
  --query-string 'fields @timestamp, userIdentity_principalId, eventSource, eventName, sourceIPAddress, errorCode, userIdentity_accountId | filter userIdentity_principalId = "{{principalId}}" | lookup account_metadata account_id as userIdentity_accountId OUTPUTNEW account_name, environment, owner | sort @timestamp desc' \
  --parameters '[{"name":"principalId","defaultValue":"AIDA1234567890EXAMPLE","description":"The principal ID to investigate"}]'
```

To see the saved query, open Saved and sample queries in the Logs Insights console, navigate to the Security folder, and choose `PrincipalActivityAudit`. The query loads with the `principalId` parameter input field pre-filled with the default value `AIDA1234567890EXAMPLE`. Figure 5 shows this view.

<!-- TODO: add Figure 5 image -->
![Figure 5: Saved parameterized query showing the principalId input field in the Logs Insights console](images/figure-05-parameterized-query-input.png)

*Figure 5: Saved parameterized query showing the `principalId` input field in the Logs Insights console*

Any team member can now open Saved and sample queries, find the Security folder, choose `PrincipalActivityAudit`, adjust the principal ID, and run it. No query writing required.

### Enabling correlated anomaly data

The remaining sections (JOIN, Sub-queries, and Scheduled queries) correlate data across both log groups. For meaningful results, all three log generators need anomaly mode enabled so they produce correlated events from IP `198.51.100.42`. Run the following commands in [AWS CloudShell](https://aws.amazon.com/cloudshell/) in the same Region as you have deployed the CDK stack.

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

## JOIN for cross-log-group correlation

**Customer problem:** "I need to see data from two log groups together. Right now, I run two separate queries and manually compare the results."

With JOIN, you can correlate events across log groups in a single query. The primary query runs against one log group. The JOIN pulls matching events from a second log group based on a shared field, such as an IP address, user ID, or request ID.

### Creating a JOIN query

This shows both what API calls were made and what application resources were accessed from a given IP, in one result set. In Logs Insights, select `/demo/security/api-activity` and set the time range to Last 1 hour. Run the following query:

```
fields @timestamp, userIdentity_principalId, eventSource, eventName, sourceIPAddress, errorCode
| join type=inner left=api right=access where api.sourceIPAddress=access.sourceIP (SOURCE "/demo/security/access-logs")
| filter api.sourceIPAddress = "198.51.100.42"
| fields api.@timestamp, api.eventName, api.eventSource, api.errorCode, access.userId, access.resource, access.action
| sort api.@timestamp desc
| limit 10
```

**Parameters**

| Parameter | Description | Default value |
| --- | --- | --- |
| `suspiciousIP` | IP address to investigate across log sources | `198.51.100.42` |

Save this query as a reusable definition using the [put-query-definition](https://docs.aws.amazon.com/cli/latest/reference/logs/put-query-definition.html) CLI command.

```bash
aws logs put-query-definition \
  --name "Security/CrossSourceCorrelation" \
  --log-group-names "/demo/security/api-activity" \
  --query-string 'fields @timestamp, userIdentity_principalId, eventSource, eventName, sourceIPAddress, errorCode | join type=inner left=api right=access where api.sourceIPAddress=access.sourceIP (SOURCE "/demo/security/access-logs") | filter api.sourceIPAddress = "{{suspiciousIP}}" | fields api.@timestamp, api.eventName, api.eventSource, api.errorCode, access.userId, access.resource, access.action | sort api.@timestamp desc | limit 100' \
  --parameters '[{"name":"suspiciousIP","defaultValue":"198.51.100.42","description":"IP address to investigate across log sources"}]'
```

Figure 6 shows the JOIN results in the console. Each row displays the API call alongside the corresponding application access event from the same IP.

<!-- TODO: add Figure 6 image -->
![Figure 6: JOIN results showing API calls and resource access correlated by source IP](images/figure-06-join-correlation.png)

*Figure 6: JOIN results showing API calls and resource access correlated by source IP*

## Sub-queries for multi-step analysis

**Customer problem:** "I want to find entities that match a condition in one log group, then look up their activity in another. This takes two queries today."

With sub-queries, the output of one query feeds into the filter of another. The inner query identifies a set of values (like principal IDs or service names), and the outer query uses those values to retrieve related data.

### Creating a sub-query

In our example, we find principals with repeated access denied errors, then retrieve all their successful actions. In Logs Insights, select `/demo/security/api-activity` and set the time range to Last 1 hour. Run the following query:

```
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
| --- | --- | --- |
| `deniedThreshold` | Minimum denied actions to flag a principal | 3 |

Save this query as a reusable definition using the [put-query-definition](https://docs.aws.amazon.com/cli/latest/reference/logs/put-query-definition.html) CLI command.

```bash
aws logs put-query-definition \
  --name "Security/DeniedThenSucceeded" \
  --log-group-names "/demo/security/api-activity" \
  --query-string 'filter userIdentity_principalId in (SOURCE "/demo/security/api-activity" | filter errorCode = "AccessDenied" | stats count(*) as denied_count by userIdentity_principalId | filter denied_count > {{deniedThreshold}} | fields userIdentity_principalId) | filter errorCode != "AccessDenied" | stats count(*) as successful_actions by userIdentity_principalId, eventSource, eventName | sort successful_actions desc' \
  --parameters '[{"name":"deniedThreshold","defaultValue":"3","description":"Minimum denied actions to flag a principal"}]'
```

Figure 7 shows the sub-query results. The inner query identified principals with repeated denied actions, and the outer query shows their successful API calls.

<!-- TODO: add Figure 7 image -->
![Figure 7: Sub-query results showing successful actions by principals who had repeated access denied errors](images/figure-07-subquery-results.png)

*Figure 7: Sub-query results showing successful actions by principals who had repeated access denied errors*

## Scheduled queries for automated analysis

**Customer problem:** "I want this query to run automatically on a schedule and alert me if it finds something. I should not have to open the console to check."

With scheduled queries, you run Logs Insights queries on a recurring cadence and deliver results to Amazon S3, Amazon EventBridge, or both. Scheduled queries support [CloudWatch Logs Insights QL](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CWL_AnalyzeLogData_LogsInsights.html), [OpenSearch PPL](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CWL_AnalyzeLogData_PPL.html), and [OpenSearch SQL](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CWL_AnalyzeLogData_SQL.html).

### Creating a scheduled query

In our example, we schedule a query that runs every 5 minutes and flags principals with repeated access denied errors. When it finds results, they land in Amazon S3. You can then configure an Amazon S3 event notification or use Amazon EventBridge to trigger downstream alerting.

The CDK stack does not create scheduled queries. Before creating one, retrieve the stack outputs you need for the CLI command. Run the following command:

```bash
aws cloudformation describe-stacks \
  --stack-name SecurityLogsInsightsStack \
  --query "Stacks[0].Outputs" \
  --output table
```

From the output, note the values for `ScheduledQueryRoleArn` (the execution-role ARN) and `ResultsBucketName` (the S3 path). Use these values to replace the corresponding placeholders in the following CLI command:

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

To verify, open the CloudWatch console, navigate to Logs, then Logs Insights. Choose the down arrow on the Schedule query button and select View scheduled queries. In the Scheduled queries section, select `ProactiveAccessDeniedDetection` to view the schedule details, as shown in Figure 8.

<!-- TODO: add Figure 8 image -->
![Figure 8: Scheduled query configuration in the CloudWatch console](images/figure-08-scheduled-query-config.png)

*Figure 8: Scheduled query configuration in the CloudWatch console*

The execution role needs `logs:StartQuery`, `logs:GetQueryResults`, and `s3:PutObject` permissions. The schedule expression uses cron syntax, `cron(0/5 * * * ? *)` runs every 5 minutes.

### Weekly summary to Amazon S3

Optionally, you can also set up a weekly summary report that groups access denied events by principal and account and delivers the results to Amazon S3. This scheduled query is not created by the CDK stack. Run the following command, using the same stack output values you retrieved earlier for `<ScheduledQueryRoleArn>`, and `<ResultsBucketName>`:

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

## Putting it together

Figure 9 shows how the features are composed. This is not a prescribed methodology. It is a demonstration of how facets, parameterized queries, lookup, JOIN and sub-queries, and scheduled queries work together in a single workflow.

<!-- TODO: add Figure 9 image -->
![Figure 9: Example workflow showing features used in combination](images/figure-09-investigation-flow.png)

*Figure 9: Example workflow showing features used in combination*

**Scenario:** A scheduled query flags a principal with repeated access denied errors from an unfamiliar IP. An engineer investigates.

1. **Scheduled query (detection).** The scheduled query `ProactiveAccessDeniedDetection` runs its 5-minute cycle and flags principal `AIDA9876543210SUSPECT` with access denied errors from IP `198.51.100.42`. The results land in Amazon S3 and an EventBridge event notifies the team.
2. **Facets (triage).** The engineer opens CloudWatch Logs Insights and chooses the `/demo/security/api-activity` log group. The `errorCode` facet in the right panel shows elevated `AccessDenied` events. They choose the value to filter the results and identify which IPs and principals are involved.
3. **Parameterized query + lookup (audit).** The engineer opens the Saved and sample queries panel, navigates to the Security folder, and chooses `PrincipalActivityAudit`. The query loads with the `principalId` parameter pre-filled. They change it to the flagged principal and run the query. The results show all API calls by that principal, enriched with account name and environment from the lookup table.
4. **JOIN (correlate).** The engineer chooses `CrossSourceCorrelation` from the same Saved and sample queries panel. The query loads with the `suspiciousIP` parameter (the IP address to investigate across both log groups). They set it to the flagged IP and run the query. The results correlate API activity with application access logs from the same IP in a single view.
5. **Sub-query (scope).** The engineer chooses `DeniedThenSucceeded` from the Saved and sample queries panel. The query loads with the `deniedThreshold` parameter (the minimum number of denied actions to flag a principal). They set it to 3 and run the query. The results show what the flagged principal successfully accomplished after their denied attempts.

Each step builds on the previous one. In this example, the engineer did not write any queries from scratch. They used saved templates, adjusted parameters, and got enriched, correlated results.

## From templates to AI-assisted operations

The parameterized queries and workflows we built in this post are not just for human engineers running queries manually. They are structured, API-accessible building blocks that AI agents and automation tools can consume directly.

Each saved query definition has a name, parameters with descriptions, and a target log group. An AI agent can load a saved query by name and fill in the parameters based on an alert or user request. It then runs the query via the CloudWatch Logs API and interprets the results. The agent does not need to know the query syntax. It needs to know which query to run and what parameters to provide.

For example, in [Kiro](https://kiro.dev/) (an AI-powered development environment), you can create a skill. This skill contains your saved query names, parameter descriptions, investigation workflows, and syntax rules. When you ask Kiro to "investigate IP `198.51.100.42`," it knows to run `Security/CrossSourceCorrelation` with that parameter, interpret the correlated results, and suggest the next steps. Other AI-assisted tools (ChatOps bots, custom automation, or any agent with access to the CloudWatch Logs API) can consume the same saved query definitions.

This is the progression from manual investigation to AIOps.

1. **Manual.** An engineer writes a query from scratch every time.
2. **Templated.** The team saves parameterized queries. Engineers select a template and fill in values.
3. **Automated.** Scheduled queries run on a cadence without human intervention.
4. **AI-assisted.** An engineer asks an AI-powered tool (like Kiro) to investigate a principal or IP. The tool knows which saved query to run, fills in the parameters, executes it, and presents the results with context.

The features in this post get you from step 1 to step 3. The saved query definitions, lookup tables, and structured workflows you create become the "skills" that an AI agent can use at step 4. The investment in building reusable templates pays off twice, once for your team today and again when you integrate AI-assisted tooling.

## Cost considerations

CloudWatch Logs Insights charges you based on the amount of data each query scans. For current pricing, see [Amazon CloudWatch pricing](https://aws.amazon.com/cloudwatch/pricing/).

**Optimization tips**

- Place filter commands as early as possible in your query to reduce the amount of data scanned. For JOIN queries, place the filter after the JOIN using the aliased field name (for example, filter `api.sourceIPAddress = "value"`).
- JOIN scans both the primary log group and the SOURCE log group. Use specific field selections in the initial fields command to limit what gets processed.
- Lookup table data does not count toward scanned data charges.
- Use stats to aggregate before joining rather than joining raw events.
- For scheduled queries, set start-time-offset to the minimum window that provides reliable detection.
- Field indexes can speed up queries and can reduce costs by skipping log events that do not match the indexed field. Index only fields you will actively use as facets or filter on frequently. For more information, see [Create field indexes to improve query performance and reduce costs](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CloudWatchLogs-Field-Indexing.html).
- Parameterized templates encourage targeted, filtered queries instead of broad exploratory scans, reducing total scan costs over time.

## Cleaning up

To avoid ongoing charges from the resources created in this walkthrough, remove the following. The companion CDK stack generates continuous log data, which incurs CloudWatch Logs ingestion and storage charges for as long as it remains deployed.

- If you deployed the example environment using the CDK companion stack, run `npx cdk destroy` to remove the stack resources (log groups, Lambda functions, index policies, sample data generators, and the `PrincipalActivityAudit` query definition). This action is irreversible and deletes all log data in the stack-created log groups.

Delete the following resources that you created manually during the walkthrough.

- **Lookup tables.** Remove the `account_metadata` lookup table through the CloudWatch console. For instructions, see [Creating and managing lookup tables](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CWL_QuerySyntax-Lookup.html).
- **Scheduled queries.** Delete `ProactiveAccessDeniedDetection` and `WeeklyAccessDeniedReport`. To find the query IDs, run the following command, then delete each with the scheduled query ID. For more information, see [Automating log analysis with scheduled queries](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/ScheduledQueries.html).
  - `aws logs describe-scheduled-queries`
  - `aws logs delete-scheduled-query --scheduled-query-id <query-id>`

## Conclusion

We walked through each new CloudWatch Logs Insights capability with working examples, showing the customer problem each one solves.

1. **Facets** let engineers explore log patterns visually without writing queries.
2. **Lookup tables** enrich results with an organizational context that lives outside your logs.
3. **Parameterized queries** turn ad-hoc queries into reusable, shareable templates.
4. **JOIN and sub-queries** correlate data across log groups and chain multi-step analysis together without manual copy-paste between queries.
5. **Scheduled queries** automate recurring analysis and deliver results without anyone opening the console.

These capabilities support Stage 3 (Advanced Observability) of the [AWS Observability Maturity Model](https://aws-observability.github.io/observability-best-practices/guides/observability-maturity-model/), where teams correlate signals across sources and detect anomalies with contextual enrichment. They complement CloudWatch Metrics and Alarms (for known thresholds), distributed tracing with AWS X-Ray (for cross-service request correlation), and Amazon GuardDuty (for automated threat detection).

To get started, create an index policy on one of your log groups and explore the facets that appear. From there, save your first parameterized query and share it with your team. For more information, see the following resources.

### Additional resources

- [AWS Observability Maturity Model](https://aws-observability.github.io/observability-best-practices/guides/observability-maturity-model/)
- [Amazon CloudWatch Logs Insights query syntax](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CWL_QuerySyntax.html)
- [Save and re-run Logs Insights queries](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CWL_Insights-Saving-Queries.html)
- [CloudWatch Logs lookup tables](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CWL_QuerySyntax-Lookup.html)
- [CloudWatch Logs Insights JOIN command](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CWL_QuerySyntax-Join.html)
- [CloudWatch Logs Insights sub-queries](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CWL_QuerySyntax-Subqueries.html)
- [CloudWatch Logs scheduled queries](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/ScheduledQueries.html)
- [CloudWatch Logs facets](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CloudWatchLogs-Facets.html)
- [Amazon CloudWatch pricing](https://aws.amazon.com/cloudwatch/pricing/)
