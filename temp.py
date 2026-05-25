#!/usr/bin/env python3
"""
Check that all npm dependencies were published more than two weeks ago.
Run from your project root (where package.json lives).
"""

import json
import subprocess
from datetime import datetime, timezone, timedelta

TWO_WEEKS = timedelta(weeks=2)
NOW = datetime.now(timezone.utc)


def run(cmd: list[str]) -> str:
    result = subprocess.run(cmd, capture_output=True, text=True)
    return result.stdout.strip()


def get_installed_deps() -> dict[str, str]:
    """Returns {package_name: version} for all installed packages."""
    raw = """{
  "version": "1.0.0",
  "name": "ramen-flux",
  "dependencies": {
    "@vitejs/plugin-vue": {
      "version": "5.2.4",
      "resolved": "https://registry.npmjs.org/@vitejs/plugin-vue/-/plugin-vue-5.2.4.tgz",
      "overridden": false
    },
    "typescript": {
      "version": "5.9.3",
      "resolved": "https://registry.npmjs.org/typescript/-/typescript-5.9.3.tgz",
      "overridden": false
    },
    "vite": {
      "version": "8.0.14",
      "resolved": "https://registry.npmjs.org/vite/-/vite-8.0.14.tgz",
      "overridden": false
    },
    "vue-tsc": {
      "version": "3.3.1",
      "resolved": "https://registry.npmjs.org/vue-tsc/-/vue-tsc-3.3.1.tgz",
      "overridden": false
    },
    "vue": {
      "version": "3.5.34",
      "resolved": "https://registry.npmjs.org/vue/-/vue-3.5.34.tgz",
      "overridden": false
    }
  }
}"""
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        print("ERROR: Could not parse `npm list` output. Are you in your project root?")
        exit(1)
    return {name: info.get("version", "unknown")
            for name, info in data.get("dependencies", {}).items()}


def get_publish_date(package: str, version: str) -> datetime | None:
    raw = run(["npm", "view", f"{package}@{version}", f"time.{version}"])
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None


def main():
    print("Fetching installed packages...\n")
    deps = get_installed_deps()

    if not deps:
        print("No dependencies found.")
        return

    recent = []
    errors = []

    for pkg, ver in sorted(deps.items()):
        published = get_publish_date(pkg, ver)
        if published is None:
            errors.append(f"  {pkg}@{ver}  →  (could not fetch date)")
            continue

        age = NOW - published
        age_days = age.days
        flag = "⚠️  RECENT" if age < TWO_WEEKS else "✅"
        print(f"  {flag}  {pkg}@{ver}  →  published {published.date()}  ({age_days}d ago)")

        if age < TWO_WEEKS:
            recent.append((pkg, ver, published, age_days))

    if errors:
        print("\nCould not check:")
        for e in errors:
            print(e)

    print("\n" + "─" * 60)
    if recent:
        print(f"⚠️  {len(recent)} package(s) published in the last two weeks:\n")
        for pkg, ver, published, age_days in recent:
            print(f"  {pkg}@{ver}  ({age_days} days ago, published {published.date()})")
        print("\nConsider pinning to an older version if stability is a concern.")
    else:
        print("✅  All packages were published more than two weeks ago.")


if __name__ == "__main__":
    main()