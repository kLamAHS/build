import { insideRoom, type Room } from './model.ts';
import { solid, slab, stair, fence, lantern, chain, bed, barrel, campfire, machine, brewingStand, lectern, enchantingTable, anvil, type BlockState, type Facing } from './block-states.ts';
import type { DetailContext } from './detail-context.ts';

/** The existing fitting footprints remain authoritative; no furniture is stretched into a route. */
export function furnishInteriors(ctx:DetailContext):void {
  const {plan,grid,structure}=ctx;
  const forbidden=(x:number,y:number,z:number)=>plan.stairs.some(s=>x>=s.bounds.x&&x<=s.bounds.x+s.bounds.w&&z>=s.bounds.z&&z<=s.bounds.z+s.bounds.d&&y>s.fromY&&y<=s.toY+s.headroom)
    ||plan.openings.some(o=>y>=o.y&&y<o.y+o.height&&(o.axis==='z'?x>=o.x&&x<o.x+o.width&&Math.abs(z-o.z)<=7:z>=o.z&&z<o.z+o.width&&Math.abs(x-o.x)<=7));
  const put=(room:Room,x:number,y:number,z:number,state:BlockState,material=9)=>{
    if(forbidden(x,y,z)||!insideRoom(room,x,z))return false;
    const kind=grid.kindAt(x,y,z);if(kind!=='air'&&kind!=='furniture')return false;
    grid.apply({x,y,z,w:1,h:1,d:1,material,kind:'furniture',componentId:room.componentId});grid.setState(x,y,z,state);return true;
  };
  for(const room of plan.rooms){
    for(const f of room.furniture){
      // No bounding-box overwrite: remove only cells that still belong to this fitting after the structural replay.
      for(let y=f.y;y<f.y+f.h;y++)for(let z=f.z;z<f.z+f.d;z++)for(let x=f.x;x<f.x+f.w;x++)
        if(grid.kindAt(x,y,z)==='furniture'&&!forbidden(x,y,z))grid.apply({x,y,z,w:1,h:1,d:1,material:0,kind:'air',componentId:room.componentId});
      const facing:Facing=Math.abs(f.x-room.bounds.x-room.bounds.w/2)>Math.abs(f.z-room.bounds.z-room.bounds.d/2)?(f.x<room.bounds.x+room.bounds.w/2?'east':'west'):(f.z<room.bounds.z+room.bounds.d/2?'south':'north');
      const fill=(state:BlockState)=>{for(let y=f.y;y<f.y+f.h;y++)for(let z=f.z;z<f.z+f.d;z++)for(let x=f.x;x<f.x+f.w;x++)put(room,x,y,z,state);};
      if(f.type==='table'||f.type==='desk'){
        const top=f.y+f.h-1;
        for(let z=f.z;z<f.z+f.d;z++)for(let x=f.x;x<f.x+f.w;x++)put(room,x,top,z,slab('spruce_slab','top'));
        if(f.h>1)for(const z of [f.z,f.z+f.d-1])for(let x=f.x;x<f.x+f.w;x+=Math.max(2,f.w-1))for(let y=f.y;y<top;y++)put(room,x,y,z,fence());
      }else if(f.type==='bed'){
        const ax=f.w>=f.d;
        for(let z=f.z;z<f.z+f.d;z+=ax?2:3)for(let x=f.x;x<f.x+f.w;x+=ax?3:2){
          const hx=x+(ax?1:0),hz=z+(ax?0:1);if(hx>=f.x+f.w||hz>=f.z+f.d)continue;
          put(room,x,f.y,z,bed(ax?'east':'south','foot'));put(room,hx,f.y,hz,bed(ax?'east':'south','head'));
        }
      }else if(f.type==='bench'||f.type==='seat')fill(stair('spruce_stairs',facing));
      else if(f.type==='crate')fill(barrel());
      else if(f.type==='shelf')fill(solid('bookshelf'));
      else if(f.type==='lectern'){fill(solid('bookshelf'));put(room,f.x,f.y,f.z,room.name.toLowerCase().startsWith('enchant')?enchantingTable():lectern(facing));}
      else if(f.type==='hearth'||f.type==='oven'||f.type==='forge'){
        fill(solid('bricks'));
        const x=f.x+Math.floor(f.w/2),z=f.z+Math.floor(f.d/2);
        if(grid.kindAt(x,f.y,z)==='furniture')grid.setState(x,f.y,z,f.type==='hearth'?campfire(facing):machine(f.type==='forge'?'blast_furnace':'furnace',facing));
        if(f.type==='forge'&&f.w>2)put(room,f.x,f.y,f.z,anvil(facing));
      }else if(f.type==='altar')fill(slab('smooth_stone_slab','top'));
      else if(f.type==='dais')fill(solid('polished_andesite'));
      else if(f.type==='still'){fill(solid('polished_andesite'));put(room,f.x+Math.floor(f.w/2),f.y+f.h-1,f.z+Math.floor(f.d/2),brewingStand());}
      else if(f.type==='well'){fill(solid('stone_bricks'));for(let y=f.y;y<f.y+f.h;y++)for(let z=f.z+1;z<f.z+f.d-1;z++)for(let x=f.x+1;x<f.x+f.w-1;x++)put(room,x,y,z,solid('water'));}
      else fill(solid('spruce_planks'));
    }
    if(room.kind==='court')continue;
    const component=plan.components.find(c=>c.id===room.componentId);
    if(!component)continue;
    let lamps=0;
    for(let z=room.bounds.z+3;z<room.bounds.z+room.bounds.d-2;z+=8)for(let x=room.bounds.x+3;x<room.bounds.x+room.bounds.w-2;x+=8){
      if(!insideRoom(room,x,z))continue;
      // Find a real overhead surface. Double-height halls do not get unsupported floating lanterns.
      let ceiling=room.floorY+5;
      const limit=Math.min(component.topY+Math.ceil(Math.min(component.bounds.w,component.bounds.d)/2)+10,room.ceilingY+16);
      while(ceiling<=limit&&!grid.get(x,ceiling,z))ceiling++;
      if(ceiling>limit)continue;
      const y=Math.max(room.floorY+4,Math.min(ceiling-1,room.ceilingY-room.floorY>6?room.floorY+7:room.ceilingY-1));
      if(grid.get(x,y,z)||forbidden(x,y,z)||y>=ceiling)continue;
      // The complete suspension must fit before placing its lamp.
      let clear=true;for(let yy=y;yy<ceiling;yy++)if(grid.get(x,yy,z)||forbidden(x,yy,z)){clear=false;break;}
      if(!clear)continue;
      for(let yy=y+1;yy<ceiling;yy++)put(room,x,yy,z,chain(),8);
      if(put(room,x,y,z,lantern(true),8))lamps++;
    }
    if(lamps)ctx.features.push({kind:'interior-lighting',componentId:component.id,blocks:lamps,bounds:{...room.bounds,y:room.floorY,h:room.ceilingY-room.floorY}});
  }
  void structure;
}
