import { tryGenerate } from './architecture.ts';
import { auditArchitecture } from './architectural-audit.ts';
import { FAMILIES, type Settings } from './model.ts';

/**
 * The fixed-seed regression batch, and the two outcomes §17.4 asks to be kept apart: whether the plans the
 * engine returns as valid actually are, and how often it finds an acceptable plan at all under its budget.
 * They are never added together — a lower search success with an honest explanation is the better of the
 * two failures, and averaging them would hide exactly the one that matters.
 */
export type BatchOutcome={
  settings:number;
  /** Search success: how often a composition was found that both built and passed the audit. */
  found:number;
  failures:{seed:string;settings:string;reason:string}[];
  /** Accepted-plan validity: of the plans returned as valid, how many stand up to a second look. */
  invalid:{seed:string;settings:string;issues:string[]}[];
  meanNavigation:number;
  meanComposition:number;
  meanRooms:number;
  slowestMs:number;
  totalMs:number;
};

const KINDS=['house','manor','castle'] as const;
const SIZES=[48,64,96,128,160,224,288,352,448,512];
const FLOORS=[1,2,3,4,6,8];
const ORGANIC=[0,35,65,100];

/**
 * The settings for one index of the batch. The strides are coprime with the axis lengths so that a run of
 * consecutive indices walks the whole space instead of marching down one column of it, and the same index
 * always means the same estate: this is a regression batch, not a sample.
 */
export function batchSettings(i:number):Settings {
  const kind=KINDS[i%KINDS.length];
  const family=FAMILIES[kind][Math.floor(i/3)%FAMILIES[kind].length].id;
  return {
    kind,family,
    size:SIZES[Math.floor(i/13)%SIZES.length],
    floors:FLOORS[Math.floor(i/7)%FLOORS.length],
    organic:ORGANIC[Math.floor(i/11)%ORGANIC.length],
    courtyard:i%5===0,chapel:i%3!==0,garden:i%2===0,cellar:i%4===0,
    seed:`BATCH-${i}`,
  };
}

const describe=(s:Settings)=>`${s.kind}/${s.family}/${s.size}/${s.floors}f`;

export function regressionBatch(count:number):BatchOutcome {
  const out:BatchOutcome={settings:count,found:0,failures:[],invalid:[],meanNavigation:0,meanComposition:0,meanRooms:0,slowestMs:0,totalMs:0};
  let navigation=0,composition=0,rooms=0;
  const start=performance.now();
  for(let i=0;i<count;i++){
    const settings=batchSettings(i),at=performance.now();
    const result=tryGenerate(settings);
    out.slowestMs=Math.max(out.slowestMs,performance.now()-at);
    if(!result.ok){out.failures.push({seed:settings.seed,settings:describe(settings),reason:result.error});continue;}
    out.found++;
    navigation+=result.plan.navigation.score;composition+=result.plan.composition.score;rooms+=result.plan.rooms.length;
    const issues=[...auditArchitecture(result.plan),...(result.plan.validation.valid?[]:result.plan.validation.issues)];
    if(issues.length)out.invalid.push({seed:settings.seed,settings:describe(settings),issues});
  }
  out.totalMs=performance.now()-start;
  const n=Math.max(1,out.found);
  out.meanNavigation=Number((navigation/n).toFixed(1));
  out.meanComposition=Number((composition/n).toFixed(1));
  out.meanRooms=Number((rooms/n).toFixed(1));
  return out;
}
