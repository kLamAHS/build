import { regressionBatch } from './regression.ts';

// `npm run batch` — the fixed-seed regression run. Pass a count; the default is the 1,000-seed suite §17
// names as the engineering target. The two outcomes are printed apart, and the exit code follows validity:
// a plan returned as valid that is not is a defect, where a search that honestly gave up is a measurement.
const count=Number(process.argv[2]??1000);
const out=regressionBatch(count);
console.log(`settings ${out.settings}`);
console.log(`accepted-plan validity  ${out.found-out.invalid.length}/${out.found} (${(100*(out.found-out.invalid.length)/Math.max(1,out.found)).toFixed(1)}%)`);
console.log(`search success          ${out.found}/${out.settings} (${(100*out.found/out.settings).toFixed(1)}%)`);
console.log(`mean navigability ${out.meanNavigation}  mean composition ${out.meanComposition}  mean rooms ${out.meanRooms}`);
console.log(`${(out.totalMs/1000).toFixed(0)}s total, slowest ${out.slowestMs.toFixed(0)}ms`);
for(const f of out.failures.slice(0,10))console.log(`  gave up: ${f.settings} ${f.seed} — ${f.reason}`);
if(out.failures.length>10)console.log(`  ...and ${out.failures.length-10} more`);
for(const bad of out.invalid.slice(0,10))console.log(`  INVALID: ${bad.settings} ${bad.seed} — ${bad.issues[0]}`);
process.exit(out.invalid.length?1:0);
