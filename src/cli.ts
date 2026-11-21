#!/usr/bin/env node
import { validateProposal } from './validation.js';
import { RepositoryStore } from './storage.js';
import { indexRepository, analyzeRepository, createContextBundle, saveProfile, createAgentPlan, generateWithModel } from './index.js';
const [command,root='.',...rest]=process.argv.slice(2);
if(!['analyze','context','agent','generate','validate','db-index','db-info','db-context','db-agent'].includes(command||'')) {
  console.error('Usage: codedeft analyze <repo-path> [output.json] | codedeft context <repo-path> <task> | codedeft agent <repo-path> <task> | codedeft generate <repo-path> <task> | codedeft validate <repo-path> <proposal.json> [--install] [--keep-workspace] | codedeft db-index <repo-path> [--db database.sqlite] | codedeft db-info <repo-path> [--db database.sqlite] | codedeft db-context <repo-path> <task> [--db database.sqlite] | codedeft db-agent <repo-path> <task> [--db database.sqlite]');
  process.exitCode=1;
} else {
  try {
    if(command?.startsWith('db-')){
      const dbFlag=rest.indexOf('--db');
      const dbPath=dbFlag>=0?rest[dbFlag+1]:undefined;
      if(dbFlag>=0&&!dbPath)throw new Error('Provide a path after --db');
      const args=dbFlag>=0?rest.filter((_,i)=>i!==dbFlag&&i!==dbFlag+1):rest;
      const store=new RepositoryStore(dbPath);
      try {
        if(command==='db-index')console.log(JSON.stringify(store.index(root),null,2));
        else if(command==='db-info')console.log(JSON.stringify({stats:store.stats(root),profile:store.profile(root)},null,2));
        else {
          if(!args.length)throw new Error('Provide a task description');
          const index=store.load(root);
          const task=args.join(' ');
          console.log(JSON.stringify(command==='db-agent'?createAgentPlan(index,task):createContextBundle(index,task),null,2));
        }
      } finally {store.close();}
    } else if(command==='validate'){
      const proposal=rest.find(arg=>!arg.startsWith('--'));
      if(!proposal)throw new Error('Provide a proposal JSON path');
      const report=validateProposal(root,proposal,{install:rest.includes('--install'),keepWorkspace:rest.includes('--keep-workspace')});
      console.log(JSON.stringify(report,null,2));
      if(report.status==='failed')process.exitCode=2;
    } else {
    const index=indexRepository(root);
    if(command==='analyze'){
      const profile=analyzeRepository(index);
      if(rest[0])saveProfile(profile,rest[0]);
      console.log(JSON.stringify(profile,null,2));
    } else if(command==='agent' || command==='generate') {
      if(!rest.length)throw new Error('Provide a task description');
      const plan=createAgentPlan(index,rest.join(' '));
      if(command==='agent') console.log(JSON.stringify(plan,null,2));
      else {
        const apiKey=process.env.CODEDEFT_API_KEY;
        const model=process.env.CODEDEFT_MODEL;
        const endpoint=process.env.CODEDEFT_ENDPOINT;
        if(!apiKey||!model||!endpoint) throw new Error('Set CODEDEFT_API_KEY, CODEDEFT_MODEL and CODEDEFT_ENDPOINT to enable generation');
        const answer=await generateWithModel(plan,{apiKey,model,endpoint});
        console.log(JSON.stringify(answer,null,2));
      }
    } else {
      if(!rest.length)throw new Error('Provide a task description');
      console.log(JSON.stringify(createContextBundle(index,rest.join(' ')),null,2));
    }
    }
  }catch(err){console.error(err instanceof Error?err.message:String(err));process.exitCode=1;}
}
