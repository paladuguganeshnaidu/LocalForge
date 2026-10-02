export function renderChatMarkdown(value: string): string {
  const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const inline = (text: string): string => {
    const tokens = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^\s)]+\))/g;
    let rendered = '';
    let position = 0;
    for (const match of text.matchAll(tokens)) {
      rendered += escape(text.slice(position, match.index));
      const token = match[0];
      if (token.startsWith('`')) rendered += '<code>' + escape(token.slice(1, -1)) + '</code>';
      else if (token.startsWith('**')) rendered += '<strong>' + escape(token.slice(2, -2)) + '</strong>';
      else if (token.startsWith('*')) rendered += '<em>' + escape(token.slice(1, -1)) + '</em>';
      else {
        const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token)!;
        let safe = false;
        try {
          const url = new URL(link[2]);
          safe = ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password;
        } catch {}
        rendered += safe ? '<a href="' + escape(link[2]) + '" rel="noreferrer noopener">' + escape(link[1]) + '</a>' : escape(token);
      }
      position = match.index! + token.length;
    }
    return rendered + escape(text.slice(position));
  };
  const blocks: string[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  let listType = '';
  let code: string[] | undefined;
  let language = '';
  const flushParagraph = () => {
    if (paragraph.length) blocks.push('<p>' + paragraph.map(inline).join('<br>') + '</p>');
    paragraph = [];
  };
  const flushList = () => {
    if (list.length) blocks.push('<' + listType + '>' + list.join('') + '</' + listType + '>');
    list = [];
    listType = '';
  };
  for (const line of String(value ?? '').replace(/\r/g, '').split('\n')) {
    const fence = /^\s*```\s*([\w+-]*)/.exec(line);
    if (fence) {
      flushParagraph();
      flushList();
      if (code) {
        blocks.push('<pre><code' + (language ? ' class="language-' + escape(language) + '"' : '') + '>' + escape(code.join('\n')) + '</code></pre>');
        code = undefined;
      } else { code = []; language = fence[1]; }
      continue;
    }
    if (code) { code.push(line); continue; }
    const item = /^\s*(?:([-*+])|\d+[.)])\s+(.+)$/.exec(line);
    if (item) {
      flushParagraph();
      const type = item[1] ? 'ul' : 'ol';
      if (listType && listType !== type) flushList();
      listType = type;
      list.push('<li>' + inline(item[2]) + '</li>');
      continue;
    }
    flushList();
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph();
      const level = heading[1].length;
      blocks.push('<h' + level + '>' + inline(heading[2]) + '</h' + level + '>');
    } else if (/^>\s?/.test(line)) {
      flushParagraph();
      blocks.push('<blockquote>' + inline(line.replace(/^>\s?/, '')) + '</blockquote>');
    } else if (!line.trim()) flushParagraph();
    else paragraph.push(line);
  }
  if (code) blocks.push('<pre><code>' + escape(code.join('\n')) + '</code></pre>');
  flushParagraph();
  flushList();
  return blocks.join('');
}
