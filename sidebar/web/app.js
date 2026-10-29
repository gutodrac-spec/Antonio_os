(function () {
  const $ = (id) => document.getElementById(id);
  const token = new URLSearchParams(location.search).get("token") || "";
  const els = {
    messages: $("messages"), empty: $("empty"), pending: $("pending"), input: $("input"), form: $("composer"),
    send: $("send"), status: $("status"), statusText: $("status-text"), preview: $("preview"),
    previewImg: $("preview-img"), previewEmpty: $("preview-empty"), attachments: $("attachments"),
    drawer: $("drawer"), audit: $("audit"), info: $("info"),
  };

  let ws = null;
  let busy = false;
  let streaming = null; // live assistant bubble while text streams in
  let attachments = [];
  const tools = new Map(); // tool_use id -> element
  const LEVELS = ["leitura", "usuário", "sistema", "crítico"];

  // ---------- connection ----------
  function connect() {
    ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws?token=${encodeURIComponent(token)}`);
    ws.onopen = () => setStatus();
    ws.onclose = () => { setStatus("offline"); setTimeout(connect, 1500); };
    ws.onmessage = (ev) => handle(JSON.parse(ev.data));
  }
  const send = (msg) => ws && ws.readyState === 1 && ws.send(JSON.stringify(msg));

  function handle(msg) {
    switch (msg.type) {
      case "state":
        els.messages.querySelectorAll(".msg, .tool, .notice, .result").forEach((n) => n.remove());
        tools.clear(); streaming = null;
        msg.history.forEach(renderEvent);
        els.pending.innerHTML = "";
        msg.approvals.forEach(renderApproval);
        if (msg.change) renderChange(msg.change);
        setBusy(msg.busy);
        if (msg.auth === false) authNeeded();
        setInfo(msg);
        break;
      case "event": renderEvent(msg.event); break;
      case "delta": appendDelta(msg.text); break;
      case "busy": setBusy(msg.busy); break;
      case "approval": renderApproval(msg.request); break;
      case "approval_done": removePending(msg.id); break;
      case "change": renderChange(msg.change); break;
      case "change_done": removePending(msg.id); break;
      case "auth": if (!msg.ok) authNeeded(); break;
      case "info": setInfo(msg); break;
      case "audit": renderAudit(msg.entries); break;
    }
    updateEmpty();
  }

  // ---------- conversation ----------
  function el(tag, cls, html) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html !== undefined) n.innerHTML = html;
    return n;
  }

  function add(node) {
    const nearBottom = els.messages.scrollHeight - els.messages.scrollTop - els.messages.clientHeight < 80;
    els.messages.appendChild(node);
    if (nearBottom) els.messages.scrollTop = els.messages.scrollHeight;
  }

  function renderEvent(e) {
    switch (e.kind) {
      case "user": {
        const n = el("div", "msg user", md.esc(e.text).replace(/\n/g, "<br>"));
        if (e.images) n.appendChild(el("div", "muted small", `${e.images} imagem(ns) anexada(s)`));
        add(n);
        break;
      }
      case "assistant": {
        if (streaming) { streaming.remove(); streaming = null; }
        add(el("div", "msg assistant", md.render(e.text)));
        break;
      }
      case "tool": {
        if (streaming) { streaming.remove(); streaming = null; }
        const n = el("details", "tool running");
        n.innerHTML = `<summary><span class="spin"></span><span class="tname">${md.esc(toolLabel(e.name))}</span><span class="targ">${md.esc(e.summary || "")}</span></summary><pre class="tout"></pre>`;
        tools.set(e.id, n);
        add(n);
        break;
      }
      case "tool_result": {
        const n = tools.get(e.id);
        if (!n) break;
        n.classList.remove("running");
        n.classList.add(e.ok ? "ok" : "fail");
        n.querySelector(".tout").textContent = e.summary || "(sem saída)";
        break;
      }
      case "notice":
        add(el("div", `notice ${e.level}`, md.esc(e.text)));
        break;
      case "result":
        if (streaming) { streaming.remove(); streaming = null; }
        if (!e.ok) add(el("div", "notice error", "A tarefa terminou com erro."));
        break;
    }
  }

  function appendDelta(text) {
    if (!streaming) {
      streaming = el("div", "msg assistant streaming");
      streaming.dataset.raw = "";
      add(streaming);
    }
    streaming.dataset.raw += text;
    streaming.innerHTML = md.render(streaming.dataset.raw);
    els.messages.scrollTop = els.messages.scrollHeight;
  }

  const TOOL_LABELS = {
    Bash: "Terminal", Read: "Ler arquivo", Write: "Escrever arquivo", Edit: "Editar arquivo", Glob: "Procurar arquivos",
    Grep: "Buscar texto", WebSearch: "Pesquisar na web", WebFetch: "Abrir página", TodoWrite: "Plano",
    mcp__desktop__screenshot: "Olhar a tela", mcp__desktop__click: "Clicar", mcp__desktop__type_text: "Digitar",
    mcp__desktop__key: "Tecla", mcp__desktop__launch_app: "Abrir programa", mcp__desktop__scroll: "Rolar",
    mcp__desktop__drag: "Arrastar", mcp__desktop__move_mouse: "Mover cursor", mcp__desktop__list_windows: "Janelas",
    mcp__desktop__window_action: "Janela", mcp__system__status: "Estado do sistema", mcp__system__apply: "Aplicar mudança",
    mcp__system__build: "Compilar sistema", mcp__system__config_diff: "Ver mudanças", mcp__system__history: "Histórico",
    mcp__system__undo: "Desfazer mudança", mcp__system__user_desktop: "Sua área de trabalho", mcp__system__open_for_user: "Abrir para você",
  };
  const toolLabel = (n) => TOOL_LABELS[n] || n.replace(/^mcp__/, "").replace(/__/g, " · ");

  function setBusy(b) {
    busy = b;
    els.send.classList.toggle("stop", b);
    els.send.title = b ? "Interromper" : "Enviar";
    els.send.innerHTML = b
      ? '<svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="1.5"/></svg>'
      : '<svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
    setStatus();
  }

  function setStatus(state) {
    const s = state || (busy ? "busy" : "ready");
    els.status.dataset.state = s;
    els.statusText.textContent = { ready: "Pronto", busy: "Trabalhando…", offline: "Sem conexão com o serviço" }[s];
  }

  function updateEmpty() {
    els.empty.hidden = !!els.messages.querySelector(".msg, .tool, .notice");
  }

  // ---------- approvals and system changes ----------
  function renderApproval(r) {
    removePending(r.id);
    const card = el("div", `card level-${r.level}`);
    card.dataset.id = r.id;
    card.innerHTML = `
      <div class="card-head"><span class="badge">${LEVELS[r.level]}</span><strong>${md.esc(r.title)}</strong></div>
      ${r.diff ? md.diff(r.detail) : `<pre class="detail">${md.esc(r.detail)}</pre>`}
      <div class="card-actions">
        <button class="btn" data-d="deny">Negar</button>
        ${r.canAlways ? '<button class="btn" data-d="always">Sempre permitir</button>' : ""}
        <button class="btn primary" data-d="allow">Aprovar</button>
      </div>`;
    card.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
      send({ type: "approval", id: r.id, decision: b.dataset.d });
      card.remove();
    }));
    els.pending.appendChild(card);
  }

  function renderChange(c) {
    removePending(c.id);
    const card = el("div", "card change");
    card.dataset.id = c.id;
    card.innerHTML = `
      <div class="card-head"><span class="badge">sistema</span><strong>Mudança ativa: ${md.esc(c.summary)}</strong></div>
      <p>Está tudo funcionando? Sem resposta, o sistema volta à versão anterior em <b class="count"></b>.</p>
      <div class="bar"><span></span></div>
      <div class="card-actions">
        <button class="btn" data-keep="0">Reverter</button>
        <button class="btn primary" data-keep="1">Manter</button>
      </div>`;
    const total = Math.max(1, c.deadline - Date.now());
    const tick = () => {
      if (!card.isConnected) return;
      const left = Math.max(0, c.deadline - Date.now());
      card.querySelector(".count").textContent = `${Math.ceil(left / 1000)} s`;
      card.querySelector(".bar span").style.width = `${(left / total) * 100}%`;
      if (left > 0) requestAnimationFrame(tick);
    };
    card.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
      send({ type: "confirm", id: c.id, keep: b.dataset.keep === "1" });
      card.remove();
    }));
    els.pending.appendChild(card);
    tick();
  }

  function removePending(id) {
    els.pending.querySelectorAll(`[data-id="${CSS.escape(id)}"]`).forEach((n) => n.remove());
  }

  function authNeeded() {
    if (document.querySelector(".notice.auth")) return;
    const n = el("div", "notice warn auth", 'Você precisa entrar na sua conta Claude. <button class="link">Abrir configurações</button>');
    n.querySelector("button").addEventListener("click", openDrawer);
    add(n);
  }

  function setInfo(m) {
    if (m.model || m.sessionId) els.info.textContent = `Modelo: ${m.model || "padrão"}${m.sessionId ? ` · sessão ${m.sessionId.slice(0, 8)}` : ""}`;
  }

  // ---------- composer ----------
  function submit() {
    if (busy) return send({ type: "interrupt" });
    const text = els.input.value.trim();
    if (!text && !attachments.length) return;
    send({ type: "send", text, images: attachments.map(({ mediaType, data }) => ({ mediaType, data })) });
    els.input.value = "";
    attachments = [];
    renderAttachments();
    autosize();
  }

  els.form.addEventListener("submit", (e) => { e.preventDefault(); submit(); });
  els.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); }
  });
  const autosize = () => { els.input.style.height = "auto"; els.input.style.height = Math.min(els.input.scrollHeight, 200) + "px"; };
  els.input.addEventListener("input", autosize);

  function addFiles(files) {
    for (const f of files) {
      if (!/^image\/(png|jpeg|webp|gif)$/.test(f.type)) continue;
      const reader = new FileReader();
      reader.onload = () => {
        attachments.push({ mediaType: f.type, data: String(reader.result).split(",")[1], url: reader.result });
        renderAttachments();
      };
      reader.readAsDataURL(f);
    }
  }
  function renderAttachments() {
    els.attachments.innerHTML = "";
    attachments.forEach((a, i) => {
      const t = el("button", "thumb");
      t.type = "button";
      t.title = "Remover";
      t.style.backgroundImage = `url(${a.url})`;
      t.addEventListener("click", () => { attachments.splice(i, 1); renderAttachments(); });
      els.attachments.appendChild(t);
    });
  }
  $("file").addEventListener("change", (e) => { addFiles(e.target.files); e.target.value = ""; });
  els.input.addEventListener("paste", (e) => addFiles([...e.clipboardData.files]));

  document.querySelectorAll(".suggestions button").forEach((b) =>
    b.addEventListener("click", () => { els.input.value = b.dataset.prompt; submit(); }));

  // ---------- header actions ----------
  $("btn-new").addEventListener("click", () => send({ type: "new_conversation" }));
  $("btn-panic").addEventListener("click", () => send({ type: "panic" }));

  let previewTimer = null;
  $("btn-preview").addEventListener("click", (e) => {
    const on = els.preview.hidden;
    els.preview.hidden = !on;
    e.currentTarget.setAttribute("aria-pressed", String(on));
    clearInterval(previewTimer);
    if (on) { refreshPreview(); previewTimer = setInterval(refreshPreview, 1000); }
  });
  function refreshPreview() {
    const img = new Image();
    img.onload = () => { els.previewImg.src = img.src; els.previewImg.hidden = false; els.previewEmpty.hidden = true; };
    img.onerror = () => { els.previewImg.hidden = true; els.previewEmpty.hidden = false; };
    img.src = `/api/preview.jpg?token=${encodeURIComponent(token)}&t=${Date.now()}`;
  }

  function openDrawer() { els.drawer.hidden = false; send({ type: "audit" }); }
  $("btn-settings").addEventListener("click", openDrawer);
  $("drawer-close").addEventListener("click", () => (els.drawer.hidden = true));
  $("btn-login").addEventListener("click", () => send({ type: "login" }));
  $("btn-save-key").addEventListener("click", () => {
    const key = $("api-key").value.trim();
    send({ type: "set_api_key", key: key || null });
    $("api-key").value = "";
    $("btn-save-key").textContent = key ? "Chave salva" : "Chave removida";
    setTimeout(() => ($("btn-save-key").textContent = "Salvar chave"), 2000);
  });

  const AUDIT_LABELS = {
    user_message: "Mensagem enviada", tool_approval: "Aprovação", tool_allowed: "Ação permitida", tool_denied: "Ação bloqueada",
    system_change_approval: "Mudança no sistema", system_change_kept: "Mudança mantida", system_change_reverted: "Mudança revertida",
    system_build_failed: "Compilação falhou", system_apply_failed: "Ativação falhou", panic: "Botão de pânico", agentd_started: "Serviço iniciado",
  };
  function renderAudit(entries) {
    els.audit.innerHTML = "";
    entries.slice().reverse().slice(0, 80).forEach((e) => {
      const what = e.summary || e.tool || "";
      const extra = e.decision ? ` — ${e.decision}` : "";
      els.audit.appendChild(el("li", "", `<time>${new Date(e.ts).toLocaleString("pt-BR")}</time> ${md.esc(AUDIT_LABELS[e.kind] || e.kind)}${what ? `: <span>${md.esc(String(what))}</span>` : ""}${md.esc(extra)}`));
    });
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !els.drawer.hidden) els.drawer.hidden = true;
  });

  connect();
  els.input.focus();
})();
