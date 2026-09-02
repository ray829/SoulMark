/** 轻量 HTML sanitize:为 Editor 的原始 HTML 节点收窄 XSS 面。
 *
 * 纵深防御:CSP(script-src 'self')已阻止 inline script / event handler / javascript: URI,
 * 此处再以白名单剥离危险标签与属性,挡住 CSS 注入、UI 伪造等残余风险。
 * 不引入第三方依赖,基于 DOMParser 手写。 */

const ALLOWED_TAGS = new Set([
  "a", "abbr", "b", "blockquote", "br", "code", "del", "div", "em",
  "figcaption", "figure", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i",
  "img", "ins", "kbd", "li", "mark", "ol", "p", "pre", "q", "s", "small",
  "span", "strong", "sub", "sup", "table", "tbody", "td", "tfoot", "th",
  "thead", "tr", "u", "ul", "wbr", "details", "summary", "dl", "dt", "dd",
  "ruby", "rt",
]);

const ALLOWED_ATTRS = new Set([
  "href", "src", "alt", "title", "width", "height", "colspan", "rowspan",
  "target", "rel", "class", "id", "data-language",
]);

const URL_ATTRS = new Set(["href", "src"]);

function isSafeUrl(url: string): boolean {
  const u = url.trim().toLowerCase();
  if (u.startsWith("javascript:") || u.startsWith("vbscript:")) return false;
  // data: 仅放行图片,禁止 text/html(可执行)
  if (u.startsWith("data:") && !u.startsWith("data:image/")) return false;
  return true;
}

/** 校验 URL 协议并返回安全值:危险协议(javascript:/vbscript:/非图片 data:)返回空串,否则原值。
 *  供 Editor 的 link/image DOM 后处理使用,剥离 Markdown 链接与图片 URL 中的危险协议。 */
export function sanitizeUrl(url: string): string {
  return isSafeUrl(url) ? url : "";
}

function sanitizeElement(el: Element): void {
  // 先递归子节点(取静态副本,避免遍历中删除影响迭代)
  for (const child of Array.from(el.children)) sanitizeElement(child);

  const tag = el.tagName.toLowerCase();
  if (!ALLOWED_TAGS.has(tag)) {
    el.remove();
    return;
  }
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase();
    // on* 事件属性一律剥离
    if (name.startsWith("on")) {
      el.removeAttribute(attr.name);
      continue;
    }
    // 非白名单属性剥离
    if (!ALLOWED_ATTRS.has(name)) {
      el.removeAttribute(attr.name);
      continue;
    }
    // URL 属性校验协议
    if (URL_ATTRS.has(name) && !isSafeUrl(attr.value)) {
      el.removeAttribute(attr.name);
    }
  }
}

/** 清洗 HTML 字符串:返回仅含白名单标签 / 属性的安全 HTML。 */
export function sanitizeHtml(html: string): string {
  if (!html) return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  sanitizeElement(doc.body);
  return doc.body.innerHTML;
}
