# WAVE7-HANDOFF — download/upload (сваренные стрелки)

Дата: 2026-07-06. Сессия упёрлась в лимит контекста — этот файл = полная инструкция для продолжения.

## Где что лежит
- Worktree: `C:\Users\Daniel\AppData\Local\Temp\wave7-wt`, ветка `feat/wave7`.
- Коммит `8902fe2` «fix(icons): download/upload — сваренные стрелки из рук + fit-decl arrays», 4 файла:
  - `scripts/migrate/fit-decl.mjs` (режим `--arrays`)
  - `semantics/anatomy.json` (декларации download/upload)
  - `svg/Outline/download.svg`, `svg/Outline/upload.svg`

## Что сделано и в каком состоянии
| Иконка | Структура файла | EO≡NZ (шаг 0.24, склейка всех path) | Гейты |
|---|---|---|---|
| download | 2 `<path>`: генератный лоток + сваренная рука-стрелка (`M12 3.4…`) | **0 точек — чисто** | fill-rule OK, anatomy-drift OK |
| upload | 2 `<path>`: генератная коробка + сваренная рука-стрелка (`M11.36 6.42…L12.9 19.83…`) | **16 точек — КРАСНЫЙ** | fill-rule OK, anatomy-drift OK (106 вариантов) |

`npx vitest run test/wave3-play.test.js` → 10 passed, 1 failed:
«корпус: нарушители EO≠NZ — только замороженное легаси» — 2 свежих нарушителя = download+upload варианты… после фикса структуры остался только **upload**.

## Диагноз upload (уже установлен, не переисследовать)
- Корпусный тест **склеивает все `<path>` файла в один d** (test/wave3-play.test.js:96-97) и растит EO vs NZ. Разделение на два path НЕ спасает.
- Точки расхождения: bbox x 8.04–15.96, y 13.8–15.48 — тонкая дуга по линии нижней кромки коробки.
- Рука upload (git show HEAD:svg/Outline/upload.svg) — 2 path:
  - path[0] коробка: нижняя кромка **разорвана** сегментами с капами r=.9 (концы на x≈8.8/9 и 15/15.2, центр x≈9.9–14.1 ОТКРЫТ — там проходит хвост стрелки). Полный d в git.
  - path[1] стрелка: `M11.36 6.42A… 12.64 6.42L15.52 9.3… 12.9 9.23L12.9 19.83A… 11.1 19.83L11.1 9.23L9.68 10.64… 8.42 9.37L8.48 9.3Z` — хвост до y=19.83 пересекает ЛИНИЮ кромки y≈13.7–15.5.
- В руке EO≡NZ проходил, потому что разрыв кромки точно обходит хвост. Мой генератный лоток строит кромку чуть иначе → тонкое перекрытие с хвостом/капами → 16 точек.

## Что делать (порядок)
1. В декларации upload (semantics/anatomy.json) построить нижнюю кромку коробки **разорванной**, как в руке: два сегмента с капами r=.9, зазор по центру x≈9.9–14.1 (взять точные числа из path[0] руки выше). Альтернатива (хуже): укоротить хвост стрелки выше кромки — но это ломает верность руке (fidelityToHand ≥95).
2. Перегенерить upload.svg (конвейер fit-decl / генератор, как для download).
3. Замер точек — скрипт ниже, должен дать 0 по обеим иконкам.
4. Гейты: `node scripts/check-fill-rule.js`; `node scripts/check-anatomy-drift.js --strict`; `npx vitest run test/wave3-play.test.js` (0 свежих EO≠NZ).
5. `git add … && git commit --amend --no-edit --no-gpg-sign` в 8902fe2, `git push -f origin feat/wave7`, PR перевести из draft.

## Скрипт замера EO≠NZ точек (готовый, проверен)
```bash
cd /c/Users/Daniel/AppData/Local/Temp/wave7-wt
node --input-type=module -e "
import { readFileSync } from 'node:fs';
import { samplePolylines } from './scripts/lib/curve-sampling.js';
import { renderedPathData } from './scripts/lib/icon-geometry.js';
function inkBoth(polys, x, y) { let hits=0, wind=0;
  for (const poly of polys) for (let i=0;i<poly.length;i++){ const [x1,y1]=poly[i],[x2,y2]=poly[(i+1)%poly.length];
    if (y1>y!==y2>y && x<x1+((y-y1)/(y2-y1))*(x2-x1)){hits++;wind+=y2>y1?1:-1;} }
  return [hits%2===1, wind!==0]; }
for (const name of ['download','upload']) {
  const d = renderedPathData(readFileSync('svg/Outline/'+name+'.svg','utf8')).join('');
  const polys = samplePolylines(d, 24).filter(p=>p.length>2);
  let pts=[]; for(let x=0.12;x<24;x+=0.24)for(let y=0.12;y<24;y+=0.24){const[eo,nz]=inkBoth(polys,x,y);if(eo!==nz)pts.push([x,y]);}
  console.log(name,'EO≠NZ:',pts.length);
}"
```

## Контекст волны (не трогать)
- LEGACY_EO_NZ в тесте — замороженный список, может только уменьшаться. upload туда НЕ добавлять.
- Гейт IoU decl-vs-рука: THRESHOLD 0.95; статусные варианты в anatomy.json.
- Задача #19 (Волна-7) in_progress; #24/#25 pending — см. TaskList.
