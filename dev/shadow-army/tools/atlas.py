import sys,pathlib,json
from PIL import Image
R=pathlib.Path(sys.argv[1]); OUT=pathlib.Path(sys.argv[2])
M="Monsters_Creatures_Fantasy/Monsters_Creatures_Fantasy/"
CH={
 "mh":("Martial_Hero/Martial Hero/Sprites/",{"idle":"Idle","attack":"Attack1","hit":"Take Hit","death":"Death"}),
 "mh2":("Martial_Hero_2/Martial Hero 2/Sprites/",{"idle":"Idle","attack":"Attack1","hit":"Take hit","death":"Death"}),
 "hun":("Huntress/Huntress/Sprites/",{"idle":"Idle","attack":"Attack1","hit":"Take hit","death":"Death"}),
 "fw":("Fantasy_Warrior/Fantasy Warrior/Sprites/",{"idle":"Idle","attack":"Attack1","hit":"Take hit","death":"Death"}),
 "king":("Medieval_King_Pack/Medieval King Pack/",{"idle":"Idle","attack":"Attack_1","hit":"Hit","death":"Death"}),
 "eye":(M+"Flying eye/",{"idle":"Flight","attack":"Attack","hit":"Take Hit","death":"Death"}),
 "gob":(M+"Goblin/",{"idle":"Idle","attack":"Attack","hit":"Take Hit","death":"Death"}),
 "wiz2":("EVil_Wizard_2/EVil Wizard 2/Sprites/",{"idle":"Idle","attack":"Attack1","hit":"Take hit","death":"Death"}),
 "wiz3":("Evil_Wizard_3/Evil Wizard 3/Sprites/",{"idle":"Idle","attack":"Attack","hit":"Get hit","death":"Death"}),
}
PAD=2; meta={}
for k,(d,anims) in CH.items():
    sheets={a:Image.open(R/d/(f+".png")).convert("RGBA") for a,f in anims.items()}
    fs=next(iter(sheets.values())).height
    frames={a:[im.crop((i*fs,0,(i+1)*fs,fs)) for i in range(im.width//fs)] for a,im in sheets.items()}
    # union bbox over all frames so every frame keeps the same anchor
    bb=None
    for fl in frames.values():
        for f in fl:
            b=f.getbbox()
            if b: bb=b if bb is None else (min(bb[0],b[0]),min(bb[1],b[1]),max(bb[2],b[2]),max(bb[3],b[3]))
    x0,y0,x1,y1=bb[0]-PAD,bb[1]-PAD,bb[2]+PAD,bb[3]+PAD; w,h=x1-x0,y1-y0
    # body metrics from idle frames: feet line, height, horizontal center
    ib=None
    for f in frames["idle"]:
        b=f.getbbox()
        if b: ib=b if ib is None else (min(ib[0],b[0]),min(ib[1],b[1]),max(ib[2],b[2]),max(ib[3],b[3]))
    order=["idle","attack","hit","death"]; n=max(len(frames[a]) for a in order)
    atlas=Image.new("RGBA",(w*n,h*len(order)),(0,0,0,0))
    for r,a in enumerate(order):
        for i,f in enumerate(frames[a]): atlas.paste(f.crop((x0,y0,x1,y1)),(i*w,r*h))
    atlas.save(OUT/f"{k}.png",optimize=True)
    meta[k]={"w":w,"h":h,"feet":ib[3]-y0,"body":ib[3]-ib[1],"cx":(ib[0]+ib[2])/2-x0,"top":ib[1]-y0,"n":{a:len(frames[a]) for a in order}}
print(json.dumps(meta,separators=(",",":")))
