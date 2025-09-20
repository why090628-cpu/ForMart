
/* ====== Util / State ====== */
const $ = (s, r=document)=>r.querySelector(s);
const $$ = (s, r=document)=>Array.from(r.querySelectorAll(s));
const el = (t,c,txt)=>{ const e=document.createElement(t); if(c) e.className=c; if(txt!=null) e.textContent=txt; return e; };
const now = ()=> Date.now();
const toUSD = n => `$${Number(n||0).toLocaleString(undefined,{maximumFractionDigits:0})}`;
const timeAgo = t => { const s=Math.floor((Date.now()-t)/1000); if(s<60) return `${s}s ago`; const m=s/60|0; if(m<60) return `${m}m ago`; const h=m/60|0; if(h<24) return `${h}h ago`; const d=h/24|0; return `${d}d ago`; };
const saveJSON = (k,v)=>{ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){ console.warn("save error",e); } };
const safeJSON = (k,def)=>{ try{ const r=localStorage.getItem(k); return r?JSON.parse(r):def; }catch{ return def; } };
const compressImage = async (file, maxW=1600, q=0.8)=>{
  const img = await new Promise((res,rej)=>{ const i=new Image(); i.onload=()=>res(i); i.onerror=rej; i.src=URL.createObjectURL(file); });
  const scale = Math.min(1, maxW / img.width);
  const w = Math.round(img.width*scale), h = Math.round(img.height*scale);
  const c = document.createElement("canvas"); c.width=w; c.height=h;
  const ctx = c.getContext("2d"); ctx.drawImage(img,0,0,w,h);
  const data = c.toDataURL("image/jpeg", q); URL.revokeObjectURL(img.src); return data;
};

/* ====== Keys / Local State ====== */
const KEYS = {
  posts: "formart_posts_v5",
  listings: "formart_listings_v5",
  account: "formart_account_v5",
  likes: "formart_likes_v1",
  favs: "formart_favs_v1",
  theme: "formart_theme_v1",
  token: "formart_token_v1",
};

let posts = safeJSON(KEYS.posts, []);
let listings = safeJSON(KEYS.listings, []);
let account = safeJSON(KEYS.account, { id:"local-user", name:"Guest", bio:"Fashion & deals.", avatar:null });
let likes = new Set(safeJSON(KEYS.likes, []));
let favs  = new Set(safeJSON(KEYS.favs, []));
const saveAll = ()=>{ saveJSON(KEYS.posts, posts); saveJSON(KEYS.listings, listings); saveJSON(KEYS.account, account); saveJSON(KEYS.likes,[...likes]); saveJSON(KEYS.favs,[...favs]); };

/* ====== Backend API (ready for your server) ====== */
const BASE_URL = ""; // e.g. "http://13.57.201.94"  ← 填上你的后端地址
const authToken = ()=> localStorage.getItem(KEYS.token) || ""; // 你接好登录后把 token 存这里

