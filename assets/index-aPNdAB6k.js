import{e as f}from"./index-CJsxlR0Y.js";import"./logger-Bs1cxXFO.js";const h=/url\(\s*(['"]?)(?!['"]?(?:data:|https?:|chrome-extension:|\/\/))([^'")]+)\1\s*\)/g;function g(e,t){return e.replace(h,(o,r,n)=>{try{return`url(${r}${new URL(n,t).href}${r})`}catch{return o}})}function y(e,t){let o;try{o=e.cssRules}catch{return""}const r=Array.from(o,n=>n.cssText).join(`
`);return g(r,e.href??t)}function w(e=document){return Array.from(e.styleSheets).map(t=>y(t,e.baseURI)).filter(t=>t!=="").join(`

`)}const E=[".code-block__actions",".heading-anchor"].join(", "),x=["data-collapse-policy","data-code-theme","data-img-enhanced","data-mermaid-theme","data-mermaid-id"];function b(e){const t=e.cloneNode(!0);for(const o of t.querySelectorAll(E))o.remove();for(const o of t.querySelectorAll(".code-block.is-collapsed"))o.classList.remove("is-collapsed");for(const o of t.querySelectorAll("img"))o.removeAttribute("loading");for(const o of t.querySelectorAll("*"))for(const r of x)o.removeAttribute(r);return t}const R="AbortError";function k(e){return e instanceof DOMException&&e.name===R}function u(e,t){const o=URL.createObjectURL(t),r=document.createElement("a");r.href=o,r.download=e,r.click(),URL.revokeObjectURL(o)}async function m(e,t,o){const r=window.showSaveFilePicker;if(typeof r!="function"||!f())return u(e,t),{status:"done",filename:e,bytes:t.size};try{const n=await r({suggestedName:e,types:[o]}),c=await n.createWritable();return await c.write(t),await c.close(),{status:"done",filename:n.name,bytes:t.size}}catch(n){return k(n)?{status:"cancelled"}:n instanceof DOMException&&n.name==="SecurityError"?(u(e,t),{status:"done",filename:e,bytes:t.size}):{status:"error",message:n instanceof Error?n.message:String(n)}}}function v(e,t){const o=e.replace(/\.[^./\\]+$/,"");return`${o===""?e:o}.${t}`}function A(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}const S=`
/* --- 导出补充：还原阅读器的页面底色与版心 --- */
html, body {
  background: var(--app-bg);
  color: var(--app-text);
}
body {
  margin: 0;
  font-family: var(--content-font-family);
}
.export-article {
  margin: 0 auto;
  padding: 2.5rem 2rem 4rem;
  max-width: var(--content-max-width);
}
.export-footer {
  margin: 3rem auto 0;
  padding-top: 1rem;
  max-width: var(--content-max-width);
  border-top: 1px solid var(--app-border-subtle);
  color: var(--app-text-subtle);
  font-size: 12px;
}
@media print {
  .export-footer { display: none; }
  .export-article { padding: 0; max-width: none; }
}
`;function T(e){const{title:t,bodyHtml:o,css:r,theme:n,generatedAt:c=new Date}=e,i=A(t);return`<!doctype html>
<html lang="zh-CN" data-theme="${n}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Markdown Reader">
<title>${i}</title>
<style>
${r}
${S}
</style>
</head>
<body>
<main class="export-article">
<div class="markdown-body">
${o}
</div>
</main>
<footer class="export-footer">${i} · 由 Markdown Reader 导出于 ${c.toLocaleString("zh-CN")}</footer>
</body>
</html>
`}const L=/^ {0,3}(`{3,}|~{3,})/,$=/^(?: {4}|\t)/,N=/ {2,}$/;function C(e,t){const o=t[0];if(o===void 0)return!1;const r=e.trim();return r.length<t.length?!1:[...r].every(n=>n===o)}function O(e,t={}){const{collapseBlankLines:o=!0}=t,r=e.replace(/\r\n?/g,`
`).split(`
`),n=[];let c=null,i=!1,s=0;for(const a of r){if(c!==null){n.push(a),C(a,c)&&(c=null),s=0;continue}const d=L.exec(a);if(d?.[1]!==void 0){c=d[1],n.push(a.trimEnd()),s=0;continue}const l=a.trim()==="";if(!l){const p=n.length===0||s>0;i=$.test(a)&&(i||p)}if(i&&!l){n.push(a),s=0;continue}if(l){if(n.length===0||(s+=1,o&&!i&&s>1))continue;n.push("");continue}s=0,n.push(N.test(a)?`${a.trimEnd()}  `:a.trimEnd())}for(;n.length>0&&n[n.length-1]==="";)n.pop();return n.length===0?"":`${n.join(`
`)}
`}const U=".markdown-body";async function D(e){const t=document.querySelector(U);if(!t)return{status:"error",message:"正文尚未渲染完成"};const o=T({title:e.doc.name,bodyHtml:b(t).innerHTML,css:w(),theme:e.theme}),r=v(e.doc.name,"html");return m(r,new Blob([o],{type:"text/html;charset=utf-8"}),{description:"HTML 文件",accept:{"text/html":[".html"]}})}async function z(e){const t=O(e.doc.content);return m(e.doc.name,new Blob([t],{type:"text/markdown;charset=utf-8"}),{description:"Markdown 文件",accept:{"text/markdown":[".md",".markdown"]}})}function H(){window.print()}export{T as buildStandaloneHtml,w as collectDocumentCss,D as exportHtml,z as exportMarkdown,H as exportPdf,O as normalizeMarkdown,b as prepareExportFragment,v as replaceExtension,m as saveFile};
//# sourceMappingURL=index-aPNdAB6k.js.map
