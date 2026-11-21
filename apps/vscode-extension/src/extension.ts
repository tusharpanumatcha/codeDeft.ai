// @ts-nocheck
// Ported from v0.7; command behavior preserved.
import * as vscode from 'vscode';
import * as path from 'node:path';
function activate(context){
  const output=vscode.window.createOutputChannel('codeDeft');context.subscriptions.push(output);
  const root=()=>{const folder=vscode.workspace.workspaceFolders?.[0];if(!folder)throw new Error('Open a repository folder in VS Code first');return folder.uri.fsPath};
  const request=async(endpoint,data)=>{const config=vscode.workspace.getConfiguration('codedeft');const base=config.get('serverUrl','http://127.0.0.1:4317');const token=config.get('apiToken','');const response=await fetch(new URL(endpoint,base),{method:'POST',headers:{'content-type':'application/json',...(token?{'x-codedeft-token':token}:{})},body:JSON.stringify(data)});const result=await response.json();if(!response.ok)throw new Error(result.error||'Request failed');return result};
  const guard=async(fn)=>{try{await fn()}catch(e){vscode.window.showErrorMessage(`codeDeft: ${e.message}`)}};
  context.subscriptions.push(vscode.commands.registerCommand('codedeft.index',()=>guard(async()=>{const result=await vscode.window.withProgress({location:vscode.ProgressLocation.Notification,title:'codeDeft indexing repository'},()=>request('/api/index',{repository:root()}));vscode.window.showInformationMessage(`codeDeft indexed ${result.files} files and ${result.symbols} symbols`)})));
  context.subscriptions.push(vscode.commands.registerCommand('codedeft.ask',()=>guard(async()=>{const question=await vscode.window.showInputBox({prompt:'Ask codeDeft about this repository',placeHolder:'How is authentication implemented?'});if(!question)return;const result=await request('/api/search',{repository:root(),query:question});output.clear();output.appendLine(`codeDeft · ${question}\n`);for(const hit of result.hits){output.appendLine(`${hit.file} (score ${hit.score})`);output.appendLine(`  ${hit.reasons.join(', ')}\n`)}if(!result.hits.length)output.appendLine('No matching files.');output.show(true);if(result.hits.length){const items=result.hits.map(h=>({label:h.file,description:`Score ${h.score}`,detail:h.reasons.join(', '),hit:h}));const picked=await vscode.window.showQuickPick(items,{placeHolder:'Select a relevant file to open'});if(picked){const uri=vscode.Uri.file(path.join(root(),picked.hit.file));const doc=await vscode.workspace.openTextDocument(uri);const editor=await vscode.window.showTextDocument(doc);const line=Math.max(0,(picked.hit.symbols?.[0]?.line||1)-1);editor.revealRange(new vscode.Range(line,0,line,0))}}})));
  context.subscriptions.push(vscode.commands.registerCommand('codedeft.dashboard',()=>guard(async()=>{const base=vscode.workspace.getConfiguration('codedeft').get('serverUrl','http://127.0.0.1:4317');await vscode.env.openExternal(vscode.Uri.parse(base))})));
}
function deactivate(){}
export { activate, deactivate };
