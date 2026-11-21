/** Figma Reader: pure parsing and normalization, no model calls or code writes. */
export type DesignNode = {id:string;name:string;type:string;visible:boolean;bounds?:{x:number;y:number;width:number;height:number};layout?:Record<string,unknown>;style?:Record<string,unknown>;text?:{content:string;fontSize?:number;fontFamily?:string;fontWeight?:number};componentId?:string;children?:DesignNode[]};
export type DesignDocument = {fileKey:string;nodeId?:string;name:string;fetchedAt:string;nodes:DesignNode[];nodeCount:number;warnings:string[]};
export function parseFigmaUrl(value:string):{fileKey:string;nodeId?:string}{
 const url=new URL(value);if(url.protocol!=='https:'||!['figma.com','www.figma.com'].includes(url.hostname))throw new Error('Expected an HTTPS figma.com file URL');
 const match=url.pathname.match(/^\/(?:file|design)\/([a-zA-Z0-9]+)(?:\/|$)/);if(!match)throw new Error('Invalid Figma design URL');
 const raw=url.searchParams.get('node-id');return {fileKey:match[1],...(raw?{nodeId:raw.replace(/-/g,':')}:{})};
}
function color(value:any):string|undefined {if(!value||typeof value!=='object')return undefined;const hex=(x:number)=>Math.round(Math.max(0,Math.min(1,x))*255).toString(16).padStart(2,'0');return '#'+hex(value.r??0)+hex(value.g??0)+hex(value.b??0)+(value.a!==undefined&&value.a<1?hex(value.a):'');}
function normalize(node:any,depth=0):DesignNode {if(depth>60)throw new Error('Figma tree exceeds depth limit');
 const b=node.absoluteBoundingBox;const fill=Array.isArray(node.fills)?node.fills.find((f:any)=>f.visible!==false&&f.type==='SOLID'):undefined;
 const layout:Record<string,unknown>={};for(const key of ['layoutMode','primaryAxisAlignItems','counterAxisAlignItems','itemSpacing','paddingLeft','paddingRight','paddingTop','paddingBottom','layoutSizingHorizontal','layoutSizingVertical','constraints'])if(node[key]!==undefined)layout[key]=node[key];
 const style:Record<string,unknown>={};if(fill?.color)style.fill=color(fill.color);if(node.cornerRadius!==undefined)style.cornerRadius=node.cornerRadius;if(node.opacity!==undefined)style.opacity=node.opacity;if(node.strokes?.length)style.stroke=color(node.strokes.find((s:any)=>s.color)?.color);
 const result:DesignNode={id:String(node.id??''),name:String(node.name??''),type:String(node.type??'UNKNOWN'),visible:node.visible!==false};
 if(b)result.bounds={x:b.x,y:b.y,width:b.width,height:b.height};if(Object.keys(layout).length)result.layout=layout;if(Object.keys(style).length)result.style=style;
 if(node.type==='TEXT')result.text={content:String(node.characters??''),...(node.style?.fontSize?{fontSize:node.style.fontSize}:{}),...(node.style?.fontFamily?{fontFamily:node.style.fontFamily}:{}),...(node.style?.fontWeight?{fontWeight:node.style.fontWeight}:{})};
 if(node.componentId)result.componentId=node.componentId;
 if(Array.isArray(node.children))result.children=node.children.map((child:any)=>normalize(child,depth+1));return result;
}
export function normalizeFigmaResponse(fileKey:string,response:any,nodeId?:string):DesignDocument {
 const roots=nodeId?[response.nodes?.[nodeId]?.document].filter(Boolean):response.document?.children??[];
 if(!roots.length)throw new Error('Figma response does not contain the selected frame or page');
 const nodes=roots.map((node:any)=>normalize(node));let count=0;const walk=(node:DesignNode)=>{count++;node.children?.forEach(walk)};nodes.forEach(walk);
 return {fileKey,nodeId,name:String(response.name??roots[0]?.name??'Figma design'),fetchedAt:new Date().toISOString(),nodes,nodeCount:count,warnings:[]};
}
export async function readFigma(url:string,token:string):Promise<DesignDocument>{
 if(!token?.trim())throw new Error('Figma personal access token required');const {fileKey,nodeId}=parseFigmaUrl(url);
 const endpoint=nodeId?`https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}/nodes?ids=${encodeURIComponent(nodeId)}`:`https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}`;
 const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),30000);
 try{const response=await fetch(endpoint,{headers:{'X-Figma-Token':token},signal:controller.signal});if(!response.ok)throw new Error(`Figma API HTTP ${response.status}${response.status===403?' (check file access and token scopes)':''}`);return normalizeFigmaResponse(fileKey,await response.json(),nodeId)}finally{clearTimeout(timeout)}
}
