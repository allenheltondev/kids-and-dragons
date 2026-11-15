import {afterEach,describe,expect,it} from 'vitest';
import type {ClassId,SpeciesId} from '@kad/shared';
import {coats} from '../../../../content/looks.json';
import {coatMaskPaintings,setCoatMaskPaintings} from './coat-masks';
import {characterWorldArtUrl,characterPortraitArtUrl} from './art-paths';
import {heroPaintingUrl,heroCoatOf,heroOfflineArt} from './hero-art';

afterEach(()=>setCoatMaskPaintings(null));
describe('colors across maturity-tier delivery waves',()=>{
 it('keeps chosen main and accent colors on masked Mythic art until the new mask arrives',()=>{
  for(const species of ['unicorn','dragonling','griffin','bigfoot','kitsune','manticore'] as SpeciesId[]){
   for(const cls of ['starweaver','songkeeper','duskrunner','thornguard'] as ClassId[]){
    for(const tier of ['ascendant','starborn','legendary'] as const){
     for(const part of ['main','accent'] as const){
      const coat=coats.find(c=>c.species.includes(species)&&c.part===part)!;
      const hero={species,class:cls,tier,look:part==='main'?{coat:coat.id}:{accent:coat.id}};
      for(const place of ['world','portrait'] as const){
       const expected=place==='world'?characterWorldArtUrl(species,'mythic',cls):characterPortraitArtUrl(species,'mythic',cls);
       expect(heroPaintingUrl(hero,place)).toBe(expected);
       expect(heroCoatOf(hero,place)?.painting).toBe(expected);
      }
     }
    }
   }
  }
 });
 it('uses the maturity painting without colors and automatically adopts a newly delivered mask',()=>{
  const hero={species:'unicorn' as const,class:'starweaver' as const,tier:'ascendant' as const};
  const painting=characterWorldArtUrl(hero.species,hero.tier,hero.class);
  expect(heroPaintingUrl(hero,'world')).toBe(painting);
  setCoatMaskPaintings([...coatMaskPaintings(),painting.slice('/assets/'.length)]);
  expect(heroPaintingUrl({...hero,look:{coat:'unicorn_sky'}},'world')).toBe(painting);
  expect(heroCoatOf({...hero,look:{coat:'unicorn_sky'}},'world')?.painting).toBe(painting);
 });
 it('warms both paintings so choosing or removing a color works offline',()=>{
  const hero={species:'unicorn' as const,class:'starweaver' as const,tier:'legendary' as const};
  for(const look of [null,{coat:'unicorn_sky'}]){
   const files=heroOfflineArt({...hero,look});
   expect(files).toContain(characterWorldArtUrl('unicorn','legendary','starweaver'));
   expect(files).toContain(characterWorldArtUrl('unicorn','mythic','starweaver'));
   expect(files).toContain(characterPortraitArtUrl('unicorn','mythic','starweaver'));
  }
 });
});
