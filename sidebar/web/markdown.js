// Minimal, safe Markdown renderer for assistant messages: everything is escaped first.
(function () {
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  function inline(s) {
    return s
      .replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  }

  function render(src) {
    const out = [];
    const parts = esc(src).split(/^```[^\n]*\n([\s\S]*?)^```\s*$/m);
    parts.forEach((part, i) => {
      if (i % 2 === 1) return out.push(`<pre><code>${part}</code></pre>`);
      let list = null;
      const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
      let para = [];
      const flush = () => { if (para.length) { out.push(`<p>${inline(para.join("<br>"))}</p>`); para = []; } };
      for (const line of part.split("\n")) {
        let m;
        if ((m = line.match(/^(#{1,4})\s+(.*)$/))) { flush(); close(); out.push(`<h${m[1].length + 2}>${inline(m[2])}</h${m[1].length + 2}>`); }
        else if ((m = line.match(/^\s*[-*]\s+(.*)$/))) { flush(); if (list !== "ul") { close(); out.push("<ul>"); list = "ul"; } out.push(`<li>${inline(m[1])}</li>`); }
        else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) { flush(); if (list !== "ol") { close(); out.push("<ol>"); list = "ol"; } out.push(`<li>${inline(m[1])}</li>`); }
        else if (!line.trim()) { flush(); close(); }
        else { close(); para.push(line); }
      }
      flush(); close();
    });
    return out.join("");
  }

  function diff(src) {
    return `<pre class="diff">${esc(src).split("\n").map((l) => {
      const cls = l.startsWith("+") && !l.startsWith("+++") ? "add" : l.startsWith("-") && !l.startsWith("---") ? "del" : l.startsWith("@@") ? "hunk" : "";
      return `<span class="${cls}">${l || " "}</span>`;
    }).join("")}</pre>`;
  }

  window.md = { render, diff, esc };
})();
