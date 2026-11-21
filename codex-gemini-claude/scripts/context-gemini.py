"""Show context usage of the Gemini conversation this Claude session started.

Usage: context-gemini.py --cwd <folder> --since <epoch ms> [--json]

The Antigravity CLI records no Claude session, so the conversation is the newest one written
since <since>, the last time this Claude session started Gemini. Print-mode runs (how the agy
plugin runs Gemini) often have no folder in the CLI's metadata, so a conversation is left out
only when the metadata names a different folder.

Context comes from `agy acp`: loading a conversation sends a `usage_update` with tokens used
and the window size. Loading is safe only while nothing runs in that conversation, so it
happens only when Gemini is idle, one load at a time, and once per change of the conversation
(the result is cached).
"""
import fcntl
import json
import os
import select
import subprocess
import sys
import tempfile
import time
from urllib.parse import unquote

HOME = os.path.expanduser("~")
AGY = f"{HOME}/.gemini/antigravity-cli"
METADATA = f"{AGY}/cache/conversation_metadata.json"
CONVERSATIONS = f"{AGY}/conversations"
PRESENCE = f"{AGY}/presence"
CACHE = os.path.join(tempfile.gettempdir(), "codex-gemini-claude-acp.json")
ACP_LOCK = os.path.join(tempfile.gettempdir(), "codex-gemini-claude-acp.lock")
ACP_TIMEOUT_S = 8
# Metadata can be written a little after the run starts.
SINCE_SLACK_MS = 5_000


def arg(name, default=None):
    args = sys.argv[1:]
    return args[args.index(name) + 1] if name in args and args.index(name) + 1 < len(args) else default


def real(path):
    try:
        return os.path.realpath(path)
    except Exception:
        return path


def folder_of(uri):
    return real(unquote(uri[len("file://"):])) if uri.startswith("file://") else None


def is_held(conversation):
    """True while a live process holds the conversation's presence lock open."""
    path = f"{PRESENCE}/{conversation}.lock"
    if not os.path.exists(path):
        return False
    try:
        run = subprocess.run(["lsof", "-t", path], capture_output=True, text=True, timeout=5)
        return bool(run.stdout.strip())
    except Exception:
        return False


def print_runs():
    """Live `agy -p` runs (not `/usage`), whatever folder they run in."""
    try:
        out = subprocess.run(["ps", "-axo", "command"], capture_output=True, text=True, timeout=5).stdout
    except Exception:
        return False
    for line in out.splitlines():
        words = line.split()
        if not words or os.path.basename(words[0]) not in ("agy", "antigravity"):
            continue
        if any(w in ("-p", "--print", "--prompt") for w in words) and "/usage" not in words:
            return True
    return False


def recorded_folders():
    """Conversation id -> the folders the CLI's metadata names for it (often none)."""
    try:
        conversations = json.load(open(METADATA)).get("conversations", {})
    except Exception:
        return {}
    folders = {}
    for cid, entry in conversations.items():
        uris = (entry.get("summary") or {}).get("WorkspaceURIs") or []
        folders[cid] = [f for f in (folder_of(u) for u in uris) if f]

    return folders


def conversation_for(folder, since):
    recorded = recorded_folders()
    found = []
    try:
        names = os.listdir(CONVERSATIONS)
    except Exception:
        return None
    for name in names:
        if not name.endswith(".db"):
            continue
        cid = name[:-3]
        try:
            stat = os.stat(f"{CONVERSATIONS}/{name}")
        except Exception:
            continue
        updated = int(stat.st_mtime * 1000)
        if updated < since - SINCE_SLACK_MS:
            continue
        if recorded.get(cid) and folder not in recorded[cid]:
            continue
        found.append({"id": cid, "updatedAt": updated, "steps": stat.st_size})
    if not found:
        return None
    # Each `agy -p` starts a new conversation: prefer one still running, then the newest.
    found.sort(key=lambda c: (is_held(c["id"]), c["updatedAt"]), reverse=True)
    return found[0]


def read_cache():
    try:
        return json.load(open(CACHE))
    except Exception:
        return {}


def write_cache(cache):
    try:
        with open(CACHE, "w") as f:
            json.dump(cache, f)
    except Exception:
        pass


def acp_usage(conversation, folder):
    """{used, size} from loading the conversation over ACP, or None."""
    proc = subprocess.Popen(
        ["agy", "acp"], cwd=folder, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL, text=True, bufsize=1, start_new_session=True,
    )
    deadline = time.time() + ACP_TIMEOUT_S

    def send(message):
        proc.stdin.write(json.dumps(message) + "\n")
        proc.stdin.flush()

    usage = None
    try:
        send({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": 1, "clientCapabilities": {}}})
        loaded = False
        while time.time() < deadline and usage is None:
            ready, _, _ = select.select([proc.stdout], [], [], max(0.0, deadline - time.time()))
            if not ready:
                break
            line = proc.stdout.readline()
            if not line:
                break
            try:
                message = json.loads(line)
            except Exception:
                continue
            if message.get("id") == 1 and not loaded:
                loaded = True
                send({"jsonrpc": "2.0", "id": 2, "method": "session/load",
                      "params": {"sessionId": conversation, "cwd": folder, "mcpServers": []}})
            elif message.get("id") == 2 and "error" in message:
                break
            update = (message.get("params") or {}).get("update") or {}
            if update.get("sessionUpdate") == "usage_update" and update.get("size"):
                usage = {"used": update.get("used", 0), "size": update["size"]}
    finally:
        # Stop the whole process group, gently first.
        for sig in (15, 9):
            try:
                os.killpg(proc.pid, sig)
            except Exception:
                break
            try:
                proc.wait(timeout=0.5)
                break
            except Exception:
                continue

    return usage


def context_of(conversation, folder, running):
    key = f"{conversation['id']}:{conversation['updatedAt']}:{conversation['steps']}"
    cache = read_cache()
    hit = cache.get(conversation["id"])
    if hit and (hit.get("key") == key or running):
        return hit
    if running:
        return None
    # One load at a time across Claude sessions; skip rather than wait.
    with open(ACP_LOCK, "w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            return hit
        usage = acp_usage(conversation["id"], folder)
    if usage is None:
        return hit
    entry = {"key": key, "used": usage["used"], "size": usage["size"]}
    cache[conversation["id"]] = entry
    write_cache(cache)

    return entry


def main():
    as_json = "--json" in sys.argv[1:]
    folder = real(arg("--cwd", os.getcwd()))
    since = arg("--since")

    def done(payload, text):
        print(json.dumps(payload) if as_json else text)
        raise SystemExit(0)

    if not since:
        done({"error": "No Gemini conversation in this Claude session yet.", "running": False},
             "No Gemini conversation in this Claude session yet.")
    conversation = conversation_for(folder, int(since))
    running = print_runs() or bool(conversation and is_held(conversation["id"]))
    if not conversation:
        done({"error": "No Gemini conversation in this Claude session yet.", "running": running},
             "No Gemini conversation in this Claude session yet.")
    context = context_of(conversation, folder, running)
    if not context:
        done({"error": "no context reading yet", "conversation": conversation["id"], "running": running},
             f"Conversation {conversation['id']}: no context reading yet.")
    used, size = context["used"], context["size"]
    percent = round(used / size * 100) if size else 0
    done({"conversation": conversation["id"], "tokens": used, "window": size, "percent": percent,
          "updatedAt": conversation["updatedAt"], "running": running},
         f"Conversation {conversation['id']}\nContext {used:,} / {size:,} tokens ({percent}% used)")


main()
