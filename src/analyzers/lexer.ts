import type { SupportedLanguage } from '../types.js';

export function detectLanguage(posixPath: string): SupportedLanguage | null {
  if (/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/i.test(posixPath)) return 'ts';
  if (/\.py$/i.test(posixPath)) return 'python';
  if (/\.go$/i.test(posixPath)) return 'go';
  if (/\.rs$/i.test(posixPath)) return 'rust';
  return null;
}

type LexerState = 'NORMAL' | 'LINE_COMMENT' | 'BLOCK_COMMENT' | 'STRING' | 'TEMPLATE_LITERAL';

export function stripCommentsAndStrings(source: string, lang: SupportedLanguage): string {
  let out = '';
  let state: LexerState = 'NORMAL';
  let i = 0;
  let blockCommentDepth = 0;
  let quoteChar = '';
  let isTripleQuote = false;
  let isRawString = false;
  let rawStringHashCount = 0;

  const stack: { state: LexerState; braceDepth?: number }[] = [];
  let braceDepth = 0;

  while (i < source.length) {
    const ch = source[i] || '';
    const n1 = source[i + 1] || '';
    const n2 = source[i + 2] || '';

    if (state === 'NORMAL') {
      if (ch === '{' || ch === '}') {
        if (ch === '{') braceDepth++;
        if (ch === '}') {
          braceDepth--;
          if (stack.length > 0 && stack[stack.length - 1]!.state === 'TEMPLATE_LITERAL' && braceDepth === stack[stack.length - 1]!.braceDepth) {
            state = stack.pop()!.state;
            out += ch;
            i++;
            continue;
          }
        }
        out += ch;
        i++;
        continue;
      }

      if (lang === 'python' && ch === '#') {
        state = 'LINE_COMMENT';
        out += ' ';
        i++;
        continue;
      } else if (lang !== 'python') {
        if (ch === '/' && n1 === '/') {
          state = 'LINE_COMMENT';
          out += '  ';
          i += 2;
          continue;
        }
        if (ch === '/' && n1 === '*') {
          state = 'BLOCK_COMMENT';
          blockCommentDepth = 1;
          out += '  ';
          i += 2;
          continue;
        }
      }

      if (lang === 'python') {
        if ((ch === '"' && n1 === '"' && n2 === '"') || (ch === "'" && n1 === "'" && n2 === "'")) {
          state = 'STRING';
          quoteChar = ch;
          isTripleQuote = true;
          out += ch + ch + ch;
          i += 3;
          continue;
        }
        if (ch === '"' || ch === "'") {
          state = 'STRING';
          quoteChar = ch;
          isTripleQuote = false;
          out += ch;
          i++;
          continue;
        }
      } else if (lang === 'rust') {
        if (ch === 'r') {
          let hashes = 0;
          let j = i + 1;
          while (j < source.length && (source[j] || '') === '#') { hashes++; j++; }
          if (j < source.length && (source[j] || '') === '"') {
            state = 'STRING';
            rawStringHashCount = hashes;
            isRawString = true;
            out += source.substring(i, j + 1);
            i = j + 1;
            continue;
          }
        }
        if (ch === "'") {
          if (/[a-zA-Z_]/.test(n1)) {
            let j = i + 1;
            while (j < source.length && /[a-zA-Z0-9_]/.test(source[j] || '')) j++;
            if (j < source.length && (source[j] || '') === "'") {
              state = 'STRING';
              quoteChar = "'";
              out += ch;
              i++;
              continue;
            } else {
              out += ch;
              i++;
              continue;
            }
          } else {
            state = 'STRING';
            quoteChar = "'";
            out += ch;
            i++;
            continue;
          }
        }
        if (ch === '"') {
          state = 'STRING';
          quoteChar = '"';
          out += ch;
          i++;
          continue;
        }
      } else if (lang === 'go') {
        if (ch === '`') {
          state = 'STRING';
          quoteChar = '`';
          isRawString = true;
          out += ch;
          i++;
          continue;
        }
        if (ch === '"' || ch === "'") {
          state = 'STRING';
          quoteChar = ch;
          out += ch;
          i++;
          continue;
        }
      } else if (lang === 'ts') {
        if (ch === '`') {
          state = 'TEMPLATE_LITERAL';
          out += ch;
          i++;
          continue;
        }
        if (ch === '"' || ch === "'") {
          state = 'STRING';
          quoteChar = ch;
          out += ch;
          i++;
          continue;
        }
      }

      out += ch;
      i++;
    } else if (state === 'LINE_COMMENT') {
      if (ch === '\n') {
        state = 'NORMAL';
        out += '\n';
      } else {
        out += ' ';
      }
      i++;
    } else if (state === 'BLOCK_COMMENT') {
      if (ch === '\n') {
        out += '\n';
        i++;
      } else if (lang === 'rust' && ch === '/' && n1 === '*') {
        blockCommentDepth++;
        out += '  ';
        i += 2;
      } else if (ch === '*' && n1 === '/') {
        blockCommentDepth--;
        if (blockCommentDepth === 0) {
          state = 'NORMAL';
        }
        out += '  ';
        i += 2;
      } else {
        out += ' ';
        i++;
      }
    } else if (state === 'STRING') {
      if (ch === '\n') {
        out += '\n';
        i++;
        continue;
      }
      if (lang === 'rust' && isRawString) {
        if (ch === '"') {
          let match = true;
          for (let k = 0; k < rawStringHashCount; k++) {
            if ((source[i + 1 + k] || '') !== '#') { match = false; break; }
          }
          if (match) {
            state = 'NORMAL';
            out += '"' + '#'.repeat(rawStringHashCount);
            i += 1 + rawStringHashCount;
            isRawString = false;
            continue;
          }
        }
        out += ' ';
        i++;
        continue;
      }

      if (lang === 'go' && isRawString && ch === '`') {
        state = 'NORMAL';
        out += '`';
        i++;
        isRawString = false;
        continue;
      }

      if (!isRawString && ch === '\\') {
        out += '  ';
        i += 2;
        continue;
      }

      if (lang === 'python' && isTripleQuote) {
        if (ch === quoteChar && n1 === quoteChar && n2 === quoteChar) {
          state = 'NORMAL';
          isTripleQuote = false;
          out += ch + ch + ch;
          i += 3;
          continue;
        }
      } else {
        if (ch === quoteChar) {
          state = 'NORMAL';
          out += ch;
          i++;
          continue;
        }
      }

      out += ' ';
      i++;
    } else if (state === 'TEMPLATE_LITERAL') {
      if (ch === '\n') {
        out += '\n';
        i++;
        continue;
      }
      if (ch === '\\') {
        out += '  ';
        i += 2;
        continue;
      }
      if (ch === '$' && n1 === '{') {
        stack.push({ state: 'TEMPLATE_LITERAL', braceDepth });
        braceDepth++;
        state = 'NORMAL';
        out += '${';
        i += 2;
        continue;
      }
      if (ch === '`') {
        state = 'NORMAL';
        out += '`';
        i++;
        continue;
      }
      out += ' ';
      i++;
    }
  }

  return out;
}
