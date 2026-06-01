"""
Generates CloudTrail-style API activity events.
Writes structured JSON logs to a custom CloudWatch log group.
"""
import json
import random
import time
import os
import boto3
from datetime import datetime, timezone

logs_client = boto3.client('logs')
LOG_GROUP = os.environ.get('LOG_GROUP_NAME', '/demo/security/api-activity')

# Normal principals (legitimate users)
NORMAL_PRINCIPALS = [
    {"principalId": "AIDA1234567890EXAMPLE", "accountId": "111122223333", "userName": "alice"},
    {"principalId": "AIDA0987654321EXAMPLE", "accountId": "111122223333", "userName": "bob"},
    {"principalId": "AIDA5555666677EXAMPLE", "accountId": "444455556666", "userName": "carol"},
    {"principalId": "AROA1111222233EXAMPLE", "accountId": "444455556666", "userName": "deploy-role"},
    {"principalId": "AROA9999888877EXAMPLE", "accountId": "777788889999", "userName": "ci-pipeline"},
]

# Suspicious principal (used in anomaly mode)
SUSPICIOUS_PRINCIPAL = {"principalId": "AIDA9876543210SUSPECT", "accountId": "111122223333", "userName": "compromised-user"}

EVENT_SOURCES = ["s3.amazonaws.com", "ec2.amazonaws.com", "iam.amazonaws.com", "lambda.amazonaws.com", "dynamodb.amazonaws.com", "sts.amazonaws.com", "kms.amazonaws.com"]

NORMAL_EVENTS = {
    "s3.amazonaws.com": ["GetObject", "ListBuckets", "PutObject", "HeadObject"],
    "ec2.amazonaws.com": ["DescribeInstances", "DescribeSecurityGroups", "DescribeVpcs"],
    "iam.amazonaws.com": ["GetUser", "ListRoles", "GetPolicy"],
    "lambda.amazonaws.com": ["ListFunctions", "GetFunction", "Invoke"],
    "dynamodb.amazonaws.com": ["GetItem", "Query", "Scan", "PutItem"],
    "sts.amazonaws.com": ["AssumeRole", "GetCallerIdentity"],
    "kms.amazonaws.com": ["Decrypt", "GenerateDataKey", "DescribeKey"],
}

# Suspicious events (privilege escalation attempts)
SUSPICIOUS_EVENTS = {
    "iam.amazonaws.com": ["CreateUser", "AttachUserPolicy", "CreateAccessKey", "PutUserPolicy"],
    "sts.amazonaws.com": ["AssumeRole"],
    "s3.amazonaws.com": ["GetBucketPolicy", "PutBucketPolicy", "DeleteBucketPolicy"],
    "ec2.amazonaws.com": ["AuthorizeSecurityGroupIngress", "CreateKeyPair", "RunInstances"],
    "kms.amazonaws.com": ["CreateGrant", "DisableKey"],
}

NORMAL_IPS = ["10.0.1.50", "10.0.2.100", "10.0.3.25", "172.16.0.10", "172.16.1.20"]
SUSPICIOUS_IPS = ["198.51.100.42", "203.0.113.99"]

ACCOUNTS = ["111122223333", "444455556666", "777788889999"]


def generate_normal_event():
    principal = random.choice(NORMAL_PRINCIPALS)
    source = random.choice(EVENT_SOURCES)
    event_name = random.choice(NORMAL_EVENTS[source])
    
    event = {
        "eventTime": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "eventSource": source,
        "eventName": event_name,
        "userIdentity_principalId": principal["principalId"],
        "userIdentity_accountId": principal["accountId"],
        "userIdentity_userName": principal["userName"],
        "sourceIPAddress": random.choice(NORMAL_IPS),
        "awsRegion": "us-east-1",
        "errorCode": None,
        "requestId": f"req-{random.randint(100000, 999999)}",
    }
    
    # Occasional access denied (normal rate ~2%)
    if random.random() < 0.02:
        event["errorCode"] = "AccessDenied"
    
    return event


def generate_suspicious_event():
    source = random.choice(list(SUSPICIOUS_EVENTS.keys()))
    event_name = random.choice(SUSPICIOUS_EVENTS[source])
    
    event = {
        "eventTime": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "eventSource": source,
        "eventName": event_name,
        "userIdentity_principalId": SUSPICIOUS_PRINCIPAL["principalId"],
        "userIdentity_accountId": SUSPICIOUS_PRINCIPAL["accountId"],
        "userIdentity_userName": SUSPICIOUS_PRINCIPAL["userName"],
        "sourceIPAddress": random.choice(SUSPICIOUS_IPS),
        "awsRegion": "us-east-1",
        "errorCode": None,
        "requestId": f"req-{random.randint(100000, 999999)}",
    }
    
    # Suspicious principals get more access denied (~30%)
    if random.random() < 0.30:
        event["errorCode"] = "AccessDenied"
    
    return event


def handler(event, context):
    anomaly_mode = os.environ.get("ANOMALY_MODE", "false").lower() == "true"
    
    events = []
    
    # Generate 8-12 normal events per invocation
    for _ in range(random.randint(8, 12)):
        events.append(generate_normal_event())
    
    # In anomaly mode, add suspicious events
    if anomaly_mode:
        for _ in range(random.randint(4, 8)):
            events.append(generate_suspicious_event())
    
    # Write events to custom log group
    stream_name = datetime.now(timezone.utc).strftime("%Y/%m/%d/") + context.log_stream_name.split("/")[-1] if context else "manual"
    
    try:
        logs_client.create_log_stream(logGroupName=LOG_GROUP, logStreamName=stream_name)
    except logs_client.exceptions.ResourceAlreadyExistsException:
        pass
    
    log_events = []
    now_ms = int(time.time() * 1000)
    for i, e in enumerate(events):
        clean_event = {k: v for k, v in e.items() if v is not None}
        log_events.append({
            'timestamp': now_ms + i,
            'message': json.dumps(clean_event),
        })
    
    if log_events:
        logs_client.put_log_events(
            logGroupName=LOG_GROUP,
            logStreamName=stream_name,
            logEvents=log_events,
        )
    
    return {
        "statusCode": 200,
        "body": json.dumps({
            "events_generated": len(events),
            "anomaly_mode": anomaly_mode,
        }),
    }
