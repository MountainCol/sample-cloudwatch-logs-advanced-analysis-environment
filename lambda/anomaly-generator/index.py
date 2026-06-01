"""
Anomaly generator - writes both API activity and access log events
that simulate a compromised principal performing reconnaissance and
data exfiltration. Only active when ANOMALY_MODE=true.
"""
import json
import random
import time
import os
import boto3
from datetime import datetime, timezone

logs_client = boto3.client('logs')
API_LOG_GROUP = os.environ.get('API_LOG_GROUP', '/demo/security/api-activity')
ACCESS_LOG_GROUP = os.environ.get('ACCESS_LOG_GROUP', '/demo/security/access-logs')

SUSPICIOUS_PRINCIPAL = {
    "principalId": "AIDA9876543210SUSPECT",
    "accountId": "111122223333",
    "userName": "compromised-user",
}

SUSPICIOUS_IPS = ["198.51.100.42", "203.0.113.99"]

# Privilege escalation attempts (API activity)
ESCALATION_EVENTS = [
    {"source": "iam.amazonaws.com", "name": "CreateUser"},
    {"source": "iam.amazonaws.com", "name": "AttachUserPolicy"},
    {"source": "iam.amazonaws.com", "name": "CreateAccessKey"},
    {"source": "iam.amazonaws.com", "name": "PutUserPolicy"},
    {"source": "iam.amazonaws.com", "name": "AddUserToGroup"},
    {"source": "sts.amazonaws.com", "name": "AssumeRole"},
    {"source": "s3.amazonaws.com", "name": "PutBucketPolicy"},
    {"source": "ec2.amazonaws.com", "name": "AuthorizeSecurityGroupIngress"},
    {"source": "kms.amazonaws.com", "name": "CreateGrant"},
]

# Data access attempts (access logs)
DATA_ACCESS_TARGETS = [
    "arn:aws:s3:::production-data-bucket/customer-records/*",
    "arn:aws:s3:::production-data-bucket/financial-reports/*",
    "arn:aws:secretsmanager:us-east-1:111122223333:secret:prod/db-credentials",
    "arn:aws:secretsmanager:us-east-1:111122223333:secret:prod/api-keys",
    "arn:aws:kms:us-east-1:111122223333:key/mrk-1234567890",
    "arn:aws:dynamodb:us-east-1:111122223333:table/UserProfiles",
]


def handler(event, context):
    anomaly_mode = os.environ.get("ANOMALY_MODE", "false").lower() == "true"
    
    if not anomaly_mode:
        return {"statusCode": 200, "body": json.dumps({"message": "Anomaly mode disabled, no events generated"})}
    
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    ip = random.choice(SUSPICIOUS_IPS)
    now_ms = int(time.time() * 1000)
    
    # Generate API activity events (privilege escalation pattern)
    api_events = []
    for _ in range(random.randint(5, 10)):
        evt = random.choice(ESCALATION_EVENTS)
        api_event = {
            "eventTime": now,
            "eventSource": evt["source"],
            "eventName": evt["name"],
            "userIdentity_principalId": SUSPICIOUS_PRINCIPAL["principalId"],
            "userIdentity_accountId": SUSPICIOUS_PRINCIPAL["accountId"],
            "userIdentity_userName": SUSPICIOUS_PRINCIPAL["userName"],
            "sourceIPAddress": ip,
            "awsRegion": "us-east-1",
            "requestId": f"req-{random.randint(100000, 999999)}",
        }
        # 40% get denied (realistic for escalation attempts)
        if random.random() < 0.40:
            api_event["errorCode"] = "AccessDenied"
        api_events.append(api_event)
    
    # Generate access log events (data exfiltration pattern)
    access_events = []
    for _ in range(random.randint(3, 6)):
        access_event = {
            "timestamp": now,
            "userId": SUSPICIOUS_PRINCIPAL["userName"],
            "resource": random.choice(DATA_ACCESS_TARGETS),
            "action": random.choice(["Read", "Decrypt", "Write", "Delete"]),
            "sourceIP": ip,
            "outcome": random.choice(["Success", "Success", "Denied"]),
            "sessionId": f"sess-{random.randint(10000, 99999)}",
        }
        access_events.append(access_event)
    
    # Write API events to api-activity log group
    stream_name = datetime.now(timezone.utc).strftime("%Y/%m/%d/anomaly-") + str(random.randint(1000, 9999))
    
    try:
        logs_client.create_log_stream(logGroupName=API_LOG_GROUP, logStreamName=stream_name)
    except logs_client.exceptions.ResourceAlreadyExistsException:
        pass
    
    api_log_events = []
    for i, e in enumerate(api_events):
        clean = {k: v for k, v in e.items() if v is not None}
        api_log_events.append({'timestamp': now_ms + i, 'message': json.dumps(clean)})
    
    if api_log_events:
        logs_client.put_log_events(logGroupName=API_LOG_GROUP, logStreamName=stream_name, logEvents=api_log_events)
    
    # Write access events to access-logs log group
    access_stream = datetime.now(timezone.utc).strftime("%Y/%m/%d/anomaly-access-") + str(random.randint(1000, 9999))
    
    try:
        logs_client.create_log_stream(logGroupName=ACCESS_LOG_GROUP, logStreamName=access_stream)
    except logs_client.exceptions.ResourceAlreadyExistsException:
        pass
    
    access_log_events = []
    for i, e in enumerate(access_events):
        access_log_events.append({'timestamp': now_ms + i, 'message': json.dumps(e)})
    
    if access_log_events:
        logs_client.put_log_events(logGroupName=ACCESS_LOG_GROUP, logStreamName=access_stream, logEvents=access_log_events)
    
    return {
        "statusCode": 200,
        "body": json.dumps({
            "api_events": len(api_events),
            "access_events": len(access_events),
        }),
    }
