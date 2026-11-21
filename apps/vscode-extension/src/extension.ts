// @ts-nocheck
// Ported from v0.7; command behavior preserved.
import * as vscode from 'vscode';
import * as path from 'node:path';
import { readFigma } from '../../../packages/figma-reader/dist/index.js';
function activate(context){
  const output=vscode.window.createOutputChannel('codeDeft');context.subscriptions.push(output);
  const root=()=>{const folder=vscode.workspace.workspaceFolders?.[0];if(!folder)throw new Error('Open a repository folder in VS Code first');return folder.uri.fsPath};
  const request=async(endpoint,data)=>{const config=vscode.workspace.getConfiguration('codedeft');const base=config.get('serverUrl','http://127.0.0.1:4317');const token=config.get('apiToken','');const response=await fetch(new URL(endpoint,base),{method:'POST',headers:{'content-type':'application/json',...(token?{'x-codedeft-token':token}:{})},body:JSON.stringify(data)});const result=await response.json();if(!response.ok)throw new Error(result.error||'Request failed');return result};
  const guard=async(fn)=>{try{await fn()}catch(e){vscode.window.showErrorMessage(`codeDeft: ${e.message}`)}};
  context.subscriptions.push(vscode.commands.registerCommand('codedeft.index',()=>guard(async()=>{const result=await vscode.window.withProgress({location:vscode.ProgressLocation.Notification,title:'codeDeft indexing repository'},()=>request('/api/index',{repository:root()}));vscode.window.showInformationMessage(`codeDeft indexed ${result.files} files and ${result.symbols} symbols`)})));
  context.subscriptions.push(vscode.commands.registerCommand('codedeft.ask',()=>guard(async()=>{const question=await vscode.window.showInputBox({prompt:'Ask codeDeft about this repository',placeHolder:'How is authentication implemented?'});if(!question)return;const result=await request('/api/search',{repository:root(),query:question});output.clear();output.appendLine(`codeDeft · ${question}\n`);for(const hit of result.hits){output.appendLine(`${hit.file} (score ${hit.score})`);output.appendLine(`  ${hit.reasons.join(', ')}\n`)}if(!result.hits.length)output.appendLine('No matching files.');output.show(true);if(result.hits.length){const items=result.hits.map(h=>({label:h.file,description:`Score ${h.score}`,detail:h.reasons.join(', '),hit:h}));const picked=await vscode.window.showQuickPick(items,{placeHolder:'Select a relevant file to open'});if(picked){const uri=vscode.Uri.file(path.join(root(),picked.hit.file));const doc=await vscode.workspace.openTextDocument(uri);const editor=await vscode.window.showTextDocument(doc);const line=Math.max(0,(picked.hit.symbols?.[0]?.line||1)-1);editor.revealRange(new vscode.Range(line,0,line,0))}}})));
  context.subscriptions.push(vscode.commands.registerCommand('codedeft.figmaConnect',()=>guard(async()=>{
    const pat=await vscode.window.showInputBox({prompt:'Figma personal access token (stored securely in VS Code SecretStorage)',password:true,ignoreFocusOut:true});
    if(!pat)return;await context.secrets.store('codedeft.figmaPat',pat);vscode.window.showInformationMessage('codeDeft: Figma token saved securely. Use codeDeft: Read Figma Design.');
  })));
  context.subscriptions.push(vscode.commands.registerCommand('codedeft.figmaDisconnect',()=>guard(async()=>{await context.secrets.delete('codedeft.figmaPat');vscode.window.showInformationMessage('codeDeft: Figma token removed.')})));
  // URL-first workflow: request credentials only after we know which design to read.
  const readFigmaWorkflow=async (initialUrl?:string)=>{
    const url=initialUrl || await vscode.window.showInputBox({
      prompt:'Paste your Figma file or selected frame URL',
      placeHolder:'https://www.figma.com/design/FILE_KEY/Example?node-id=12-45',
      ignoreFocusOut:true
    });
    if(!url)return;
    // Validate before prompting for credentials, avoiding unnecessary token requests.
    const { parseFigmaUrl }=await import('../../../packages/figma-reader/dist/index.js');
    parseFigmaUrl(url.trim());
    let pat=await context.secrets.get('codedeft.figmaPat');
    if(!pat){
      const choice=await vscode.window.showInformationMessage(
        'codeDeft needs a Figma personal access token to read this design. Your token is stored in VS Code SecretStorage.',
        'Connect to Figma'
      );
      if(choice!=='Connect to Figma')return;
      await vscode.commands.executeCommand('codedeft.figmaConnect');
      pat=await context.secrets.get('codedeft.figmaPat');
      if(!pat)return;
    }
    const design=await vscode.window.withProgress({location:vscode.ProgressLocation.Notification,title:'codeDeft retrieving Figma design'},()=>readFigma(url.trim(),pat));
    const doc=await vscode.workspace.openTextDocument({language:'json',content:JSON.stringify(design,null,2)});
    await vscode.window.showTextDocument(doc);
    const action=await vscode.window.showInformationMessage(`Extracted ${design.nodeCount} Figma design nodes. Send to codeDeft engine?`,'Analyze','Generate Proposal');
    if(!action)return;
    const endpoint=action==='Analyze'?'/api/figma/plan':'/api/figma/generate';
    const result=await vscode.window.withProgress({location:vscode.ProgressLocation.Notification,title:'codeDeft analyzing design'},()=>request(endpoint,{repository:root(),design}));
    const report=await vscode.workspace.openTextDocument({language:'json',content:JSON.stringify(result,null,2)});
    await vscode.window.showTextDocument(report);
    if(action==='Generate Proposal'&&result.proposal){
      const validate=await vscode.window.showInformationMessage('Proposal created, NOT applied. Validate in isolated workspace?','Validate');
      if(validate){const validation=await request('/api/figma/validate',{repository:root(),proposal:result.proposal});const vd=await vscode.workspace.openTextDocument({language:'json',content:JSON.stringify(validation,null,2)});await vscode.window.showTextDocument(vd);}
    }
  };
  context.subscriptions.push(vscode.commands.registerCommand('codedeft.figmaRead',()=>guard(()=>readFigmaWorkflow())));
  // Lightweight chat entry point until the full chat sidebar is available.
  context.subscriptions.push(vscode.commands.registerCommand('codedeft.chat',()=>guard(async()=>{
    const message=await vscode.window.showInputBox({prompt:'Ask codeDeft or type figma to import a design',placeHolder:'figma | connect to figma | Figma frame URL | repository question'});
    if(!message)return;
    const trimmed=message.trim();
    if(/^(figma|connect(?:\s+to)?\s+figma|read\s+figma)$/i.test(trimmed))return readFigmaWorkflow();
    if(/^https:\/\/(?:www\.)?figma\.com\//i.test(trimmed))return readFigmaWorkflow(trimmed);
    const result=await request('/api/search',{repository:root(),query:trimmed});
    output.clear();output.appendLine(`codeDeft · ${trimmed}\n`);
    for(const hit of result.hits??[])output.appendLine(`${hit.file} (score ${hit.score}) — ${(hit.reasons??[]).join(', ')}`);
    if(!result.hits?.length)output.appendLine('No matching files.');
    output.show(true);
  })));
  context.subscriptions.push(vscode.commands.registerCommand('codedeft.dashboard',()=>guard(async()=>{const base=vscode.workspace.getConfiguration('codedeft').get('serverUrl','http://127.0.0.1:4317');await vscode.env.openExternal(vscode.Uri.parse(base))})));
}
function deactivate(){}
export { activate, deactivate };
