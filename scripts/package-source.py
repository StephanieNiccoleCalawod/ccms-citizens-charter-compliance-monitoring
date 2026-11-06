"""Create a source-only ccms-monorepo.zip next to the repository. Python 3 standard library only."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import hashlib
import json

root = Path(__file__).resolve().parent.parent
output = root.parent / 'ccms-monorepo.zip'
excluded_dirs = {'.git', 'node_modules', '.next', 'dist', 'build', 'coverage', '.turbo', '.run-logs', 'test-results', 'playwright-report', '__pycache__'}
excluded_suffixes = {'.log', '.pem', '.key', '.tsbuildinfo', '.zip', '.pyc'}

def include(p):
    relative = p.relative_to(root)
    if any(part in excluded_dirs for part in relative.parts): return False
    if p.name.startswith('.env') and p.name != '.env.example': return False
    if p.name.startswith('.run-') or p.name == 'next-env.d.ts': return False
    if p.suffix in excluded_suffixes or p.name in {'.DS_Store', 'Thumbs.db'}: return False
    return p.is_file() and not p.is_symlink()

def source_files(directory):
    for p in sorted(directory.iterdir()):
        if p.is_symlink(): continue
        if p.is_dir():
            if p.name not in excluded_dirs: yield from source_files(p)
        elif include(p): yield p

count = 0
with ZipFile(output, 'w', ZIP_DEFLATED, compresslevel=9) as archive:
    for p in source_files(root):
        archive.write(p, p.relative_to(root).as_posix())
        count += 1
with ZipFile(output) as archive:
    assert archive.testzip() is None
    assert 'package.json' in archive.namelist()
    assert 'package-lock.json' in archive.namelist()
    assert len([n for n in archive.namelist() if n.endswith('/package.json')]) == 7
print(json.dumps({'archive': str(output), 'files': count, 'bytes': output.stat().st_size, 'sha256': hashlib.sha256(output.read_bytes()).hexdigest()}, indent=2))
