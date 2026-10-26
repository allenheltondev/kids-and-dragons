"""Build an offline motion review from the exact production prop assets and CSS."""
import base64,html,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
HERE=Path(__file__).resolve().parent

def url(path):return 'data:image/webp;base64,'+base64.b64encode((ROOT/path).read_bytes()).decode('ascii')
manifest=json.loads((ROOT/'assets/manifest.json').read_text(encoding='utf-8'))
spec=manifest['storyProps'];cards=[]
requested=[e['id'] for e in json.loads((HERE/'sources.json').read_text(encoding='utf-8')) if e['kind']=='prop']
for id in requested:
 motion=spec['motions'][id];name=html.escape(id.replace('-',' ').title())
 cards.append(f'<article class="card"><h2>{name}</h2><div class="well"><img class="story-prop" data-motion="{motion["preset"]}" style="--story-prop-duration:{motion["durationMs"]}ms" src="{url("assets/story-props/"+id+".webp")}" alt=""></div><p>{motion["preset"]}</p></article>')
mound=url('assets/story-props/snow-mound.webp');kid=url('assets/cast/snowhorn_kid/portrait.webp')
tracking=''.join(f'<div class="burrow">'+(f'<div class="kid-window"><img class="kid story-prop" data-motion="peek" src="{kid}" alt="Goat kid"></div>' if i==1 else '')+f'<img class="mound" src="{mound}" alt="Snow mound"></div>' for i in range(3))
css=(ROOT/'assets/story-props/motion.css').read_text(encoding='utf-8-sig')
page='''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Riftlight interaction art review</title><style>
*{box-sizing:border-box}body{margin:0;background:#172c2e;color:#f5e7cc;font:16px/1.5 system-ui,sans-serif}main{max-width:1160px;margin:auto;padding:28px}h1{font:600 34px Georgia,serif;margin:0 0 8px}header p{max-width:700px;margin:0 0 20px;color:#d6d3bd}.controls{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:26px}button{font:inherit;border:1px solid #d1af64;border-radius:8px;padding:8px 16px;background:#284345;color:#fff5dc;cursor:pointer}button[aria-pressed=true]{background:#a87835;color:#fff}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px}.card{background:#efe5d0;color:#3a2a1e;border-radius:12px;padding:18px;overflow:hidden}.card h2{font:600 20px Georgia,serif;margin:0}.card p{margin:0;color:#67523a;font-size:14px}.well{height:210px;display:grid;place-items:center;overflow:hidden}.well img{width:180px;height:180px}.tracking{margin-top:24px;background:#294347;border-radius:12px;padding:20px}.tracking h2{margin:0 0 8px;font:600 24px Georgia,serif}.burrows{display:flex;gap:10px;max-width:680px}.burrow{position:relative;flex:1;height:180px;overflow:hidden}.mound{position:absolute;bottom:-30px;width:100%;height:160px;object-fit:contain;z-index:2}.kid-window{position:absolute;inset:0 0 40px;overflow:hidden;z-index:1}.kid{position:absolute;width:70%;height:130px;object-fit:contain;left:15%;bottom:-12px;z-index:1}.paused .story-prop{animation-play-state:paused!important}.force-reduced .story-prop{animation:none!important}@media(max-width:500px){main{padding:18px}.grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.card{padding:12px}.card h2{font-size:17px}.well{height:150px}.well img{width:120px;height:120px}.burrow{height:140px}.kid{height:90px;bottom:-12px}.mound{height:115px;bottom:-20px}}
'''+css+'''</style><main><header><h1>Riftlight interaction art</h1><p>Painted objects, sound glyphs, water cues and a snow-cover study. Looping motion previews for art review.</p></header><div class="controls"><button id="pause" aria-pressed="false">Pause motion</button><button id="reduce" aria-pressed="false">Reduce motion</button></div><section class="grid">'''+''.join(cards)+'''</section><section class="tracking"><h2>Snow-cover compositing</h2><p>Three identical covers, with the approved goat kid behind the middle mound.</p><div class="burrows">'''+tracking+'''</div></section></main><script>
for (const [id,cls,on,off] of [['pause','paused','Resume motion','Pause motion'],['reduce','force-reduced','Show motion','Reduce motion']]) { const button=document.getElementById(id);button.addEventListener('click',()=>{const active=document.body.classList.toggle(cls);button.setAttribute('aria-pressed',String(active));button.textContent=active?on:off;}); }
</script></html>'''
(HERE/'motion-preview.html').write_text(page,encoding='utf-8')
print('Built standalone motion review for',len(requested),'props.')
