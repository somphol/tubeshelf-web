#!/usr/bin/env python3
"""Regenerate src/taxonomy.json and src/taxonomy.js from the Mac app's Swift source.

Usage:
  python3 scripts/sync-taxonomy.py [path-to-TagTaxonomy.swift] [--check]

Default path: ../tubeshelf/Sources/TubeShelfCore/TagTaxonomy.swift

The Mac app is the source of truth. Never hand-edit taxonomy.js; run this script
and commit the generated files when the Swift taxonomy changes.
"""
import argparse
import json
import pathlib
import re
import sys


def blocks(text, marker):
    out = []
    start = 0
    while True:
        i = text.find(marker, start)
        if i == -1:
            break
        j = i + len(marker)
        depth = 1
        in_string = False
        escaped = False
        while j < len(text) and depth > 0:
            ch = text[j]
            if in_string:
                if escaped:
                    escaped = False
                elif ch == "\\":
                    escaped = True
                elif ch == '"':
                    in_string = False
            else:
                if ch == '"':
                    in_string = True
                elif ch == "(":
                    depth += 1
                elif ch == ")":
                    depth -= 1
            j += 1
        out.append(text[i:j])
        start = j
    return out


def field(block, name):
    match = re.search(name + r":\s*\[(.*?)\]", block, re.S)
    if not match:
        return []
    return [s.replace('\\"', '"') for s in re.findall(r'"((?:[^"\\]|\\.)*)"', match.group(1))]


def parse(swift_text):
    categories = []
    for block in blocks(swift_text, "VideoCategory("):
        name = re.search(r'name:\s*"([^"]+)"', block)
        symbol = re.search(r'symbol:\s*"([^"]+)"', block)
        parent = re.search(r'parent:\s*"([^"]+)"', block)
        if not name:
            continue
        categories.append({
            "name": name.group(1),
            "symbol": symbol.group(1) if symbol else "",
            "keywords": field(block, "keywords"),
            "weakKeywords": field(block, "weakKeywords"),
            "parent": parent.group(1) if parent else None,
        })

    start = swift_text.find("public static let aliases: [String: String] = [")
    end = swift_text.find("\n    ]", start)
    aliases = {}
    if start != -1:
        for key, value in re.findall(r'"([^"]+)"\s*:\s*"([^"]+)"', swift_text[start:end]):
            aliases[key] = value
    return {"version": 1, "categories": categories, "aliases": aliases}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "swift",
        nargs="?",
        default=str(pathlib.Path(__file__).resolve().parents[2]
                    / "tubeshelf/Sources/TubeShelfCore/TagTaxonomy.swift"),
    )
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    source = pathlib.Path(args.swift)
    if not source.exists():
        sys.exit(f"Swift taxonomy not found: {source}")

    payload = parse(source.read_text())
    if not payload["categories"]:
        sys.exit("No VideoCategory entries found; did the Swift shape change?")

    root = pathlib.Path(__file__).resolve().parents[1]
    json_path = root / "src/taxonomy.json"
    js_path = root / "src/taxonomy.js"
    encoded = json.dumps(payload, indent=2, ensure_ascii=False) + "\n"

    if args.check:
        current = json.loads(json_path.read_text()) if json_path.exists() else {}
        if current != payload:
            sys.exit("taxonomy is stale; run scripts/sync-taxonomy.py")
        print(f"taxonomy ok: {len(payload['categories'])} categories, "
              f"{len(payload['aliases'])} aliases")
        return

    json_path.write_text(encoded)
    js_path.write_text(
        "// Generated from the Mac app's TagTaxonomy.swift. Do not edit by hand.\n"
        "// Regenerate with scripts/sync-taxonomy.py when the taxonomy changes.\n"
        "export const TAXONOMY = " + json.dumps(payload, indent=2, ensure_ascii=False) + ";\n"
    )
    print(f"wrote {json_path.name} and {js_path.name}: "
          f"{len(payload['categories'])} categories, {len(payload['aliases'])} aliases")


if __name__ == "__main__":
    main()
