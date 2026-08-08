#!/usr/bin/env python3
"""Find a Slack channel ID by name, email, or display name.

Usage:
  python3 find_channel.py <query>

Searches:
  - Public/private channels by name
  - DMs by user display name, real name, or email

Token: SLACK_USER_TOKEN, read from the environment.
"""

import json
import os
import subprocess
import sys


def load_token() -> str:
    """Read the token from the environment.

    Barry resolves SLACK_USER_TOKEN from the barry's configured source (vault,
    keychain, or a literal value) and injects it before the skill runs. Reading
    a file on disk instead would bypass the credential chain and miss a
    rotated secret.
    """
    token = os.environ.get("SLACK_USER_TOKEN", "")
    if not token:
        print(
            "ERROR: SLACK_USER_TOKEN is not set.\n"
            "Configure it with:\n"
            "  barry vault set-env <barry> SLACK_USER_TOKEN <token> --source vault",
            file=sys.stderr,
        )
        sys.exit(1)
    return token


def slack_get(token: str, method: str, params: dict = {}) -> dict:
    import urllib.request, urllib.parse
    url = f"https://slack.com/api/{method}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())


def find_channels(token: str, query: str) -> list[dict]:
    results = []
    query_lower = query.lower()

    # Search channels (public + private)
    cursor = None
    while True:
        params = {"types": "public_channel,private_channel", "limit": 200, "exclude_archived": "true"}
        if cursor:
            params["cursor"] = cursor
        data = slack_get(token, "conversations.list", params)
        for ch in data.get("channels", []):
            if query_lower in ch.get("name", "").lower():
                results.append({"type": "channel", "name": f"#{ch['name']}", "id": ch["id"]})
        cursor = data.get("response_metadata", {}).get("next_cursor")
        if not cursor:
            break

    # Search DMs by user name/email
    cursor = None
    users_by_id = {}
    while True:
        params = {"limit": 200}
        if cursor:
            params["cursor"] = cursor
        data = slack_get(token, "users.list", params)
        for u in data.get("members", []):
            if u.get("deleted") or u.get("is_bot"):
                continue
            profile = u.get("profile", {})
            name = profile.get("display_name") or profile.get("real_name") or u.get("name", "")
            email = profile.get("email", "")
            if query_lower in name.lower() or query_lower in email.lower():
                users_by_id[u["id"]] = {"name": name, "email": email}
        cursor = data.get("response_metadata", {}).get("next_cursor")
        if not cursor:
            break

    if users_by_id:
        # Find DM channel IDs for matched users
        cursor = None
        while True:
            params = {"types": "im", "limit": 200}
            if cursor:
                params["cursor"] = cursor
            data = slack_get(token, "conversations.list", params)
            for ch in data.get("channels", []):
                uid = ch.get("user")
                if uid in users_by_id:
                    u = users_by_id[uid]
                    label = u["name"]
                    if u["email"]:
                        label += f" <{u['email']}>"
                    results.append({"type": "dm", "name": f"DM: {label}", "id": ch["id"]})
            cursor = data.get("response_metadata", {}).get("next_cursor")
            if not cursor:
                break

    return results


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 find_channel.py <query>")
        sys.exit(1)

    query = " ".join(sys.argv[1:])
    token = load_token()
    results = find_channels(token, query)

    if not results:
        print(f"No channels or DMs found matching '{query}'")
        sys.exit(1)

    for r in results:
        print(f"{r['id']}  {r['type']:7}  {r['name']}")


if __name__ == "__main__":
    main()
