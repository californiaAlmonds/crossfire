import type { ExportedSymbol, SymbolReference } from '../types.js';
import { detectLanguage, stripCommentsAndStrings } from './lexer.js';

function getLineOffsets(text: string): number[] {
  const offsets = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') offsets.push(i + 1);
  }
  return offsets;
}

function offsetToLine(offsets: number[], offset: number): number {
  let l = 0, r = offsets.length - 1;
  while (l <= r) {
    const m = (l + r) >> 1;
    if ((offsets[m] || 0) <= offset) l = m + 1;
    else r = m - 1;
  }
  return l;
}

function parseArgs(cleanContent: string, startIdx: number, skipFirst = false): { min: number, max: number | null } {
  let depth = 0;
  let i = startIdx;
  let argsStr = '';
  while (i < cleanContent.length) {
    const ch = cleanContent[i] || '';
    if (ch === '(' || ch === '<' || ch === '{' || ch === '[') depth++;
    else if (ch === ')' || ch === '>' || ch === '}' || ch === ']') {
      depth--;
      if (depth === 0 && ch === ')') {
        argsStr += ch;
        break;
      }
    }
    argsStr += ch;
    i++;
  }
  
  const inner = argsStr.slice(1, -1).trim();
  if (!inner) return { min: 0, max: 0 };
  
  let currentArg = '';
  const args: string[] = [];
  let d = 0;
  for (let j = 0; j < inner.length; j++) {
    const ch = inner[j] || '';
    if (ch === '(' || ch === '<' || ch === '{' || ch === '[') d++;
    else if (ch === ')' || ch === '>' || ch === '}' || ch === ']') d--;
    else if (ch === ',' && d === 0) {
       args.push(currentArg);
       currentArg = '';
       continue;
    }
    currentArg += ch;
  }
  if (currentArg) args.push(currentArg);
  
  let min = 0;
  let max: number | null = args.length;
  for (let j = 0; j < args.length; j++) {
     const a = (args[j] || '').trim();
     if (skipFirst && j === 0 && (a === 'self' || a === 'cls' || a.endsWith('self'))) {
         max!--;
         continue;
     }
     if (a.startsWith('...') || a.startsWith('*')) {
        max = null;
        break;
     }
     const colonIdx = a.indexOf(':');
     const eqIdx = a.indexOf('=');
     const qIdx = a.indexOf('?');
     
     let isOpt = false;
     if (eqIdx !== -1 && (colonIdx === -1 || eqIdx < colonIdx || eqIdx > colonIdx)) {
         isOpt = true;
     }
     if (qIdx !== -1 && (colonIdx === -1 || qIdx < colonIdx)) {
         isOpt = true;
     }
     if (!isOpt) {
         min++;
     }
  }
  return { min, max };
}

function parseFields(cleanContent: string, startIdx: number): string[] {
  let depth = 0;
  let i = startIdx;
  let bodyStr = '';
  while (i < cleanContent.length) {
    const ch = cleanContent[i] || '';
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
         bodyStr += ch;
         break;
      }
    }
    bodyStr += ch;
    i++;
  }
  
  const inner = bodyStr.slice(1, -1);
  const fields: string[] = [];
  let d = 0;
  let currentStmt = '';
  for (let j = 0; j < inner.length; j++) {
    const ch = inner[j] || '';
    if (ch === '(' || ch === '<' || ch === '{' || ch === '[') d++;
    else if (ch === ')' || ch === '>' || ch === '}' || ch === ']') d--;
    else if ((ch === ';' || ch === ',' || ch === '\n') && d === 0) {
       if (currentStmt.trim()) {
           const stmt = currentStmt.trim();
           const colonIdx = stmt.indexOf(':');
           const qIdx = stmt.indexOf('?');
           if (colonIdx !== -1) {
               if (qIdx === -1 || qIdx > colonIdx) {
                   const name = stmt.substring(0, colonIdx).trim().split(/\s+/).pop();
                   if (name && !name.includes('(') && !name.includes('[')) fields.push(name);
               }
           } else {
               const parts = stmt.split(/\s+/);
               if (parts.length >= 2) fields.push(parts[0] || ''); // go struct roughly
           }
       }
       currentStmt = '';
       continue;
    }
    currentStmt += ch;
  }
  if (currentStmt.trim()) {
     const stmt = currentStmt.trim();
     const colonIdx = stmt.indexOf(':');
     const qIdx = stmt.indexOf('?');
     if (colonIdx !== -1 && (qIdx === -1 || qIdx > colonIdx)) {
         const name = stmt.substring(0, colonIdx).trim().split(/\s+/).pop();
         if (name && !name.includes('(') && !name.includes('[')) fields.push(name);
     } else {
         const parts = stmt.split(/\s+/);
         if (parts.length >= 2 && !stmt.includes('(')) fields.push(parts[0] || '');
     }
  }
  return fields.filter(Boolean);
}

