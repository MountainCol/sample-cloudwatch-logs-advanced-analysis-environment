#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { SecurityLogsInsightsStack } from '../lib/security-logs-insights-stack';

const app = new cdk.App();

// The stack is environment-agnostic on purpose: it does not pin an account or
// Region. CloudFormation resolves account and Region from the credentials used
// at deploy time, and the synthesized template uses the AWS::AccountId and
// AWS::Region pseudo parameters instead of literal values. This keeps the
// template portable across accounts, Regions, and partitions.
new SecurityLogsInsightsStack(app, 'SecurityLogsInsightsStack');
