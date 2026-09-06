import { marked } from 'marked';

// Один разбор для ссылок, примеров и текста. Разметка не удаляет символы
// идентификаторов: GH_PAT и выделенное _слово_ имеют разную структуру.
export function parseDocumentation(source) {
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
      return [token.header, ...token.rows].map((row) => row.map(text).join(' ')).join('\n');
    }
    const children = token.tokens ?? token.items;
    const content = children ? children.map(text).join('') : token.text ?? '';
    return ['paragraph', 'heading', 'list', 'list_item', 'code', 'blockquote'].includes(token.type)
      ? `\n${content}\n` : content;
  }
  return { links, examples, jsonExamples, text: tokens.map(text).join('') };
}