export function extractExportedSymbols(posixPath: string, content: string): ExportedSymbol[] {
  const lang = detectLanguage(posixPath);
  if (!lang) return [];
  const cleanContent = stripCommentsAndStrings(content, lang);
  const offsets = getLineOffsets(cleanContent);
  const symbols: ExportedSymbol[] = [];

  const addRoute = (index: number, method: string, len: number) => {
      const argStart = index + len;
      const quoteMatch = content.substring(argStart).match(/^\s*(['"`])(.*?)\1/);
      if (quoteMatch) {
         const routePath = quoteMatch[2] || '';
         symbols.push({
            name: `${method.toUpperCase()} ${routePath}`, file: posixPath,
            line: offsetToLine(offsets, index), kind: 'route',
            rawSignature: `${method.toUpperCase()} ${routePath}`
         });
      }
  };

  if (lang === 'ts') {
    const declRegex = /\bexport\s+(?:default\s+)?(?:async\s+)?(function|class|interface|type|const|let)\s+([a-zA-Z0-9_$]+)/g;
    let match;
    while ((match = declRegex.exec(cleanContent)) !== null) {
      const kindStr = match[1] || '';
      const name = match[2] || '';
      let kind: ExportedSymbol['kind'] = 'const';
      if (kindStr === 'function') kind = 'function';
      else if (kindStr === 'class') kind = 'class';
      else if (kindStr === 'interface') kind = 'interface';
      else if (kindStr === 'type') kind = 'type';
      
      let minArgs: number | undefined;
      let maxArgs: number | null | undefined;
      let fields: string[] | undefined;
      
      if (kind === 'function' || kindStr === 'const' || kindStr === 'let') {
        const paramStart = cleanContent.indexOf('(', match.index);
        if (paramStart !== -1 && paramStart < match.index + 200) {
           if (kindStr === 'const' || kindStr === 'let') {
              const eqIdx = cleanContent.indexOf('=', match.index);
              if (eqIdx !== -1 && eqIdx < paramStart) kind = 'function';
           }
           if (kind === 'function') {
               const { min, max } = parseArgs(cleanContent, paramStart);
               minArgs = min; maxArgs = max;
           }
        }
      } else if (kind === 'interface' || kind === 'type') {
        const bodyStart = cleanContent.indexOf('{', match.index);
        if (bodyStart !== -1 && bodyStart < match.index + 200) {
           fields = parseFields(cleanContent, bodyStart);
        }
      }
      
      const sigEnd = cleanContent.indexOf('{', match.index);
      const nlEnd = cleanContent.indexOf('\n', match.index);
      const endIdx = sigEnd !== -1 && (nlEnd === -1 || sigEnd < nlEnd) ? sigEnd : (nlEnd !== -1 ? nlEnd : cleanContent.length);
      const rawSignature = content.substring(match.index, endIdx).trim();
      
      symbols.push({ name, file: posixPath, line: offsetToLine(offsets, match.index), kind, minArgs, maxArgs, fields, rawSignature });
    }
    
    const listRegex = /\bexport\s*\{([^}]+)\}/g;
    while ((match = listRegex.exec(cleanContent)) !== null) {
       const items = (match[1] || '').split(',');
       for (const item of items) {
          const parts = item.trim().split(/\s+as\s+/);
          if (parts[0]) {
             const name = (parts[parts.length - 1] || '').trim();
             if (name) {
                symbols.push({
                   name, file: posixPath, line: offsetToLine(offsets, match.index),
                   kind: 'const', rawSignature: `export { ${parts[0]} as ${name} }`
                });
             }
          }
       }
    }
    
    const routeRegex = /\b(?:app|router)\.(get|post|put|delete|patch)\s*\(/g;
    while ((match = routeRegex.exec(cleanContent)) !== null) {
       addRoute(match.index, match[1] || '', match[0].length);
    }
    
    if (posixPath.match(/\/route\.(ts|js)$/)) {
       const nextRouteRegex = /\bexport\s+(?:async\s+)?function\s+(GET|POST|PUT|DELETE|PATCH)\b/g;
       while ((match = nextRouteRegex.exec(cleanContent)) !== null) {
          symbols.push({
             name: match[1] || '', file: posixPath, line: offsetToLine(offsets, match.index),
             kind: 'route', rawSignature: content.substring(match.index, match.index + match[0].length).trim()
          });
       }
    }
  } else if (lang === 'python') {
    const pyDefRegex = /^async\s+def\s+([a-zA-Z0-9_]+)\s*\(|^def\s+([a-zA-Z0-9_]+)\s*\(/gm;
    let match;
    while ((match = pyDefRegex.exec(cleanContent)) !== null) {
      const name = match[1] || match[2] || '';
      if (name.startsWith('_')) continue;
      const { min, max } = parseArgs(cleanContent, match.index + match[0].length - 1);
      const nlEnd = cleanContent.indexOf('\n', match.index);
      const rawSignature = content.substring(match.index, nlEnd !== -1 ? nlEnd : cleanContent.length).trim().replace(/:$/, '');
      symbols.push({ name, file: posixPath, line: offsetToLine(offsets, match.index), kind: 'function', minArgs: min, maxArgs: max, rawSignature });
    }
    const pyClassRegex = /^class\s+([a-zA-Z0-9_]+)/gm;
    while ((match = pyClassRegex.exec(cleanContent)) !== null) {
      const name = match[1] || '';
      if (name.startsWith('_')) continue;
      const nlEnd = cleanContent.indexOf('\n', match.index);
      symbols.push({ name, file: posixPath, line: offsetToLine(offsets, match.index), kind: 'class', rawSignature: content.substring(match.index, nlEnd !== -1 ? nlEnd : cleanContent.length).trim().replace(/:$/, '') });
    }
    const pyRouteRegex = /^@(?:app|router)\.(get|post|put|delete|patch)\s*\(/gm;
    while ((match = pyRouteRegex.exec(cleanContent)) !== null) {
       addRoute(match.index, match[1] || '', match[0].length);
    }
  } else if (lang === 'go') {
    const goFuncRegex = /^func\s+([A-Z][a-zA-Z0-9_]*)\s*\(/gm;
    let match;
    while ((match = goFuncRegex.exec(cleanContent)) !== null) {
      const { min, max } = parseArgs(cleanContent, match.index + match[0].length - 1);
      const nlEnd = cleanContent.indexOf('{', match.index);
      const name = match[1] || '';
      symbols.push({ name, file: posixPath, line: offsetToLine(offsets, match.index), kind: 'function', minArgs: min, maxArgs: max, rawSignature: content.substring(match.index, nlEnd !== -1 ? nlEnd : cleanContent.length).trim() });
    }
    const goTypeRegex = /^type\s+([A-Z][a-zA-Z0-9_]*)\s+struct\s*\{/gm;
    while ((match = goTypeRegex.exec(cleanContent)) !== null) {
      const fields = parseFields(cleanContent, match.index + match[0].length - 1);
      const name = match[1] || '';
      symbols.push({ name, file: posixPath, line: offsetToLine(offsets, match.index), kind: 'type', fields, rawSignature: `type ${name} struct` });
    }
  } else if (lang === 'rust') {
    const rustFnRegex = /^\s*pub(?:\s*\([^)]*\))?\s+(?:async\s+)?(?:unsafe\s+)?fn\s+([a-zA-Z0-9_]+)\s*\(/gm;
    let match;
    while ((match = rustFnRegex.exec(cleanContent)) !== null) {
      const { min, max } = parseArgs(cleanContent, match.index + match[0].length - 1, true);
      const sigEnd = cleanContent.indexOf('{', match.index);
      const nlEnd = cleanContent.indexOf('\n', match.index);
      const endIdx = sigEnd !== -1 && (nlEnd === -1 || sigEnd < nlEnd) ? sigEnd : (nlEnd !== -1 ? nlEnd : cleanContent.length);
      const name = match[1] || '';
      symbols.push({ name, file: posixPath, line: offsetToLine(offsets, match.index), kind: 'function', minArgs: min, maxArgs: max, rawSignature: content.substring(match.index, endIdx).trim() });
    }
    const rustStructRegex = /^\s*pub(?:\s*\([^)]*\))?\s+struct\s+([a-zA-Z0-9_]+)\s*\{/gm;
    while ((match = rustStructRegex.exec(cleanContent)) !== null) {
      const fields = parseFields(cleanContent, match.index + match[0].length - 1);
      const name = match[1] || '';
      symbols.push({ name, file: posixPath, line: offsetToLine(offsets, match.index), kind: 'class', fields, rawSignature: `pub struct ${name}` });
    }
  }

  return symbols;
}

export function extractSymbolReferences(posixPath: string, content: string): SymbolReference[] {
  const lang = detectLanguage(posixPath);
  if (!lang) return [];
  const cleanContent = stripCommentsAndStrings(content, lang);
  const offsets = getLineOffsets(cleanContent);
  const refs: SymbolReference[] = [];
  const localAliasMap = new Map<string, string>();

  let match;
  if (lang === 'ts') {
    const tsImportRegex = /\bimport\s*\{([^}]+)\}\s*from\s*['"`]([^'"`]+)['"`]/g;
    while ((match = tsImportRegex.exec(content)) !== null) {
      const fromModule = match[2] || '';
      const items = (match[1] || '').split(',');
      for (const item of items) {
        const parts = item.trim().split(/\s+as\s+/);
        if (parts[0]) {
          const original = parts[0].trim();
          const alias = (parts[parts.length - 1] || '').trim();
          localAliasMap.set(alias, original);
          refs.push({ name: original, file: posixPath, line: offsetToLine(offsets, match.index), kind: 'import', fromModule });
        }
      }
    }
  } else if (lang === 'python') {
    const pyImportRegex = /^\s*from\s+([a-zA-Z0-9_.]+)\s+import\s+([^#\n]+)/gm;
    while ((match = pyImportRegex.exec(content)) !== null) {
      const fromModule = match[1] || '';
      const items = (match[2] || '').split(',');
      for (const item of items) {
        const parts = item.trim().split(/\s+as\s+/);
        if (parts[0]) {
          const original = parts[0].trim();
          const alias = (parts[parts.length - 1] || '').trim();
          localAliasMap.set(alias, original);
          refs.push({ name: original, file: posixPath, line: offsetToLine(offsets, match.index), kind: 'import', fromModule });
        }
      }
    }
  } else if (lang === 'rust') {
    const rustImportRegex = /^\s*use\s+([a-zA-Z0-9_:]+)::\{([^}]+)\}/gm;
    while ((match = rustImportRegex.exec(content)) !== null) {
      const fromModule = match[1] || '';
      const items = (match[2] || '').split(',');
      for (const item of items) {
        const parts = item.trim().split(/\s+as\s+/);
        if (parts[0]) {
          const original = parts[0].trim();
          const alias = (parts[parts.length - 1] || '').trim();
          localAliasMap.set(alias, original);
          refs.push({ name: original, file: posixPath, line: offsetToLine(offsets, match.index), kind: 'import', fromModule });
        }
      }
    }
  }

  const callRegex = /\b([a-zA-Z0-9_$]+)\s*\(/g;
  const skipKeywords = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'sizeof', 'typeof', 'match', 'fn', 'def', 'func']);
  while ((match = callRegex.exec(cleanContent)) !== null) {
    const ident = match[1] || '';
    if (skipKeywords.has(ident)) continue;
    if (match.index > 0 && (cleanContent[match.index - 1] || '') === '.') continue; // skip member calls for simplicity
    
    const { min, max } = parseArgs(cleanContent, match.index + match[0].length - 1);
    const resolvedName = localAliasMap.get(ident) || ident;
    refs.push({ name: resolvedName, file: posixPath, line: offsetToLine(offsets, match.index), kind: 'call', argCount: max === null ? undefined : max });
  }

  const typeRefRegex = /\b([A-Z][a-zA-Z0-9_]*)\b/g;
  while ((match = typeRefRegex.exec(cleanContent)) !== null) {
    const ident = match[1] || '';
    if (match.index > 0 && (cleanContent[match.index - 1] || '') === '.') continue;
    const resolvedName = localAliasMap.get(ident) || ident;
    refs.push({ name: resolvedName, file: posixPath, line: offsetToLine(offsets, match.index), kind: 'type_ref' });
  }

  return refs;
}
