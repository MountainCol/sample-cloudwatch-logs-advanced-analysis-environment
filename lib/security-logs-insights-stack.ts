import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';

export class SecurityLogsInsightsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Template metadata (rendered into the synthesized CloudFormation template).
    this.templateOptions.templateFormatVersion = '2010-09-09';
    this.templateOptions.description =
      'Advanced log analysis in Amazon CloudWatch Logs Insights - demo environment. ' +
      'WARNING: This template creates AWS Lambda functions, Amazon CloudWatch log groups, ' +
      'an Amazon S3 bucket, Amazon EventBridge schedules, and AWS IAM roles. You will be ' +
      'billed for the AWS resources used if you create a stack from this template.';

    // ─────────────────────────────────────────────────────────────────────────
    // S3 Bucket for scheduled query results
    // ─────────────────────────────────────────────────────────────────────────
    const resultsBucket = new s3.Bucket(this, 'ScheduledQueryResultsBucket', {
      // No explicit bucketName: let CDK auto-generate a unique name. This avoids
      // name collisions and lets the stack be deployed more than once per account.
      // Retrieve the generated name from the ResultsBucketName stack output.
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // ─────────────────────────────────────────────────────────────────────────
    // IAM Role for Scheduled Queries
    // ─────────────────────────────────────────────────────────────────────────
    const scheduledQueryRole = new iam.Role(this, 'SecurityScheduledQueryRole', {
      roleName: 'SecurityLogsScheduledQueryRole',
      assumedBy: new iam.ServicePrincipal('logs.amazonaws.com'),
    });

    scheduledQueryRole.addToPolicy(new iam.PolicyStatement({
      actions: ['s3:PutObject'],
      resources: [resultsBucket.bucketArn, `${resultsBucket.bucketArn}/*`],
    }));

    scheduledQueryRole.addToPolicy(new iam.PolicyStatement({
      actions: ['logs:StartQuery', 'logs:GetQueryResults'],
      resources: [
        `arn:${cdk.Aws.PARTITION}:logs:${this.region}:${this.account}:log-group:/demo/security/api-activity:*`,
        `arn:${cdk.Aws.PARTITION}:logs:${this.region}:${this.account}:log-group:/demo/security/access-logs:*`,
      ],
    }));

    // ─────────────────────────────────────────────────────────────────────────
    // Log Groups
    // ─────────────────────────────────────────────────────────────────────────
    const apiActivityLogGroup = new logs.LogGroup(this, 'ApiActivityLogGroup', {
      logGroupName: '/demo/security/api-activity',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const accessLogsLogGroup = new logs.LogGroup(this, 'AccessLogsLogGroup', {
      logGroupName: '/demo/security/access-logs',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Lambda: CloudTrail-style event generator
    // ─────────────────────────────────────────────────────────────────────────
    const cloudtrailGenerator = new lambda.Function(this, 'CloudTrailGenerator', {
      functionName: 'demo-cloudtrail-generator',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/cloudtrail-generator'),
      timeout: cdk.Duration.seconds(30),
      // Explicit execution log group with a retention period so logs do not
      // persist indefinitely and are removed when the stack is deleted.
      logGroup: new logs.LogGroup(this, 'CloudTrailGeneratorLogGroup', {
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
      environment: {
        LOG_GROUP_NAME: '/demo/security/api-activity',
        ANOMALY_MODE: 'false',
      },
    });

    apiActivityLogGroup.grantWrite(cloudtrailGenerator);

    // ─────────────────────────────────────────────────────────────────────────
    // Lambda: Application access log generator
    // ─────────────────────────────────────────────────────────────────────────
    const accessLogGenerator = new lambda.Function(this, 'AccessLogGenerator', {
      functionName: 'demo-access-log-generator',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/access-log-generator'),
      timeout: cdk.Duration.seconds(30),
      logGroup: new logs.LogGroup(this, 'AccessLogGeneratorLogGroup', {
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
      environment: {
        LOG_GROUP_NAME: '/demo/security/access-logs',
        ANOMALY_MODE: 'false',
      },
    });

    accessLogsLogGroup.grantWrite(accessLogGenerator);

    // ─────────────────────────────────────────────────────────────────────────
    // Lambda: Anomaly generator (enables suspicious patterns)
    // ─────────────────────────────────────────────────────────────────────────
    const anomalyGenerator = new lambda.Function(this, 'AnomalyGenerator', {
      functionName: 'demo-anomaly-generator',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/anomaly-generator'),
      timeout: cdk.Duration.seconds(30),
      logGroup: new logs.LogGroup(this, 'AnomalyGeneratorLogGroup', {
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
      environment: {
        API_LOG_GROUP: '/demo/security/api-activity',
        ACCESS_LOG_GROUP: '/demo/security/access-logs',
        ANOMALY_MODE: 'false',
      },
    });

    apiActivityLogGroup.grantWrite(anomalyGenerator);
    accessLogsLogGroup.grantWrite(anomalyGenerator);

    // ─────────────────────────────────────────────────────────────────────────
    // EventBridge Scheduler: Trigger generators every 1 minute
    // ─────────────────────────────────────────────────────────────────────────
    const schedulerRole = new iam.Role(this, 'SchedulerRole', {
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com'),
    });

    cloudtrailGenerator.grantInvoke(schedulerRole);
    accessLogGenerator.grantInvoke(schedulerRole);
    anomalyGenerator.grantInvoke(schedulerRole);

    new scheduler.CfnSchedule(this, 'CloudTrailSchedule', {
      name: 'demo-cloudtrail-generator-schedule',
      scheduleExpression: 'rate(1 minute)',
      flexibleTimeWindow: { mode: 'OFF' },
      target: {
        arn: cloudtrailGenerator.functionArn,
        roleArn: schedulerRole.roleArn,
      },
    });

    new scheduler.CfnSchedule(this, 'AccessLogSchedule', {
      name: 'demo-access-log-generator-schedule',
      scheduleExpression: 'rate(1 minute)',
      flexibleTimeWindow: { mode: 'OFF' },
      target: {
        arn: accessLogGenerator.functionArn,
        roleArn: schedulerRole.roleArn,
      },
    });

    new scheduler.CfnSchedule(this, 'AnomalySchedule', {
      name: 'demo-anomaly-generator-schedule',
      scheduleExpression: 'rate(1 minute)',
      flexibleTimeWindow: { mode: 'OFF' },
      target: {
        arn: anomalyGenerator.functionArn,
        roleArn: schedulerRole.roleArn,
      },
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Index Policies (Facets)
    // ─────────────────────────────────────────────────────────────────────────
    new cr.AwsCustomResource(this, 'ApiActivityIndexPolicy', {
      installLatestAwsSdk: true,
      onCreate: {
        service: 'CloudWatchLogs',
        action: 'putIndexPolicy',
        parameters: {
          logGroupIdentifier: '/demo/security/api-activity',
          policyDocument: JSON.stringify({
            FieldsV2: {
              eventSource: { type: 'FACET' },
              eventName: { type: 'FACET' },
              errorCode: { type: 'FACET' },
              sourceIPAddress: { type: 'FACET' },
              userIdentity_accountId: { type: 'FACET' },
              userIdentity_principalId: { type: 'FIELD_INDEX' },
            },
          }),
        },
        physicalResourceId: cr.PhysicalResourceId.of('api-activity-index-policy'),
      },
      onDelete: {
        service: 'CloudWatchLogs',
        action: 'deleteIndexPolicy',
        parameters: {
          logGroupIdentifier: '/demo/security/api-activity',
        },
        ignoreErrorCodesMatching: '.*',
      },
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          actions: ['logs:PutIndexPolicy', 'logs:DeleteIndexPolicy'],
          resources: [`arn:${cdk.Aws.PARTITION}:logs:${this.region}:${this.account}:log-group:/demo/security/api-activity`],
        }),
      ]),
    });

    new cr.AwsCustomResource(this, 'AccessLogsIndexPolicy', {
      installLatestAwsSdk: true,
      onCreate: {
        service: 'CloudWatchLogs',
        action: 'putIndexPolicy',
        parameters: {
          logGroupIdentifier: '/demo/security/access-logs',
          policyDocument: JSON.stringify({
            FieldsV2: {
              userId: { type: 'FACET' },
              resource: { type: 'FACET' },
              action: { type: 'FACET' },
              sourceIP: { type: 'FACET' },
            },
          }),
        },
        physicalResourceId: cr.PhysicalResourceId.of('access-logs-index-policy'),
      },
      onDelete: {
        service: 'CloudWatchLogs',
        action: 'deleteIndexPolicy',
        parameters: {
          logGroupIdentifier: '/demo/security/access-logs',
        },
        ignoreErrorCodesMatching: '.*',
      },
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          actions: ['logs:PutIndexPolicy', 'logs:DeleteIndexPolicy'],
          resources: [`arn:${cdk.Aws.PARTITION}:logs:${this.region}:${this.account}:log-group:/demo/security/access-logs`],
        }),
      ]),
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Saved Query Definitions
    // ─────────────────────────────────────────────────────────────────────────
    const queryDefPolicy = cr.AwsCustomResourcePolicy.fromStatements([
      new iam.PolicyStatement({
        // Query-definition APIs do not support resource-level scoping, so '*' is
        // required here. The index-policy custom resources above are scoped to
        // specific log-group ARNs where the API does support it.
        actions: ['logs:PutQueryDefinition', 'logs:DeleteQueryDefinition'],
        resources: ['*'],
      }),
    ]);

    // Template 1: Principal Activity Audit (parameterized + lookup)
    new cr.AwsCustomResource(this, 'PrincipalActivityQuery', {
      installLatestAwsSdk: true,
      onCreate: {
        service: 'CloudWatchLogs',
        action: 'putQueryDefinition',
        parameters: {
          name: 'Security/PrincipalActivityAudit',
          logGroupNames: ['/demo/security/api-activity'],
          queryString: [
            'fields @timestamp, userIdentity_principalId, eventSource, eventName, sourceIPAddress, errorCode, userIdentity_accountId',
            '| filter userIdentity_principalId = "{{principalId}}"',
            '| lookup account_metadata account_id as userIdentity_accountId OUTPUTNEW account_name, environment, owner',
            '| sort @timestamp desc',
          ].join('\n'),
          parameters: [
            { name: 'principalId', defaultValue: 'AIDA1234567890EXAMPLE', description: 'The principal ID to investigate' },
          ],
        },
        physicalResourceId: cr.PhysicalResourceId.fromResponse('queryDefinitionId'),
      },
      onDelete: {
        service: 'CloudWatchLogs',
        action: 'deleteQueryDefinition',
        parameters: {
          queryDefinitionId: new cr.PhysicalResourceIdReference(),
        },
        ignoreErrorCodesMatching: '.*',
      },
      policy: queryDefPolicy,
    });

    // Template 2: Denied-Then-Succeeded (parameterized + sub-query)
    new cr.AwsCustomResource(this, 'DeniedThenSucceededQuery', {
      installLatestAwsSdk: true,
      onCreate: {
        service: 'CloudWatchLogs',
        action: 'putQueryDefinition',
        parameters: {
          name: 'Security/DeniedThenSucceeded',
          logGroupNames: ['/demo/security/api-activity'],
          queryString: [
            'filter userIdentity_principalId in (',
            '    SOURCE "/demo/security/api-activity"',
            '    | filter errorCode = "AccessDenied"',
            '    | stats count(*) as denied_count by userIdentity_principalId',
            '    | filter denied_count > {{deniedThreshold}}',
            '    | fields userIdentity_principalId',
            ')',
            '| filter errorCode != "AccessDenied"',
            '| stats count(*) as successful_actions by userIdentity_principalId, eventSource, eventName',
            '| sort successful_actions desc',
          ].join('\n'),
          parameters: [
            { name: 'deniedThreshold', defaultValue: '3', description: 'Minimum denied actions to flag a principal' },
          ],
        },
        physicalResourceId: cr.PhysicalResourceId.fromResponse('queryDefinitionId'),
      },
      onDelete: {
        service: 'CloudWatchLogs',
        action: 'deleteQueryDefinition',
        parameters: {
          queryDefinitionId: new cr.PhysicalResourceIdReference(),
        },
        ignoreErrorCodesMatching: '.*',
      },
      policy: queryDefPolicy,
    });

    // Template 3: Cross-Source Correlation (parameterized + JOIN)
    new cr.AwsCustomResource(this, 'CrossSourceCorrelationQuery', {
      installLatestAwsSdk: true,
      onCreate: {
        service: 'CloudWatchLogs',
        action: 'putQueryDefinition',
        parameters: {
          name: 'Security/CrossSourceCorrelation',
          logGroupNames: ['/demo/security/api-activity'],
          queryString: [
            'fields @timestamp, userIdentity_principalId, eventSource, eventName, sourceIPAddress, errorCode',
            '| join type=inner left=api right=access where api.sourceIPAddress=access.sourceIP (SOURCE "/demo/security/access-logs")',
            '| filter api.sourceIPAddress = "{{suspiciousIP}}"',
            '| fields api.@timestamp, api.eventName, api.eventSource, api.errorCode, access.userId, access.resource, access.action',
            '| sort api.@timestamp desc',
            '| limit 100',
          ].join('\n'),
          parameters: [
            { name: 'suspiciousIP', defaultValue: '198.51.100.42', description: 'IP address to investigate across log sources' },
          ],
        },
        physicalResourceId: cr.PhysicalResourceId.fromResponse('queryDefinitionId'),
      },
      onDelete: {
        service: 'CloudWatchLogs',
        action: 'deleteQueryDefinition',
        parameters: {
          queryDefinitionId: new cr.PhysicalResourceIdReference(),
        },
        ignoreErrorCodesMatching: '.*',
      },
      policy: queryDefPolicy,
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Outputs
    // ─────────────────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'ResultsBucketName', {
      value: resultsBucket.bucketName,
      description: 'S3 bucket for scheduled query results',
    });

    new cdk.CfnOutput(this, 'ScheduledQueryRoleArn', {
      value: scheduledQueryRole.roleArn,
      description: 'Execution role ARN for scheduled queries',
    });
  }
}
