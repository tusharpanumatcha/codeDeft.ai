/** Figma Reader: pure parsing and normalization, no model calls or code writes. */
export type DesignNode = {id:string;name:string;type:string;visible:boolean;bounds?:{x:number;y:number;width:number;height:number};layout?:Record<string,unknown>;style?:Record<string,unknown>;text?:{content:string;fontSize?:number;fontFamily?:string;fontWeight?:number};componentId?:string;children?:DesignNode[]};
export type DesignDocument = {fileKey:string;nodeId?:string;name:string;fetchedAt:string;nodes:DesignNode[];nodeCount:number;warnings:string[]};

/** Same limit the codeDeft server enforces; checked here so users get a clear message before upload. */
export const MAX_DESIGN_NODES = 15_000;

/**
 * Accepts https://www.figma.com/file|design/KEY/... URLs. For branch URLs
 * (/design/MAINKEY/branch/BRANCHKEY/...) the branch key is returned, because the Figma REST API
 * addresses a branch by its own key.
 */
export function parseFigmaUrl(value:string):{fileKey:string;nodeId?:string;branchOf?:string}{
 const url=new URL(value);if(url.protocol!=='https:'||!['figma.com','www.figma.com'].includes(url.hostname))throw new Error('Expected an HTTPS figma.com file URL');
 const match=url.pathname.match(/^\/(?:file|design)\/([a-zA-Z0-9]+)(?:\/branch\/([a-zA-Z0-9]+))?(?:\/|$)/);if(!match)throw new Error('Invalid Figma design URL');
 const raw=url.searchParams.get('node-id');
 return {fileKey:match[2]??match[1]!,...(match[2]?{branchOf:match[1]}:{}),...(raw?{nodeId:raw.replace(/-/g,':')}:{})};
}
function color(value:any):string|undefined {if(!value||typeof value!=='object')return undefined;const hex=(x:number)=>Math.round(Math.max(0,Math.min(1,x))*255).toString(16).padStart(2,'0');return '#'+hex(value.r??0)+hex(value.g??0)+hex(value.b??0)+(value.a!==undefined&&value.a<1?hex(value.a):'');}
function normalize(node:any,counter:{count:number},depth=0):DesignNode {
 if(depth>60)throw new Error('Figma tree exceeds depth limit');
 if(++counter.count>MAX_DESIGN_NODES)throw new Error(`This design has more than ${MAX_DESIGN_NODES} layers. Select a single frame in Figma and use "Copy link to selection" so the URL includes node-id.`);
 const b=node.absoluteBoundingBox;const fill=Array.isArray(node.fills)?node.fills.find((f:any)=>f.visible!==false&&f.type==='SOLID'):undefined;
 const layout:Record<string,unknown>={};for(const key of ['layoutMode','primaryAxisAlignItems','counterAxisAlignItems','itemSpacing','paddingLeft','paddingRight','paddingTop','paddingBottom','layoutSizingHorizontal','layoutSizingVertical','constraints'])if(node[key]!==undefined)layout[key]=node[key];
 const style:Record<string,unknown>={};if(fill?.color)style.fill=color(fill.color);if(node.cornerRadius!==undefined)style.cornerRadius=node.cornerRadius;if(node.opacity!==undefined)style.opacity=node.opacity;if(node.strokes?.length)style.stroke=color(node.strokes.find((s:any)=>s.color)?.color);
 const result:DesignNode={id:String(node.id??''),name:String(node.name??''),type:String(node.type??'UNKNOWN'),visible:node.visible!==false};
 if(b)result.bounds={x:b.x,y:b.y,width:b.width,height:b.height};if(Object.keys(layout).length)result.layout=layout;if(Object.keys(style).length)result.style=style;
 if(node.type==='TEXT')result.text={content:String(node.characters??''),...(node.style?.fontSize?{fontSize:node.style.fontSize}:{}),...(node.style?.fontFamily?{fontFamily:node.style.fontFamily}:{}),...(node.style?.fontWeight?{fontWeight:node.style.fontWeight}:{})};
 if(node.componentId)result.componentId=node.componentId;
 if(Array.isArray(node.children))result.children=node.children.map((child:any)=>normalize(child,counter,depth+1));return result;
}
export function normalizeFigmaResponse(fileKey:string,response:any,nodeId?:string):DesignDocument {
 const roots=nodeId?[response.nodes?.[nodeId]?.document].filter(Boolean):response.document?.children??[];
 if(!roots.length)throw new Error('Figma response does not contain the selected frame or page');
 const counter={count:0};const nodes=roots.map((node:any)=>normalize(node,counter));
 return {fileKey,nodeId,name:String(response.name??roots[0]?.name??'Figma design'),fetchedAt:new Date().toISOString(),nodes,nodeCount:counter.count,warnings:[]};
}
export type ReadFigmaOptions = {
 /** Figma REST base URL. Defaults to https://api.figma.com; override for corporate proxies or tests. HTTPS required except loopback. */
 apiBase?:string;
 fetchImpl?:typeof fetch;
 timeoutMs?:number;
};
/** Error from the Figma API or network. Never contains the access token. */
export class FigmaReadError extends Error{constructor(message:string,readonly status:number,readonly kind:'auth'|'not_found'|'upstream'|'timeout'|'network'){super(message);this.name='FigmaReadError';}}
export function figmaApiBase(value?:string):string{
 const base=new URL(value||'https://api.figma.com');
 if(base.protocol!=='https:'&&!(base.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(base.hostname)))throw new Error('Figma API base must use HTTPS (or loopback HTTP for tests)');
 return base.toString().replace(/\/+$/,'');
}
export async function readFigma(url:string,token:string,options:ReadFigmaOptions={}):Promise<DesignDocument>{
 if(!token?.trim())throw new Error('Figma personal access token required');const {fileKey,nodeId,branchOf}=parseFigmaUrl(url);
 const base=figmaApiBase(options.apiBase);
 const endpoint=nodeId?`${base}/v1/files/${encodeURIComponent(fileKey)}/nodes?ids=${encodeURIComponent(nodeId)}`:`${base}/v1/files/${encodeURIComponent(fileKey)}`;
 const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),options.timeoutMs??30000);
 const doFetch=options.fetchImpl??fetch;
 try{
  let response:Response;
  try{response=await doFetch(endpoint,{headers:{'X-Figma-Token':token.trim()},signal:controller.signal});}
  catch{throw controller.signal.aborted?new FigmaReadError('Figma did not respond in time',504,'timeout'):new FigmaReadError('Could not reach the Figma API',502,'network');}
  if(!response.ok){
   const kind=response.status===401||response.status===403?'auth':response.status===404?'not_found':'upstream';
   const hint=kind==='auth'?' (check the token and that it can read this file)':kind==='not_found'?(branchOf?' (branch not found or not shared with this token)':' (file or frame not found)'):'';
   throw new FigmaReadError(`Figma API HTTP ${response.status}${hint}`,response.status,kind);
  }
  const design=normalizeFigmaResponse(fileKey,await response.json(),nodeId);
  if(branchOf)design.warnings.push(`Read from branch ${fileKey} of file ${branchOf}.`);
  return design;
 }finally{clearTimeout(timeout)}
}
