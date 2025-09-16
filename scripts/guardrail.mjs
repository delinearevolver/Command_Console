import fs from "fs";
import yaml from "js-yaml";
import micromatch from "micromatch";
import { execSync } from "child_process";

const manifest = yaml.load(fs.readFileSync("LLM_MANIFEST.yaml","utf8"));
const imm = manifest.immutable_paths || [];
const START = manifest.protected_regions?.start || "// <keep>";
const END   = manifest.protected_regions?.end   || "// </keep>";

function atHead(p){ try { return execSync(git show HEAD:, {encoding:"utf8"}); } catch { return null; } }
const changed = execSync("git diff --cached --name-only", {encoding:"utf8"}).trim().split("\n").filter(Boolean);

let errors = [];
for (const f of changed) {
  if (micromatch.isMatch(f, imm)) errors.push(Immutable path touched: );
  const before = atHead(f); if (!before) continue;
  const after = fs.readFileSync(f, "utf8");
  const grab = s => { let out="", i=0; for(;;){ const a=s.indexOf(START,i); if(a<0) break; const b=s.indexOf(END,a); if(b<0) break; out+=s.slice(a,b+END.length); i=b+END.length; } return out; };
  if (grab(before) !== grab(after)) errors.push(Protected region changed: );
}

if (errors.length){
  console.error("\nGuardrail blocked commit:\n" + errors.map(e=>" - "+e).join("\n"));
  process.exit(1);
}