async function apiFetch(path, opts={}){
  if(!BASE_URL){ throw new Error("No BASE_URL set; using local fallback."); }
  const headers = Object.assign(
    {"Content-Type":"application/json"},
    opts.headers||{},
    authToken()? {"Authorization":"Bearer "+authToken()} : {}
  );
  const res = await fetch(BASE_URL+path, Object.assign({}, opts, {headers}));
  if(!res.ok) throw new Error("API error: "+res.status);
  const ct = res.headers.get("content-type")||"";
  return ct.includes("application/json") ? res.json() : res.text();
}
const api = {
  me: ()=> apiFetch("/api/auth/me").catch(()=>({id:account.id,name:account.name,avatar:account.avatar,bio:account.bio})),
  user: (id)=> apiFetch(`/api/users/${id}`).catch(()=>localUserSnapshot(id)),
  posts: {
    list: ()=> apiFetch("/api/posts").catch(()=> posts),
    create: (payload)=> apiFetch("/api/posts",{method:"POST",body:JSON.stringify(payload)}).catch(()=>{
      // local fallback
      const p = Object.assign({id:crypto.randomUUID(), time:now(), likes:0, images:[]}, payload);
      posts.unshift(p); saveJSON(KEYS.posts, posts); return p;
    }),
    like: (id,flag)=> apiFetch(`/api/posts/${id}/like`,{method: flag?"POST":"DELETE"}).catch(()=>{
      localToggleLike(id,"post",flag);
      return {ok:true};
    }),
  },
  listings: {
    list: ()=> apiFetch("/api/listings").catch(()=> listings),
    create: (payload)=> apiFetch("/api/listings",{method:"POST",body:JSON.stringify(payload)}).catch(()=>{
      const l = Object.assign({id:crypto.randomUUID(), time:now(), likes:0, photos:[]}, payload);
      listings.unshift(l); saveJSON(KEYS.listings, listings); return l;
    }),
    like: (id,flag)=> apiFetch(`/api/listings/${id}/like`,{method: flag?"POST":"DELETE"}).catch(()=>{
      localToggleLike(id,"listing",flag);
      return {ok:true};
    }),
    favorite: (id,flag)=> apiFetch(`/api/listings/${id}/favorite`,{method: flag?"POST":"DELETE"}).catch(()=>{
      if(flag) favs.add(id); else favs.delete(id); saveJSON(KEYS.favs,[...favs]); return {ok:true};
    })
  },
  upload: {
    media: async (files)=>{ // 返回后端文件URL数组；无后端时返回 DataURL
      if(!BASE_URL){
        // local: 压缩图片成 DataURL；视频用 ObjectURL 仅预览
        const out=[];
        for(const f of files){
          if(f.type.startsWith("image/")) out.push(await compressImage(f,1600,0.82));
          else if(f.type.startsWith("video/")) out.push(URL.createObjectURL(f));
        }
        return out;
      }
      const fd = new FormData();
      files.forEach(f=> fd.append("files", f));
      const res = await fetch(BASE_URL+"/api/upload", {
        method:"POST",
        headers: authToken()? {"Authorization":"Bearer "+authToken()} : {},
        body: fd
      });
      if(!res.ok) throw new Error("upload failed");
      return res.json(); // 需后端返回 ["https://.../a.jpg", "..."]
    }
  }
};
function localUserSnapshot(id){
  // 简易本地快照：从帖子/商品里找该作者
  const p = posts.find(x=>x.author?.id===id);
  const l = listings.find(x=>x.seller?.id===id);
  const any = p?.author || l?.seller || account;
  return {
    id: any.id||id, name:any.name||"User", avatar:any.avatar||null, bio:any.bio||""
  };
}
function localToggleLike(id,kind,flag){
  const set = likes;
  const has = set.has(kind+":"+id);
  if(flag && !has) set.add(kind+":"+id);
  if(!flag && has) set.delete(kind+":"+id);
  if(kind==="post"){ const p=posts.find(x=>x.id===id); if(p){ p.likes = Math.max(0,(p.likes||0) + (flag?+1:-1)); } saveJSON(KEYS.posts, posts); }
  if(kind==="listing"){ const l=listings.find(x=>x.id===id); if(l){ l.likes = Math.max(0,(l.likes||0) + (flag?+1:-1)); } saveJSON(KEYS.listings, listings); }
  saveJSON(KEYS.likes,[...likes]);
}

/* ====== Online banner ====== */
const offlineBar = $("#offline-bar");
function updateOnlineUI(){ offlineBar.hidden = navigator.onLine; }
addEventListener("online", updateOnlineUI);
addEventListener("offline", updateOnlineUI);
updateOnlineUI();

/* ====== Theme ====== */
function applyTheme(t){
  document.documentElement.setAttribute("data-theme", t);
  localStorage.setItem(KEYS.theme, t);
  const b = $("#theme-toggle");
  if (b) b.textContent = (t === "dark") ? "☀️" : "🌙";
}
const systemDark = matchMedia && matchMedia('(prefers-color-scheme: dark)').matches;
applyTheme(localStorage.getItem(KEYS.theme) || (systemDark ? "dark" : "light"));
$("#theme-toggle")?.addEventListener("click", ()=>{
  const next = (localStorage.getItem(KEYS.theme) === "dark") ? "light" : "dark";
  applyTheme(next);
});

