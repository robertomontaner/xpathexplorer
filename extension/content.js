// XPath Explorer - Content Script

function evaluateXPath(expression) {
  try {
    const result = document.evaluate(expression, document, null, XPathResult.ANY_TYPE, null);
    const type = result.resultType;

    if (type === XPathResult.NUMBER_TYPE)  return { type: 'number',  value: result.numberValue,  count: 1 };
    if (type === XPathResult.STRING_TYPE)  return { type: 'string',  value: result.stringValue,  count: 1 };
    if (type === XPathResult.BOOLEAN_TYPE) return { type: 'boolean', value: result.booleanValue, count: 1 };

    // ── Collect ALL nodes before touching the DOM ──────────────────
    let node;
    const nodes = [];
    while ((node = result.iterateNext())) {
      if (node.nodeType === 2) {
        nodes.push({ tag: '@' + node.nodeName, nodeKind: 'attr', value: node.nodeValue, text: node.nodeValue, html: null, attributes: {} });
      } else if (node.nodeType === 3) {
        const val = (node.textContent || '').trim();
        nodes.push({ tag: 'text()', nodeKind: 'text', value: val, text: val, html: null, attributes: {} });
      } else {
        const info = {
          tag: node.nodeName, nodeKind: 'element', value: null,
          text: (node.textContent || '').trim().substring(0, 200),
          html: node.outerHTML ? node.outerHTML.substring(0, 500) : '',
          attributes: {}
        };
        if (node.attributes) { for (const attr of node.attributes) info.attributes[attr.name] = attr.value; }
        nodes.push(info);
      }
    }
    return { type: 'nodeset', nodes, count: nodes.length };
  } catch (e) {
    return { type: 'error', message: e.message };
  }
}

function highlightNodes(expression) {
  // Clear previous highlights first
  clearHighlights();
  try {
    const result = document.evaluate(expression, document, null, XPathResult.ANY_TYPE, null);

    // ── Step 1: collect all matching element nodes (no DOM changes yet)
    const toHighlight = [];
    let node;
    while ((node = result.iterateNext())) {
      // For attr nodes, highlight the owner element
      if (node.nodeType === 2) {
        if (node.ownerElement) toHighlight.push(node.ownerElement);
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        toHighlight.push(node);
      }
      // text() nodes: highlight parentElement
      else if (node.nodeType === 3 && node.parentElement) {
        toHighlight.push(node.parentElement);
      }
    }

    // ── Step 2: apply highlights (DOM mutation happens here, iterator already done)
    const unique = [...new Set(toHighlight)].slice(0, 100);
    unique.forEach(el => {
      el.dataset.__xpathHl = '1';
      el.style.outline = '2px solid #FACC15';
      el.style.outlineOffset = '2px';
    });

    return { highlighted: unique.length };
  } catch (e) { return { highlighted: 0 }; }
}

function clearHighlights() {
  document.querySelectorAll('*').forEach(el => {
    if (el.dataset.__xpathHl) {
      delete el.dataset.__xpathHl;
      el.style.outline = '';
      el.style.outlineOffset = '';
    }
  });
}

function getPageContext() {
  const ctx = { ids: [], classes: [], tags: {}, dataAttrs: [], roles: [], names: [], ariaLabels: [] };
  const seen = { ids: new Set(), classes: new Set(), data: new Set(), roles: new Set(), names: new Set(), aria: new Set() };

  document.querySelectorAll('*').forEach(el => {
    const tag = el.tagName.toLowerCase();
    ctx.tags[tag] = (ctx.tags[tag] || 0) + 1;
    if (el.id && el.id.trim() && !seen.ids.has(el.id)) { seen.ids.add(el.id); ctx.ids.push(el.id); }
    if (el.className && typeof el.className === 'string') {
      el.className.split(/\s+/).forEach(c => {
        if (c && c.length > 1 && c.length < 40 && !seen.classes.has(c)) { seen.classes.add(c); ctx.classes.push(c); }
      });
    }
    for (const attr of el.attributes) {
      if (attr.name.startsWith('data-') && !seen.data.has(attr.name)) { seen.data.add(attr.name); ctx.dataAttrs.push(attr.name); }
    }
    const role = el.getAttribute('role');
    if (role && !seen.roles.has(role)) { seen.roles.add(role); ctx.roles.push(role); }
    const name = el.getAttribute('name');
    if (name && !seen.names.has(name)) { seen.names.add(name); ctx.names.push(name); }
    const aria = el.getAttribute('aria-label');
    if (aria && !seen.aria.has(aria)) { seen.aria.add(aria); ctx.ariaLabels.push(aria.substring(0, 60)); }
  });

  ctx.topTags = Object.entries(ctx.tags).sort((a,b)=>b[1]-a[1]).slice(0,20).map(([tag,count])=>({tag,count}));
  ctx.ids      = ctx.ids.slice(0, 40);
  ctx.classes  = ctx.classes.slice(0, 80);
  ctx.dataAttrs = ctx.dataAttrs.slice(0, 30);
  return ctx;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if      (message.action === 'evaluate')         sendResponse(evaluateXPath(message.xpath));
  else if (message.action === 'highlight')        sendResponse(highlightNodes(message.xpath));
  else if (message.action === 'clearHighlights')  { clearHighlights(); sendResponse({ ok: true }); }
  else if (message.action === 'getPageContext')   sendResponse(getPageContext());
  else if (message.action === 'scrollTo')        sendResponse(scrollToNode(message.index));
  return true;
});

function scrollToNode(index) {
  // Find the index-th element node from last highlight
  const highlighted = document.querySelectorAll('[data-\\-\\-xpathHl]');
  // Fallback: re-evaluate last expression — use a simpler approach via stored results
  const allHl = [];
  document.querySelectorAll('*').forEach(el => { if (el.dataset.__xpathHl) allHl.push(el); });
  const target = allHl[index];
  if (target) {
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // Flash effect
    const orig = target.style.outline;
    target.style.outline = '3px solid #FACC15';
    target.style.outlineOffset = '4px';
    setTimeout(() => { target.style.outline = orig; target.style.outlineOffset = '2px'; }, 800);
    return { ok: true };
  }
  return { ok: false };
}
