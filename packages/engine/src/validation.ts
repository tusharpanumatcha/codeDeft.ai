import { mkdtempSync, cpSync, existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, lstatSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative, dirname, sep, isAbsolute } from 'node:path';
import { spawnSync } from 'node:child_process';

export type Proposal = { changes: { path: string; content: string }[] };
export type CheckResult = { name: string; status: 'passed'|'failed'|'skipped'; command?: string; exitCode?: number|null; output?: string; reason?: string; durationMs?: number };
export type ValidationReport = { status: 'passed'|'failed'|'incomplete'; repository: string; proposal: string; changedFiles: string[]; checks: CheckResult[]; workspace?: string; warning: string };
const MAX_FILE_BYTES = 2_000_000;
const MAX_OUTPUT = 12_000;
/** Paths a proposal may never write: VCS data, installed packages, and secret files (.env, .env.local, .npmrc …). */
function isProtectedSegment(segment: string): boolean {
  const s = segment.toLowerCase();
  return ['.git', 'node_modules', '.npmrc', '.yarnrc', '.yarnrc.yml', '.ssh'].includes(s) || s === '.env' || s.startsWith('.env.');
}
/**
 * Environment for repository scripts. Only what npm and common toolchains need is passed through, so API keys
 * and tokens in the parent process (e.g. CODEDEFT_API_KEY, AWS_*, GITHUB_TOKEN) are not visible to them.
 */
const ENV_ALLOWLIST = ['PATH', 'Path', 'PATHEXT', 'HOME', 'USERPROFILE', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM',
  'SystemRoot', 'SYSTEMROOT', 'ComSpec', 'COMSPEC', 'WINDIR', 'APPDATA', 'LOCALAPPDATA', 'ProgramFiles', 'ProgramData',
  'NVM_DIR', 'NVM_BIN', 'VOLTA_HOME', 'FNM_DIR', 'PNPM_HOME', 'COREPACK_HOME', 'npm_config_cache', 'NPM_CONFIG_CACHE',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE'];
export function scriptEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ENV_ALLOWLIST) if (source[key] !== undefined) env[key] = source[key];
  return { ...env, CI: 'true', npm_config_yes: 'false', npm_config_fund: 'false', npm_config_audit: 'false' };
}
function safeTarget(root: string, path: string): string {
  if (!path || isAbsolute(path) || path.includes('\\') || path.includes('\0')) throw new Error(`Unsafe proposal path: ${path}`);
  const segments = path.split('/');
  if (segments.some(s => !s || s === '.' || s === '..') || segments.some(isProtectedSegment)) throw new Error(`Unsafe proposal path: ${path}`);
  const target = resolve(root, path);
  if (!target.startsWith(root + sep)) throw new Error(`Proposal escapes workspace: ${path}`);
  let parent = dirname(target);
  while (parent.startsWith(root + sep)) {
    if (existsSync(parent) && lstatSync(parent).isSymbolicLink()) throw new Error(`Symlink parent not allowed: ${path}`);
    parent = dirname(parent);
  }
  if (existsSync(target) && lstatSync(target).isSymbolicLink()) throw new Error(`Symlink target not allowed: ${path}`);
  return target;
}
function run(name: string, command: string, cwd: string, timeoutMs: number): CheckResult {
  const start = Date.now();
  const r = spawnSync(command, {cwd, shell: true, encoding:'utf8', timeout:timeoutMs, maxBuffer: 1024*1024, env:scriptEnvironment()});
  const output = `${r.stdout ?? ''}\n${r.stderr ?? ''}`.trim().slice(-MAX_OUTPUT);
  return {name, command, status:r.status===0?'passed':'failed', exitCode:r.status, output, durationMs:Date.now()-start};
}
/** Execute only on repositories you trust: npm scripts can run arbitrary code. */
export function validateProposal(repoPath: string, proposalPath: string, options: { install?: boolean; keepWorkspace?: boolean; timeoutMs?: number } = {}): ValidationReport {
  const root = realpathSync(repoPath);
  const proposal = JSON.parse(readFileSync(proposalPath,'utf8')) as Proposal;
  if (!proposal || !Array.isArray(proposal.changes) || !proposal.changes.length || proposal.changes.length>100) throw new Error('Proposal must contain 1–100 changes');
  for (const change of proposal.changes) {
    if (!change || typeof change.path !== 'string' || typeof change.content !== 'string' || Buffer.byteLength(change.content)>MAX_FILE_BYTES) throw new Error('Invalid proposal change');
    safeTarget(root, change.path);
  }
  const seen = new Set<string>();
  for (const c of proposal.changes) { if(seen.has(c.path)) throw new Error(`Duplicate path: ${c.path}`); seen.add(c.path); }
  const temp = mkdtempSync(join(tmpdir(),'codedeft-validation-'));
  const workspace = join(temp,'repo');
  const checks: CheckResult[] = [];
  try {
    cpSync(root,workspace,{recursive:true,filter:(src)=> {
      const rel=relative(root,src);
      if (src !== root && lstatSync(src).isSymbolicLink()) return false;
      return !rel.split(sep).some(s=>['.git','node_modules','.next','dist','build','coverage','.nuxt'].includes(s));
    }});
    for(const change of proposal.changes){
      const target=safeTarget(workspace,change.path);
      mkdirSync(dirname(target),{recursive:true});
      writeFileSync(target,change.content,'utf8');
    }
    const pkgPath=join(workspace,'package.json');
    if(!existsSync(pkgPath)) throw new Error('No package.json found in target repository');
    const pkg=JSON.parse(readFileSync(pkgPath,'utf8')) as {scripts?:Record<string,string>};
    const timeoutMs=options.timeoutMs??120_000;
    if(options.install){
      const cmd=existsSync(join(workspace,'package-lock.json'))?'npm ci --ignore-scripts --no-audit --no-fund':'npm install --ignore-scripts --no-audit --no-fund';
      checks.push(run('dependencies',cmd,workspace,timeoutMs));
    } else checks.push({name:'dependencies',status:'skipped',reason:'Use --install to install dependencies in the isolated workspace'});
    if(checks.some(c=>c.name==='dependencies'&&c.status==='failed')){
      for(const name of ['typecheck','lint','test','build']) checks.push({name,status:'skipped',reason:'Dependency installation failed'});
    } else {
      const scripts=pkg.scripts??{};
      for(const [name, candidates] of [
        ['typecheck',['typecheck','check','type-check']],['lint',['lint']],['test',['test:unit','test']],['build',['build']]
      ] as const){
        const script=candidates.find(s=>typeof scripts[s]==='string');
        if(!script) checks.push({name,status:'skipped',reason:'No matching package.json script'});
        else if(!options.install) checks.push({name,status:'skipped',reason:'Dependencies not installed in isolated workspace; rerun with --install'});
        else checks.push(run(name,`npm run ${script}`,workspace,timeoutMs));
      }
    }
    const failed=checks.some(c=>c.status==='failed');
    const skipped=checks.some(c=>c.status==='skipped');
    return {status:failed?'failed':skipped?'incomplete':'passed',repository:root,proposal:resolve(proposalPath),changedFiles:proposal.changes.map(c=>c.path),checks,workspace:options.keepWorkspace?workspace:undefined,warning:'Scripts run only in a temporary copy, but they can execute arbitrary commands and access your machine/network. Only validate trusted repositories and proposals.'};
  } finally {if(!options.keepWorkspace)rmSync(temp,{recursive:true,force:true});}
}
