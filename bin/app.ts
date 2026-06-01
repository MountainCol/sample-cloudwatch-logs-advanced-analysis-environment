#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { SecurityLogsInsightsStack } from '../lib/security-logs-insights-stack';

const app = new cdk.App();
new SecurityLogsInsightsStack(app, 'SecurityLogsInsightsStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
});
