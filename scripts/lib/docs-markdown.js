import { marked } from 'marked';

// Один разбор для ссылок, примеров и текста. Разметка не удаляет символы
// идентификаторов: GH_PAT и выделенное _слово_ имеют разную структуру.
export function parseDocumentation(source, { blockSeparator = '\n', maskVersionIdentifiers = false } = {}) {
  const tokens = marked.lexer(source);
  const links = [];
  const examples = [];
  const jsonExamples = [];
  marked.walkTokens(tokens, (token) => {
    if (token.type === 'link' || token.type === 'image') links.push(token.href);
    if (token.type === 'code' && ['js', 'javascript'].includes(token.lang)) examples.push(token.text);
    if (token.type === 'code' && token.lang === 'json') jsonExamples.push(token.text);
  });
  function text(token) {
    if (token.type === 'table') {
      return [token.header, ...token.rows].map((row) => row.map(text).join(' ')).join(blockSeparator);
    }
    const children = token.tokens ?? token.items;
    const content = children ? children.reduce((result, child) => {
      // Marker и code literal должны находиться в одном inline-контексте.
      const version = maskVersionIdentifiers && child.type === 'codespan' && /^\d+$/.test(child.text) &&
        /(?:^|[^\p{L}\p{N}_])(?:версия|version)\s*[:=]?\s*$/iu.test(result);
      return result + (version ? 'version-id' : text(child));
    }, '') : token.text ?? '';
    return ['paragraph', 'heading', 'list', 'list_item', 'code', 'blockquote'].includes(token.type)
      ? `${blockSeparator}${content}${blockSeparator}` : content;
  }
  return { links, examples, jsonExamples, text: tokens.map(text).join('') };
}
