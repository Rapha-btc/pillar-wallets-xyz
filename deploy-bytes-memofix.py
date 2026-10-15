#!/usr/bin/env python3
"""Deploy bytes for the memo fix (juice-safe-v9 + juice-autostake-safe, d4eda1c).

Deploy form = the repo convention (DEPLOYED-VERIFIED.md): comments stripped with
build-be-templates.strip_clarity, then `clarinet format --stdin`. The same
pipeline reproduces the LIVE juice-safe-v8 bytes (sha512/256 b3d74b90...) from
contracts/juice-safe-v8.clar; this script asserts that before writing anything.

Writes deploy-bytes-memofix/<name>.clar and SHA256SUMS.txt
(<file> <bytes> <sha256> <sha512/256> <source>), the column layout the
autostake stxer harnesses read. --check: verify the folder is current.

  python3 deploy-bytes-memofix.py [--check]
"""
import hashlib, importlib.util, subprocess, sys, tempfile
from pathlib import Path

ROOT = Path(__file__).parent
OUT = ROOT / "deploy-bytes-memofix"
LIVE_V8 = "b3d74b90efebba24a28e3c8d5101fd7c56208deb1699088f18206565f1c0ba15"
PRE_FIX = "93d3adf"  # parent of the memo fix d4eda1c

spec = importlib.util.spec_from_file_location("bbt", ROOT / "build-be-templates.py")
bbt = importlib.util.module_from_spec(spec); spec.loader.exec_module(bbt)


FMT_DIR = tempfile.mkdtemp(prefix="memofix-fmt-")  # clarinet wants a manifest; an empty one keeps
(Path(FMT_DIR) / "Clarinet.toml").write_text('[project]\nname = "fmt"\n')  # the project's simnet plan untouched


def deploy_form(src: str) -> str:
    code = bbt.strip_clarity(src)
    r = subprocess.run(["clarinet", "format", "--stdin"], input=code, capture_output=True, text=True, cwd=FMT_DIR)
    if r.returncode != 0:
        raise SystemExit(f"clarinet format failed: {r.stderr}")
    out = r.stdout
    assert ";" not in out.replace('"', ""), "a ';' survived"
    assert out.count("(") == out.count(")"), "parens unbalanced"
    assert len(out.encode()) < 100_000, "over the 100,000-byte deploy cap"
    return out


def git_show(rev, path):
    return subprocess.run(["git", "show", f"{rev}:{path}"], capture_output=True, text=True, cwd=ROOT, check=True).stdout


h512 = lambda s: hashlib.new("sha512_256", s.encode()).hexdigest()
h256 = lambda s: hashlib.sha256(s.encode()).hexdigest()

v8 = deploy_form((ROOT / "contracts/juice-safe-v8.clar").read_text())
if h512(v8) != LIVE_V8:
    raise SystemExit(f"pipeline does not reproduce live juice-safe-v8: {h512(v8)} != {LIVE_V8}")

head = subprocess.run(["git", "log", "-1", "--format=%h", "--", "contracts/juice-safe-v9.clar", "contracts/juice-autostake-safe.clar"],
                      capture_output=True, text=True, cwd=ROOT).stdout.strip()
FILES = [
    ("juice-safe-v9", (ROOT / "contracts/juice-safe-v9.clar").read_text(), f"contracts/juice-safe-v9.clar@{head}"),
    ("juice-autostake-safe", (ROOT / "contracts/juice-autostake-safe.clar").read_text(), f"contracts/juice-autostake-safe.clar@{head}"),
    ("juice-autostake-safe-prefix", git_show(PRE_FIX, "contracts/juice-autostake-safe.clar"), f"contracts/juice-autostake-safe.clar@{PRE_FIX}(pre-fix-control)"),
    ("juice-autostake-safe-auth-helpers-v1", (ROOT / "contracts/juice-autostake-safe-auth-helpers-v1.clar").read_text(), "contracts/juice-autostake-safe-auth-helpers-v1.clar"),
]
check = "--check" in sys.argv
rows, bad = [], False
for name, src, origin in FILES:
    code = deploy_form(src)
    p = OUT / f"{name}.clar"
    if check:
        if not p.exists() or p.read_text() != code:
            print(f"STALE {p.name}"); bad = True
    else:
        OUT.mkdir(exist_ok=True); p.write_text(code)
    rows.append(f"{name}.clar {len(code.encode())} {h256(code)} {h512(code)} {origin}")
    print(f"  {name:40s} {len(code.encode()):6d} bytes  sha512/256 {h512(code)}")
sums = "\n".join(rows) + "\n"
if check:
    if (OUT / "SHA256SUMS.txt").read_text() != sums:
        print("STALE SHA256SUMS.txt"); bad = True
    sys.exit(1 if bad else 0)
(OUT / "SHA256SUMS.txt").write_text(sums)
print(f"  live juice-safe-v8 reproduced ({LIVE_V8[:12]}); wrote {OUT.name}/")