/* ====== Router (hash) ====== */
const views = {
  forum: $("#view-forum"),
  market: $("#view-market"),
  explore: $("#view-explore"),
  account: $("#view-account")
};
const catBar = $("#cat-bar");
function go(view){ location.hash = "#/"+view; }
function route(){
  const h = location.hash.replace(/^#\/?/,"");
  // #/user/:id → 进入 Account 视图但加载该用户
  if(h.startsWith("user/")){
    const uid = h.slice(5);
    selectTab("account");
    showView("account");
    loadUserProfile(uid);
    return;
  }
  // 默认四视图
  const v = (["forum","market","explore","account"].includes(h) ? h : "forum");
  selectTab(v); showView(v);
  if(v==="account") loadUserProfile(null); // me
}
addEventListener("hashchange", route);

/* tab buttons */
$$(".tab").forEach(btn=>{
  btn.addEventListener("click", ()=> go(btn.dataset.view));
});
$('[data-nav="forum"]')?.addEventListener("click",(e)=>{e.preventDefault(); go("forum");});

function selectTab(name){
  $$(".tab").forEach(b=> b.classList.toggle("active", b.dataset.view===name));
}
function showView(name){
  Object.values(views).forEach(v=>v.classList.remove("show"));
  views[name]?.classList.add("show");
  if (name==="account" || name==="explore") catBar.style.display="none";
  else catBar.style.display="";
  renderCurrent();
}
route();

/* ====== Categories / Search helpers ====== */
const CATS = ["Shoes","Clothing","Accessories","Collectibles","Tech","Furniture","Appliances","Other"];
let activeCat = "All";
$$(".cat").forEach(p=>{
  p.addEventListener("click", ()=>{
    $$(".cat").forEach(x=>x.classList.remove("active"));
    p.classList.add("active");
    activeCat = p.dataset.cat;
    renderCurrent();
  });
});
function parseQuery(raw){
  const out = { text: "", cmd:{} };
  const tokens = (raw||"").trim().split(/\s+/);
  const rest=[];
  tokens.forEach(t=>{
    const m = t.match(/^(\w+):(.*)$/);
    if (m) out.cmd[m[1].toLowerCase()] = m[2];
    else rest.push(t);
  });
  out.text = rest.join(" ").toLowerCase();
  return out;
}

/* ====== Lightbox ====== */
const lightbox = $("#lightbox"), lbImg=$("#lb-img"), lbPrev=$("#lb-prev"), lbNext=$("#lb-next"), lbClose=$("#lb-close"), lbCap=$("#lb-caption");
let lbItems = []; let lbIndex = 0;
function openLightbox(items, start=0){ if(!items?.length) return; lbItems=items; lbIndex=start; drawLB(); lightbox.hidden=false; }
function drawLB(){ const it=lbItems[lbIndex]; lbImg.src=it.src; lbCap.textContent = it.cap || `${lbIndex+1}/${lbItems.length}`; }
function closeLightbox(){ lightbox.hidden=true; lbItems=[]; lbImg.src=""; }
lbPrev.addEventListener("click", ()=>{ lbIndex=(lbIndex-1+lbItems.length)%lbItems.length; drawLB(); });
lbNext.addEventListener("click", ()=>{ lbIndex=(lbIndex+1)%lbItems.length; drawLB(); });
lbClose.addEventListener("click", closeLightbox);
lightbox.addEventListener("click", (e)=>{ if(e.target===lightbox) closeLightbox(); });
addEventListener("keydown", (e)=>{ if(lightbox.hidden) return; if(e.key==="Escape") closeLightbox(); if(e.key==="ArrowLeft") lbPrev.click(); if(e.key==="ArrowRight") lbNext.click(); });

/* ====== Forum ====== */
const forumForm = $("#post-form");
const forumFiles = $("#forum-files");
const forumPreview = $("#forum-preview");
let forumPending = []; // {type:'image'|'video', src/url, urlFromServer?}

wireUploader(forumFiles, $("#forum-file-note"));
forumFiles?.addEventListener("change", async (e)=>{
  const note = $("#forum-file-note");
  const btn = forumForm?.querySelector('button[type="submit"]');
  const files = Array.from(e.target.files||[]);
  if (!files.length) return;
  const defaultText = note?.dataset.default || "";
  if (note) note.innerHTML = `<span class="loading-dots">Optimizing media<span class="dot"></span><span class="dot"></span><span class="dot"></span></span>`;
  if (btn) { btn.disabled = true; btn.textContent = "Processing…"; }
  try {
    // 上传到后端（如配置了），否则本地压缩
    const urls = await api.upload.media(files.slice(0, 6 - forumPending.length));
    urls.forEach(u=> forumPending.push({type: guessType(u), src:u}));
    drawPreview(forumPreview, forumPending, idx=>{ forumPending.splice(idx,1); drawPreview(forumPreview, forumPending, ()=>{}); });
  } catch(e){ alert("Upload failed, using local preview only."); }
  finally {
    if (note) note.textContent = forumPending.length ? `${forumPending.length} file(s) selected` : defaultText;
    if (btn) { btn.disabled = false; btn.textContent = "Publish"; }
  }
});

forumForm?.addEventListener("submit", async (e)=>{
  e.preventDefault();
  const fd = new FormData(forumForm);
  const title = (fd.get("title")||"").toString().trim();
  if (!title) return alert("Title is required.");
  const tag = (fd.get("tag")||"").toString();
  const body = (fd.get("body")||"").toString();

  const payload = {
    title, tag, body,
    author: { id: account.id, name: account.name||"Guest", avatar: account.avatar||null },
    images: forumPending.filter(x=>x.type==="image").map(x=>x.src),
    videos: forumPending.filter(x=>x.type==="video").map(x=>x.src),
    time: now()
  };

  const created = await api.posts.create(payload);
  // optimistic local push if API failed already handled
  forumPending = []; forumFiles.value=""; forumPreview.innerHTML=""; forumForm.reset();
  await refreshForum();
  // 自动切到 Forum
  go("forum");
});

/* Feed */
const FEED = $("#forum-feed"), FQ = $("#forum-search"), FS = $("#forum-sort");
FQ.addEventListener("input", renderForum);
FS.addEventListener("change", renderForum);

async function refreshForum(){
  try{ posts = await api.posts.list(); saveJSON(KEYS.posts, posts); }
  catch(e){ /* keep local */ }
  renderForum();
}
function renderForum(){
  const raw = FQ.value||""; const q = parseQuery(raw);
  let list = posts.filter(p=>{
    const catOK = (activeCat==="All") || (p.tag===activeCat);
    const tagOK = q.cmd.tag ? (p.tag?.toLowerCase()===q.cmd.tag.toLowerCase()) : true;
    const userOK = q.cmd.user ? ((p.author?.name||"").toLowerCase().includes(q.cmd.user.toLowerCase())) : true;
    const textOK = q.text ? ((p.title||"").toLowerCase().includes(q.text) || (p.body||"").toLowerCase().includes(q.text)) : true;
    return catOK && tagOK && userOK && textOK;
  });
  if (FS.value==="top") list.sort((a,b)=> (b.likes||0)-(a.likes||0) || (b.time||0)-(a.time||0));
  else if (FS.value==="pinned") list.sort((a,b)=> ((b.pinned?1:0)-(a.pinned?1:0)) || (b.time||0)-(a.time||0));
  else list.sort((a,b)=> (b.time||0)-(a.time||0));

  FEED.innerHTML = "";
  list.forEach(p=> FEED.appendChild(renderPost(p)));
}
function renderPost(p){
  const root = el("article", "post"+(p.pinned?" pinned":"")); root.dataset.id = p.id;

  const ph = el("div","ph");
  const av = makeAvatar(p.author, 36);
  const metaWrap = el("div","meta-wrap");
  const metaTop = el("div","meta-top");
  const author = el("span","author", p.author?.name || "User");
  author.addEventListener("click", ()=> openUser(p.author?.id));
  av.addEventListener("click", ()=> openUser(p.author?.id));
  metaTop.append(el("strong","",p.title||"(no title)"), el("span","tag",p.tag||"Other"), el("span","time",timeAgo(p.time||now())), author);
  metaWrap.append(metaTop); ph.append(av, metaWrap); root.appendChild(ph);

  const body = el("div","body");
  if (p.body) body.append(el("p","",p.body));
  const imgs = p.images||[], vids = p.videos||[];
  if (imgs.length || vids.length){
    const grid = el("div","attach-grid");
    imgs.forEach((src, idx)=>{
      const img = new Image(); img.src=src; img.alt=p.title; img.loading="lazy"; img.decoding="async";
      img.addEventListener("click", ()=> openLightbox(imgs.map(s=>({src:s, cap:p.title})), idx));
      grid.appendChild(img);
    });
    vids.forEach((src)=>{ const v=document.createElement("video"); v.src=src; v.controls=true; grid.appendChild(v); });
    body.appendChild(grid);
  }
  root.appendChild(body);

  const actions = el("div","actions");
  const liked = likes.has("post:"+p.id);
  const likeBtn = el("button","btn-ghost"+(liked?" active":""), `❤ ${p.likes||0}`);
  likeBtn.addEventListener("click", async ()=>{
    const want = !likes.has("post:"+p.id);
    likes[want?"add":"delete"]("post:"+p.id);
    likeBtn.classList.toggle("active", want);
    p.likes = Math.max(0,(p.likes||0) + (want?+1:-1)); likeBtn.textContent = `❤ ${p.likes||0}`;
    saveJSON(KEYS.posts, posts); saveJSON(KEYS.likes,[...likes]);
    try{ await api.posts.like(p.id, want); }catch{}
  });
  const pinBtn = el("button","btn-ghost", p.pinned?"Unpin":"Pin");
  pinBtn.addEventListener("click", ()=>{ p.pinned=!p.pinned; saveJSON(KEYS.posts, posts); renderForum(); });
  actions.append(likeBtn, pinBtn);
  root.appendChild(actions);

  return root;
}

/* ====== Marketplace ====== */
const listForm = $("#list-form");
const listFiles = $("#list-files");
const listPreview = $("#list-preview");
let listPending = [];

wireUploader(listFiles, $("#list-file-note"));
listFiles?.addEventListener("change", async (e)=>{
  const note = $("#list-file-note"); const btn = listForm?.querySelector('button[type="submit"]');
  const files = Array.from(e.target.files||[]); if(!files.length) return;
  const defaultText = note?.dataset.default || "";
  if (note) note.innerHTML = `<span class="loading-dots">Optimizing images<span class="dot"></span><span class="dot"></span><span class="dot"></span></span>`;
  if (btn) { btn.disabled = true; btn.textContent = "Processing…"; }
  try{
    const urls = await api.upload.media(files.slice(0, 8 - listPending.length));
    urls.forEach(u=> listPending.push({type:"image", src:u}));
    drawPreview(listPreview, listPending, idx=>{ listPending.splice(idx,1); drawPreview(listPreview, listPending, ()=>{}); });
  }catch(e){ alert("Upload failed, using local preview only."); }
  finally{
    if (note) note.textContent = listPending.length ? `${listPending.length} file(s) selected` : defaultText;
    if (btn) { btn.disabled = false; btn.textContent = "Post Listing"; }
  }
});

listForm?.addEventListener("submit", async (e)=>{
  e.preventDefault();
  const fd = new FormData(listForm);
  const title = (fd.get("title")||"").toString().trim();
  if (!title) return alert("Title is required.");
  const cat = (fd.get("cat")||"").toString();
  const price = Number(fd.get("price")); if(isNaN(price)||price<0) return alert("Enter a valid price.");
  const cond = (fd.get("cond")||"").toString();
  const status = (fd.get("status")||"Available").toString();
  const body = (fd.get("body")||"").toString();
  const contact = (fd.get("contact")||"").toString();

  const payload = {
    title, cat, price, cond, status, body, contact,
    photos: listPending.map(x=>x.src),
    seller: { id: account.id, name: account.name||"Guest", avatar: account.avatar||null },
    time: now()
  };

  const created = await api.listings.create(payload);
  listPending = []; listFiles.value=""; listPreview.innerHTML=""; listForm.reset();
  await refreshMarket();
  go("market");
});

const MF = $("#market-feed"), MQ = $("#list-search"), MS = $("#list-sort");
MQ.addEventListener("input", renderMarket);
MS.addEventListener("change", renderMarket);

async function refreshMarket(){
  try{ listings = await api.listings.list(); saveJSON(KEYS.listings, listings); }
  catch(e){ /* keep local */ }
  renderMarket();
}
function renderMarket(){
  const raw = MQ.value||""; const q = parseQuery(raw);
  let list = listings.filter(l=>{
    const catOK = (activeCat==="All") || (l.cat===activeCat);
    const tagOK = q.cmd.tag ? (l.cat?.toLowerCase()===q.cmd.tag.toLowerCase()) : true;
    const statusOK = q.cmd.status ? (l.status?.toLowerCase()===q.cmd.status.toLowerCase()) : true;
    const textOK = q.text ? ((l.title||"").toLowerCase().includes(q.text) || (l.body||"").toLowerCase().includes(q.text)) : true;
    return catOK && tagOK && statusOK && textOK;
  });

  if (MS.value==="priceAsc") list.sort((a,b)=> a.price-b.price || (b.time||0)-(a.time||0));
  else if (MS.value==="priceDesc") list.sort((a,b)=> b.price-a.price || (b.time||0)-(a.time||0));
  else if (MS.value==="available") list.sort((a,b)=> (a.status==="Sold") - (b.status==="Sold") || (b.time||0)-(a.time||0));
  else list.sort((a,b)=> (b.time||0)-(a.time||0));

  MF.innerHTML="";
  list.forEach(l=> MF.appendChild(renderListing(l)));
}
function renderListing(l){
  const card = el("article","card"+(l.status==="Sold"?" sold":"")); card.dataset.id = l.id;

  const img = new Image();
  img.src = (l.photos?.[0]) || "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='600' height='400'/>";
  img.alt = l.title; img.loading="lazy"; img.decoding="async";
  img.addEventListener("click", ()=> openLightbox((l.photos||[]).map(s=>({src:s, cap:l.title})), 0));
  card.appendChild(img);

  const ci = el("div","ci");
  ci.append(el("h3","", l.title));
  ci.append(el("div","badge", l.cat||"Other"));
  ci.append(el("p","", l.body||""));

  // seller
  const sellerRow = el("div","seller");
  const av = makeAvatar(l.seller, 24);
  const name = el("span","author", l.seller?.name || "Seller");
  av.addEventListener("click", ()=> openUser(l.seller?.id));
  name.addEventListener("click", ()=> openUser(l.seller?.id));
  sellerRow.append(av, name);
  ci.appendChild(sellerRow);

  const row = el("div","row");
  row.append(el("span","price", toUSD(l.price)));

  const saveBtn = el("button","cta", favs.has(l.id) ? "Saved" : "Save");
  saveBtn.addEventListener("click",(e)=>{ e.stopPropagation(); toggleFav(l.id); saveBtn.textContent = favs.has(l.id)?"Saved":"Save"; try{ api.listings.favorite(l.id, saveBtn.textContent==="Saved"); }catch{} });

  const contactBtn = el("button","cta","Contact");
  contactBtn.addEventListener("click",(e)=>{ e.stopPropagation(); alert(l.contact ? `Contact seller: ${l.contact}` : "No contact provided."); });

  row.append(saveBtn, contactBtn);
  ci.append(row, el("small","", `${l.cond||"Good"} • ${l.status||"Available"} • ${timeAgo(l.time||now())}`));
  card.appendChild(ci);

  const actions = el("div","actions");
  const liked = likes.has("listing:"+l.id);
  const likeBtn = el("button","btn-ghost"+(liked?" active":""), `❤ ${l.likes||0}`);
  likeBtn.addEventListener("click", async ()=>{
    const want = !likes.has("listing:"+l.id);
    likes[want?"add":"delete"]("listing:"+l.id);
    likeBtn.classList.toggle("active", want);
    l.likes = Math.max(0,(l.likes||0) + (want?+1:-1)); likeBtn.textContent = `❤ ${l.likes||0}`;
    saveJSON(KEYS.listings, listings); saveJSON(KEYS.likes,[...likes]);
    try{ await api.listings.like(l.id, want); }catch{}
  });
  const pinBtn = el("button","btn-ghost", l.pinned?"Unpin":"Pin");
  pinBtn.addEventListener("click", ()=>{ l.pinned=!l.pinned; saveJSON(KEYS.listings, listings); renderMarket(); });
  actions.append(likeBtn, pinBtn);
  card.appendChild(actions);

  return card;
}
function toggleFav(id){ if(favs.has(id)) favs.delete(id); else favs.add(id); saveJSON(KEYS.favs,[...favs]); }

/* ====== Account & User Profile ====== */
const accAvatar=$("#acc-avatar"), accAvatarInput=$("#acc-avatar-input"), accForm=$("#acc-profile-form");
const accTab=$("#acc-tab"), accContent=$("#acc-content");
const acctTitle = $("#acct-title"); const acctUserName = $("#acct-username");
let viewingUserId = null; // null => me

async function loadUserProfile(userId){
  viewingUserId = userId;
  let data;
  if(userId && BASE_URL){
    try{ data = await api.user(userId); }
    catch{ data = localUserSnapshot(userId); }
  } else if(userId && !BASE_URL){
    data = localUserSnapshot(userId);
  } else {
    try{ const me = await api.me(); data = me; }catch{ data = account; }
  }
  // If viewing others, lock editing
  const isMe = !userId || userId===account.id || userId==="local-user";
  acctTitle.textContent = isMe ? "My Account" : "User Profile";
  acctUserName.textContent = isMe ? "My Activity" : (data.name||"User")+"'s Activity";
  accForm.style.display = isMe ? "" : "none";
  $("#acc-avatar-input").parentElement.style.display = isMe ? "" : "none";

  // fill
  renderAccountHeader(data, isMe);
  drawAccountSection(accTab.value || "uploads", data, isMe);
}
function renderAccountHeader(u, isMe){
  const src = u.avatar || placeAvatarLetter(u.name||"U");
  $("#acc-avatar").src = src;
  if(isMe){
    accForm.elements.name.value = account.name || "";
    accForm.elements.bio.value = account.bio || "";
  }else{
    accForm.elements.name.value = u.name || "";
    accForm.elements.bio.value = u.bio || "";
  }
}

accAvatarInput?.addEventListener("change", async (e)=>{
  const file=(e.target.files||[])[0]; if(!file) return;
  // 如果有后端，可走 api.upload.media([file]) 取真实URL；这里先压缩本地
  const img = await compressImage(file, 400, 0.85);
  account.avatar = img; saveJSON(KEYS.account, account); loadUserProfile(null);
});
accForm?.addEventListener("submit",(e)=>{
  e.preventDefault();
  const fd=new FormData(accForm);
  account.name = (fd.get("name")||"").toString().trim() || "Guest";
  account.bio = (fd.get("bio")||"").toString();
  saveJSON(KEYS.account, account);
  alert("Profile saved.");
  loadUserProfile(null);
});

accTab?.addEventListener("change", ()=> loadUserProfile(viewingUserId));

function drawAccountSection(which, user, isMe){
  user = user || account;
  accContent.innerHTML = "";
  if (which==="profile"){
    const box = el("div","panel");
    box.append(el("h3","", user.name||"User"));
    box.append(el("p","muted", user.bio||""));
    accContent.append(box);
    return;
  }
  if (which==="uploads"){
    // 上传并自动发到 forum
    if(!isMe){
      accContent.append(el("p","muted","Uploads are available on your own profile."));
      return;
    }
    const form = document.createElement("form");
    form.className="stack";
    form.innerHTML = `
      <label class="field"><span>Title</span>
        <input name="title" maxlength="120" placeholder="Share from your profile…" />
      </label>
      <label class="field"><span>Category</span>
        <select name="tag">${CATS.map(c=>`<option>${c}</option>`).join("")}</select>
      </label>
      <label class="field"><span>Content</span>
        <textarea name="body" rows="3" placeholder="Thoughts, story, details…"></textarea>
      </label>
      <label class="field"><span>Attach photos/videos</span>
        <div class="uploader">
          <input id="acc-upload-files" type="file" accept="image/*,video/*" multiple class="visually-hidden" />
          <label for="acc-upload-files" class="uploader-btn" role="button" tabindex="0">Choose files</label>
          <small id="acc-upload-note" class="hint" data-default="Up to 6 files."></small>
        </div>
      </label>
      <div id="acc-upload-preview" class="preview-grid" aria-live="polite"></div>
      <button class="primary" type="submit">Publish to Forum</button>
    `;
    accContent.append(form);
    const f = form; const up = $("#acc-upload-files"); const note=$("#acc-upload-note"); const prev=$("#acc-upload-preview");
    let pend = [];
    wireUploader(up, note);
    up.addEventListener("change", async (e)=>{
      const files = Array.from(up.files||[]);
      note.textContent = "Uploading…";
      const urls = await api.upload.media(files.slice(0, 6-pend.length));
      urls.forEach(u=> pend.push({type:guessType(u), src:u}));
      drawPreview(prev, pend, idx=>{ pend.splice(idx,1); drawPreview(prev, pend, ()=>{}); });
      note.textContent = pend.length ? `${pend.length} file(s) selected` : (note.dataset.default||"");
    });
    f.addEventListener("submit", async (e)=>{
      e.preventDefault();
      const fd=new FormData(f);
      const title=(fd.get("title")||"").toString().trim(); if(!title) return alert("Title is required.");
      const tag=(fd.get("tag")||"").toString();
      const body=(fd.get("body")||"").toString();
      const payload={
        title, tag, body,
        author:{id:account.id,name:account.name,avatar:account.avatar},
        images: pend.filter(x=>x.type==="image").map(x=>x.src),
        videos: pend.filter(x=>x.type==="video").map(x=>x.src),
        time: now()
      };
      await api.posts.create(payload);
      pend=[]; prev.innerHTML=""; up.value="";
      alert("Published to Forum!");
      await refreshForum(); go("forum");
    });
    return;
  }
  if (which==="posts"){
    const list = posts.filter(p=> p.author?.id===user.id);
    if(!list.length){ accContent.append(el("p","muted","No posts yet.")); return; }
    const wrap = el("div","list"); list.forEach(p=> wrap.appendChild(renderPost(p))); accContent.append(wrap); return;
  }
  if (which==="listings"){
    const mine = listings.filter(l=> l.seller?.id===user.id);
    if(!mine.length){ accContent.append(el("p","muted","No listings yet.")); return; }
    const wrap = el("div","cards"); mine.forEach(l=> wrap.appendChild(renderListing(l))); accContent.append(wrap); return;
  }
  if (which==="liked"){
    // 展示这个用户点赞过的（本地仅自己可见；接后端可查询 /users/:id/liked）
    if(!isMe){ accContent.append(el("p","muted","Liked items are private.")); return; }
    const likedPostsIds = [...likes].filter(x=>x.startsWith("post:")).map(x=>x.split(":")[1]);
    const likedListsIds = [...likes].filter(x=>x.startsWith("listing:")).map(x=>x.split(":")[1]);
    const lp = posts.filter(p=> likedPostsIds.includes(p.id));
    const ll = listings.filter(l=> likedListsIds.includes(l.id));
    if(!lp.length && !ll.length){ accContent.append(el("p","muted","You haven’t liked anything yet.")); return; }
    if(lp.length){ accContent.append(el("h3","", "Posts you liked")); const wrap=el("div","list"); lp.forEach(p=> wrap.appendChild(renderPost(p))); accContent.append(wrap); }
    if(ll.length){ accContent.append(el("h3","", "Listings you liked")); const wrap=el("div","cards"); ll.forEach(l=> wrap.appendChild(renderListing(l))); accContent.append(wrap); }
    return;
  }
  if (which==="favorites"){
    const saved = listings.filter(l=> favs.has(l.id));
    if(!saved.length) { accContent.append(el("p","muted","You haven’t saved any listings.")); return; }
    const wrap=el("div","cards"); saved.forEach(l=> wrap.appendChild(renderListing(l))); accContent.append(wrap); return;
  }
}

/* ====== Shared helpers ====== */
function wireUploader(inputEl, noteEl){
  if(!inputEl || !noteEl) return;
  const update = ()=> { const n=(inputEl.files||[]).length; noteEl.textContent = n ? `${n} file${n>1?'s':''} selected` : noteEl.dataset.default; };
  inputEl.addEventListener("change", update); update();
}
function drawPreview(container, files, onDelete){
  container.innerHTML="";
  files.forEach((f, idx)=>{
    const wrap = el("div","preview-item");
    if (f.type==="image"){ const img=new Image(); img.src=f.src; wrap.appendChild(img); }
    else { const v=document.createElement("video"); v.src=f.src; v.controls=true; wrap.appendChild(v); }
    const x = el("button","", "✕"); x.type="button"; x.addEventListener("click", ()=>onDelete(idx));
    wrap.appendChild(x); container.appendChild(wrap);
  });
}
function makeAvatar(user, sz=36){
  const a = el("div","avatar");
  a.style.width = a.style.height = sz+"px";
  if(user?.avatar){ const img=new Image(); img.src=user.avatar; img.alt=user.name||"avatar"; a.innerHTML=""; a.appendChild(img); }
  else a.textContent = (user?.name||"U")[0].toUpperCase();
  return a;
}
function placeAvatarLetter(name){ return `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80'><rect width='100%' height='100%' fill='%2311264a'/><text x='50%' y='54%' dominant-baseline='middle' text-anchor='middle' fill='white' font-size='26' font-family='Georgia'>${(name||'U')[0].toUpperCase()}</text></svg>`; }
function openUser(id){ if(!id) return; location.hash = "#/user/"+encodeURIComponent(id); }
function guessType(url){ return /\.(mp4|webm|mov)$/i.test(url) ? "video" : "image"; }

/* ====== Initial seed (only for demo) ====== */
if (!posts.length){
  posts = [
    { id:crypto.randomUUID(), title:"Are Panda Dunks over?", tag:"Shoes", body:"Still versatile if you rotate laces and care leather.", author:{id:"u-leo", name:"Leo"}, time:now()-3*3600*1000, likes:6, images:[] },
    { id:crypto.randomUUID(), title:"Best budget wool coat?", tag:"Clothing", body:"Looking for old-money vibe under $80.", author:{id:"u-ava", name:"Ava"}, time:now()-11*3600*1000, likes:2, images:[] }
  ];
  saveJSON(KEYS.posts, posts);
}
if (!listings.length){
  listings = [
    { id:crypto.randomUUID(), title:"Leather Loafers — Size 9", cat:"Shoes", price:95, cond:"Good", status:"Available", body:"Classic penny loafers, great for uniforms.", contact:"@loafers9", photos:[], seller:{id:"u-leo",name:"Leo"}, time:now()-6*3600*1000, likes:1 },
    { id:crypto.randomUUID(), title:"Desk Lamp (brass)", cat:"Furniture", price:35, cond:"Like New", status:"Sold", body:"Warm brass tone; perfect for study desk.", contact:"you@example.com", photos:[], seller:{id:"u-ava",name:"Ava"}, time:now()-18*3600*1000, likes:0 }
  ];
  saveJSON(KEYS.listings, listings);
}

/* ====== Render boot ====== */
function renderAll(){ refreshForum(); refreshMarket(); renderExplore(); loadUserProfile(null); }
function renderCurrent(){
  if (views.forum.classList.contains("show")) renderForum();
  else if (views.market.classList.contains("show")) renderMarket();
  else if (views.explore.classList.contains("show")) renderExplore();
  else loadUserProfile(viewingUserId);
}
function renderExplore(){
  const board = $("#explore-board");
  if (!board) return;
  board.innerHTML = `<p class="muted">No announcements yet.</p>`;
}
renderAll();
