import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { generatePlan, DEFAULT_SETTINGS } from './generator.ts';

test('SVG stays identical when engines differ at the final trigonometric decimal',async()=>{
 const require=createRequire(import.meta.url);
 let source=await readFile(new URL('../components/plan-drawing.tsx',import.meta.url),'utf8');
 source=source.replaceAll("'@/lib/generator'",JSON.stringify(new URL('./generator.ts',import.meta.url).href));
 let compiled=ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 for(const name of ['react/jsx-runtime','react'])compiled=compiled.replaceAll(`from "${name}"`,`from ${JSON.stringify(pathToFileURL(require.resolve(name)).href)}`).replaceAll(`from '${name}'`,`from ${JSON.stringify(pathToFileURL(require.resolve(name)).href)}`);
 const {PlanDrawing}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
 const plan=generatePlan(DEFAULT_SETTINGS);
 const render=()=>renderToStaticMarkup(React.createElement('svg',null,React.createElement(PlanDrawing,{plan,floor:plan.floors[0],options:{labels:true,furniture:true,grid:true,dimensions:true,colors:true}})));
 const baseline=render();
 const sin=Math.sin,cos=Math.cos;
 try{Math.sin=x=>sin(x)*(1+Number.EPSILON);Math.cos=x=>cos(x)*(1+Number.EPSILON);assert.equal(render(),baseline);}finally{Math.sin=sin;Math.cos=cos;}
 assert.ok(!baseline.includes('NaN'));
});
