/* ===== 代码块语法高亮:ProseMirror inline Decoration 方案 =====
   单层 DOM:ProseMirror 在默认 <pre><code> 里渲染文本节点,本插件只给每个
   token 加 inline decoration(color),文本与颜色在同一层 → 不存在两层
   对齐问题 → 不会因高亮产生高度跳变/抖动。

   对比已废弃的"grid 双层叠加"方案(高光层 + contentDOM 叠在同一格):
   - 双层方案要求两层像素级对齐,异步高亮替换 innerHTML / 聚焦失焦切换时
     高度只要有 1px 差异,grid 单元格就跳变,整篇文档跟着抖。
   - 本方案 decoration 只改 color,不改布局,高度恒定。 */

import { $proseAsync } from "@milkdown/kit/utils";
import { editorViewCtx } from "@milkdown/kit/core";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { findChildren } from "@milkdown/kit/prose";
import { codeBlockSchema } from "@milkdown/kit/preset/commonmark";
import { createHighlighter, type Highlighter } from "shiki";
import type { Node as PmNode } from "@milkdown/kit/prose/model";
import type { Ctx } from "@milkdown/kit/ctx";

/* Shiki highlighter 单例:首次 await 仅加载主题(不预载任何语言),之后同步复用。
   预加载 github-light / github-dark 双主题,运行时按 currentTheme 切换,
   配合应用 data-theme(暗色底用 github-dark,token 色才可读)。
   语言按需加载:遇到具体代码块时由 ensureLanguage 调 loadLanguage,各语言为独立
   chunk,只有文档真正出现的语言才下载——原方案硬编码 17 语言,首屏无论有无代码块
   都同步加载约 1.8MB grammar(cpp 一个就 768K)。 */
let hlPromise: Promise<Highlighter> | null = null;
function getHL(): Promise<Highlighter> {
  if (!hlPromise) {
    hlPromise = createHighlighter({
      themes: ["github-light", "github-dark"],
      langs: [],
    });
  }
  return hlPromise;
}

/* 按需加载语言:记录在途 / 失败的语言,避免重复触发 loadLanguage。
   loadLanguage 返回 Promise(各自动态 import 对应 grammar chunk),完成后
   dispatch force-highlight 让 ProseMirror 重算 decoration → 代码块由无色变高亮。
   失败(不支持的语言名等)记入 failedLangs,避免反复重试。 */
const loadingLangs = new Set<string>();
const failedLangs = new Set<string>();
function ensureLanguage(ctx: Ctx, lang: string, hl: Highlighter): void {
  if (!lang || loadingLangs.has(lang) || failedLangs.has(lang)) return;
  if (hl.getLoadedLanguages().includes(lang)) return;
  loadingLangs.add(lang);
  void hl
    .loadLanguage(lang as never)
    .then(() => {
      loadingLangs.delete(lang);
      // 语法加载完成:触发重算 decoration(此时该 lang 已可着色)。
      try {
        const view = ctx.get(editorViewCtx);
        view.dispatch(view.state.tr.setMeta("force-highlight", true));
      } catch {
        /* view 已销毁,忽略 */
      }
    })
    .catch(() => {
      loadingLangs.delete(lang);
      failedLangs.add(lang);
    });
}

/* 当前高亮主题(模块级):由 setShikiTheme 切换。
   初始读取 <html data-theme>,默认 light。 */
let currentTheme: "github-light" | "github-dark" = "github-light";

/** 切换 Shiki 高亮主题并强制重算所有代码块 decoration。
    App 在主题变化时调用;resolved 为实际明暗模式。 */
export function setShikiTheme(resolved: "light" | "dark") {
  currentTheme = resolved === "dark" ? "github-dark" : "github-light";
  // 通知所有活跃编辑器实例重算:监听该事件并 dispatch force-highlight
  window.dispatchEvent(new CustomEvent("soulmark:shiki-theme"));
}

/** 读取当前高亮主题名 */
export function getShikiTheme() {
  return currentTheme;
}

const highlightKey = new PluginKey("shiki-highlight");

