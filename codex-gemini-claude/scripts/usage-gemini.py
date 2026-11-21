"""Print Gemini usage limits.

Runs `agy -p "/usage" --output-format json`, a local command that makes no model call, and
keeps the "Gemini Models" group: its 5-hour and weekly windows.

Usage: usage-gemini.py [--json]
"""
import datetime
import json
import subprocess
import sys

GROUP = "Gemini Models"
WINDOWS = {"5h": "5h", "weekly": "Weekly"}


def read_usage(timeout=25):
    run = subprocess.run(
        ["agy", "-p", "/usage", "--output-format", "json"],
        stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=timeout,
    )
    return json.loads(run.stdout)


def epoch_ms(iso):
    return int(datetime.datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp() * 1000)


def windows_of(result):
    groups = ((result.get("command") or {}).get("data") or {}).get("groups") or []
    group = next((g for g in groups if g.get("name") == GROUP), None)
    rows = []
    for bucket in (group or {}).get("buckets") or []:
        name = WINDOWS.get(bucket.get("window"))
        remaining = bucket.get("remaining_fraction")
        if name is None or remaining is None:
            continue
        row = {"name": name, "percent": round((1 - remaining) * 100)}
        if bucket.get("reset_time"):
            row["resetsAt"] = epoch_ms(bucket["reset_time"])
        rows.append(row)

    return rows


try:
    windows = windows_of(read_usage())
except Exception as err:
    if "--json" in sys.argv[1:]:
        print(json.dumps({"windows": [], "error": str(err)}))
        raise SystemExit(0)
    raise SystemExit(f"Could not read Gemini usage: {err}")

if "--json" in sys.argv[1:]:
    print(json.dumps({"windows": windows}))
    raise SystemExit(0)

for w in windows:
    reset = datetime.datetime.fromtimestamp(w["resetsAt"] / 1000).strftime("%a %d %b %H:%M") if "resetsAt" in w else "?"
    print(f"{w['name']:<7} {w['percent']}% used, resets {reset}")
