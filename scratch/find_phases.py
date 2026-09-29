import json
import re

import os
transcript_path = r"C:\Users\Misha\.gemini\antigravity\brain\b0a44186-c2a0-4f11-bb15-35ff93d66e7a\.system_generated\logs\transcript.jsonl"
out_file = os.path.join(os.path.dirname(__file__), "find_phases.txt")

with open(transcript_path, "r", encoding="utf-8") as f, open(out_file, "w", encoding="utf-8") as out:
    for idx, line in enumerate(f):
        try:
            d = json.loads(line)
            content = d.get("content", "")
            # Look for instances where Phase 1, Phase 2, etc. are listed together
            if "Phase 1" in content and "Phase 2" in content:
                out.write(f"=== STEP {idx} (type: {d.get('type')}, source: {d.get('source')}) ===\n")
                out.write(content + "\n\n")
        except Exception as e:
            pass

print("Done writing to", out_file)
