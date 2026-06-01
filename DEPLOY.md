# Deployment walkthrough

These steps deploy the demo environment and prepare it for the investigation scenario in
the blog post.

> **Cost consideration:** This deployment creates resources that incur ongoing AWS
> charges, including Lambda functions that run every minute, CloudWatch Logs storage, S3
> storage, and EventBridge schedules. Complete the cleanup steps in section 8 when you
> are finished to avoid unnecessary charges.

## 1. Configure AWS credentials

Configure the AWS CLI for the account and region you want to deploy into. For example:

```bash
aws configure
# or, with IAM Identity Center (SSO):
aws configure sso
```

Confirm you are pointed at the right account:

```bash
aws sts get-caller-identity
```

All examples use `us-east-1`. Set your region with `export AWS_REGION=us-east-1` (or pass
`--region us-east-1` on each command).

## 2. Deploy the CDK stack

```bash
npm install
npx cdk bootstrap        # first time only, per account/region
npx cdk deploy
```

## 3. Wait for logs (about 15 minutes)

The generator Lambda functions run every 1 minute. Wait roughly 15 minutes so enough
sample data accumulates for the facets and queries to be meaningful.

## 4. Upload the lookup table

Upload `assets/account-metadata.csv` as a lookup table named `account_metadata` through
the CloudWatch console (Logs → Settings → Lookup tables → Create). The saved queries
reference this table by name for enrichment.

## 5. Enable anomaly mode (for the investigation screenshots)

This makes the generators emit the suspicious patterns (compromised principal,
privilege-escalation attempts, off-hours access) used in the post.

```bash
aws lambda update-function-configuration \
  --function-name demo-anomaly-generator \
  --environment "Variables={API_LOG_GROUP=/demo/security/api-activity,ACCESS_LOG_GROUP=/demo/security/access-logs,ANOMALY_MODE=true}" \
  --region us-east-1

aws lambda update-function-configuration \
  --function-name demo-cloudtrail-generator \
  --environment "Variables={LOG_GROUP_NAME=/demo/security/api-activity,ANOMALY_MODE=true}" \
  --region us-east-1

aws lambda update-function-configuration \
  --function-name demo-access-log-generator \
  --environment "Variables={LOG_GROUP_NAME=/demo/security/access-logs,ANOMALY_MODE=true}" \
  --region us-east-1
```

## 6. (Optional) Create the scheduled queries

The post demonstrates scheduled queries directly with the AWS CLI. Replace the execution
role ARN with the `ScheduledQueryRoleArn` output from `cdk deploy`, and the S3 path with
the `ResultsBucketName` output.

```bash
aws logs create-scheduled-query \
  --name "ProactiveAccessDeniedDetection" \
  --query-language "CWLI" \
  --query-string 'fields @timestamp, userIdentity_principalId, eventSource, eventName, sourceIPAddress | filter errorCode = "AccessDenied" | stats count(*) as denied_count by userIdentity_principalId, sourceIPAddress | filter denied_count > 10 | sort denied_count desc' \
  --log-group-identifiers "/demo/security/api-activity" \
  --schedule-expression "cron(0/5 * * * ? *)" \
  --start-time-offset 600 \
  --execution-role-arn "<ScheduledQueryRoleArn>" \
  --destination-configuration '{"s3Configuration":{"destinationIdentifier":"s3://<ResultsBucketName>/scheduled-query-results/","roleArn":"<ScheduledQueryRoleArn>"}}' \
  --region us-east-1
```

## 7. Disable anomaly mode (after screenshots)

```bash
aws lambda update-function-configuration \
  --function-name demo-anomaly-generator \
  --environment "Variables={API_LOG_GROUP=/demo/security/api-activity,ACCESS_LOG_GROUP=/demo/security/access-logs,ANOMALY_MODE=false}" \
  --region us-east-1

aws lambda update-function-configuration \
  --function-name demo-cloudtrail-generator \
  --environment "Variables={LOG_GROUP_NAME=/demo/security/api-activity,ANOMALY_MODE=false}" \
  --region us-east-1

aws lambda update-function-configuration \
  --function-name demo-access-log-generator \
  --environment "Variables={LOG_GROUP_NAME=/demo/security/access-logs,ANOMALY_MODE=false}" \
  --region us-east-1
```

## 8. Clean up

> **Warning:** The following steps permanently delete all deployed resources, including
> the CloudWatch log groups (and all generated sample data) and the S3 bucket and its
> scheduled-query results (`autoDeleteObjects` is enabled). Save anything you need before
> proceeding.

```bash
npx cdk destroy
```

Then remove the manually created items:

- **Lookup table** `account_metadata` — CloudWatch console (Logs → Settings → Lookup tables).
- **Scheduled queries** (if you created them in step 6):

  ```bash
  aws logs delete-scheduled-query --name "ProactiveAccessDeniedDetection" --region us-east-1
  ```
