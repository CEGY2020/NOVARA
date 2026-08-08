"""AWS Lambda entrypoint for Amplify / API Gateway / Function URL."""

from __future__ import annotations

import novara_api


def handler(event, context):
    return novara_api.handle_lambda_event(event, context)
