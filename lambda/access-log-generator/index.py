"""
Generates application access log events.
Writes structured JSON logs to a custom CloudWatch log group.
"""
import json
import random
import time
import os
import boto3
from datetime import datetime, timezone

logs_client = boto3.client('logs')
LOG_GROUP = os.environ.get('LOG_GROUP_NAME', '/demo/security/access-logs')

USERS = ["alice", "bob", "carol", "deploy-role", "ci-pipeline"]
SUSPICIOUS_USER = "compromised-user"

RESOURCES = [
    "arn:aws:s3:::production-data-bucket/customer-records/*",
    "arn:aws:s3:::production-data-bucket/financial-reports/*",
    "arn:aws:s3:::staging-data-bucket/test-data/*",
    "arn:aws:dynamodb:us-east-1:111122223333:table/UserProfiles",
    "arn:aws:dynamodb:us-east-1:111122223333:table/Transactions",
    "arn:aws:secretsmanager:us-east-1:111122223333:secret:prod/db-credentials",
    "arn:aws:secretsmanager:us-east-1:111122223333:secret:prod/api-keys",
    "arn:aws:kms:us-east-1:111122223333:key/mrk-1234567890",
]

SENSITIVE_RESOURCES = [
    "arn:aws:s3:::production-data-bucket/customer-records/*",
    "arn:aws:s3:::production-data-bucket/financial-reports/*",
    "arn:aws:secretsmanager:us-east-1:111122223333:secret:prod/db-credentials",
    "arn:aws:secretsmanager:us-east-1:111122223333:secret:prod/api-keys",
    "arn:aws:kms:us-east-1:111122223333:key/mrk-1234567890",
]

ACTIONS = ["Read", "Write", "List", "Delete", "Decrypt"]

NORMAL_IPS = ["10.0.1.50", "10.0.2.100", "10.0.3.25", "172.16.0.10", "172.16.1.20"]
SUSPICIOUS_IPS = ["198.51.100.42", "203.0.113.99"]


def generate_normal_access():
    return {
        "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "userId": random.choice(USERS),
        "resource": random.choice(RESOURCES),
        "action": random.choice(["Read", "List"]),  # Normal users mostly read/list
        "sourceIP": random.choice(NORMAL_IPS),
        "outcome": "Success",
        "sessionId": f"sess-{random.randint(10000, 99999)}",
    }


def generate_suspicious_access():
    return {
        "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "userId": SUSPICIOUS_USER,
        "resource": random.choice(SENSITIVE_RESOURCES),
        "action": random.choice(["Read", "Write", "Delete", "Decrypt"]),
        "sourceIP": random.choice(SUSPICIOUS_IPS),
        "outcome": random.choice(["Success", "Success", "Denied"]),  # Mix of success and denied
        "sessionId": f"sess-{random.randint(10000, 99999)}",
    }


def handler(event, context):
    anomaly_mode = os.environ.get("ANOMALY_MODE", "false").lower() == "true"
    
    events = []
    
    # Generate 5-8 normal access events
    for _ in range(random.randint(5, 8)):
        events.append(generate_normal_access())
    
    # In anomaly mode, add suspicious access patterns
    if anomaly_mode:
        for _ in range(random.randint(3, 6)):
            events.append(generate_suspicious_access())
    
    # Write events to custom log group
    stream_name = datetime.now(timezone.utc).strftime("%Y/%m/%d/") + (context.log_stream_name.split("/")[-1] if context else "manual")
    
    try:
        logs_client.create_log_stream(logGroupName=LOG_GROUP, logStreamName=stream_name)
    except logs_client.exceptions.ResourceAlreadyExistsException:
        pass
    
    log_events = []
    now_ms = int(time.time() * 1000)
    for i, e in enumerate(events):
        log_events.append({
            'timestamp': now_ms + i,
            'message': json.dumps(e),
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
