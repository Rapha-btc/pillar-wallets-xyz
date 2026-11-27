"""Local dependency bindings only. Wallet/auth bodies are unchanged."""
from pathlib import Path
import re,json,hashlib,shutil
here=Path(__file__).resolve().parent;root=here.parents[1];out=here/'.build'
(out/'contracts').mkdir(parents=True,exist_ok=True);(out/'settings').mkdir(exist_ok=True)
files={p.stem:p.read_text() for p in (here/'mocks').glob('*.clar')}
production=json.loads((here/'production.json').read_text());hashes={}
for n,path in production.items():
 raw=(root/path).read_bytes();files[n]=raw.decode();hashes[path]=hashlib.sha256(raw).hexdigest()
for n,s in files.items():
 s=re.sub(r"'[A-Z0-9]+\.([a-zA-Z0-9_-]+)",lambda m:'.'+m[1] if m[1] in files else m[0],s)
 (out/'contracts'/f'{n}.clar').write_text(s)
manifest='[project]\nname="wallet-nov27"\ntelemetry=false\ncache_dir=".cache"\n[repl.analysis]\npasses=[]\n'
for n in files:manifest+=f'\n[contracts.{n}]\npath="contracts/{n}.clar"\nclarity_version=6\nepoch="4.0"\n'
(out/'Clarinet.toml').write_text(manifest);shutil.copyfile(root/'settings/Devnet.toml',out/'settings/Devnet.toml')
(out/'source-hashes.json').write_text(json.dumps(hashes,indent=2)+'\n')

(here/'settings').mkdir(exist_ok=True)
shutil.copyfile(root/'settings/Devnet.toml',here/'settings/Devnet.toml')