/* token 缓存:ProseMirror 节点不可变,编辑某块时仅该 block node 被替换,其余 block node 引用不变。
   以 node 为 WeakMap key 缓存其 token 化结果(text+lang+theme 一致即命中),
   避免每次按键对所有代码块全量 codeToTokens(大文档主线程卡顿的根因)。
   position 仍每次重算(便宜),仅 token 化(贵)走缓存。theme 切换时 key 含 theme,自动失效。 */
type ShikiToken = { content: string; color?: string };
type BlockCache = { text: string; lang: string; theme: string; tokens: ShikiToken[][] };
const tokenCache = new WeakMap<PmNode, BlockCache>();

/* 遍历 doc 中所有 code_block,对每个块的文本做 token 化,
   用 inline decoration 给每个 token 染色。
   pos 从 block.pos+1 起算(block 节点起始位置 +1 进入内部文本),
   并对 textEnd 做 clamp,防止尾随换行导致的越界 decoration。 */
function buildDecorations(
  ctx: Ctx,
  doc: PmNode,
  hl: Highlighter,
): DecorationSet {
  const codeBlockType = codeBlockSchema.type(ctx);
  const blocks = findChildren((n) => n.type === codeBlockType)(doc);
  const decorations: Decoration[] = [];

  for (const block of blocks) {
    const text = block.node.textContent;
    if (!text) continue;

    const language = (block.node.attrs.language as string) || "";
    const loaded = hl.getLoadedLanguages();
    const lang = language && loaded.includes(language) ? language : "";
    // 语言未加载:触发按需 loadLanguage(异步),完成后 dispatch force-highlight 重算。
    // 本轮该块不着色(下方 !lang continue),加载完成后的重算会着色。
    if (language && !lang) ensureLanguage(ctx, language, hl);
    if (!lang) continue; // 无语言或语言包未加载:不着色,退化为普通文本(不抖动)

    // 命中缓存则复用 token,未命中才 codeToTokens(大文档按键只重算被编辑的块)
    let cache = tokenCache.get(block.node);
    if (!cache || cache.text !== text || cache.lang !== lang || cache.theme !== currentTheme) {
      try {
        // lang 已由 getLoadedLanguages() 运行时校验,断言为 shiki 期望的字面量联合类型
        const { tokens } = hl.codeToTokens(text, {
          lang: lang as never,
          theme: currentTheme,
        });
        cache = { text, lang, theme: currentTheme, tokens: tokens as unknown as ShikiToken[][] };
        tokenCache.set(block.node, cache);
      } catch {
        /* 单块 token 化失败跳过,不影响其他块 */
        continue;
      }
    }

    const textStart = block.pos + 1; // code_block 起始标记占 1,内部文本从 +1 起
    const textEnd = textStart + text.length;
    let pos = textStart;

    for (const line of cache.tokens) {
      for (const token of line) {
        const len = token.content.length;
        if (len > 0 && pos + len <= textEnd) {
          decorations.push(
            Decoration.inline(pos, pos + len, {
              style: `color: ${token.color}`,
            }),
          );
        }
        pos += len;
      }
      pos += 1; // 行间换行符占 1
    }
  }

  return DecorationSet.create(doc, decorations);
}

/* $proseAsync:先 await highlighter 就绪,再返回 Plugin。
   插件 state 在 init 与 docChanged 时重算 decoration;主题切换时由外部
   dispatch force-highlight meta 触发重算;选区变化直接复用,避免无谓重算。 */
export const shikiHighlightPlugin = $proseAsync(async (ctx) => {
  const hl = await getHL();
  return new Plugin({
    key: highlightKey,
    state: {
      init: (_, { doc }) => buildDecorations(ctx, doc, hl),
      apply: (tr, value) => {
        if (tr.docChanged || tr.getMeta("force-highlight")) {
          return buildDecorations(ctx, tr.doc, hl);
        }
        // 选区/存储标记变化:decoration 位置不变,直接复用
        return value;
      },
    },
    props: {
      decorations: (state) => highlightKey.getState(state),
    },
  });
});
