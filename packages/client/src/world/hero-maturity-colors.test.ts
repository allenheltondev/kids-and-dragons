import {describe,expect,it} from 'vitest';
import type {ClassId,SpeciesId} from '@kad/shared';
import {coats} from '../../../../content/looks.json';
import {coatMaskUrl} from './coat-masks';
import {characterWorldArtUrl,characterPortraitArtUrl} from './art-paths';
import {heroPaintingUrl,heroCoatOf,heroOfflineArt} from './hero-art';

describe('colors across maturity-tier delivery waves',()=>{
 it('keeps chosen main and accent colors on the new maturity paintings for every species and class',()=>{
  for(const species of ['unicorn','dragonling','griffin','bigfoot','kitsune','manticore'] as SpeciesId[]){
   for(const cls of ['starweaver','songkeeper','duskrunner','thornguard'] as ClassId[]){
    for(const tier of ['ascendant','starborn','legendary'] as const){
     for(const part of ['main','accent'] as const){
      const coat=coats.find(c=>c.species.includes(species)&&c.part===part)!;
      const hero={species,class:cls,tier,look:part==='main'?{coat:coat.id}:{accent:coat.id}};
      for(const place of ['world','portrait'] as const){
       const expected=place==='world'?characterWorldArtUrl(species,tier,cls):characterPortraitArtUrl(species,tier,cls);
       expect(heroPaintingUrl(hero,place)).toBe(expected);
       expect(heroCoatOf(hero,place)?.painting).toBe(expected);
       expect(heroCoatOf(hero,place)?.mask).toBe(coatMaskUrl(expected));
       expect(coatMaskUrl(expected)).not.toBeNull();
      }
     }
    }
   }
  }
 });
 it('uses the same maturity painting with and without selected colors',()=>{
  const hero={species:'unicorn' as const,class:'starweaver' as const,tier:'ascendant' as const};
  const painting=characterWorldArtUrl(hero.species,hero.tier,hero.class);
  expect(heroPaintingUrl(hero,'world')).toBe(painting);
  expect(heroPaintingUrl({...hero,look:{coat:'unicorn_sky'}},'world')).toBe(painting);
  expect(heroCoatOf({...hero,look:{coat:'unicorn_sky'}},'world')?.painting).toBe(painting);
 });
 it('warms maturity paintings and their masks so choosing or removing a color works offline',()=>{
  const hero={species:'unicorn' as const,class:'starweaver' as const,tier:'legendary' as const};
  for(const look of [null,{coat:'unicorn_sky'}]){
   const files=heroOfflineArt({...hero,look});
   expect(files).toContain(characterWorldArtUrl('unicorn','legendary','starweaver'));
   expect(files).toContain(coatMaskUrl(characterWorldArtUrl('unicorn','legendary','starweaver')));
   expect(files.some(p=>p.includes('/mythic/'))).toBe(false);
  }
 });
});
